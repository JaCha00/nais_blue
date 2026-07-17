# Android APK release

NAIS blue uses a generated Tauri Android project, but its release identity and the
scripts that recreate signing are tracked. `src-tauri/gen/android` remains
ignored; every clean build runs `tauri android init`, applies the managed Gradle
patch, verifies the APK, installs it on an emulator, and only then exposes the
artifact.

## Release identity

Phase 12 establishes a new, independent Android application identity:

- release/debug application ID: `com.bluhair.naisblue`
- signer certificate SHA-256:
  `6E20E7607AD38F1FC94619007BB3C59D19F088B23D91559A99EEAA7C6DE41A65`
- Android version code scheme: `major * 1,000,000 + minor * 1,000 + patch`

These values, minimum SDK, and required ABIs are pinned in
`android-release-policy.json`. Debug device QA and release artifacts use the
same user-owned signer when the process-scoped signing environment is present.

This is the first release for the final package ID, so no retired-package APK is
installed as an update baseline. Existing retired app data is not migrated or
cleared. If an install reports a signer collision, stop and obtain explicit
approval before uninstalling anything.

## GitHub Actions

`.github/workflows/android.yml` provides three gates:

- pull requests, `main` pushes, and standalone manual runs create an x86_64
  debug APK with the final application ID and install/launch it on an emulator;
- a `v*` tag runs the desktop workflow first, then calls the Android workflow
  to build a signed APK;
- the signing job deletes its key material before a separate no-secret emulator
  job tests the update, after which a write-only job uploads the Android assets
  and publishes the cross-platform draft Release.

The signed job treats this package as a first install, then launches it and
verifies signer/package metadata. Future releases can add an immutable baseline
only after a public artifact exists for this exact application ID.

Configure these `android-release` Environment secrets before enabling signed
builds. Keeping the Android key in the protected Environment ensures the
signing job cannot read it until the required reviewer approves the deployment:

- `NAIS_KEYSTORE_BASE64`: Base64 encoding of the exact pinned release keystore
- `NAIS_KEYSTORE_PASSWORD`: keystore and key password

The tracked policy supplies the non-secret `release` alias. The
`android-release` GitHub Environment must require a reviewer and allow only
`v*` tag deployments. Its production signing secrets must not also remain at
repository scope. The active tag ruleset must reject tag updates and deletions.
Ordinary branch and manual Android runs never receive the release key.

The workflow pins JDK 17, Android API 36, Build Tools 36.1.0, NDK
29.0.14206865, and all four Rust Android targets. It uses the lockfile's local
Tauri CLI rather than installing a different global version. Release workflow
Actions are pinned to reviewed commit SHAs instead of floating tags.

Tag names must exactly match `v<package.json version>`, and the tagged commit
must already belong to `main`. The preflight also requires npm, Tauri, and Cargo
version sources to agree and requires the Android version code to be newer than
the pinned update baseline. Existing assets are verified on a retry and never
replaced with different content; release a new version instead.

## Local signed build

Keep the keystore outside the repository and shared workspace:

```powershell
$env:APK_RELEASE_KEYSTORE_PATH = "$env:USERPROFILE\.nais2\nais2-release.jks"
$env:APK_RELEASE_KEY_PASSWORD = '<password>'
npm run release:android:apk
```

The normal command requires both secrets in the current process and refuses an
in-project keystore. An explicit legacy build can pass `-AllowProjectSecrets`
directly to `scripts/release-android.ps1`, but this is only a migration escape
hatch for the existing ignored `nais-release-key` and `.env`. The alias and
expected certificate are read from `android-release-policy.json`; a substituted
keystore fails before the APK is published.

For local Phase 12 verification, `scripts/build-android-signed-local.ps1` reads
the ignored `.env` without interpreting Windows backslashes, copies the source
keystore to an OS temporary file, sets Gradle signing values only in the child
process, and deletes the copy in `finally`. The `.env` alias was characterized as
stale; the sole keytool-verified user key and tracked policy alias are `release`.

The command verifies version agreement, initializes Android when necessary,
applies the idempotent signing patch, reads CI signing credentials from
process-scoped environment variables without writing the password into the
generated Gradle project, builds a universal APK, and checks:

- APK signature validity and the pinned signer certificate;
- package ID, version name, derived version code, min/target SDK, and four ABIs;
- 16 KiB zip alignment;
- rejection of `*-unsigned.apk` outputs.

It writes:

```text
release-artifacts/android/NAIS-blue_<version>-universal.apk
release-artifacts/android/NAIS-blue_<version>-universal.apk.sha256
```

To include a connected-device install and launch check for an existing APK:

```powershell
npm run test:android-release -- --apk <path-to-apk> --install
```

The device gate runs `adb install -r`, starts the launch activity, confirms the
process remains alive, and checks the crash buffer. An exact adb failure such as
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` remains visible in the command output.

Local GitHub publication remains available as a guarded fallback:

```powershell
npm run release:android:github
```

It requires a clean tree plus matching local and remote immutable tags, refuses
duplicate assets, downloads the uploaded APK, and compares its SHA-256. CI is
the normal path for future tag releases.

Never commit a keystore, Base64 key export, `.env`, or
`src-tauri/gen/android/keystore.properties`. If signing material is exposed,
stop releases and plan an Android signing-key migration before rotating it.
