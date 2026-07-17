"""Danbooru tag verification helpers for NAIS blue's Tauri Python sidecars.

This module is intentionally independent from ``tagger_server.py`` so the GUI
can import or expose these helpers later without changing the existing WD
tagger sidecar lifecycle in ``src-tauri/src/lib.rs``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
import json
import re
import time
from typing import Iterable, Iterator, Literal, Mapping
import urllib.parse
import urllib.request


DANBOORU_TAGS_ENDPOINT = "https://danbooru.donmai.us/tags.json"
USER_AGENT = "nais2-danbooru-tag-verify/1.0"
CACHE_SIZE = 4096
FUZZY_SUGGESTION_LIMIT = 5
LOW_POST_COUNT_THRESHOLD = 100
HTTP_TIMEOUT_SECONDS = 15
REQUEST_THROTTLE_SECONDS = 0.12

TagStatus = Literal["OK", "LOW", "GHOST", "ERROR", "SKIPPED"]

_WEIGHTED_TAG_RE = re.compile(r"^[+-]?\d+(?:\.\d+)?::(?P<tag>.*?)::$")
_FRAGMENT_RE = re.compile(r"^<[^<>]+>$")
_SEPARATOR_RE = re.compile(r"[,;\n]+")
_SPACE_RE = re.compile(r"\s+")
_UNDERSCORE_RE = re.compile(r"_+")
_BRACKET_TRANSLATION = str.maketrans("", "", "{}[]()")


@dataclass(frozen=True, slots=True)
class Suggestion:
    """A fuzzy Danbooru tag candidate returned for ghost tags."""

    name: str
    postCount: int


@dataclass(frozen=True, slots=True)
class TagVerifyResult:
    """Verification result consumed by the future NAIS blue GUI integration layer."""

    raw: str
    normalized: str
    postCount: int | None
    status: TagStatus
    suggestions: list[Suggestion] = field(default_factory=list)
    error: str | None = None


def normalize_tag(raw: str) -> str:
    """Normalize one NovelAI/Danbooru tag token into Danbooru's slug format."""

    tag = raw.strip()
    if not tag or tag.startswith("#") or _FRAGMENT_RE.fullmatch(tag):
        return ""

    previous = None
    while previous != tag:
        previous = tag
        match = _WEIGHTED_TAG_RE.fullmatch(tag)
        if match:
            tag = match.group("tag").strip()

    tag = tag.translate(_BRACKET_TRANSLATION)
    tag = tag.strip().lower()
    tag = _SPACE_RE.sub("_", tag)
    tag = _UNDERSCORE_RE.sub("_", tag)
    return tag.strip("_")


def parse_tags(text: str) -> list[str]:
    """Parse prompt text into normalized tags, skipping comments and fragments."""

    return [
        normalized
        for raw in _iter_raw_tokens(text)
        if (normalized := normalize_tag(raw))
    ]


def verify_tag(
    raw: str,
    *,
    ok_threshold: int = LOW_POST_COUNT_THRESHOLD,
    fuzzy_limit: int = FUZZY_SUGGESTION_LIMIT,
) -> TagVerifyResult:
    """Verify a single raw prompt tag against Danbooru."""

    normalized = normalize_tag(raw)
    if not normalized:
        return TagVerifyResult(
            raw=raw,
            normalized="",
            postCount=None,
            status="SKIPPED",
            suggestions=[],
            error=None,
        )

    try:
        post_count = exact_search(normalized)
        if post_count >= ok_threshold:
            status: TagStatus = "OK"
            suggestions: list[Suggestion] = []
        elif post_count > 0:
            status = "LOW"
            suggestions = []
        else:
            status = "GHOST"
            suggestions = list(fuzzy_search(normalized, fuzzy_limit))

        return TagVerifyResult(
            raw=raw,
            normalized=normalized,
            postCount=post_count,
            status=status,
            suggestions=suggestions,
            error=None,
        )
    except Exception as error:  # noqa: BLE001 - library boundary returns errors as data.
        return TagVerifyResult(
            raw=raw,
            normalized=normalized,
            postCount=None,
            status="ERROR",
            suggestions=[],
            error=str(error),
        )


def verify_tags(
    raw_tags: Iterable[str],
    *,
    ok_threshold: int = LOW_POST_COUNT_THRESHOLD,
    fuzzy_limit: int = FUZZY_SUGGESTION_LIMIT,
) -> list[TagVerifyResult]:
    """Verify tags in order while preserving duplicates in the returned results."""

    return [
        verify_tag(
            raw_tag,
            ok_threshold=ok_threshold,
            fuzzy_limit=fuzzy_limit,
        )
        for raw_tag in raw_tags
    ]


def verify_prompt(
    text: str,
    *,
    ok_threshold: int = LOW_POST_COUNT_THRESHOLD,
    fuzzy_limit: int = FUZZY_SUGGESTION_LIMIT,
) -> list[TagVerifyResult]:
    """Parse prompt text and verify each tag against Danbooru."""

    return [
        verify_tag(
            raw_tag,
            ok_threshold=ok_threshold,
            fuzzy_limit=fuzzy_limit,
        )
        for raw_tag in _iter_raw_tokens(text)
    ]


@lru_cache(maxsize=CACHE_SIZE)
def exact_search(normalized_tag: str) -> int:
    """Return the exact Danbooru post count for a normalized tag."""

    data = _request_tags({"search[name]": normalized_tag, "limit": "1"})
    exact_match = next(
        (item for item in data if str(item.get("name", "")) == normalized_tag),
        None,
    )
    if exact_match is None:
        return 0
    return _as_int(exact_match.get("post_count"))


@lru_cache(maxsize=CACHE_SIZE)
def fuzzy_search(
    normalized_tag: str,
    limit: int = FUZZY_SUGGESTION_LIMIT,
) -> tuple[Suggestion, ...]:
    """Return up to five count-ordered fuzzy suggestions for a ghost tag."""

    safe_limit = max(0, min(limit, FUZZY_SUGGESTION_LIMIT))
    if safe_limit == 0:
        return ()

    data = _request_tags(
        {
            "search[name_matches]": f"*{normalized_tag}*",
            "search[order]": "count",
            "limit": str(safe_limit),
        }
    )
    return tuple(
        Suggestion(
            name=str(item.get("name", "")),
            postCount=_as_int(item.get("post_count")),
        )
        for item in data[:safe_limit]
        if item.get("name")
    )


def _iter_raw_tokens(text: str) -> Iterator[str]:
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        yield from (
            token.strip()
            for token in _SEPARATOR_RE.split(stripped)
            if token.strip() and not _FRAGMENT_RE.fullmatch(token.strip())
        )


def _request_tags(params: Mapping[str, str]) -> list[dict[str, object]]:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{DANBOORU_TAGS_ENDPOINT}?{query}",
        headers={
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )

    time.sleep(REQUEST_THROTTLE_SECONDS)
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        payload = response.read().decode("utf-8")

    data = json.loads(payload)
    if not isinstance(data, list):
        raise ValueError("Danbooru tags API returned a non-list payload")
    return [item for item in data if isinstance(item, dict)]


def _as_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdecimal():
        return int(value)
    return 0
