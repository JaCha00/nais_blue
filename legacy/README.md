# Legacy Source Snapshots

This directory keeps source snapshots used during the NAIS2 integration review.

- `NAIS2-2.0.29/` is the pre-integration reference source.
- `NAIS2-main-source-snapshot/` is the earlier main-source snapshot kept for comparison.
- `stylelab-frontend-sources-20260628-155859/` is the StyleLab extraction source snapshot.

Build outputs, dependency folders, local runtime artifacts, signing keys, and local
environment files are intentionally ignored by the root `.gitignore`.

Dependency manifests inside archived source trees are stored with `.snapshot`
filenames, for example `package.snapshot.json` and `Cargo.snapshot.toml`.
These files are historical evidence for comparison only; renaming them keeps
GitHub Dependabot focused on the active application manifests at the repository
root and under `src-tauri/`.
