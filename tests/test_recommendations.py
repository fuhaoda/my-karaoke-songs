import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.collect_recommendations import fetch_issues, parse_recommendation, render_recommendations, write_atomic


def issue(song="花开忘忧", artist="周深", **overrides):
    item = {"title": "[歌曲推荐] 想唱的歌", "state": "open", "body": f"### 歌名\n\n{song}\n\n### 演唱者\n\n{artist}\n\n### 备注\n\n_No response_"}
    item.update(overrides)
    return item


class RecommendationTests(unittest.TestCase):
    def test_parses_form_and_optional_artist(self):
        self.assertEqual(parse_recommendation(issue()), ("花开忘忧", "周深"))
        self.assertEqual(parse_recommendation(issue(artist="_No response_")), ("花开忘忧", ""))

    def test_excludes_unrelated_closed_and_pull_requests(self):
        for overrides in [{"title": "Bug"}, {"state": "closed"}, {"pull_request": {}}, {"body": None}]:
            with self.subTest(overrides=overrides):
                self.assertIsNone(parse_recommendation(issue(**overrides)))

    def test_rejects_missing_multiline_control_and_long_fields(self):
        for song in ["", "first\nsecond", "bad\x00name", "bad\u2028name", "a" * 121]:
            with self.subTest(song=song):
                self.assertIsNone(parse_recommendation(issue(song=song)))
        self.assertIsNone(parse_recommendation(issue(artist="one\ntwo")))

    def test_rejects_duplicate_form_headings(self):
        malformed = issue()
        malformed["body"] += "\n\n### 歌名\n\n别的歌"
        self.assertIsNone(parse_recommendation(malformed))

    def test_deduplicates_unicode_case_and_preserves_distinct_artists(self):
        items = [issue("Ｈｅｌｌｏ", "Adele"), issue("hello", "ADELE"), issue("hello", "Lionel Richie"), issue("花开忘忧", "_No response_")]
        rendered = render_recommendations(items)
        self.assertEqual(rendered, render_recommendations(reversed(items)))
        self.assertEqual(len(rendered.splitlines()), 3)
        self.assertIn("hello - Lionel Richie\n", rendered)
        self.assertIn("花开忘忧\n", rendered)

    def test_shell_syntax_remains_inert_plain_text(self):
        song = '$(touch /tmp/never-run); `whoami` <script>'
        self.assertEqual(render_recommendations([issue(song)]), f"{song} - 周深\n")

    def test_paginates_full_issue_history(self):
        requests = []
        pages = [[issue(song=str(number)) for number in range(100)], [issue(song="last")]]
        def opener(request, timeout):
            requests.append(request)
            return io.BytesIO(json.dumps(pages[len(requests) - 1]).encode())
        self.assertEqual(len(fetch_issues("fuhaoda/my-karaoke-songs", "test-token", opener)), 101)
        self.assertIn("page=2", requests[1].full_url)
        self.assertEqual(requests[0].get_header("Authorization"), "Bearer test-token")
        self.assertIn("state=all", requests[0].full_url)

    def test_api_failures_leave_existing_file_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "recommended_to_add.txt"
            output.write_text("already here\n")
            def opener(request, timeout):
                raise OSError("offline")
            with self.assertRaises(OSError):
                contents = render_recommendations(fetch_issues("owner/repo", "test-token", opener))
                write_atomic(output, contents)
            self.assertEqual(output.read_text(), "already here\n")

    def test_atomic_output_and_invalid_repository(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "recommended_to_add.txt"
            write_atomic(output, "中文歌 - 歌手\n")
            self.assertEqual(output.read_bytes(), "中文歌 - 歌手\n".encode())
            self.assertEqual(list(Path(folder).iterdir()), [output])
        with self.assertRaises(ValueError):
            fetch_issues("owner/repo/../../elsewhere", "test-token")


if __name__ == "__main__":
    unittest.main()
