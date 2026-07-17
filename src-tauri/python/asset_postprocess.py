"""
NAIS blue deployment image post-processing.

This module is registered by ``tagger_server.py`` so the Tauri app can reuse the
existing local Python sidecar without touching the WD Tagger model cache. It
owns the pixel-only export path used after ``src/lib/generation-metadata.ts``
creates a matching sidecar snapshot in the frontend.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field


DEFAULT_BACKGROUND_RGBA = (0, 0, 0, 255)

FORMAT_TO_MIME = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}

EXTENSION_TO_FORMAT = {
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".png": "PNG",
    ".webp": "WEBP",
}

MIME_TO_FORMAT = {
    "image/jpeg": "JPEG",
    "image/jpg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}


class AssetPostprocessRequest(BaseModel):
    """Request body shared with ``src/services/asset-postprocess-service.ts``."""

    model_config = ConfigDict(extra="forbid")

    image_base64: str = Field(min_length=1)
    mime: str = Field(default="image/png", min_length=1)
    output_path: str = Field(min_length=1)
    metadata_path: str = Field(min_length=1)
    sidecar: dict[str, Any] = Field(default_factory=dict)
    strip: bool = True
    clean_blur_radius: float = Field(default=0.0, ge=0.0)


class AssetPostprocessResponse(BaseModel):
    success: bool
    output_path: str
    metadata_path: str
    mime: str
    width: int
    height: int
    stripped: bool
    blurred: bool
    alpha_composited: bool


class AssetPostprocessError(ValueError):
    """Raised for request-data problems that should become HTTP 400."""


router = APIRouter()


@router.post("/asset/postprocess", response_model=AssetPostprocessResponse)
async def asset_postprocess_endpoint(
    request: AssetPostprocessRequest,
) -> AssetPostprocessResponse:
    """Run CPU and disk-heavy image cleanup outside FastAPI's event loop."""

    try:
        return await asyncio.to_thread(postprocess_asset, request)
    except AssetPostprocessError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to write postprocessed asset: {error}",
        ) from error


def postprocess_asset(request: AssetPostprocessRequest) -> AssetPostprocessResponse:
    """Strip deploy-time metadata, optionally blur pixels, and write sidecar JSON."""

    raw_bytes = _decode_base64_image(request.image_base64)
    original = _load_image(raw_bytes)

    try:
        image = ImageOps.exif_transpose(original)
        alpha_composited = _has_alpha_channel(image)

        if alpha_composited:
            image = _composite_alpha_on_black(image)
        else:
            image = image.convert("RGB")

        blurred = request.clean_blur_radius > 0
        if blurred:
            image = image.filter(ImageFilter.GaussianBlur(radius=request.clean_blur_radius))

        output_format = _resolve_output_format(request.mime, request.output_path)
        image_to_save = _prepare_image_for_save(
            image,
            output_format=output_format,
            strip=request.strip,
        )

        _atomic_save_image(
            image_to_save,
            Path(request.output_path),
            output_format=output_format,
            strip=request.strip,
            original=original,
        )
        _atomic_write_json(Path(request.metadata_path), request.sidecar)

        return AssetPostprocessResponse(
            success=True,
            output_path=request.output_path,
            metadata_path=request.metadata_path,
            mime=FORMAT_TO_MIME[output_format],
            width=image_to_save.width,
            height=image_to_save.height,
            stripped=request.strip,
            blurred=blurred,
            alpha_composited=alpha_composited,
        )
    finally:
        original.close()


def _decode_base64_image(image_base64: str) -> bytes:
    payload = image_base64.strip()
    if payload.lower().startswith("data:") and "," in payload:
        payload = payload.split(",", 1)[1]

    payload = "".join(payload.split())
    remainder = len(payload) % 4
    if remainder:
        payload += "=" * (4 - remainder)

    try:
        return base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as error:
        raise AssetPostprocessError("image_base64 is not valid base64 image data") from error


def _load_image(raw_bytes: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(raw_bytes))
        image.load()
        return image
    except UnidentifiedImageError as error:
        raise AssetPostprocessError("image_base64 does not contain a supported image") from error


def _has_alpha_channel(image: Image.Image) -> bool:
    return (
        image.mode in {"RGBA", "LA"}
        or "A" in image.getbands()
        or (image.mode == "P" and "transparency" in image.info)
    )


def _composite_alpha_on_black(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, DEFAULT_BACKGROUND_RGBA)
    background.alpha_composite(rgba)
    return background.convert("RGB")


def _resolve_output_format(mime: str, output_path: str) -> str:
    path_format = EXTENSION_TO_FORMAT.get(Path(output_path).suffix.lower())
    if path_format:
        return path_format

    normalized_mime = mime.split(";", 1)[0].strip().lower()
    return MIME_TO_FORMAT.get(normalized_mime, "PNG")


def _prepare_image_for_save(
    image: Image.Image,
    *,
    output_format: str,
    strip: bool,
) -> Image.Image:
    save_mode = "RGB" if output_format in {"JPEG", "PNG", "WEBP"} else image.mode
    converted = image.convert(save_mode)

    if not strip:
        return converted

    # Copy only pixel data so EXIF/XMP/PNG/WebP metadata held in Image.info cannot
    # be propagated by an encoder. This is why tagger_server.py can safely expose
    # the route for deploy exports while metadata lives in the .nais-blue.json sidecar.
    pixel_only = Image.new(converted.mode, converted.size)
    pixel_only.paste(converted)
    pixel_only.info.clear()
    return pixel_only


def _atomic_save_image(
    image: Image.Image,
    output_path: Path,
    *,
    output_format: str,
    strip: bool,
    original: Image.Image,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.",
        suffix=f".tmp{output_path.suffix}",
        dir=str(output_path.parent),
    )
    os.close(fd)

    try:
        image.save(
            temp_name,
            format=output_format,
            **_save_kwargs(output_format, strip=strip, original=original),
        )
        os.replace(temp_name, output_path)
    except Exception:
        _unlink_if_exists(temp_name)
        raise


def _save_kwargs(
    output_format: str,
    *,
    strip: bool,
    original: Image.Image,
) -> dict[str, Any]:
    if output_format == "JPEG":
        kwargs: dict[str, Any] = {"quality": 95, "optimize": True}
    elif output_format == "PNG":
        kwargs = {"optimize": True}
    elif output_format == "WEBP":
        kwargs = {"quality": 95, "method": 6}
    else:
        kwargs = {}

    if strip:
        return kwargs

    # Non-strip mode is kept for internal diagnostics. Deployment callers should
    # pass strip=true so prompt metadata remains only in the sidecar JSON.
    for key in ("exif", "icc_profile", "xmp"):
        if key in original.info:
            kwargs[key] = original.info[key]
    return kwargs


def _atomic_write_json(metadata_path: Path, sidecar: dict[str, Any]) -> None:
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{metadata_path.name}.",
        suffix=".tmp",
        dir=str(metadata_path.parent),
        text=True,
    )

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(sidecar, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, metadata_path)
    except Exception:
        _unlink_if_exists(temp_name)
        raise


def _unlink_if_exists(path: str) -> None:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
