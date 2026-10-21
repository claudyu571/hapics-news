#!/usr/bin/env python3
"""Render and optionally print the current Hapics morning briefing.

Dependencies: uv run --no-project --with reportlab --with pypdf python scripts/print-briefing.py
"""

import argparse
import html
import json
import os
from pathlib import Path
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


def format_indicator(indicator):
    value = indicator["value"]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = f"{value:,.2f}".rstrip("0").rstrip(".")
        value = value.replace(",", "_").replace(".", ",").replace("_", ".")
    date = datetime.fromisoformat(indicator["referenceDate"]).strftime("%d.%m.%Y")
    return f"{indicator['label']}: {value} {indicator['unit']} ({date})"


def render_pdf(edition, destination):
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
    lead_title = ParagraphStyle("lead-title", fontName="BriefingSerif-Bold", fontSize=21, leading=24.5,
                                textColor=dark, spaceAfter=8)
    secondary_title = ParagraphStyle("secondary-title", fontName="BriefingSerif-Bold", fontSize=14.2,
                                     leading=17.2, textColor=dark, spaceAfter=6)
    body = ParagraphStyle("body", fontName="Briefing", fontSize=12, leading=15.5,
                          textColor=dark, alignment=TA_LEFT)
    source = ParagraphStyle("source", fontName="Briefing", fontSize=12, leading=15,
                            textColor=muted)
    stat = ParagraphStyle("stat", fontName="Briefing-Bold", fontSize=14, leading=17, textColor=dark)
    small = ParagraphStyle("small", fontName="Briefing", fontSize=12, leading=15, textColor=muted)

    content_width = A4[0] - 80
    gutter = 22
    column_width = (content_width - gutter) / 2
    issue_date = datetime.fromisoformat(date).strftime("%d.%m.%Y")
    header = Table([[
        [Paragraph("HAPICS", brand), Paragraph("BRIEFINGUL DIMINEȚII", eyebrow)],
        [Paragraph(issue_date, dateline), Paragraph("ROMÂNIA · LUME · PIEȚE", dateline)],
    ]], colWidths=[content_width * .64, content_width * .36])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    def source_line(item):
        category = html.escape(item.get("category", "Știri"))
        source_name = html.escape(item["sourceName"])
        source_url = html.escape(item["sourceUrl"], quote=True)
        return Paragraph(
            f"{category} · Sursă: <link href='{source_url}' color='#4f5753'>{source_name}</link>",
            source,
        )

    def secondary_story(item, number):
        return [
            Paragraph(f"{number:02d}  /  {html.escape(item.get('category', 'Știri')).upper()}", eyebrow),
            Spacer(1, 4),
            Paragraph(html.escape(item["title"]), secondary_title),
            paragraph(item.get("printSummary") or item["fact"], body),
            Spacer(1, 5),
            source_line(item),
            Spacer(1, 10),
            HRFlowable(width="100%", thickness=.35, color=line),
            Spacer(1, 10),
        ]

    indicators = [x for x in edition.get("indicators", []) if x.get("freshness") == "current" and x.get("value") is not None][:3]
    for count in range(min(5, len(ranked)), 2, -1):
        selected = ranked[:count]
        lead = selected[0][1]
        story = [
            header,
            Spacer(1, 8),
            HRFlowable(width="100%", thickness=1.6, color=dark),
            Spacer(1, 15),
            Paragraph("01  /  PRINCIPAL", eyebrow),
            Spacer(1, 5),
            Paragraph(html.escape(lead["title"]), lead_title),
            paragraph(lead["fact"], body),
            Spacer(1, 7),
            source_line(lead),
            Spacer(1, 15),
            HRFlowable(width="100%", thickness=.7, color=dark),
            Spacer(1, 9),
            Paragraph("ÎN RESTUL EDIȚIEI", eyebrow),
            Spacer(1, 10),
        ]
        left = []
        right = []
        for index, (_, item) in enumerate(selected[1:], 2):
            (left if index % 2 == 0 else right).extend(secondary_story(item, index))
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
        story.append(Spacer(1, 8))
        if indicators:
            story.append(HRFlowable(width="100%", thickness=.7, color=dark))
            story.append(Spacer(1, 8))
            story.append(Paragraph("PIEȚE · DATE VERIFICATE", eyebrow))
            story.append(Spacer(1, 7))
            indicator_cells = []
            for indicator in indicators:
                formatted = format_indicator(indicator)
                label_text, value_text = formatted.split(": ", 1)
                indicator_cells.append([
                    paragraph(label_text, small),
                    paragraph(value_text, stat),
                ])
            indicator_cells.extend([[]] * (3 - len(indicator_cells)))
            strip = Table([indicator_cells], colWidths=[content_width / 3] * 3)
            strip.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]))
            story.append(strip)
            story.append(Spacer(1, 12))
        story.append(HRFlowable(width="100%", thickness=.35, color=line))

        def draw_footer(canvas, _document):
            canvas.saveState()
            canvas.setFont("Briefing", 12)
            canvas.setFillColor(muted)
            canvas.drawString(
                40, 22,
                f"Publicat {updated.astimezone(ZONE).strftime('%H:%M')} · Articolele și sursele complete: news.hapics.uk",
            )
            canvas.restoreState()

        document = SimpleDocTemplate(str(destination), pagesize=A4, rightMargin=40, leftMargin=40,
                                     topMargin=38, bottomMargin=38, title=f"Hapics News {date}",
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
        result = subprocess.run(["lp", "-d", printer, "-o", "media=A4", "-o", "ColorModel=Gray",
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
    parser.add_argument("--allow-stale", action="store_true", help="Only for previewing an archived edition")
    args = parser.parse_args()
    if args.print_job and args.allow_stale:
        parser.error("--print cannot be combined with --allow-stale")
    if args.print_job and args.file:
        parser.error("--print requires the published live URL")

    edition = json.loads(args.file.read_text()) if args.file else fetch_edition(args.url)
    date, _, _ = validate_edition(edition, require_today=not args.allow_stale)
    output = args.output or ROOT / "output" / "pdf" / f"hapics-briefing-{date}.pdf"
    count = render_pdf(edition, output)
    print(f"Validated one-page A4 PDF with {count} stories: {output}")
    if args.print_job:
        print(submit_once(output, date, args.printer))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Print briefing failed: {error}", file=sys.stderr)
        sys.exit(1)
