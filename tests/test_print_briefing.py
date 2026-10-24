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

    def test_summaries_and_sudoku_fit_on_one_page(self):
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
            count = module.render_pdf(self.edition, path)
            self.assertGreaterEqual(count, 4)
            reader = module.PdfReader(str(path))
            self.assertEqual(len(reader.pages), 1)
            text = " ".join(reader.pages[0].extract_text().split())
            self.assertIn("INDICATORI · BVB / BNR", text)
            self.assertIn("EUR/RON", text)
            self.assertIn("USD/RON", text)
            self.assertNotIn("Indice BET", text)
            self.assertNotIn("ROBOR 3M", text)
            self.assertIn("SUDOKU", text)
            ranked = sorted(enumerate(self.edition["importantNews"]),
                            key=lambda pair: (-pair[1]["impact"], pair[0]))
            for _, item in module.select_stories(ranked, count):
                self.assertIn(" ".join(item["title"].split()), text)

    def test_current_style_edition_keeps_four_stories_and_sudoku(self):
        edition = json.loads((SCRIPT.parents[1] / "data" / "archive" / "2026-10-21.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "briefing.pdf"
            self.assertGreaterEqual(module.render_pdf(edition, path), 4)
            self.assertEqual(len(module.PdfReader(str(path)).pages), 1)

    def test_proof_is_clearly_labeled(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "proof.pdf"
            module.render_pdf(self.edition, path, proof=True)
            text = module.PdfReader(str(path)).pages[0].extract_text()
            self.assertIn("BRIEFINGUL DIMINEȚII · PROBĂ", text)
            self.assertIn("Probă generată", text)

    def test_standard_sudoku_is_included(self):
        edition = json.loads((SCRIPT.parents[1] / "data" / "archive" / "2026-10-21.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "briefing.pdf"
            self.assertGreaterEqual(module.render_pdf(edition, path), 4)
            text = module.PdfReader(str(path)).pages[0].extract_text()
            self.assertIn("SUDOKU", text)
            self.assertIn("1–9 în", text)
            self.assertIn("casetă 3×3", text)
            self.assertEqual(len(module.PdfReader(str(path)).pages), 1)

    def test_daily_sudoku_has_one_solution(self):
        puzzles = []
        for day in range(21, 28):
            puzzle, solution = module.sudoku_for_date(f"2026-10-{day}")
            self.assertEqual(module.sudoku_solution_count([row[:] for row in puzzle]), 1)
            self.assertEqual(len(puzzle), 9)
            self.assertGreaterEqual(sum(value == 0 for row in puzzle for value in row), 40)
            for index in range(9):
                self.assertEqual(set(solution[index]), set(range(1, 10)))
                self.assertEqual({solution[row][index] for row in range(9)}, set(range(1, 10)))
            puzzles.append(puzzle)
        self.assertNotEqual(puzzles[0], puzzles[1])

    def test_exchange_rates_keep_four_decimal_places(self):
        indicator = {"id": "usd-ron", "label": "USD/RON", "value": 4.7, "unit": "lei",
                     "referenceDate": "2026-10-20", "freshness": "current"}
        self.assertEqual(module.format_indicator(indicator), "USD/RON: 4,7000 lei (20.10.2026)")
        indicator["value"] = None
        indicator["freshness"] = "unavailable"
        self.assertEqual(module.format_indicator(indicator), "USD/RON: indisponibil")

    def test_relevant_world_and_discovery_stories_get_print_slots(self):
        stories = [
            {"title": "Lead", "category": "Politică", "impact": 5},
            {"title": "Domestic 1", "category": "Economie", "impact": 5},
            {"title": "Domestic 2", "category": "Social", "impact": 4},
            {"title": "Domestic 3", "category": "Piețe", "impact": 4},
            {"title": "Domestic 4", "category": "Justiție", "impact": 3},
            {"title": "World", "category": "Extern", "impact": 4},
            {"title": "Discovery", "category": "Știință", "impact": 4},
        ]
        ranked = sorted(enumerate(stories), key=lambda pair: (-pair[1]["impact"], pair[0]))
        selected = module.select_stories(ranked, 5)
        self.assertEqual([pair[1]["title"] for pair in selected],
                         ["Lead", "Domestic 1", "Domestic 2", "World", "Discovery"])
        self.assertEqual([pair[1]["title"] for pair in module.select_stories(ranked, 4)],
                         ["Lead", "Domestic 1", "Domestic 2", "World"])

    def test_significant_sport_can_take_a_discovery_slot(self):
        stories = [
            {"title": "Lead", "category": "Politică", "impact": 5},
            {"title": "Local", "category": "Social", "impact": 4},
            {"title": "World", "category": "Extern", "impact": 4},
            {"title": "Sport", "category": "Sport", "impact": 4},
        ]
        ranked = list(enumerate(stories))
        self.assertIn("Sport", [pair[1]["title"] for pair in module.select_stories(ranked, 4)])

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
