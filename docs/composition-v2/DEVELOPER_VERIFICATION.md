# Developer verification guide

기준일: 2026-07-13 (Asia/Seoul)

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
```

`test:composition`은 현재 전체 Vitest suite를 실행하므로 category 명령과 중복될 수 있다. 중복은 실패 은폐가 아니라 category별 진단을 위한 의도된 matrix다. `test:persistence`는 Vitest fault suite 뒤에 실제 Chromium startup에서 blocked IndexedDB rescue keyboard/touch gate를 실행한다. `test:credential-vault`는 AuthState v2→v3 two-phase migration, interruption/resume, wrong passphrase/unavailable/delete, legacy backup scan과 native source/capability 계약을 실행한다. `test:secret-redaction`은 export/snapshot/restore projection에서 AuthState v3 reference만 남고 raw secret/runtime cache가 제거되는지 별도로 검증한다. `test:nai-transport`는 browser/desktop fetch adapter와 Android channel adapter의 standard/stream, cancel-before-request, cancel-after-headers, body timeout과 429 보존을 실행한다. Rust category는 loopback mock server로 headers/body, socket cancellation과 total timeout을 검증하며 live token을 사용하지 않는다.

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
