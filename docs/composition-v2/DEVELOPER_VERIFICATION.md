# Developer verification guide

기준일: 2026-07-15 (Asia/Seoul)

## Reproducible baseline

실행 중인 Vite/esbuild/Tauri process를 먼저 종료한다. `node_modules`가 잠겨 있으면 `npm ci`의 EPERM을 code failure와 구분해 기록한다.

```text
npm ci
npm ls --all
npm run lint
npm run build
npm run test:unit
npm run test:payload-parity
npm run test:composition
npm run test:migration
npm run test:diagnostics
npm run test:persistence
npm run test:credential-vault
npm run test:queue
npm run test:sync
npm run test:r2
npm run test:organizer
npm run test:secret-redaction
npm run test:characterization
npm run test:nai-core
npm run test:nai-transport
npm run test:smart-tools
npm run test:responsive-layout
npm run test:android-port
npm run test:android-release-contract
npm run test:remote-runtime-removal
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml nai_transport::tests --lib
cargo test --manifest-path src-tauri/Cargo.toml r2_native:: --lib
```

`test:composition`은 현재 전체 Vitest suite를 실행하므로 category 명령과 중복될 수 있다. 중복은 실패 은폐가 아니라 category별 진단을 위한 의도된 matrix다. `test:persistence`는 Vitest fault suite 뒤에 실제 Chromium startup에서 blocked IndexedDB rescue keyboard/touch gate를 실행한다. `test:credential-vault`는 AuthState v2→v3 two-phase migration, interruption/resume, wrong passphrase/unavailable/delete, legacy backup scan과 native source/capability 계약을 실행한다. `test:queue`는 state transition/snapshot/hash/schema upgrade 외에 atomic batch/resource enqueue, 10,000-job pagination, lease/startup recovery, dual-token/streaming concurrency, pause/restart/resume, 401/429/decode/ENOSPC/cancel, retry-failed, managed resource digest, OutputWriter linkage와 legacy rollback을 실행한다. `test:secret-redaction`은 export/snapshot/restore projection에서 AuthState v3 reference만 남고 raw secret/runtime cache가 제거되는지 별도로 검증한다. `test:nai-transport`는 browser/desktop fetch adapter와 Android channel adapter의 standard/stream, cancel-before-request, cancel-after-headers, body timeout과 429 보존을 실행한다. Rust category는 loopback mock server로 headers/body, socket cancellation과 total timeout을 검증하며 live token을 사용하지 않는다.

Vault restart regression의 focused gate는 `npm run test:credential-vault`와
`npm run test:persistence`다. Native setup은 `app_data_dir`와 `app_local_data_dir`를 Stronghold plugin
등록 전에 생성해야 하며 close/relaunch는 pending IndexedDB flush → Stronghold unload → process
exit 순서다. History I2I는 metadata hydration과 진행 중 unlock의 terminal state를 await하고
`unavailable/error`에서는 source image/mode/navigation을 commit하지 않는다. Existing snapshot의
실제 re-unlock은 passphrase/credential이 명시적으로 opt-in된 isolated profile에서만 수행한다.

Vault ACL regression을 확인할 때는 별도 application identifier의 isolated production binary를 사용한다.
Generated capability의 `$APPDATA/**` 존재, `BaseDirectory.AppData` resolved directory와 snapshot parent
동일 여부, absolute/relative `exists` 허용 여부만 boolean으로 기록한다. 실제 resolved path, snapshot
내용, passphrase와 credential은 terminal/artifact에 남기지 않는다.

## Phase 09 native R2 focused verification

```text
npm run test:r2
npm run test:diagnostics
npm run test:secret-redaction
cargo test --manifest-path src-tauri/Cargo.toml r2_native:: --lib
cargo check --manifest-path src-tauri/Cargo.toml
npm run lint
npm run build
```

R2 category는 legacy Wrangler의 current-session/delta/full-sync/dry-run request parity, non-secret Asset
Profile projection, R2ProfileV2 validation, mobile explicit capability, manifest v2 dedupe, conditional conflict
preview, interrupted multipart restart, abort, 1,000-object partial failure와 one-way credential command contract를
검증한다. Rust fake server는 official SDK가 SigV4와 `If-None-Match`를 실제 request에 넣는지, 403/
SignatureDoesNotMatch/clock skew/404/412를 fixed typed error로 분류하는지와 same upload ID continuation을
검증한다. Test fixture credential은 provider에 전달하지 않고 result/log/artifact에 출력하지 않는다.

Live R2는 isolated opt-in profile에서만 실행한다. Temporary object의 key/content는 non-secret random probe로
제한하고 put→head→delete 모두 성공해야 한다. Terminal, diagnostic export와 test artifact에서 access/secret,
Authorization, signed URL, provider response body와 local file content를 검색한다. 노출, conditional overwrite,
completed part 재전송이 하나라도 관찰되면 Phase 09 stop gate다.

## Phase 08 durable queue focused verification

Queue cutover 변경은 가장 작은 category와 workflow/output characterization을 먼저 실행한다.

```text
npm run test:queue
npx --no-install vitest run tests/characterization/main-workflow.test.ts tests/characterization/scene-workflow.test.ts tests/services/output/output-writer.test.ts tests/helpers/metadata-v2.test.ts tests/components/queue-center.contract.test.ts
npm run lint
npm run build
```

Repository/coordinator suite는 10,000 jobs, 두 active token의 최대 동시성, streaming T2I single slot,
pause→restart→resume, retry failed only, 401 batch pause, 429 ready-at backoff, decode failure continuation,
wrapped disk-full pause, cancel 뒤 late output 없음, files-committed recovery와 legacy authority를 포함해야 한다.
Resource tests는 AppData reference의 digest/readback과 DB snapshot에서 raw/base64 byte가 제거되는지 확인한다.
Queue Center contract는 390×844, 412×915, 768×1024, 1280×800, 1536×960에서 `/queue` route를 포함한다.

실제 restart 검증은 종료 전에 job/output transaction ID만 redacted evidence로 기록하고 prompt, token,
signed URL, image byte/base64를 남기지 않는다. Live NovelAI request, actual disk-full, APK/emulator test는
명시적 credential/device/release 환경에서만 추가한다. Android request가 finite success 또는 typed
timeout/cancel로 끝나지 않거나 cancel 뒤 output/history/job success가 생기면 즉시 stop gate다.

## Phase 06 authority preflight

Production-like authority fixture와 운영 panel contract는 다음 focused 명령으로 먼저 진단할 수 있다.

```text
npx --no-install vitest run tests/migration/composition-production-startup.test.ts tests/migration/composition-migration-startup.test.ts tests/diagnostics/diagnostics-ui.contract.test.ts
```

이 suite는 fresh default legacy 유지, canonical v2 restart, explicit verified upgrade,
both-present, retired-key old backup sanitation, expired interruption cleanup, corrupted repository
fail-closed, one-action rollback과 verified forward activation을 실제 repository/startup 경계로
실행한다. Diagnostics panel은 persisted/runtime authority, revision/hash, migration status,
startup verification과 workflow requested/effective mode를 표시해야 한다. Silent fallback은
`E_COMPOSITION_AUTHORITY_FALLBACK` redacted event로 남아야 한다.

이 local suite 통과만으로 production default를 바꾸지 않는다. Supported V4/V4.5 Main/Scene/
Style Lab standard/stream, PNG/WebP, source edit, cancel matrix는 명시적 live credential opt-in과
redacted evidence가 필요하다. Android authenticated image/output과 signed export→rollback
install→restore→forward migration drill도 별도 release environment에서 실행한다.

## Android

SDK/NDK/Rust target이 있으면 clean generated project에서 debug APK를 만든다.

```text
npx --no-install tauri android init --ci --skip-targets-install
node scripts/patch-android-signing.mjs
npx --no-install tauri android build --debug --apk --ci --target x86_64
npm run test:android-debug -- --apk src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Emulator smoke는 startup, migration, Main/Scene generate-cancel 접근, sheets, AppData persistence, unsupported capability explanation, process recreation을 확인한다. NovelAI token이나 network credential이 없으면 authenticated generation/image output은 실행 불가로 명시하고 성공으로 간주하지 않는다. UI 좌표는 `uiautomator` tree의 현재 bounds에서만 얻고 persisted prompt/image가 보일 수 있는 screenshot이나 raw XML은 evidence로 보존하지 않는다. Android transport 결과는 success 또는 typed timeout/cancel로 유한 시간 안에 끝나야 하며 cancel 뒤 Scene output/history/queue를 재확인한다.

Android native response body는 raw `Channel<Response>`가 아니라 headers/body/end를 함께 운반하는
single JSON event channel을 사용한다. Body chunk는 IPC에서만 base64로 직렬화하고 JS가 즉시
`Uint8Array`로 복원한다. `test:nai-transport`는 `onBody`가 다시 생기지 않고 body event가 end 전에
조립되는지 검증하며 Rust loopback test는 reconstructed bytes와 headers→body→end 순서를 검증한다.
Token, payload, body/base64를 log나 artifact로 저장하지 않는다.

Physical app이 요청 전에 종료되면 `dumpsys activity exit-info <package>`로 app crash와 dependency
death를 먼저 구분한다. M500_MIKU에서 Google Play Services FontsProvider가
`ACCESS_BROADCAST_RESPONSE_STATS` permission denial로 crash loop를 만들었던 환경은 Android
transport 실패로 분류하지 않는다. 그러나 post-fix authenticated output gate도 통과한 것으로
간주하지 않는다. 별도 authority 없이 Play Services privileged permission grant, component disable,
data clear 또는 app-data clear로 testbed를 변형하지 않는다.

`ACCESS_BROADCAST_RESPONSE_STATS`, `READ_SAFETY_CENTER_STATUS`,
`SEND_SAFETY_CENTER_UPDATE`가 logcat에 보이면 crash line의 `Process:`를 함께 확인한다. 이 권한들은
M500_MIKU package manager에서 signature/privileged 계열이며 GMS process denial이었다. NAIS2
manifest에 선언하거나 runtime permission dialog로 요청하지 않는다. `test:android-port`는 generated
manifest에 세 privileged permission이 들어오면 실패한다. Runtime request는 NAIS2가 실제로 호출하는
dangerous permission과 app-owned failure stack이 확인된 경우에만 별도 characterization 뒤 추가한다.

Windows host에서 Stronghold의 transitive `libsodium-sys-stable`이 Android용 Unix
`configure`를 실행하지 못하면 code regression과 분리해 기록한다. Linux Android build host를
사용하거나 공식 crate archive에서 해당 target의 static library를 검증 생성한 뒤 crate가
정의한 `SODIUM_LIB_DIR`를 해당 build process에만 설정한다. Generated library를 repository에
track하거나 Base64/plain credential fallback으로 우회하지 않는다. Windows PATH에서는
standalone Rust보다 `%USERPROFILE%\.cargo\bin` rustup shim이 먼저 와야 installed Android
target sysroot를 사용한다.

## Required evidence

최종 보고는 명령, exit code, suite/test count, artifact path, 실행하지 못한 이유를 기록한다. 다음을 정적 source search만으로 통과했다고 보고하지 않는다.

- cancel timing과 store/output commit ordering
- old backup restore와 interrupted migration
- payload parity
- responsive/coarse pointer/focus assertions
- Android APK metadata/install
- Android native standard/stream body completion과 request cancellation

Retired remote runtime residue는 broad grep 결과를 수동으로 세는 대신 allowlist를 코드화한 `test:remote-runtime-removal`을 authoritative gate로 사용한다.

## Opt-in NovelAI live smoke

Live smoke는 CI와 일반 `test:composition`에서 실행하지 않는다. ignored `.env`에 `NAI_TOKEN`이 있고 Opus subscription을 확인한 뒤에만 명시적으로 실행한다.

```text
npm run smoke:nai-subscription
NAI_SMOKE_GENERATE=1 npm run smoke:nai-endpoints
NAI_LIVE=1 npm run smoke:nai-client
```

PowerShell에서는 각 env 값을 해당 process에만 설정하고 실행 후 제거한다. Endpoint smoke는 512×512, 1 step, 1 sample이고 production-client smoke는 512×512, 4 steps와 취소용 최대 28 steps를 사용한다. 토큰, payload 전문, image base64와 API error body는 출력하거나 artifact에 저장하지 않는다. Character reference와 uncached vibe는 별도 추가 비용 가능성이 있으므로 이 free-base smoke에 포함하지 않는다.

## Phase 10 organizer and distribution focused verification

먼저 pure/repository/coordinator/UI contract와 OutputWriter artifact-sidecar path를 실행한다.

```text
npm run test:organizer
npx --no-install vitest run tests/services/output/output-writer.test.ts tests/services/output/filename-policy.test.ts tests/helpers/metadata-v2.test.ts tests/services/r2/r2-upload-repository-coordinator.test.ts
npm run lint
npm run build
npm run test:responsive-layout
```

Organizer suite는 10,000-image fixed-grid bounded window, Enter/drag/touch slot assignment와 duplicate block,
portable ArtifactRecord immutability/pagination, filename traversal/reserved-name collision, original checksum,
interrupted rename/conversion rollback, failed-only retry, PNG/WebP/JPEG EXIF/XMP/ICC/text/app chunk strip, WebP flags,
alpha LSB/color fixture와 R2 enqueue linkage를 검증한다. OutputWriter suite는 image/metadata/artifact-sidecar가 같은
journal collision/rollback path를 사용하는지 확인한다. Responsive matrix에는 `/organizer` route가 포함된다.

Live NovelAI/R2 credential, actual external user folder mutation, physical Android organizer flow, actual disk-full,
Canvas/browser color-profile matrix와 WAN R2 completion은 explicit opt-in/isolated environment 없이는 실행하지 않는다.
Fixture/log/artifact에는 raw path, token, Authorization, signed URL, prompt, image byte/base64를 남기지 않는다.

## Phase 11 local-first sync focused verification

가장 작은 envelope/sanitizer/repository/conflict gate를 먼저 실행한 뒤 전체 sync category와
existing authority 계약을 확인한다.

```text
npx --no-install vitest run tests/domain/sync/envelope-and-revision.test.ts tests/domain/sync/sanitizer.test.ts tests/domain/sync/conflict-resolver.test.ts tests/domain/sync/outbox-repository.test.ts
npm run test:sync
npm run lint
npm run build
npm run test:composition
npm run test:migration
npm run test:secret-redaction
npm run test:remote-runtime-removal
```

Sync category는 다음 behavior를 source assertion만으로 통과했다고 보고하지 않는다.

- `revision = baseRevision + 1`, normal non-root의 explicit `baseOpId`, schema-v0 upgrade에서만 durable
  `lineageUnknown: true` marker, unknown envelope key/invalid timestamp/encryption fail-closed
- current canonical Composition/artifact validation, entity allowlist, nested `extensions` omission, envelope metadata와
  payload 전체의 secret/path/signed-query/image-signature/base64/blob/thumbnail/journal/lease canary. Encoded key/value와
  URL query/path/fragment는 bounded fixed-point decode하고, raw/hex/Base64/MIME-wrapped image signature는 full bounded
  value의 모든 offset, strong-binary evidence는 bounded rolling decode로 검사. Standalone opaque-ID field만 generic syntax
  예외이고 ordinary free-form prose와 decoded evidence 없는 unpadded encoding의 문법적 모호성은 limitation 55로
  유지한다. 두 예외에도 known image/strong-binary/JWT/PEM/provider credential/path 검사는 계속 적용
- user-hashed physical database와 bound-user rejection, 같은 entity/op ID의 cross-user isolation
- local sync shadow + outbox/inbox/tombstone transaction/readback. Production source edit와 outbox의
  cross-database atomicity는 Phase 11 성공 항목으로 간주하지 않음
- duplicate content/id collision, reordered parent/child, reconnect, offline close/reopen, deferred child의 later local-parent
  recomputation, equivalent operation cohort와 branch-descendant delivery permutation의 canonical convergence
- locale-independent total order, deterministic/bounded conflict-copy ID, UI preference-only LWW, immutable job
  snapshot no-merge policy
- tombstone-only persisted authority, delete-vs-edit, stale/duplicate/reordered upsert의 resurrection prevention
- 60초 `in-flight` lease, unexpired duplicate claim rejection, reopen 후 expired ready reselection, typed retry state,
  이전 attempt의 늦은 failure를 막는 attempt-count/lease CAS fence, ack/checkpoint monotonicity
- retained unique-operation 2,048 cap의 fail-closed behavior와 record 자동 compaction 부재
- schema-v0 envelope와 schema-v1 authoritative entity/outbox/tombstone/checkpoint record upgrade, 이 store들의
  malformed record에 대한 upgrade transaction abort와 previous database preservation; v1에는 없던 inbox는
  빈 current store로 생성

Phase 11에는 production caller, network transport, user-facing sync control, encryption/key management과 background
worker가 없다. 따라서 live NovelAI/R2 credential, Android network output, WAN reconnect를 이 focused gate에서
사용하지 않으며 local-only source contract을 계속 유지한다. Fixture, terminal, diagnostic에는
token, Authorization, signed URL, raw path, prompt 전문, image/base64/blob을 남기지 않는다.

## Phase 12 secure LAN transport focused verification

먼저 network-free Phase 11 regression과 새 coordinator/pairing/transport 계약을 실행하고 native TLS/Android
worker를 각각 검증한다.

```text
npx --no-install vitest run tests/services/sync tests/domain/sync/local-only.contract.test.ts tests/domain/sync/two-device-simulation.test.ts
npm run test:sync
npm run test:android-transfer
cargo test --manifest-path src-tauri/Cargo.toml sync_transport
cargo test --manifest-path src-tauri/plugins/nais-android-transfer/Cargo.toml --lib
npm run test:credential-vault
npm run test:secret-redaction
npm run test:android-port
npm run lint
npm run build
```

LAN behavior는 source assertion만으로 통과했다고 보고하지 않는다. Rust loopback/HTTPS test는 다음을 실제
socket과 bounded timeout으로 확인한다.

- TLS 1.3 mTLS paired client만 manifest/push/pull/ack route에 도달하며 missing/wrong-CA client는 handler count 0
- Pairing capability/확인 코드가 120초 이내 한 번만 소비되고 두 번째 active peer는 기존 peer revoke 전 거부
- Certificate fingerprint가 request identity이며 header/body peer ID로 spoof할 수 없음
- 같은 keepalive connection에서도 revoke 직후 다음 request가 거부됨
- sequence regression과 nonce/request-ID replay가 durable state reopen 뒤에도 거부됨
- TLS record/CSR/body tamper, browser Origin, global/wildcard bind, CIDR 밖 source와 2 MiB/100-op 초과가 fail closed
- Unpaired/expired/revoked denial에 entity ID/type/count/checkpoint/manifest가 없음
- Pull은 local apply/duplicate receipt 뒤 exact ack 전까지 remote item을 제거하지 않음

TypeScript coordinator test는 interruption-before-ack의 duplicate recovery, timeout/cancel retry lease, checkpoint
monotonicity, stale upsert의 tombstone non-resurrection, R2-object missing typed failure와 JSON stop-gate를 확인한다.
`SyncEnvelope.encrypted`는 계속 `false`여야 하며 TLS outer protection을 envelope schema migration으로 바꾸지 않는다.

Android contract는 tracked local plugin source에서 API 34+ UIDT, API 24–33 foreground WorkManager, notification
pause/cancel, durable secret-free ticket/checkpoint와 process recreation recovery를 확인한다. Generated
`src-tauri/gen/android/**` 수정만으로 통과했다고 보고하지 않는다. Physical M500_MIKU 검증은 UI tree에서
notification/action 좌표를 얻고 schedule→notification→pause/resume/cancel→process kill/relaunch를 확인하며
앱/시스템 crash는 package/process owner로 분리한다. Android 16에서는 WorkManager long-running job quota를
primary path로 쓰지 않고 user-initiated transfer 대안을 확인한다.

Current Tauri generated Android build는 Kotlin 1.9.25 compiler를 사용하므로 WorkManager는 compatible stable
2.10.5 exact pin이다. 2.11.2를 그대로 올리면 Kotlin metadata 2.1 mismatch가 발생하며 generated root compiler를
임의 수정해 우회하지 않는다. Full APK build가 Stronghold의 Windows `libsodium-sys` cross-build에서 먼저 막히면
R-025로 분리하되, tracked plugin의 최종 Kotlin compile/APK integration이 통과한 것으로 간주하지 않는다.

Windows에서 이미 검증된 target static archive가 있으면 archive가 ELF64/AArch64인지와 SHA-256을 먼저 확인하고
아래처럼 build process에만 연결한다. Archive와 generated plugin binding은 tracked source로 추가하지 않는다.

```text
$env:SODIUM_LIB_DIR=<verified-aarch64-libsodium-directory>
$env:PATH="$env:USERPROFILE\.cargo\bin;<Android Studio JBR/SDK/NDK paths>;$env:PATH"
npx tauri android build --debug --target aarch64 --split-per-abi --apk --ci
node scripts/verify-android-apk.mjs --mode debug --apk <arm64-debug-apk> --install --device <serial>
```

2026-07-15 continuation은 Android Studio JBR 21, SDK, NDK 29와 Phase 06 AArch64 archive SHA-256
`DEADF3D53DE1FC933736410A02BE9BF99F0BDDFA4A9CD05647C7EFBA1125A50F`를 사용해 첫 build attempt에서
성공했다. SM-S928N/API 36에서는 `arm64-v8a` metadata/install/start/restart와 UIDT registration/cancel persistence를
검증했다. Actual notification action과 bytes/checkpoint는 executor 부재로 미실행이라고 별도 기록한다.

Live NovelAI/R2 credential은 이 gate에 필요하지 않다. Actual R2/large-LAN byte transfer를 실행하려면 명시적으로
opt-in한 local profile에서만 수행하고 token, Authorization, certificate private key, signed URL, prompt, image/base64,
raw path를 terminal/log/artifact에 남기지 않는다. Relay는 local fake contract만 실행하며 production provider
endpoint를 구성하지 않는다.
## Phase 13 product guidance and token gate

Run the characterization gate first, then the focused Phase 13 suite:

```text
npx --no-install vitest run tests/product-guidance/phase13-baseline-characterization.test.ts
npx --no-install vitest run tests/product-guidance
npm run lint
npm run build
```

The focused suite covers fresh/returning state, locked vault/no credential, optional R2, desktop/mobile sheet placement,
keyboard/touch target and focus restore source contracts, reduced motion, ko/en/ja key parity, payload-aligned section golden
fixtures, all current models, unknown-model fallback, future-model registry injection, and DiagnosticCode guide routing. A
passing test must show the confirmed 512 upper limit for registered current models without inventing calculated usage, and
must leave unknown models limit-free. Official research is recorded in D-039 and fixture provenance; no live NovelAI/R2
credential is required or permitted by default. Manual physical Android touch QA remains separate from source/build gates.

For physical Phase 13 QA, use Android Studio's SDK/ADB attached device, build the current ARM64 APK with the existing
user-owned signer, and update-install without uninstall or app-data clear. Derive all tap coordinates from `uiautomator dump`,
then verify help trigger → bottom sheet → output/privacy controls → close/focus return. Do not use an older installed binary as
evidence.

The 2026-07-16 continuation passed this gate on `SM-S928N`/API 36 with the current signed ARM64 debug APK. `install -r`
preserved first-install time, data directory, file count and size; touch-opened Korean output/R2 guidance and keyboard
TAB/Enter/Escape focus restoration passed. When remaining QA was redirected to Hiby M500_MIKU or an emulator, Hiby was not
attached at test-bed selection, so Android Studio AVD `nais2-api35`/API 35 was used. Hiby appeared only after the permitted
AVD matrix and shutdown were complete. Build and verify the x86_64 artifact with:

```text
npx --no-install tauri android build --debug --apk --ci --target x86_64
node scripts/verify-android-apk.mjs --mode debug --apk src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk --install --device emulator-5554
```

Run the build command under the same process-scoped `ANDROID_KEYSTORE_PATH`, `ANDROID_KEY_ALIAS` and
`ANDROID_KEY_PASSWORD` setup used by `build-android-signed-local.ps1`; keep the keystore copy in the OS temp directory and
remove it in `finally`. Do not put the password or decoded keystore bytes in the command line, log or artifact.

The signed x86_64 APK passed package/version/SDK/ABI/signature/alignment checks, launch, English locked-vault guidance,
output/R2 touch disclosure, Enter/Escape focus restoration and cold process recreation. Raw UI XML and screenshots were
temporary and deleted. `updateBaseline: null` is valid only with `firstReleaseForApplicationId: true` and a
`firstReleaseVersion` equal to the current package version; existing and future baseline tags must use stable
`v<major>.<minor>.<patch>` within versionCode bounds, and release validation retains the exact `v<version>` tag check.

This device evidence does not override the responsive browser gate. The 2026-07-16 `test:responsive-layout` runs remain exit
1 at 390px because two 44px controls plus their 8px gap cannot fit the organizer's 89px safe vertical interval. Do not loosen
the overlap/clipping assertions; validate a route-specific horizontal organizer rail in a fresh session.
