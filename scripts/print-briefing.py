#!/usr/bin/env python3
"""Render and optionally print the current Hapics morning briefing.

Dependencies: uv run --no-project --with reportlab --with pypdf python scripts/print-briefing.py
"""

import argparse
import html
import json
import os
from pathlib import Path
import random
import subprocess
import sys
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ZONE = ZoneInfo("Europe/Bucharest")
DEFAULT_URL = "https://news.hapics.uk/data/latest.json"
DEFAULT_PRINTER = "Canon_MX490_series"
STATE_DIR = Path.home() / ".local" / "state" / "hapics-news"
ROOT = Path(__file__).resolve().parents[1]
PRINT_INDICATORS = (("rotx", "ROTX"), ("eur-ron", "EUR/RON"), ("usd-ron", "USD/RON"))
INNOVATION_CATEGORIES = {"Tehnologie", "Știință", "Spațiu", "Sănătate", "Climă"}
DISCOVERY_CATEGORIES = INNOVATION_CATEGORIES | {"Sport"}
PAGE_INSET = 8


def register_fonts():
    sans_choices = [
        (Path("/System/Library/Fonts/Supplemental/Arial.ttf"), Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
    ]
    serif_choices = [
        (Path("/System/Library/Fonts/Supplemental/Georgia.ttf"), Path("/System/Library/Fonts/Supplemental/Georgia Bold.ttf")),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf")),
    ]
    for regular, bold in sans_choices:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont("Briefing", str(regular)))
            pdfmetrics.registerFont(TTFont("Briefing-Bold", str(bold)))
            pdfmetrics.registerFontFamily("Briefing", normal="Briefing", bold="Briefing-Bold")
            break
    else:
        raise RuntimeError("No Romanian-capable Arial or DejaVu font found")
    for regular, bold in serif_choices:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont("BriefingSerif", str(regular)))
            pdfmetrics.registerFont(TTFont("BriefingSerif-Bold", str(bold)))
            return
    raise RuntimeError("No Romanian-capable Georgia or DejaVu Serif font found")


def fetch_edition(url):
    separator = "&" if "?" in url else "?"
    request = Request(f"{url}{separator}{urlencode({'v': int(datetime.now().timestamp())})}",
                      headers={"User-Agent": "hapics-news-local-print/1.0", "Cache-Control": "no-cache"})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def validate_edition(edition, require_today):
    metadata = edition["metadata"]
    date = metadata["editionDate"]
    updated = datetime.fromisoformat(metadata["updatedAt"])
    if metadata["status"] != "published" or updated.tzinfo is None:
        raise ValueError("Only timestamped published editions can be printed")
    if updated.astimezone(ZONE).date().isoformat() != date:
        raise ValueError("Edition date and publication timestamp differ")
    if updated > datetime.now(ZONE):
        raise ValueError("Publication timestamp is in the future")
    if require_today and date != datetime.now(ZONE).date().isoformat():
        raise ValueError(f"Latest edition is {date}, not today's edition")
    items = edition.get("importantNews", [])
    if len(items) < 3:
        raise ValueError("At least three verified stories are required")
    for item in items:
        if not all(item.get(key) for key in ("title", "fact", "sourceName", "sourceUrl")):
            raise ValueError("Every selected story needs a fact and source")
    return date, updated, items


def paragraph(value, style):
    return Paragraph(html.escape(str(value)), style)


def format_indicator(indicator, compact=False):
    value = indicator["value"]
    if value is None or indicator.get("freshness") == "unavailable":
        return (f"{html.escape(str(indicator['label']))} indisponibil" if compact
                else f"{indicator['label']}: indisponibil")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        decimals = 4 if indicator["id"] in ("eur-ron", "usd-ron") else 2
        value = f"{value:,.{decimals}f}"
        value = value.replace(",", "_").replace(".", ",").replace("_", ".")
    date_format = "%d.%m" if compact else "%d.%m.%Y"
    date = datetime.fromisoformat(indicator["referenceDate"]).strftime(date_format)
    if compact:
        unit = "pct" if indicator["id"] == "rotx" else indicator["unit"]
        age = " · ultim" if indicator.get("freshness") == "stale" else ""
        return (f"{html.escape(str(indicator['label']))} <b>{html.escape(str(value))}</b> "
                f"{html.escape(str(unit))} · {date}{age}")
    age = " · ultimul curs" if indicator.get("freshness") == "stale" else ""
    return f"{indicator['label']}: {value} {indicator['unit']} ({date}){age}"


def select_stories(ranked, count):
    """Keep the lead and give significant world, sport and discovery news a fair chance."""
    selected = [ranked[0]]
    groups = [{"Extern"}] if count >= 4 else []
    if count >= 5:
        groups.append(DISCOVERY_CATEGORIES)
    for categories in groups:
        candidate = next((pair for pair in ranked[1:]
                          if pair[1]["impact"] >= 4 and pair[1]["category"] in categories
                          and pair not in selected), None)
        if candidate:
            selected.append(candidate)
    selected.extend(pair for pair in ranked[1:] if pair not in selected)
    picked = selected[:count]
    return [ranked[0]] + sorted(picked[1:], key=ranked.index)


def sudoku_solution_count(grid, limit=2):
    best = None
    choices = None
    for row in range(9):
        for column in range(9):
            if grid[row][column]:
                continue
            used = set(grid[row]) | {grid[index][column] for index in range(9)}
            used |= {grid[r][c] for r in range(row // 3 * 3, row // 3 * 3 + 3)
                     for c in range(column // 3 * 3, column // 3 * 3 + 3)}
            available = set(range(1, 10)) - used
            if not available:
                return 0
            if choices is None or len(available) < len(choices):
                best, choices = (row, column), available
    if best is None:
        return 1
    row, column = best
    found = 0
    for value in sorted(choices):
        grid[row][column] = value
        found += sudoku_solution_count(grid, limit - found)
        grid[row][column] = 0
        if found >= limit:
            break
    return found


def sudoku_for_date(date):
    """Create a repeatable 9x9 puzzle with exactly one solution for each date."""
    rng = random.Random(datetime.fromisoformat(date).date().toordinal())
    digits = list(range(1, 10))
    rng.shuffle(digits)

    def ordered_lines():
        groups = [0, 1, 2]
        rng.shuffle(groups)
        result = []
        for group in groups:
            band = [group * 3 + offset for offset in range(3)]
            rng.shuffle(band)
            result.extend(band)
        return result

    rows, columns = ordered_lines(), ordered_lines()
    solution = [[digits[(r * 3 + r // 3 + c) % 9] for c in columns] for r in rows]
    puzzle = [row[:] for row in solution]
    cells = [(row, column) for row in range(9) for column in range(9)]
    rng.shuffle(cells)
    for row, column in cells:
        old = puzzle[row][column]
        puzzle[row][column] = 0
        if sudoku_solution_count(puzzle) != 1:
            puzzle[row][column] = old
        if sum(value != 0 for line in puzzle for value in line) <= 36:
            break
    return puzzle, solution


def render_pdf(edition, destination, proof=False):
    register_fonts()
    date, updated, items = validate_edition(edition, require_today=False)
    destination.parent.mkdir(parents=True, exist_ok=True)
    ranked = sorted(enumerate(items), key=lambda pair: (-pair[1]["impact"], pair[0]))
    dark = colors.HexColor("#17201d")
    accent = colors.HexColor("#1e594a")
    muted = colors.HexColor("#4f5753")
    line = colors.HexColor("#c6cbc7")
    brand = ParagraphStyle("brand", fontName="BriefingSerif-Bold", fontSize=28, leading=31, textColor=dark)
    dateline = ParagraphStyle("dateline", fontName="Briefing-Bold", fontSize=12, leading=16,
                              textColor=muted, alignment=2)
    eyebrow = ParagraphStyle("eyebrow", fontName="Briefing-Bold", fontSize=12, leading=15,
                             textColor=accent)
    lead_title = ParagraphStyle("lead-title", fontName="BriefingSerif-Bold", fontSize=20.5, leading=24,
                                textColor=dark, spaceAfter=8)
    secondary_title = ParagraphStyle("secondary-title", fontName="BriefingSerif-Bold", fontSize=14.2,
                                     leading=17.2, textColor=dark, spaceAfter=4)
    body = ParagraphStyle("body", fontName="Briefing", fontSize=12, leading=15.2,
                          textColor=dark, alignment=TA_LEFT)
    indicator_style = ParagraphStyle("indicator", fontName="Briefing", fontSize=12,
                                     leading=15, textColor=dark)
    puzzle_label = ParagraphStyle("puzzle-label", fontName="Briefing-Bold", fontSize=12,
                                  leading=15, textColor=accent)
    puzzle_instruction = ParagraphStyle("puzzle-instruction", fontName="Briefing",
                                        fontSize=12, leading=15, textColor=muted)

    content_width = A4[0] - 2 * PAGE_INSET
    gutter = 18
    column_width = (content_width - gutter) / 2
    issue_date = datetime.fromisoformat(date).strftime("%d.%m.%Y")
    header = Table([[
        [Paragraph("HAPICS", brand), Paragraph("BRIEFINGUL DIMINEȚII · PROBĂ" if proof else "BRIEFINGUL DIMINEȚII", eyebrow)],
        [Paragraph(issue_date, dateline), Paragraph("ROMÂNIA · LUME · PIEȚE", dateline)],
    ]], colWidths=[content_width * .64, content_width * .36])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    def story_label(item, number, kind=None):
        category = html.escape((kind or item.get("category", "Știri")).upper())
        source_name = html.escape(item["sourceName"])
        source_url = html.escape(item["sourceUrl"], quote=True)
        return Paragraph(
            f"{number:02d} / {category} · <link href='{source_url}' color='#4f5753'>{source_name}</link>",
            eyebrow,
        )

    def secondary_story(item, number, full=False):
        return [
            story_label(item, number),
            Spacer(1, 2),
            Paragraph(html.escape(item["title"]), secondary_title),
            paragraph(item["fact"] if full else item.get("printSummary") or item["fact"], body),
            Spacer(1, 3),
            HRFlowable(width="100%", thickness=.35, color=line),
            Spacer(1, 3),
        ]

    def watchlist_panel():
        watched = edition.get("watchlist", [])
        if not watched:
            return []
        item = watched[0]
        return [
            Paragraph(f"DE URMĂRIT · {html.escape(item['title'])}", eyebrow),
            Spacer(1, 2),
            paragraph(item["trigger"], body),
        ]

    def sudoku_panel():
        puzzle, _ = sudoku_for_date(date)
        grid = Table([[str(value) if value else "" for value in row] for row in puzzle],
                     colWidths=[19] * 9, rowHeights=[19] * 9, hAlign="CENTER")
        grid.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), "Briefing-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 12),
            ("TEXTCOLOR", (0, 0), (-1, -1), dark),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), .35, line),
            ("BOX", (0, 0), (-1, -1), 1.1, dark),
            ("LINEAFTER", (2, 0), (2, -1), 1.1, dark),
            ("LINEAFTER", (5, 0), (5, -1), 1.1, dark),
            ("LINEBELOW", (0, 2), (-1, 2), 1.1, dark),
            ("LINEBELOW", (0, 5), (-1, 5), 1.1, dark),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        panel = Table([[
            [Table([[Paragraph("SUDOKU", puzzle_label),
                     Paragraph("1–9 / rând, coloană, casetă 3×3", puzzle_instruction)]],
                   colWidths=[66, column_width - 66],
                   style=TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0),
                                     ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                     ("TOPPADDING", (0, 0), (-1, -1), 0),
                                     ("BOTTOMPADDING", (0, 0), (-1, -1), 0)])),
             Spacer(1, 4), grid],
        ]], colWidths=[column_width])
        panel.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return panel

    available_indicators = {indicator["id"]: indicator for indicator in edition.get("indicators", [])}
    indicators = [
        {**available_indicators.get(identifier, {"id": identifier, "value": None, "freshness": "unavailable"}),
         "label": label}
        for identifier, label in PRINT_INDICATORS
    ]
    attempts = []
    for count in range(min(9, len(ranked)), 2, -1):
        if count == 8:
            variants = (((6, 8), True), ((8,), True), ((6,), True), ((), True),
                        ((6, 8), False), ((8,), False), ((6,), False), ((), False))
        elif count == 7:
            variants = (((2, 4, 6), True), ((2, 4, 6), False), ((4, 6), True),
                        ((4, 6), False), ((6,), True), ((6,), False),
                        ((), True), ((), False))
        elif count == 6:
            variants = (((6,), False), ((6,), True), ((4, 6), False),
                        ((4, 6), True), ((), True), ((), False))
        else:
            variants = (((), False),)
        attempts.extend((count, expanded_indices, show_watchlist) for expanded_indices, show_watchlist in variants)
    for count, expanded_indices, show_watchlist in attempts:
        selected = select_stories(ranked, count)
        lead = selected[0][1]
        story = [
            header,
            Spacer(1, 6),
            HRFlowable(width="100%", thickness=1.6, color=dark),
            Spacer(1, 11),
            story_label(lead, 1, "Principal"),
            Spacer(1, 4),
            Paragraph(html.escape(lead["title"]), lead_title),
            paragraph(lead.get("printSummary") or lead["fact"], body),
            Spacer(1, 8),
            HRFlowable(width="100%", thickness=.7, color=dark),
            Spacer(1, 7),
            Paragraph("ÎN RESTUL EDIȚIEI", eyebrow),
            Spacer(1, 7),
        ]
        left = []
        right = []
        for index, (_, item) in enumerate(selected[1:], 2):
            (left if index % 2 == 0 else right).extend(
                secondary_story(item, index, full=index in expanded_indices))
        if show_watchlist:
            left.extend(watchlist_panel())
        right.append(sudoku_panel())
        columns = Table([[left, right]], colWidths=[column_width, column_width], hAlign="LEFT")
        columns.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (0, 0), 0),
            ("RIGHTPADDING", (0, 0), (0, 0), gutter),
            ("LEFTPADDING", (1, 0), (1, 0), 0),
            ("RIGHTPADDING", (1, 0), (1, 0), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(columns)
        story.append(Spacer(1, 4))
        story.append(HRFlowable(width="100%", thickness=.7, color=dark))
        story.append(Spacer(1, 7))
        strip = Table([[Paragraph(format_indicator(indicator, compact=True), indicator_style)
                        for indicator in indicators]], colWidths=[content_width / 3] * 3)
        strip.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(strip)

        def draw_footer(canvas, _document):
            canvas.saveState()
            canvas.setFont("Briefing", 12)
            canvas.setFillColor(muted)
            footer = (
                f"Probă generată {datetime.now(ZONE).strftime('%H:%M')} · Sursele sunt asociate fiecărei știri"
                if proof else
                f"Publicat {updated.astimezone(ZONE).strftime('%H:%M')} · Articolele și sursele complete: news.hapics.uk"
            )
            canvas.drawString(PAGE_INSET, 12, footer)
            canvas.restoreState()

        document = SimpleDocTemplate(str(destination), pagesize=A4,
                                     rightMargin=PAGE_INSET, leftMargin=PAGE_INSET,
                                     topMargin=PAGE_INSET, bottomMargin=18,
                                     title=f"Hapics News {date}",
                                     author="Hapics News")
        document.build(story, onFirstPage=draw_footer)
        reader = PdfReader(str(destination))
        if len(reader.pages) != 1:
            continue
        extracted = " ".join((reader.pages[0].extract_text() or "").split())
        if any(" ".join(item["title"].split()) not in extracted for _, item in selected):
            destination.unlink(missing_ok=True)
            raise ValueError("PDF text check failed")
        return count
    destination.unlink(missing_ok=True)
    raise ValueError("At least three stories could not fit on one A4 page")


def submit_once(pdf_path, date, printer):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    marker = STATE_DIR / f"printed-{date}.json"
    try:
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise RuntimeError(f"Print already attempted for {date}: {marker}")
    with os.fdopen(fd, "w") as stream:
        json.dump({"date": date, "status": "submitting", "pdf": str(pdf_path)}, stream)
    try:
        result = subprocess.run(["lp", "-d", printer, "-o", "PageSize=A4.Fullbleed", "-o", "ColorModel=Gray",
                                 "-n", "1", str(pdf_path)], capture_output=True, text=True, check=True)
    except Exception:
        marker.unlink(missing_ok=True)
        raise
    marker.write_text(json.dumps({"date": date, "status": "submitted", "printer": printer,
                                  "job": result.stdout.strip(), "pdf": str(pdf_path)}, indent=2) + "\n")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--url", default=DEFAULT_URL)
    source.add_argument("--file", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--printer", default=DEFAULT_PRINTER)
    parser.add_argument("--print", action="store_true", dest="print_job")
    parser.add_argument("--proof", action="store_true", help="Mark a local selection as a proof, never a published edition")
    parser.add_argument("--allow-stale", action="store_true", help="Only for previewing an archived edition")
    args = parser.parse_args()
    if args.print_job and args.allow_stale:
        parser.error("--print cannot be combined with --allow-stale")
    if args.print_job and args.file:
        parser.error("--print requires the published live URL")
    if args.print_job and args.proof:
        parser.error("--print cannot be combined with --proof")

    edition = json.loads(args.file.read_text()) if args.file else fetch_edition(args.url)
    date, _, _ = validate_edition(edition, require_today=not args.allow_stale)
    output = args.output or ROOT / "output" / "pdf" / f"hapics-briefing-{date}.pdf"
    count = render_pdf(edition, output, proof=args.proof)
    print(f"Validated one-page A4 PDF with {count} stories: {output}")
    if args.print_job:
        print(submit_once(output, date, args.printer))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Print briefing failed: {error}", file=sys.stderr)
        sys.exit(1)
