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

    def test_artist_lookup_preserves_parentheses_and_drops_nai_prefix(self):
        self.assertEqual(
            danbooru_tags.normalize_tag("artist:poper (arin sel)"),
            "poper_(arin_sel)",
        )

    def test_exact_lookup_distinguishes_zero_count_from_missing_tag(self):
        with patch.object(
            danbooru_tags,
            "_request_tags",
            side_effect=[
                [{"name": "zero_tag", "post_count": 0}],
                [],
            ],
        ):
            danbooru_tags._exact_lookup.cache_clear()
            self.assertEqual(danbooru_tags._exact_lookup("zero_tag"), (True, 0))
            self.assertEqual(danbooru_tags._exact_lookup("missing_tag"), (False, 0))
            danbooru_tags._exact_lookup.cache_clear()

    def test_zero_count_exact_tag_is_low_instead_of_ghost(self):
        with patch.object(danbooru_tags, "_exact_lookup", return_value=(True, 0)), patch.object(
            danbooru_tags,
            "fuzzy_search",
            side_effect=AssertionError("exact zero-count tags must not request fuzzy suggestions"),
        ):
            result = danbooru_tags.verify_tag("zero tag")

        self.assertEqual(result.status, "LOW")
        self.assertTrue(result.exactMatch)
        self.assertEqual(result.postCount, 0)


if __name__ == "__main__":
    unittest.main()
