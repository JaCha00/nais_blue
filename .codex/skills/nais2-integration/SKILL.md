---
name: nais2-integration
description: Continue or review the NAIS2 integration repository using the local project index, staging manifest, uploaded commit c6412f9, and preservation constraints. Use for NAIS2 integration review issue work, phase follow-up, verifier triage, local implementation, code review, and release-readiness checks in this repo.
---

# NAIS2 Integration

## Start Here

Read `references/project-index.md` before changing code. It records the public review repo, local roots, uploaded commit, staged A/B integration evidence, core source map, preservation constraints, and verifier commands supplied by the user.

## Operating Rules

1. Treat this repo as the public review target:
   `C:\Users\User\OneDrive\图片\NAIS\NAIS2-main`.
2. Treat `C:\Users\User\OneDrive\图片\NAIS\NAIS2-2.0.29` as reference A only.
3. Use the staging evidence under
   `C:\Users\User\OneDrive\图片\챗봇 제작\.analysis\nais2-integration-staging-*`
   when a task asks how A and B differed.
4. Never copy A over B wholesale. Port only the requested behavior into B's current architecture.
5. Preserve Marketplace/Supabase/deep-link auth, StyleLab, IndexedDB backup/import/export, image memory, thumbnails, metadata, `imageFormat`, `charCacheKeys`, Tauri updater/deep-link/single-instance/protocol-asset setup, and plugin chains.
6. Ignore existing untracked local folders unless the user explicitly scopes them:
   `NAIS2-main/` and `stylelab-frontend-sources-20260628-155859/`.

## Workflow

1. Restate the current task, target files, preservation constraints, validation commands, and stop condition.
2. Read affected B files first, then relevant staged/reference A files.
3. Make narrow, reviewable edits in B.
4. Update verifier scripts only when code has moved across file boundaries.
5. Validate with the smallest relevant verifier first, then `npm run lint`, then `npm run build`. Run `cd src-tauri && cargo check` only when Rust, Tauri config, sidecar, or capability files changed.
6. Report changed files, verification evidence, intentional non-changes, and remaining risks.

