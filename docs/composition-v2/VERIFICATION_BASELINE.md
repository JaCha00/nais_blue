# Composition Domain v2 검증 기준선

실행일: 2026-07-11 (Asia/Seoul)

## 저장소 및 toolchain

| 항목 | 기준선 |
| --- | --- |
| branch / upstream | `main` / `public/main` |
| HEAD | `066b043dbeb19783b563d156b505ba09f853a243` |
| target remote HEAD | `main`, `066b043dbeb19783b563d156b505ba09f853a243` |
| reference NAIS3 HEAD | `main`, `5c65aa6b00b1d3ecbeaf3787e5ab510e2464f464` |
| package manager | npm 11.8.0 |
| lockfile | `package-lock.json`, lockfileVersion 3 |
| Node.js | v25.5.0 |
| TypeScript | 5.9.3 (lockfile/install) |
| React / React DOM | 18.3.1 / 18.3.1 |
| Tauri JS API / CLI | 2.11.1 / 2.10.1 |
| Rust toolchain | rustc 1.93.0, cargo 1.93.0 |
| Rust MSRV 선언 | 1.88.0 |
| Rust `tauri` crate | 2.11.5 |

`package.json`에는 `packageManager`와 `engines` 필드가 없다. package manager 선택은 repository의 `package-lock.json`을 근거로 한다.

## npm scripts 기준선

```text
dev
dev:mobile
build
preview
test:responsive-layout
test:smart-tools
test:nai-core
test:unit
test:payload-parity
test:composition
test:migration
test:characterization
test:android-port
test:release-version
test:android-idle
smoke:nai-subscription
smoke:nai-endpoints
tauri
tauri:dev
tauri:build
tauri:android:init
tauri:android:dev
tauri:android:build:apk
tauri:android:build:aab
android:prepare
test:android-release-contract
test:android-release
test:android-debug
release:android:apk
release:android:github
lint
```

## 테스트 및 verifier 형태

- Playwright 1.61.1이 devDependency이며 `verify-responsive-layout-contract.mjs`가 `playwright`의 Chromium API를 직접 사용한다.
- `test-smart-tools-contract.mjs`는 Node 내장 `node:test`를 사용한다.
- Composition 하네스 단계에서 devDependency `vitest` 4.1.10과 `vitest.config.ts`를 추가했다. Node 환경에서 `tests/**/*.test.ts`만 실행하며 production runtime dependency가 아니다.
- `tests/helpers`, `tests/payload-parity`, `tests/migration`, `tests/characterization`, `tests/fixtures`가 일반 unit/fixture suite를 구성한다.
- `playwright.config.*`는 없으며 Playwright는 계속 responsive/E2E contract에만 사용한다.
- 나머지는 Node 기반 custom contract/phase verifier다.
- `scripts/`에는 다음 verification script가 있다.

```text
test-smart-tools-contract.mjs
verify-android-apk.mjs
verify-android-port-contract.mjs
verify-android-release-contract.mjs
verify-auto-backup-phase.mjs
verify-character-rotation-phase.mjs
verify-dual-api-phase.mjs
verify-dual-worker-phase.mjs
verify-nai-core-phase.mjs
verify-output-directories-phase.mjs
verify-prompt-editor-phase.mjs
verify-release-version.mjs
verify-responsive-layout-contract.mjs
verify-store-snapshot-phase.mjs
verify-tagger-sidecar-phase.mjs
```

## 설치 결과

### lockfile 기준 1차 시도

명령: `npm ci`

결과: **실패, exit 1**

실제 오류: 실행 중인 이 checkout의 Vite dev server가 `node_modules/@esbuild/win32-x64/esbuild.exe`를 사용하고 있어 npm이 binary를 unlink하지 못했다. Windows `EPERM` (`errno -4048`)이었다. 이 실패는 성공으로 간주하지 않는다.

### 보수적 복구 시도

명령: `npm install --no-audit --no-fund`

결과: **성공, exit 0**

- 286 packages added, 83 packages changed in `node_modules`.
- 실행 중인 dev server가 보유한 esbuild/Rollup 임시 디렉터리 cleanup에 EPERM warning이 남았다.
- `package.json`과 `package-lock.json`은 변경되지 않았다.
- 후속 `npm ls --depth=0`은 **성공, exit 0**이었다.

해석: dependency graph는 검증 가능한 상태로 복구됐지만, dev server가 실행 중인 상태에서는 clean `npm ci` 재현성이 확보되지 않았다. 이는 환경 제약이며 runtime source failure가 아니다.

## 기준선 명령 결과

| 명령 | 결과 | 증거/비고 |
| --- | --- | --- |
| `npm run test:responsive-layout` | PASS, exit 0 | 390×844, 412×892, 768×900, 1280×900에서 10개 route 확인 |
| `npm run test:smart-tools` | PASS, exit 0 | Node tests 3/3; BRIA unavailable 로그는 fallback test의 예상 경로 |
| `npm run test:nai-core` | PASS, exit 0 | 43/43; shared payload builder, V4/V4.5 parity scope, source edit ZIP, metadata 흐름 포함 |
| `npm run test:android-port` | PASS, exit 0 | Android port contract passed |
| `npm run test:release-version` | PASS, exit 0 | 2.8.1, Android versionCode 2008001 |
| `npm run test:android-release-contract` | PASS, exit 0 | Android release contract passed |
| `npm run lint` | PASS, exit 0 | ESLint warning 허용치 0 |
| `npm run build` | PASS, exit 0 | `tsc && vite build`; 2311 modules transformed; Vite 6.4.3 |
| `cargo check --manifest-path src-tauri/Cargo.toml` (1차) | FAIL, exit 1 | 과거 OneDrive checkout 절대 경로가 남은 `src-tauri/target` generated permission artifact 누락 |
| `cargo clean --manifest-path src-tauri/Cargo.toml` | PASS, exit 0 | workspace 내부 `src-tauri/target`만 정리; 57,128 files, 30.7 GiB |
| `cargo check --manifest-path src-tauri/Cargo.toml` (fresh) | PASS, exit 0 | fresh target에서 dev profile 완료, tauri 2.11.5 |

## Composition 테스트 하네스 검증

실행일: 2026-07-11 (Asia/Seoul)

실행 위치는 canonical E 드라이브 checkout `E:\AI_Project_Library\projects\nais\nais2-main`이다. 기존 `127.0.0.1:4173` Vite server가 esbuild binary를 점유하고 있어 clean install 직전에 해당 E checkout server만 중지했으며, 검증 후 같은 E 경로와 포트로 복구했다.

| 명령 | 결과 | 증거/비고 |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | PASS, exit 0 | clean install, 404 packages added |
| `npm ls --depth=0` | PASS, exit 0 | `vitest@4.1.10`, `vite@6.4.3`, dependency tree 오류 없음 |
| `npm run test:unit` | PASS, exit 0 | helper 5 files, 26/26 |
| `npm run test:payload-parity` | PASS, exit 0 | current `buildGenerateImagePayload()` 직접 호출, V4.5 fixture 1/1 |
| `npm run test:migration` | PASS, exit 0 | old/new/both/malformed/partial/interrupted 8/8 |
| `npm run test:characterization` | PASS, exit 0 | 실제 Main/Scene/Style Lab workflow capture 및 deterministic primitive, 4 files, 5/5 |
| `npm run test:composition` | PASS, exit 0 | 전체 15 files, 60/60; workflow golden/provenance/redaction 포함 |
| `npm run lint` | PASS, exit 0 | 기존 `--max-warnings 0` 유지, test/config TypeScript 포함 |
| `npm run build` | PASS, exit 0 | `tsc && vite build`, 2311 modules transformed |
| `npm run test:responsive-layout` | PASS, exit 0 | 4 viewport × 10 route |
| `npm run test:smart-tools` | PASS, exit 0 | Node tests 3/3; BRIA unavailable은 fallback case의 예상 로그 |
| `npm run test:nai-core` | PASS, exit 0 | 기존 기대값 수정 없이 43/43 |
| `npm run test:android-port` | PASS, exit 0 | Android port contract passed |
| `npm run test:release-version` | PASS, exit 0 | 2.8.1, Android versionCode 2008001 |
| `npm run test:android-release-contract` | PASS, exit 0 | Android release contract passed |

### package script 밖 기존 phase verifier 추가 진단

기존 baseline package gate 외 정적 verifier도 실행했다. `verify-dual-api-phase`, `verify-dual-worker-phase`, `verify-output-directories-phase`, `verify-prompt-editor-phase`, `verify-tagger-sidecar-phase`는 PASS였다. 다음 3개는 각 1개 static source assertion이 FAIL이며 성공으로 숨기지 않는다.

- `verify-auto-backup-phase.mjs`: verifier는 `BaseDirectory.Picture` literal을 요구하지만 현재 HEAD는 `MEDIA_STORAGE_BASE_DIRECTORY` platform abstraction을 사용한다.
- `verify-store-snapshot-phase.mjs`: 같은 `BaseDirectory.Picture` literal mismatch다.
- `verify-character-rotation-phase.mjs`: verifier는 literal `['NAIS_Scene', ...]` shape를 요구하지만 현재 HEAD는 configurable `sceneRoot`를 사용한다.

이번 단계는 `src/**`, `src-tauri/**`, `scripts/**`를 수정하지 않았으므로 위 3건은 테스트 하네스 diff가 만든 runtime regression이 아니라 기존 HEAD와 비-package static verifier 사이의 mismatch다. 이번 범위에서 verifier 기대값이나 runtime을 맞추기 위해 변경하지 않았다.

## 현재 code failure와 환경 제약 분리

### 현재 확인된 code/contract failure

- 요청된 clean install, lint, build, 새 script 5개와 기존 package contract 6개에는 failure가 없다.
- package script 밖 추가 진단에서는 위에 기록한 기존 static verifier mismatch 3건이 남아 있다. 이번 diff는 해당 runtime/source나 verifier를 수정하지 않았고, 실패를 성공으로 간주하지 않는다.

### 환경/재현성 제약

- 이 checkout에서 Vite dev server(`127.0.0.1:4173`)가 실행 중이면 Windows binary lock 때문에 `npm ci`가 실패할 수 있다.
- checkout을 이동한 뒤 재사용된 Rust target은 이전 절대 경로를 참조할 수 있다. fresh target에서는 문제가 재현되지 않았다.
- Node.js v25.5.0은 `package.json`에서 명시적으로 고정되어 있지 않다.

## 이번 baseline에서 실행하지 않은 명령

- `test:android-idle`: 장시간 idle 추적이며 phase 00 contract baseline 대상이 아니다.
- `test:android-release`, `test:android-debug`: APK 산출물이 필요한 artifact verifier다.
- `smoke:nai-subscription`, `smoke:nai-endpoints`: 실제 credential/network endpoint smoke이며 이번 단계의 로컬 contract 범위를 벗어난다.
- `release:*`, push, PR, 배포 명령: 사용자 요청 범위 밖이며 실행하지 않았다.

## 이후 phase 최소 verification gate

1. 변경 영역의 가장 작은 fixture/contract
2. `npm run test:composition`
3. `npm run test:nai-core` (composition 또는 payload 경계 변경 시 필수)
4. `npm run lint`
5. `npm run build`
6. Rust/Tauri/config/capability 변경 시 `cargo check --manifest-path src-tauri/Cargo.toml`
7. Scene 경계 변경 시 dual-worker/character-rotation verifier와 cancel/session 전용 fixture
8. persistence 변경 시 backup/snapshot verifier와 old/new format round-trip fixture
