# Android APK release

NAIS2 uses a generated Tauri Android project, but its release identity and the
scripts that recreate signing are tracked. `src-tauri/gen/android` remains
ignored; every clean build runs `tauri android init`, applies the managed Gradle
patch, verifies the APK, installs it on an emulator, and only then exposes the
artifact.

## Release identity

The public `v2.8.0` APK is the first JaCha00 Android release and establishes this
update identity:

- application ID: `com.sunakgo.nais2`
- debug application ID: `com.sunakgo.nais2.dev`
- signer certificate SHA-256:
  `6E20E7607AD38F1FC94619007BB3C59D19F088B23D91559A99EEAA7C6DE41A65`
- Android version code scheme: `major * 1,000,000 + minor * 1,000 + patch`

These public values, minimum SDK, and required ABIs are pinned in
`android-release-policy.json`. Never replace the signing key in place. A new key
would make the APK unable to update `v2.8.0` installations.

The package ID predates this fork. An APK signed by this project cannot update a
different developer's `com.sunakgo.nais2` installation. Such a device must
uninstall the conflicting app first, or a future fork release must deliberately
move to a new package ID. Changing the ID also creates a separate app and does
not migrate existing data.

## GitHub Actions

`.github/workflows/android.yml` provides three gates:

- pull requests, `main` pushes, and standalone manual runs create an isolated
  `com.sunakgo.nais2.dev` x86_64 debug APK and install/launch it on an emulator;
- a `v*` tag runs the desktop workflow first, then calls the Android workflow
  to build a signed APK;
- the signing job deletes its key material before a separate no-secret emulator
  job tests the update, after which a write-only job uploads the Android assets
  and publishes the cross-platform draft Release.

The signed job downloads the public `v2.8.0` APK by its pinned SHA-256, installs
that baseline first, and then uses `adb install -r` for the newly built APK. This
turns signer continuity and version monotonicity into an executable update test,
not just a comparison against the key supplied during the current build.

Configure these `android-release` Environment secrets before enabling signed
builds. Keeping the Android key in the protected Environment ensures the
signing job cannot read it until the required reviewer approves the deployment:

- `NAIS_KEYSTORE_BASE64`: Base64 encoding of the exact pinned release keystore
- `NAIS_KEYSTORE_PASSWORD`: keystore and key password
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: optional production frontend
  configuration, matching the desktop workflow

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

Keep the keystore outside the repository and shared workspace when possible:

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
release-artifacts/android/NAIS2_<version>-universal.apk
release-artifacts/android/NAIS2_<version>-universal.apk.sha256
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
