"""
Asset module plan preview for GUI-free agent self-correction.

The frontend resolver in ``src/lib/asset-modules/resolver.ts`` remains the
generation-time source for UI plans. This module mirrors the same conservative
merge rules for external editors that modify ``asset-profile.json`` and need a
local Python check immediately after writing the file.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field


DEFAULT_TARGET = "main.base"
DEFAULT_OUTPUT_DIRECTORY = "NAIS_Output"
DEFAULT_FILENAME_TEMPLATE = "{profile}_{seed}_{datetime:YYYYMMDD-HHmmss}"
DEFAULT_FILENAME_MAX_LENGTH = 180
INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1F]')
WINDOWS_RESERVED_NAME = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.I)
TOKEN_PATTERN = re.compile(r"\{([A-Za-z0-9_.]+)(?::([^{}]+))?\}")


class AssetPlanPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profilePath: str = Field(min_length=1)
    recipeId: str | None = None
    seed: int | None = None
    outputDirectory: str | None = None


class AssetPlanPreviewResponse(BaseModel):
    ok: bool
    finalPrompt: str
    negativePrompt: str
    fileName: str
    warnings: list[str]


class AssetPlanPreviewError(ValueError):
    pass


router = APIRouter()


@router.post("/asset/plan/preview", response_model=AssetPlanPreviewResponse)
def preview_asset_plan(request: AssetPlanPreviewRequest) -> AssetPlanPreviewResponse:
    try:
        return build_asset_plan_preview(request)
    except AssetPlanPreviewError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"Failed to read asset profile: {error}") from error


def build_asset_plan_preview(request: AssetPlanPreviewRequest) -> AssetPlanPreviewResponse:
    profile_path = Path(request.profilePath).expanduser().resolve()
    profile = _load_profile(profile_path)
    warnings: list[str] = []
    now = datetime.now()
    seed = request.seed if request.seed is not None else int(now.timestamp() * 1000)

    recipe = _find_recipe(profile, request.recipeId)
    if not recipe:
        warnings.append(
            f'Recipe "{request.recipeId}" is missing or disabled.'
            if request.recipeId
            else "No enabled recipe found."
        )
        file_name = _fallback_filename(now)
        return AssetPlanPreviewResponse(
            ok=False,
            finalPrompt="",
            negativePrompt="",
            fileName=file_name,
            warnings=warnings,
        )

    prompt_groups: dict[str, list[tuple[int, int, str]]] = {}
    output = dict(_as_record(profile.get("output")))
    enabled_step_count = 0
    contribution_index = 0

    for step in _as_list(recipe.get("steps")):
        if not _as_record(step):
            continue
        if step.get("enabled") is False:
            continue

        module_id = str(step.get("moduleId") or "").strip()
        module = _as_record(_as_record(profile.get("modules")).get(module_id))
        if not module:
            warnings.append(f'Module "{module_id}" referenced by recipe "{recipe.get("id")}" was not found.')
            continue
        if module.get("enabled") is False:
            continue

        enabled_step_count += 1
        output.update(_as_record(module.get("output")))
        source = {
            **module,
            **_as_record(module.get("settings")),
            **_as_record(step.get("settings")),
            **step,
        }
        order = _read_number(source, "order", 0)
        target = _read_string(source, "target") or DEFAULT_TARGET

        for prompt_target, prompt_text in _collect_prompts(source.get("prompt"), target, order):
            contribution_index += 1
            prompt_groups.setdefault(prompt_target, []).append((order, contribution_index, prompt_text))
        for prompt_target, prompt_text in _collect_prompts(source.get("prompts"), target, order):
            contribution_index += 1
            prompt_groups.setdefault(prompt_target, []).append((order, contribution_index, prompt_text))
        for prompt_target, prompt_text in _collect_prompts(source.get("targets"), target, order):
            contribution_index += 1
            prompt_groups.setdefault(prompt_target, []).append((order, contribution_index, prompt_text))

        negative = _read_string(source, "negative") or _read_string(source, "negativePrompt")
        if negative:
            contribution_index += 1
            prompt_groups.setdefault("main.negative", []).append((order, contribution_index, negative))

    output.update(_as_record(recipe.get("output")))

    resolved_groups: dict[str, str] = {}
    duplicate_warnings: list[str] = []
    for target, items in prompt_groups.items():
        merged = ", ".join(text for _order, _index, text in sorted(items))
        deduped, duplicates = _dedupe_prompt_tokens(merged)
        if deduped:
            resolved_groups[target] = deduped
        duplicate_warnings.extend(f"Duplicate tag removed in {target}: {tag}" for tag in duplicates)

    if duplicate_warnings:
        warnings.append("Duplicate tags detected")
        warnings.extend(duplicate_warnings[:10])

    if enabled_step_count == 0:
        warnings.append(f'Recipe "{recipe.get("id")}" has no enabled module steps.')

    final_prompt = resolved_groups.get("main.base") or resolved_groups.get("main.positive") or ""
    negative_prompt = resolved_groups.get("main.negative") or ""
    file_name = _build_file_name(profile, recipe, output, seed, now)

    directory = request.outputDirectory or _read_string(output, "directory") or DEFAULT_OUTPUT_DIRECTORY
    output_path = Path(directory) / file_name
    if output_path.exists():
        warnings.append("Filename already exists")

    if not final_prompt:
        warnings.append("Final prompt is empty")

    return AssetPlanPreviewResponse(
        ok=len(warnings) == 0,
        finalPrompt=final_prompt,
        negativePrompt=negative_prompt,
        fileName=file_name,
        warnings=warnings,
    )


def _load_profile(path: Path) -> dict[str, Any]:
    if not path.exists() or not path.is_file():
        raise AssetPlanPreviewError(f"Asset profile does not exist: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise AssetPlanPreviewError("Asset profile JSON root must be an object.")
    return data


def _find_recipe(profile: dict[str, Any], recipe_id: str | None) -> dict[str, Any] | None:
    recipes = [recipe for recipe in _as_list(profile.get("recipes")) if isinstance(recipe, dict)]
    if recipe_id:
        return next((recipe for recipe in recipes if recipe.get("id") == recipe_id and recipe.get("enabled") is not False), None)
    return next((recipe for recipe in recipes if recipe.get("enabled") is not False), None)


def _collect_prompts(value: Any, target: str, order: int) -> list[tuple[str, str]]:
    if isinstance(value, str):
        prompt = value.strip()
        return [(target, prompt)] if prompt else []
    if isinstance(value, list):
        prompts: list[tuple[str, str]] = []
        for item in value:
            prompts.extend(_collect_prompts(item, target, order))
        return prompts
    if not isinstance(value, dict):
        return []

    nested = _read_string(value, "prompt") or _read_string(value, "text")
    if nested:
        return [(_read_string(value, "target") or target, nested)]

    prompts = []
    for nested_target, nested_value in value.items():
        prompts.extend(_collect_prompts(nested_value, str(nested_target), order))
    return prompts


def _dedupe_prompt_tokens(prompt: str) -> tuple[str, list[str]]:
    tokens = _split_prompt_tokens(_remove_comments(prompt))
    seen: set[str] = set()
    deduped: list[str] = []
    duplicates: list[str] = []

    for token in tokens:
        key = _normalize_token_key(token)
        if not key:
            continue
        if key in seen:
            duplicates.append(token)
            continue
        seen.add(key)
        deduped.append(token)

    return ", ".join(deduped), duplicates


def _remove_comments(prompt: str) -> str:
    lines = []
    for line in prompt.replace("\r\n", "\n").split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        lines.append(line.split("#", 1)[0].strip())
    return "\n".join(line for line in lines if line)


def _split_prompt_tokens(prompt: str) -> list[str]:
    tokens: list[str] = []
    current = ""
    curly = square = round_depth = 0

    for char in prompt:
        if char in {",", "\n"} and curly == 0 and square == 0 and round_depth == 0:
            token = current.strip()
            if token:
                tokens.append(token)
            current = ""
            continue

        current += char
        if char == "{":
            curly += 1
        elif char == "}":
            curly = max(0, curly - 1)
        elif char == "[":
            square += 1
        elif char == "]":
            square = max(0, square - 1)
        elif char == "(":
            round_depth += 1
        elif char == ")":
            round_depth = max(0, round_depth - 1)

    trailing = current.strip()
    if trailing:
        tokens.append(trailing)
    return tokens


def _normalize_token_key(token: str) -> str:
    value = token.strip()
    changed = True
    while changed and len(value) >= 2:
        changed = False
        if (value.startswith("{") and value.endswith("}")) or (value.startswith("[") and value.endswith("]")):
            value = value[1:-1].strip()
            changed = True
    weight_match = re.match(r"^\s*\d+(?:\.\d+)?::(.+)::\s*$", value)
    if weight_match:
        value = weight_match.group(1)
    return re.sub(r"\s+", " ", value).strip().lower()


def _build_file_name(
    profile: dict[str, Any],
    recipe: dict[str, Any],
    output: dict[str, Any],
    seed: int,
    now: datetime,
) -> str:
    template = _read_string(output, "filenameTemplate") or DEFAULT_FILENAME_TEMPLATE
    context = {
        "profile": _read_string(_as_record(profile.get("settings")), "name") or str(profile.get("updatedBy") or "asset"),
        "recipe": {
            "id": recipe.get("id"),
            "label": recipe.get("label"),
        },
        "seed": seed,
    }
    rendered = TOKEN_PATTERN.sub(lambda match: _render_token(match, context, now), template)
    file_name = _sanitize_filename(rendered, _fallback_filename(now))
    file_format = _read_string(output, "format")
    if file_format:
        ext = file_format.lstrip(".")
        if ext and not re.search(r"\.[A-Za-z0-9]{2,5}$", file_name):
            file_name = f"{file_name}.{ext}"
    return file_name


def _render_token(match: re.Match[str], context: dict[str, Any], now: datetime) -> str:
    path = match.group(1)
    fmt = match.group(2)
    if path == "datetime":
        return _format_datetime(now, fmt or "YYYYMMDD-HHmmss")
    value = _path_value(context, path)
    if isinstance(value, int) and fmt and re.fullmatch(r"0\d+", fmt):
        return str(value).zfill(len(fmt))
    if value is None:
        return ""
    return str(value)


def _format_datetime(value: datetime, fmt: str) -> str:
    replacements = {
        "YYYY": f"{value.year:04d}",
        "YY": f"{value.year % 100:02d}",
        "MM": f"{value.month:02d}",
        "DD": f"{value.day:02d}",
        "HH": f"{value.hour:02d}",
        "mm": f"{value.minute:02d}",
        "ss": f"{value.second:02d}",
        "SSS": f"{value.microsecond // 1000:03d}",
    }
    rendered = fmt
    for token, replacement in replacements.items():
        rendered = rendered.replace(token, replacement)
    return rendered


def _sanitize_filename(value: str, fallback: str) -> str:
    normalized = INVALID_FILENAME_CHARS.sub("_", value)
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"_+", "_", normalized).strip(" ._")
    normalized = normalized[:DEFAULT_FILENAME_MAX_LENGTH].strip(" ._")
    if not normalized or WINDOWS_RESERVED_NAME.match(normalized):
        return fallback
    return normalized


def _fallback_filename(now: datetime) -> str:
    return f"NAIS_{int(now.timestamp() * 1000)}"


def _path_value(source: dict[str, Any], path: str) -> Any:
    current: Any = source
    for segment in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(segment)
    return current


def _read_string(source: dict[str, Any], key: str) -> str | None:
    value = source.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _read_number(source: dict[str, Any], key: str, fallback: int) -> int:
    value = source.get(key)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value)
    return fallback


def _as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []
