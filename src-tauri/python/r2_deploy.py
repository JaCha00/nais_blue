"""
Cloudflare R2 deployment orchestration for cleaned NAIS blue assets.

``tagger_server.py`` registers this router next to ``asset_postprocess.py`` so
the GUI can deploy the post-processed image and ``.nais-blue.json`` sidecar pair
through the existing local sidecar. Credentials are intentionally not accepted
by these request models: Phase 1 relies on Wrangler's own secure auth profile or
environment, and Phase 2 can load Tauri Secure Settings before constructing a
direct S3-compatible uploader.
"""
from __future__ import annotations

import asyncio
import fnmatch
import hashlib
import json
import mimetypes
import os
import re
import shlex
import tempfile
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field


DeployMode = Literal["current-session", "delta", "full-sync", "dry-run"]
UploaderKind = Literal["wrangler", "s3"]
JobStatus = Literal["queued", "planning", "running", "completed", "failed", "cancelled"]

DEFAULT_INCLUDE_PATTERNS = ["*.png", "*.jpg", "*.jpeg", "*.webp", "*.nais-blue.json", "*.nais2.json"]
DEFAULT_MANIFEST_NAME = ".nais-blue-r2-deploy-manifest.json"
MAX_RETAINED_RESULTS = 500
SECRET_ENV_KEYS = (
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_EMAIL",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
)


class R2DeployFileSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1)
    key: str | None = None
    content_type: str | None = None
    kind: str | None = None


class R2DeployRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: DeployMode
    bucket: str = Field(min_length=3)
    key_prefix: str = ""
    local_root: str | None = None
    files: list[R2DeployFileSpec] = Field(default_factory=list)
    include_patterns: list[str] = Field(default_factory=lambda: DEFAULT_INCLUDE_PATTERNS.copy())
    exclude_patterns: list[str] = Field(default_factory=list)
    manifest_path: str | None = None
    uploader: UploaderKind = "wrangler"
    wrangler_command: str | list[str] = "wrangler"
    wrangler_cwd: str | None = None
    wrangler_config: str | None = None
    wrangler_env: str | None = None
    wrangler_profile: str | None = None
    jurisdiction: str | None = None
    remote: bool = True
    cache_control: str | None = None
    storage_class: str | None = None
    command_timeout_seconds: int = Field(default=300, ge=5, le=3600)
    dry_run_limit: int = Field(default=200, ge=1, le=5000)
    stop_on_error: bool = False


class R2DeployStartResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str


class R2DeployJobItemResult(BaseModel):
    key: str
    path: str
    status: Literal["planned", "uploaded", "skipped", "failed", "cancelled"]
    size: int
    content_type: str
    message: str | None = None


class R2DeployJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    mode: DeployMode
    bucket: str
    key_prefix: str
    total: int
    completed: int
    failed: int
    skipped: int
    cancel_requested: bool
    current_key: str | None
    message: str
    error: str | None
    started_at: str
    updated_at: str
    finished_at: str | None
    results: list[R2DeployJobItemResult]


class R2RemoteProbeResult(BaseModel):
    key: str
    status: Literal["present", "missing", "unknown", "skipped"]
    message: str | None = None


class R2ScopeCheckItem(BaseModel):
    key: str
    path: str
    size: int
    content_type: str
    manifest_status: Literal["uploaded", "changed", "new"]
    remote_status: Literal["present", "missing", "unknown", "skipped"] = "skipped"


class R2ScopeCheckResponse(BaseModel):
    bucket: str
    key_prefix: str
    local_root: str
    total_local: int
    planned: int
    manifest_uploaded: int
    manifest_missing_or_changed: int
    remote_checked: int
    remote_present: int
    remote_missing: int
    remote_unknown: int
    truncated: bool
    credential_hint: str
    items: list[R2ScopeCheckItem]


@dataclass(frozen=True)
class DeployItem:
    path: Path
    key: str
    content_type: str
    size: int
    mtime_ns: int
    sha256: str


@dataclass
class R2JobState:
    job_id: str
    request: R2DeployRequest
    status: JobStatus = "queued"
    total: int = 0
    completed: int = 0
    failed: int = 0
    skipped: int = 0
    current_key: str | None = None
    message: str = "Queued"
    error: str | None = None
    cancel_requested: bool = False
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    finished_at: str | None = None
    results: list[R2DeployJobItemResult] = field(default_factory=list)
    current_process: asyncio.subprocess.Process | None = None


class R2DeployError(RuntimeError):
    pass


class R2DeployCancelled(RuntimeError):
    pass


router = APIRouter()
_jobs: dict[str, R2JobState] = {}
_jobs_lock = threading.RLock()


@router.post("/asset/r2/deploy", response_model=R2DeployStartResponse)
async def start_r2_deploy(request: R2DeployRequest) -> R2DeployStartResponse:
    job_id = uuid.uuid4().hex
    state = R2JobState(job_id=job_id, request=request)

    with _jobs_lock:
        _jobs[job_id] = state

    asyncio.create_task(_run_deploy_job(job_id))
    return R2DeployStartResponse(
        job_id=job_id,
        status=state.status,
        message="R2 deployment job queued",
    )


@router.get("/asset/r2/jobs/{job_id}", response_model=R2DeployJobResponse)
def get_r2_deploy_job(job_id: str) -> R2DeployJobResponse:
    return _get_job_snapshot(job_id)


@router.post("/asset/r2/jobs/{job_id}/cancel", response_model=R2DeployJobResponse)
def cancel_r2_deploy_job(job_id: str) -> R2DeployJobResponse:
    state = _get_job(job_id)
    with _jobs_lock:
        state.cancel_requested = True
        state.message = "Cancellation requested"
        state.updated_at = _utc_now()
        process = state.current_process

    if process and process.returncode is None:
        process.terminate()

    return _snapshot_job(state)


@router.get("/asset/r2/scope-check", response_model=R2ScopeCheckResponse)
async def scope_check_r2_deploy(
    local_root: str = Query(..., min_length=1),
    bucket: str = Query(..., min_length=3),
    key_prefix: str = "",
    mode: DeployMode = "dry-run",
    include_patterns: str = ",".join(DEFAULT_INCLUDE_PATTERNS),
    exclude_patterns: str = "",
    manifest_path: str | None = None,
    remote_probe: bool = True,
    remote_probe_limit: int = Query(default=50, ge=0, le=500),
    wrangler_command: str = "wrangler",
    wrangler_cwd: str | None = None,
    wrangler_config: str | None = None,
    wrangler_env: str | None = None,
    wrangler_profile: str | None = None,
    jurisdiction: str | None = None,
    remote: bool = True,
) -> R2ScopeCheckResponse:
    try:
        request = R2DeployRequest(
            mode=mode,
            bucket=bucket,
            key_prefix=key_prefix,
            local_root=local_root,
            include_patterns=_split_patterns(include_patterns),
            exclude_patterns=_split_patterns(exclude_patterns),
            manifest_path=manifest_path,
            wrangler_command=wrangler_command,
            wrangler_cwd=wrangler_cwd,
            wrangler_config=wrangler_config,
            wrangler_env=wrangler_env,
            wrangler_profile=wrangler_profile,
            jurisdiction=jurisdiction,
            remote=remote,
        )

        items = await asyncio.to_thread(collect_deploy_items, request)
        manifest = await asyncio.to_thread(load_manifest, _manifest_path(request))
        manifest_status = [_manifest_status_for(item, manifest) for item in items]
        planned_items = _filter_items_by_mode(request.mode, items, manifest)

        probe_by_key: dict[str, R2RemoteProbeResult] = {}
        if remote_probe and remote_probe_limit > 0:
            uploader = WranglerR2Uploader(request)
            for item in planned_items[:remote_probe_limit]:
                probe_by_key[item.key] = await uploader.probe(item)

        scope_items: list[R2ScopeCheckItem] = []
        for item, status in zip(items, manifest_status):
            if len(scope_items) >= request.dry_run_limit:
                break
            probe = probe_by_key.get(item.key)
            scope_items.append(
                R2ScopeCheckItem(
                    key=item.key,
                    path=str(item.path),
                    size=item.size,
                    content_type=item.content_type,
                    manifest_status=status,
                    remote_status=probe.status if probe else "skipped",
                )
            )

        remote_counts = _count_remote_probe_statuses(probe_by_key.values())
        manifest_uploaded = sum(1 for status in manifest_status if status == "uploaded")

        return R2ScopeCheckResponse(
            bucket=bucket,
            key_prefix=_normalize_prefix(key_prefix),
            local_root=str(Path(local_root).expanduser().resolve()),
            total_local=len(items),
            planned=len(planned_items),
            manifest_uploaded=manifest_uploaded,
            manifest_missing_or_changed=len(items) - manifest_uploaded,
            remote_checked=len(probe_by_key),
            remote_present=remote_counts["present"],
            remote_missing=remote_counts["missing"],
            remote_unknown=remote_counts["unknown"],
            truncated=len(items) > request.dry_run_limit,
            credential_hint=(
                "R2 credentials are not read from asset-profile.json. Use `wrangler login`, "
                "`wrangler --profile`, or a future Tauri Secure Settings bridge."
            ),
            items=scope_items,
        )
    except R2DeployError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


async def _run_deploy_job(job_id: str) -> None:
    state = _get_job(job_id)

    try:
        _update_job(state, status="planning", message="Scanning local deployment scope")
        all_items = await asyncio.to_thread(collect_deploy_items, state.request)
        manifest_path = _manifest_path(state.request)
        manifest = await asyncio.to_thread(load_manifest, manifest_path)
        plan = _filter_items_by_mode(state.request.mode, all_items, manifest)

        with _jobs_lock:
            state.total = len(plan)
            state.status = "running"
            state.message = "Dry-run plan ready" if state.request.mode == "dry-run" else "Uploading to R2"
            state.updated_at = _utc_now()

        if state.request.mode == "dry-run":
            for item in plan[: state.request.dry_run_limit]:
                _append_result(state, _result_for_item(item, "planned"))
            _finish_job(state, "completed", f"Dry-run planned {len(plan)} file(s)")
            return

        uploader = _build_uploader(state.request)
        for item in plan:
            _raise_if_cancelled(state)
            _set_current_item(state, item)

            try:
                await uploader.upload(item, state)
                _append_result(state, _result_for_item(item, "uploaded"))
                await asyncio.to_thread(update_manifest_item, manifest_path, state.request, item)
                with _jobs_lock:
                    state.completed += 1
                    state.message = f"Uploaded {state.completed}/{state.total}"
                    state.updated_at = _utc_now()
            except R2DeployCancelled:
                _append_result(state, _result_for_item(item, "cancelled", "Upload cancelled"))
                _finish_job(state, "cancelled", "R2 deployment cancelled")
                return
            except Exception as error:
                message = str(error)
                _append_result(state, _result_for_item(item, "failed", message))
                with _jobs_lock:
                    state.failed += 1
                    state.error = message
                    state.message = f"Failed {state.failed} upload(s)"
                    state.updated_at = _utc_now()
                if state.request.stop_on_error:
                    break

        if state.cancel_requested:
            _finish_job(state, "cancelled", "R2 deployment cancelled")
        elif state.failed > 0:
            _finish_job(state, "failed", f"Completed with {state.failed} failed upload(s)")
        else:
            _finish_job(state, "completed", f"Uploaded {state.completed} file(s)")
    except R2DeployCancelled:
        _finish_job(state, "cancelled", "R2 deployment cancelled")
    except Exception as error:
        with _jobs_lock:
            state.error = str(error)
        _finish_job(state, "failed", str(error))
    finally:
        with _jobs_lock:
            state.current_key = None
            state.current_process = None
            state.updated_at = _utc_now()


class BaseR2Uploader:
    async def upload(self, item: DeployItem, state: R2JobState) -> None:
        raise NotImplementedError


class WranglerR2Uploader(BaseR2Uploader):
    def __init__(self, request: R2DeployRequest) -> None:
        self.request = request
        self.command = _normalize_wrangler_command(request.wrangler_command)

    async def upload(self, item: DeployItem, state: R2JobState) -> None:
        args = self._object_command("put", item.key)
        args.extend(["--file", str(item.path), "--content-type", item.content_type, "--force"])

        if self.request.cache_control:
            args.extend(["--cache-control", self.request.cache_control])
        if self.request.storage_class:
            args.extend(["--storage-class", self.request.storage_class])

        await self._run(args, state)

    async def probe(self, item: DeployItem) -> R2RemoteProbeResult:
        fd, temp_name = tempfile.mkstemp(prefix=".nais-blue-r2-probe.", suffix=".tmp")
        os.close(fd)
        probe_state = R2JobState(
            job_id="scope-check",
            request=self.request,
            status="running",
            total=1,
        )

        try:
            args = self._object_command("get", item.key)
            args.extend(["--file", temp_name])
            await self._run(args, probe_state, raise_on_error=True)
            return R2RemoteProbeResult(key=item.key, status="present")
        except Exception as error:
            message = str(error)
            lowered = message.lower()
            if "not found" in lowered or "404" in lowered or "no such" in lowered:
                return R2RemoteProbeResult(key=item.key, status="missing", message=message)
            return R2RemoteProbeResult(key=item.key, status="unknown", message=message)
        finally:
            _unlink_if_exists(temp_name)

    def _object_command(self, action: Literal["put", "get"], key: str) -> list[str]:
        args = [*self.command, "r2", "object", action, f"{self.request.bucket}/{key}"]

        if self.request.remote:
            args.append("--remote")
        else:
            args.append("--local")
        if self.request.jurisdiction:
            args.extend(["--jurisdiction", self.request.jurisdiction])
        if self.request.wrangler_config:
            args.extend(["--config", self.request.wrangler_config])
        if self.request.wrangler_env:
            args.extend(["--env", self.request.wrangler_env])
        if self.request.wrangler_profile:
            args.extend(["--profile", self.request.wrangler_profile])

        return args

    async def _run(
        self,
        args: list[str],
        state: R2JobState,
        *,
        raise_on_error: bool = True,
    ) -> tuple[str, str]:
        _raise_if_cancelled(state)

        try:
            process = await asyncio.create_subprocess_exec(
                *args,
                cwd=self.request.wrangler_cwd or None,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as error:
            raise R2DeployError(
                "Wrangler command was not found. Install Wrangler or pass "
                "wrangler_command such as ['npx', 'wrangler']."
            ) from error

        with _jobs_lock:
            state.current_process = process

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(),
                timeout=self.request.command_timeout_seconds,
            )
        except asyncio.TimeoutError as error:
            process.kill()
            await process.communicate()
            raise R2DeployError(
                f"Wrangler command timed out after {self.request.command_timeout_seconds}s"
            ) from error
        finally:
            with _jobs_lock:
                if state.current_process is process:
                    state.current_process = None

        stdout = _redact_sensitive_text(stdout_bytes.decode("utf-8", errors="replace"))
        stderr = _redact_sensitive_text(stderr_bytes.decode("utf-8", errors="replace"))

        if state.cancel_requested:
            raise R2DeployCancelled()

        if process.returncode != 0 and raise_on_error:
            detail = stderr.strip() or stdout.strip() or f"exit code {process.returncode}"
            raise R2DeployError(f"Wrangler failed: {detail}")

        return stdout, stderr


class S3R2Uploader(BaseR2Uploader):
    """Phase 2 extension point for direct Cloudflare R2 S3-compatible uploads."""

    async def upload(self, item: DeployItem, state: R2JobState) -> None:
        raise R2DeployError(
            "Direct S3-compatible R2 upload is not enabled yet. Use uploader='wrangler'."
        )


def collect_deploy_items(request: R2DeployRequest) -> list[DeployItem]:
    _validate_bucket_name(request.bucket)

    if request.mode == "current-session" and not request.files:
        raise R2DeployError("current-session mode requires explicit files from the GUI session")

    root = Path(request.local_root).expanduser().resolve() if request.local_root else None
    if request.files:
        return _items_from_file_specs(request, root)

    if root is None:
        raise R2DeployError("local_root is required when files are not provided")
    if not root.exists() or not root.is_dir():
        raise R2DeployError(f"local_root does not exist or is not a directory: {root}")

    items: list[DeployItem] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name.startswith("."):
            continue
        relative = path.relative_to(root).as_posix()
        if not _matches_patterns(relative, request.include_patterns, request.exclude_patterns):
            continue
        items.append(_build_deploy_item(path, _key_for_relative(request.key_prefix, relative)))

    return items


def _items_from_file_specs(
    request: R2DeployRequest,
    root: Path | None,
) -> list[DeployItem]:
    items: list[DeployItem] = []
    seen_keys: set[str] = set()

    for spec in request.files:
        path = Path(spec.path).expanduser()
        if not path.is_absolute() and root is not None:
            path = root / path
        path = path.resolve()
        if not path.exists() or not path.is_file():
            raise R2DeployError(f"Deploy file does not exist: {path}")

        if spec.key:
            key = _normalize_key_with_prefix("", spec.key)
        elif root and _is_relative_to(path, root):
            key = _key_for_relative(request.key_prefix, path.relative_to(root).as_posix())
        else:
            key = _key_for_relative(request.key_prefix, path.name)

        if key in seen_keys:
            raise R2DeployError(f"Duplicate R2 target key: {key}")
        seen_keys.add(key)

        items.append(_build_deploy_item(path, key, spec.content_type))

    return items


def _build_deploy_item(
    path: Path,
    key: str,
    content_type: str | None = None,
) -> DeployItem:
    stat = path.stat()
    return DeployItem(
        path=path,
        key=_normalize_key_with_prefix("", key),
        content_type=content_type or _guess_content_type(path),
        size=stat.st_size,
        mtime_ns=stat.st_mtime_ns,
        sha256=_sha256(path),
    )


def _filter_items_by_mode(
    mode: DeployMode,
    items: list[DeployItem],
    manifest: dict[str, Any],
) -> list[DeployItem]:
    if mode in {"current-session", "full-sync", "dry-run"}:
        return items
    if mode == "delta":
        return [item for item in items if _manifest_status_for(item, manifest) != "uploaded"]
    return items


def _manifest_status_for(
    item: DeployItem,
    manifest: dict[str, Any],
) -> Literal["uploaded", "changed", "new"]:
    stored = manifest.get("items", {}).get(item.key)
    if not isinstance(stored, dict):
        return "new"

    if (
        stored.get("sha256") == item.sha256
        and stored.get("size") == item.size
        and stored.get("local_path") == str(item.path)
    ):
        return "uploaded"

    return "changed"


def load_manifest(path: Path | None) -> dict[str, Any]:
    if path is None or not path.exists():
        return {"version": 1, "items": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise R2DeployError(f"R2 deploy manifest is invalid JSON: {path}") from error

    if not isinstance(data, dict):
        raise R2DeployError(f"R2 deploy manifest must be an object: {path}")
    if not isinstance(data.get("items"), dict):
        data["items"] = {}
    return data


def update_manifest_item(path: Path | None, request: R2DeployRequest, item: DeployItem) -> None:
    if path is None:
        return

    manifest = load_manifest(path)
    manifest.update(
        {
            "version": 1,
            "bucket": request.bucket,
            "key_prefix": _normalize_prefix(request.key_prefix),
            "updated_at": _utc_now(),
        }
    )
    manifest.setdefault("items", {})[item.key] = {
        "local_path": str(item.path),
        "key": item.key,
        "sha256": item.sha256,
        "size": item.size,
        "mtime_ns": item.mtime_ns,
        "content_type": item.content_type,
        "uploaded_at": _utc_now(),
    }
    _atomic_write_json(path, manifest)


def _manifest_path(request: R2DeployRequest) -> Path | None:
    if request.manifest_path:
        return Path(request.manifest_path).expanduser().resolve()
    if request.local_root:
        return Path(request.local_root).expanduser().resolve() / DEFAULT_MANIFEST_NAME
    return None


def _build_uploader(request: R2DeployRequest) -> BaseR2Uploader:
    if request.uploader == "wrangler":
        return WranglerR2Uploader(request)
    return S3R2Uploader()


def _get_job(job_id: str) -> R2JobState:
    with _jobs_lock:
        state = _jobs.get(job_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"R2 deploy job not found: {job_id}")
    return state


def _get_job_snapshot(job_id: str) -> R2DeployJobResponse:
    return _snapshot_job(_get_job(job_id))


def _snapshot_job(state: R2JobState) -> R2DeployJobResponse:
    with _jobs_lock:
        return R2DeployJobResponse(
            job_id=state.job_id,
            status=state.status,
            mode=state.request.mode,
            bucket=state.request.bucket,
            key_prefix=_normalize_prefix(state.request.key_prefix),
            total=state.total,
            completed=state.completed,
            failed=state.failed,
            skipped=state.skipped,
            cancel_requested=state.cancel_requested,
            current_key=state.current_key,
            message=state.message,
            error=state.error,
            started_at=state.started_at,
            updated_at=state.updated_at,
            finished_at=state.finished_at,
            results=list(state.results),
        )


def _update_job(
    state: R2JobState,
    *,
    status: JobStatus,
    message: str,
) -> None:
    with _jobs_lock:
        state.status = status
        state.message = message
        state.updated_at = _utc_now()


def _finish_job(state: R2JobState, status: JobStatus, message: str) -> None:
    with _jobs_lock:
        state.status = status
        state.message = message
        state.finished_at = _utc_now()
        state.updated_at = state.finished_at


def _set_current_item(state: R2JobState, item: DeployItem) -> None:
    with _jobs_lock:
        state.current_key = item.key
        state.updated_at = _utc_now()


def _append_result(state: R2JobState, result: R2DeployJobItemResult) -> None:
    with _jobs_lock:
        state.results.append(result)
        if len(state.results) > MAX_RETAINED_RESULTS:
            state.results = state.results[-MAX_RETAINED_RESULTS:]
        state.updated_at = _utc_now()


def _result_for_item(
    item: DeployItem,
    status: Literal["planned", "uploaded", "skipped", "failed", "cancelled"],
    message: str | None = None,
) -> R2DeployJobItemResult:
    return R2DeployJobItemResult(
        key=item.key,
        path=str(item.path),
        status=status,
        size=item.size,
        content_type=item.content_type,
        message=message,
    )


def _raise_if_cancelled(state: R2JobState) -> None:
    if state.cancel_requested:
        raise R2DeployCancelled()


def _normalize_wrangler_command(command: str | list[str]) -> list[str]:
    if isinstance(command, list):
        if not command or not all(part.strip() for part in command):
            raise R2DeployError("wrangler_command must not be empty")
        return command

    parts = shlex.split(command)
    if not parts:
        raise R2DeployError("wrangler_command must not be empty")
    return parts


def _validate_bucket_name(bucket: str) -> None:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", bucket):
        raise R2DeployError(
            "R2 bucket names must be 3-63 chars using lowercase letters, numbers, and hyphens"
        )


def _key_for_relative(prefix: str, relative: str) -> str:
    return _normalize_key_with_prefix(prefix, relative)


def _normalize_key_with_prefix(prefix: str, key: str) -> str:
    cleaned_key = _normalize_key(key)
    cleaned_prefix = _normalize_prefix(prefix)
    return f"{cleaned_prefix}/{cleaned_key}" if cleaned_prefix else cleaned_key


def _normalize_prefix(prefix: str) -> str:
    if not prefix:
        return ""
    return _normalize_key(prefix)


def _normalize_key(value: str) -> str:
    normalized = value.replace("\\", "/").strip("/")
    parts = [part for part in normalized.split("/") if part and part != "."]
    if not parts or any(part == ".." for part in parts):
        raise R2DeployError(f"Invalid R2 object key: {value}")
    return "/".join(parts)


def _matches_patterns(relative: str, include_patterns: list[str], exclude_patterns: list[str]) -> bool:
    normalized = relative.replace("\\", "/")
    included = any(fnmatch.fnmatch(normalized, pattern) for pattern in include_patterns)
    excluded = any(fnmatch.fnmatch(normalized, pattern) for pattern in exclude_patterns)
    return included and not excluded


def _guess_content_type(path: Path) -> str:
    if path.name.lower().endswith((".nais-blue.json", ".nais2.json")):
        return "application/json"
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
        text=True,
    )

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        _unlink_if_exists(temp_name)
        raise


def _split_patterns(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def _count_remote_probe_statuses(results: Any) -> dict[str, int]:
    counts = {"present": 0, "missing": 0, "unknown": 0}
    for result in results:
        if result.status in counts:
            counts[result.status] += 1
    return counts


def _redact_sensitive_text(text: str) -> str:
    redacted = text
    for key in SECRET_ENV_KEYS:
        value = os.getenv(key)
        if value:
            redacted = redacted.replace(value, "[REDACTED]")
    return redacted


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _unlink_if_exists(path: str) -> None:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
