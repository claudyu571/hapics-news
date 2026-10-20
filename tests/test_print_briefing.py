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
        self.edition = json.loads((SCRIPT.parents[1] / "data" / "latest.json").read_text())

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
