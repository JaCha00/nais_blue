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
npm run test:characterization
npm run test:nai-core
npm run test:smart-tools
npm run test:responsive-layout
npm run test:android-port
npm run test:android-release-contract
npm run test:remote-runtime-removal
cargo check --manifest-path src-tauri/Cargo.toml
```

`test:composition`은 현재 전체 Vitest suite를 실행하므로 category 명령과 중복될 수 있다. 중복은 실패 은폐가 아니라 category별 진단을 위한 의도된 matrix다. `test:persistence`는 Vitest fault suite 뒤에 실제 Chromium startup에서 blocked IndexedDB rescue keyboard/touch gate를 실행한다.

## Android

SDK/NDK/Rust target이 있으면 clean generated project에서 debug APK를 만든다.

```text
npx --no-install tauri android init --ci --skip-targets-install
node scripts/patch-android-signing.mjs
npx --no-install tauri android build --debug --apk --ci --target x86_64
npm run test:android-debug -- --apk src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Emulator smoke는 startup, migration, Main/Scene generate-cancel 접근, sheets, AppData persistence, unsupported capability explanation, process recreation을 확인한다. NovelAI token이나 network credential이 없으면 authenticated generation/image output은 실행 불가로 명시하고 성공으로 간주하지 않는다.

## Required evidence

최종 보고는 명령, exit code, suite/test count, artifact path, 실행하지 못한 이유를 기록한다. 다음을 정적 source search만으로 통과했다고 보고하지 않는다.

- cancel timing과 store/output commit ordering
- old backup restore와 interrupted migration
- payload parity
- responsive/coarse pointer/focus assertions
- Android APK metadata/install

Retired remote runtime residue는 broad grep 결과를 수동으로 세는 대신 allowlist를 코드화한 `test:remote-runtime-removal`을 authoritative gate로 사용한다.

## Opt-in NovelAI live smoke

Live smoke는 CI와 일반 `test:composition`에서 실행하지 않는다. ignored `.env`에 `NAI_TOKEN`이 있고 Opus subscription을 확인한 뒤에만 명시적으로 실행한다.

```text
npm run smoke:nai-subscription
NAI_SMOKE_GENERATE=1 npm run smoke:nai-endpoints
NAI_LIVE=1 npm run smoke:nai-client
```

PowerShell에서는 각 env 값을 해당 process에만 설정하고 실행 후 제거한다. Endpoint smoke는 512×512, 1 step, 1 sample이고 production-client smoke는 512×512, 4 steps와 취소용 최대 28 steps를 사용한다. 토큰, payload 전문, image base64와 API error body는 출력하거나 artifact에 저장하지 않는다. Character reference와 uncached vibe는 별도 추가 비용 가능성이 있으므로 이 free-base smoke에 포함하지 않는다.
