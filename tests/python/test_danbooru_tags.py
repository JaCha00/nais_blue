from pathlib import Path
import sys
import unittest
from unittest.mock import patch


PYTHON_SIDECAR = Path(__file__).resolve().parents[2] / "src-tauri" / "python"
sys.path.insert(0, str(PYTHON_SIDECAR))

import danbooru_tags  # noqa: E402


class NovelAiRenamedTagTests(unittest.TestCase):
    def test_semicolon_bar_survives_prompt_tokenization(self):
        self.assertEqual(
            danbooru_tags.parse_tags("1girl, ;|, smile"),
            ["1girl", ";|", "smile"],
        )

    def test_renamed_tags_return_official_replacements_without_network(self):
        prompt = r"v, double v, |_|, \||/, :|, ;|, <|> <|>, eyepatch bikini, tachi-e"
        expected = [
            "peace sign",
            "double peace",
            "bar eyes",
            r"open \m/",
            "neutral face",
            "neutral face",
            "neco-arc eyes",
            "square bikini",
            "character image",
        ]

        with patch.object(
            danbooru_tags,
            "exact_search",
            side_effect=AssertionError("renamed tags must not call Danbooru"),
        ):
            results = danbooru_tags.verify_prompt(prompt)

        self.assertEqual([result.status for result in results], ["RENAMED"] * len(expected))
        self.assertEqual([result.recommended for result in results], expected)


if __name__ == "__main__":
    unittest.main()
