# Patching Guide

## Start Here

1. Extract `source/NAIS2_2.7.2-public-source.zip`.
2. Run `npm ci`.
3. Run `npm run build` for frontend verification.
4. Run `tauri build` for signed native installers.

## Main Extension Points

- StyleLab domain logic: `src/lib/style-lab/`
- StyleLab state: `src/stores/style-lab-store.ts`
- StyleLab image generation: `src/services/style-lab-generation.ts`
- StyleLab UI: `src/pages/StyleLab.tsx`
- i18n strings: `src/i18n/locales/*.json`
- Tauri native commands: `src-tauri/src/`

## Release Keys

Forks should replace `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` with their own public updater key and build with matching `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Never commit private signing keys or passwords. Keep them in CI secrets or local user environment variables.

## Verification Checklist

- `npm run build`
- `tauri build`
- Confirm NSIS, MSI, and `.sig` files exist.
- Confirm `checksums/SHA256SUMS.txt` was regenerated after every artifact change.
