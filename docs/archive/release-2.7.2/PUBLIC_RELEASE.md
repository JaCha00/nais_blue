# Public Release Layout

## Goal

The public release package contains only redistributable installers, updater signatures, checksums, release metadata, and a clean source archive for future patch work.

It must not contain local runtime data, generated caches, installed dependencies, Rust build output, private signing keys, personal app data, or one-off backup folders.

## Included

- `installers/NAIS2_2.7.2_x64-setup.exe`
- `installers/NAIS2_2.7.2_x64-setup.exe.sig`
- `installers/NAIS2_2.7.2_x64_en-US.msi`
- `installers/NAIS2_2.7.2_x64_en-US.msi.sig`
- `portable/nais2.exe`
- `source/NAIS2_2.7.2-public-source.zip`
- `checksums/SHA256SUMS.txt`
- `release-manifest.json`
- `docs/ELO_AUDIT.md`
- `docs/PATCHING_GUIDE.md`

## Excluded

- `.git/`
- `.env*`
- `node_modules/`
- `dist/`
- `src-tauri/target/`
- `NAIS2-main/` nested backup copies
- `stylelab-frontend-sources-*`
- local caches, databases, logs, signing keys, and generated installer artifacts outside the curated output folder

## Build Note

MSI bundling with WiX can fail when the project path contains non-ASCII characters. The release process builds from an ASCII mirror such as `C:\nais2-release-build`, then copies the final public artifacts into the curated release folder.
