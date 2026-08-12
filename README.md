# NAI Blue

<p align="center">
  <img src="public/nai-blue.png" alt="NAI Blue logo" width="128" height="128">
</p>

<p align="center">
  A desktop and Android workspace for building, organizing, and running NovelAI image-generation workflows.
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.ja.md">日本語</a>
</p>

> NAI Blue is an independent community client and is not affiliated with or endorsed by NovelAI.

## Install

Download the installer for your platform from [GitHub Releases](https://github.com/bluehair-blue/NAI-Blue/releases/latest).

- Windows: use the `x64-setup.exe` installer. The MSI is also provided for managed environments.
- macOS: use the build that matches Apple Silicon (`aarch64`) or Intel (`x64`). If Gatekeeper reports that the app is damaged, run `xattr -cr "/Applications/NAI Blue.app"` in Terminal after confirming that the file came from this repository.
- Android: install the signed universal APK. Android may ask you to allow installs from the app that opened the APK.

## First run

1. Open NAI Blue and stay in the **Guided** surface for the initial setup.
2. Connect your NovelAI account in the account/API step and verify the token.
3. Choose **Single image** or **Batch images**.
4. Build the positive, negative, and character prompts. Character positions start at the center (`0.5, 0.5`) and can be adjusted per task.
5. Choose an output folder and metadata policy, then review the settings before adding the job to the queue.
6. Follow progress in **Queue**. Each queued job shows its destination folder.

Credentials are stored through the operating system credential vault on supported desktop platforms. Do not paste a NovelAI token, R2 secret, or private sidecar into an issue.

## Everyday workflows

### Prompt modules

Open the prompt module library from Guided or Advanced generation. Modules can be organized in folders and contain base, detail, additional, negative, character, and character-negative parts. Select only the parts you want when inserting a module; character positions remain task-specific.

### Import image metadata

Drop a PNG, WebP, JPEG, `.nai-blue.json` sidecar, or supported metadata-extraction JSON into the prompt import surface. NAI Blue maps main and character prompts into the same editor format. For migration from other automation tools, it reads NAIS2 and NAIS3 metadata; those identifiers are recognized only at the import boundary and are never written as NAI Blue data.

### Output folders and R2

Create generation folders before enqueueing work. Each folder can define its local destination, common prompt, R2 profile, bucket, prefix, and automatic-upload preference. Child folders inherit the parent prefix unless they explicitly override it.

R2 controls remain disabled until a profile passes setup. Use the **Set up R2** action, verify the connection, then enable automatic upload on the folders that need it. Deleting the local original is always an explicit, separate choice.

### Image cleanup and sidecars

The metadata step offers embedded metadata, sidecar-only, clean image plus private sidecar, and strip-only policies. The clean-image workflow re-encodes pixel data, keeps restoration metadata in a separate private sidecar, and can add the configured rights-owner XMP.

## Troubleshooting and bug reports

Before reporting a problem:

1. Retry once with the same inputs and note the exact step that failed.
2. Open **Settings → Advanced settings and diagnostics**.
3. Select the related event and copy or export the **sanitized diagnostic log**.
4. Check the latest release notes and existing [issues](https://github.com/bluehair-blue/NAI-Blue/issues).

Submit a [bug report](https://github.com/bluehair-blue/NAI-Blue/issues/new?template=bug_report.yml) with:

- NAI Blue version, operating system, and installation type;
- the shortest reproducible sequence;
- expected and actual behavior;
- the displayed `DiagnosticCode` and sanitized log;
- a screenshot with tokens, paths, prompts, and private metadata redacted.

Never attach a NovelAI token, Cloudflare secret, signing key, raw credential backup, or unreviewed private sidecar. For a security vulnerability, do not open a public issue; use the repository's private security advisory flow.

## Build and debug from source

Requirements: Node.js 24 LTS, npm, Rust 1.88 or newer, and the native build tools required by Tauri. Python 3.11 is required when rebuilding the tagger sidecar.

```bash
git clone https://github.com/bluehair-blue/NAI-Blue.git
cd NAI-Blue
npm ci
npm run tauri dev
```

Useful checks:

```bash
npm run lint
npm run test:composition
npm run build
npm run tauri build
```

Release process and signing requirements are documented in [RELEASING.md](./RELEASING.md).

## Credits and license

NAI Blue continues work that began with [NAIS2](https://github.com/sunanakgo/NAIS2). Thanks to its original maintainers and contributors. The wildcard and scene workflows also learned from [NAIA2.0](https://github.com/DNT-LAB/NAIA2.0) and [SDStudio](https://github.com/sunho/SDStudio).

Licensed under [GPL-3.0](./LICENSE).
