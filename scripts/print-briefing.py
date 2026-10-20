#!/usr/bin/env python3
"""Render and optionally print the current Hapics morning briefing.

Dependencies: uv run --no-project --with reportlab --with pypdf python scripts/print-briefing.py
"""

import argparse
import html
import json
import os
from pathlib import Path
import re
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
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer


ZONE = ZoneInfo("Europe/Bucharest")
DEFAULT_URL = "https://news.hapics.uk/data/latest.json"
DEFAULT_PRINTER = "Canon_MX490_series"
STATE_DIR = Path.home() / ".local" / "state" / "hapics-news"
ROOT = Path(__file__).resolve().parents[1]


def register_fonts():
    choices = [
        (Path("/System/Library/Fonts/Supplemental/Arial.ttf"), Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
    ]
    for regular, bold in choices:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont("Briefing", str(regular)))
            pdfmetrics.registerFont(TTFont("Briefing-Bold", str(bold)))
            pdfmetrics.registerFontFamily("Briefing", normal="Briefing", bold="Briefing-Bold")
            return
    raise RuntimeError("No Romanian-capable Arial or DejaVu font found")


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


def render_pdf(edition, destination):
    register_fonts()
    date, updated, items = validate_edition(edition, require_today=False)
    destination.parent.mkdir(parents=True, exist_ok=True)
    ranked = sorted(enumerate(items), key=lambda pair: (-pair[1]["impact"], pair[0]))
    dark = colors.HexColor("#18352d")
    muted = colors.HexColor("#59655f")
    headline = ParagraphStyle("headline", fontName="Briefing-Bold", fontSize=12.2, leading=15,
                              textColor=dark, spaceAfter=3)
    body = ParagraphStyle("body", fontName="Briefing", fontSize=10.3, leading=14.3,
                          textColor=colors.HexColor("#202522"), alignment=TA_LEFT)
    source = ParagraphStyle("source", fontName="Briefing", fontSize=8, leading=11,
                            textColor=muted)
    label = ParagraphStyle("label", fontName="Briefing-Bold", fontSize=8, leading=11,
                           textColor=dark, spaceAfter=5)
    title = ParagraphStyle("title", fontName="Briefing-Bold", fontSize=19, leading=22,
                           textColor=dark)
    small = ParagraphStyle("small", fontName="Briefing", fontSize=7.4, leading=10,
                           textColor=muted)

    opening = [
        paragraph("HAPICS  /  BRIEFING DE DIMINEAȚĂ", label),
        paragraph(f"Știrile zilei · {datetime.fromisoformat(date).strftime('%d.%m.%Y')}", title),
        Spacer(1, 4),
        paragraph("Subiectele principale, ordonate după impactul editorial.", small),
        Spacer(1, 9),
        HRFlowable(width="100%", thickness=0.8, color=dark),
        Spacer(1, 8),
    ]
    indicators = [x for x in edition.get("indicators", []) if x.get("freshness") == "current" and x.get("value") is not None][:3]
    for count in range(min(6, len(ranked)), 2, -1):
        selected = ranked[:count]
        story = list(opening)
        for position, (_, item) in enumerate(selected, 1):
            category = html.escape(item.get("category", "Știri"))
            fact = html.escape(item["fact"])
            source_name = html.escape(item["sourceName"])
            source_url = html.escape(item["sourceUrl"], quote=True)
            block = [
                Paragraph(f"{position:02d}  {html.escape(item['title'])}", headline),
                Paragraph(fact, body),
                Spacer(1, 4),
                Paragraph(f"{category}  ·  Sursă: <link href='{source_url}' color='#59655f'>{source_name}</link>", source),
                Spacer(1, 11),
                HRFlowable(width="100%", thickness=0.35, color=colors.HexColor("#c8cfca")),
                Spacer(1, 11),
            ]
            story.append(KeepTogether(block))

        if indicators:
            story.append(paragraph("INDICATORI VERIFICAȚI", label))
            story.append(paragraph("   ·   ".join(f"{x['label']}: {x['value']} {x['unit']} ({x['referenceDate']})" for x in indicators), small))
            story.append(Spacer(1, 8))
        story.append(paragraph(
            f"Publicat: {updated.astimezone(ZONE).strftime('%H:%M')} · Ediția completă și linkurile surselor: news.hapics.uk",
            small,
        ))

        document = SimpleDocTemplate(str(destination), pagesize=A4, rightMargin=39, leftMargin=39,
                                     topMargin=37, bottomMargin=37, title=f"Hapics News {date}",
                                     author="Hapics News")
        document.build(story)
        reader = PdfReader(str(destination))
        if len(reader.pages) != 1:
            continue
        extracted = reader.pages[0].extract_text() or ""
        if any(item["title"] not in extracted for _, item in selected):
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
