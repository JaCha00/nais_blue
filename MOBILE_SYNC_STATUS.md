# NAIS2 Mobile And Remote Sync Status

This file is the public release boundary between the Android runtime work that
ships in the current 2.8.2 release and the cross-device sync system that does
not ship yet. It must be read together with `src/platform/runtime.ts`,
`src/platform/storage.ts`, and
`scripts/verify-android-port-contract.mjs` when changing mobile behavior.

## Included in 2.8.0

- Tauri Android configuration and app-scoped `$APPDATA` capabilities.
- Android-safe media, backup, and snapshot storage boundaries.
- Runtime gates for desktop updater, local Python tagger, embedded browser, and
  keyboard-only shortcuts.
- Responsive Main, Prompt, History, Scene, Prompt Editor, and Settings flows.
- Repeatable Android port and idle-loop verification scripts.

These pieces make the existing image-generation workflow Android-capable. They
do not transfer user data between devices.

## Remote sync verdict

PC-to-mobile remote sync is **not implemented or enabled in the current 2.8.2 release**. There is no
`src/sync` transport, pairing service, encrypted outbox, conflict resolver, or
sanitized sync exporter in the released source. Consequently, this release
must not advertise remote sync as available or proven stable.

Two previously planned npm commands referenced nonexistent sync verification
files. They were removed before release so the Android contract cannot report a
false positive for a feature that is absent.

## Security requirements before enabling sync

The future implementation must prove all of the following before any network
toggle becomes visible:

1. Sync exports exclude NovelAI tokens, Gemini keys, image/blob data,
   thumbnails, device paths, absolute PC paths, and platform-only settings.
2. Pairing keys use a reviewed secret store; pairing tokens expire.
3. Payloads are encrypted before LAN or relay transport.
4. Unpaired manifest/pull/push requests reveal no store metadata.
5. Conflict behavior is deterministic and covered by two-device tests.
6. Android cleartext/TLS policy and desktop CORS allowlists are explicit.

Until those gates and their executable tests exist, local backup/export remains
the only supported way to move settings or metadata between installations.

## Release verification

The source release requires these commands to pass:

```text
npm run lint
npm run build
npm run test:responsive-layout
npm run test:android-port
npm run test:android-release-contract
cd src-tauri && cargo check
```

The Android workflow additionally creates the generated Gradle project, builds
and verifies a signed universal APK, installs it on an x86_64 emulator, launches
the app, and checks that the process remains alive without a crash-buffer entry.
The pinned public certificate and package policy live in
`android-release-policy.json`; signing secrets remain outside Git.
