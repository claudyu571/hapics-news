import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "print-briefing.py"
spec = importlib.util.spec_from_file_location("print_briefing", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrintBriefingTest(unittest.TestCase):
    def setUp(self):
        self.edition = json.loads((SCRIPT.parents[1] / "data" / "archive" / "2026-09-16.json").read_text())

    def test_old_edition_is_rejected_for_daily_print(self):
        with self.assertRaisesRegex(ValueError, "not today's edition"):
            module.validate_edition(self.edition, require_today=True)

    def test_pdf_is_a4_and_one_page(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "briefing.pdf"
            count = module.render_pdf(self.edition, path)
            reader = module.PdfReader(str(path))
            self.assertGreaterEqual(count, 3)
            self.assertEqual(len(reader.pages), 1)
            self.assertAlmostEqual(float(reader.pages[0].mediabox.width), 595.28, places=1)

    def test_five_stories_fit_with_short_print_summaries(self):
        summaries = [
            "Biziday: randamentul titlurilor românești la zece ani a ajuns la 7,35% în seara de 15 septembrie, pe fondul vânzărilor internaționale de obligațiuni.",
            "Planul de reluare a exporturilor de ovine și caprine a fost trimis Comisiei Europene, potrivit guvernului; aprobarea rămâne necesară.",
            "Qatarul cere menținerea deschisă a strâmtorii Bab el-Mandeb; avertismentul privește o posibilă închidere, nu una confirmată.",
            "Comandantul Andrii Biletski afirmă că Ucraina desfășoară o ofensivă în Donețk; câștigurile teritoriale nu au fost verificate independent.",
            "Parlamentul European a adoptat un raport care propune un centru de reziliență democratică și protejarea infrastructurii electorale.",
        ]
        for item, summary in zip(self.edition["importantNews"][:5], summaries):
            item["printSummary"] = summary
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "briefing.pdf"
            self.assertEqual(module.render_pdf(self.edition, path), 5)
            reader = module.PdfReader(str(path))
            self.assertEqual(len(reader.pages), 1)
            text = " ".join(reader.pages[0].extract_text().split())
            self.assertIn("ROTX · CURS BNR", text)
            self.assertIn("EUR/RON", text)
            self.assertIn("USD/RON", text)
            self.assertNotIn("Indice BET", text)
            self.assertNotIn("ROBOR 3M", text)
            for item in self.edition["importantNews"][:5]:
                self.assertIn(" ".join(item["title"].split()), text)

    def test_current_style_edition_fits_five_stories(self):
        edition = json.loads((SCRIPT.parents[1] / "data" / "archive" / "2026-10-21.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "briefing.pdf"
            self.assertEqual(module.render_pdf(edition, path), 5)
            self.assertEqual(len(module.PdfReader(str(path)).pages), 1)

    def test_exchange_rates_keep_four_decimal_places(self):
        indicator = {"id": "usd-ron", "label": "USD/RON", "value": 4.7, "unit": "lei",
                     "referenceDate": "2026-10-20", "freshness": "current"}
        self.assertEqual(module.format_indicator(indicator), "USD/RON: 4,7000 lei (20.10.2026)")
        indicator["value"] = None
        indicator["freshness"] = "unavailable"
        self.assertEqual(module.format_indicator(indicator), "USD/RON: indisponibil")

    def test_duplicate_job_does_not_reach_printer(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(module, "STATE_DIR", Path(directory)), patch.object(module.subprocess, "run") as run:
                run.return_value.stdout = "request id is Canon_MX490_series-1"
                module.submit_once(Path(directory) / "briefing.pdf", "2026-10-21", "Canon_MX490_series")
                with self.assertRaisesRegex(RuntimeError, "already attempted"):
                    module.submit_once(Path(directory) / "briefing.pdf", "2026-10-21", "Canon_MX490_series")
                run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
