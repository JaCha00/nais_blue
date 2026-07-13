# Composition Domain v2 implementation ledger

기준 시각: 2026-07-13T16:13:51+09:00 (Asia/Seoul)

이 문서는 현재 checkout에서 직접 확인한 runtime code, tests, `AGENTS.md`,
`docs/composition-v2/**`만을 구현 근거로 사용한다. `legacy/**`와 NAIS3 자료는
historical/behavior reference이며 production authority가 아니다.

## Phase 00 — post-cleanup baseline lock

### Baseline identity

| 항목 | 확인값 |
| --- | --- |
| Expected baseline | `4fce6de2f04e805b3a4c99dc162980e986c863fa` |
| Observed baseline HEAD | `4fce6de2f04e805b3a4c99dc162980e986c863fa` |
| Branch | `main` |
| HEAD subject | `Merge pull request #15 from JaCha00/agent/cleanup-obsolete-context` |
| Initial working tree | ` M AGENTS.md` |
| Phase 00 source changes | 없음 |
| Phase 00 tracked change | 이 ledger만 추가 |
| Package | `nais2@2.8.1` |
| Lockfile | `package-lock.json`, lockfileVersion 3 |
| Toolchain | Node v25.5.0, npm 11.8.0, rustc/cargo 1.93.0 |
| Build/test tools | TypeScript 5.9.3, Vite 6.4.3, Vitest 4.1.10, Playwright 1.61.1 |

`AGENTS.md`의 수정은 Phase 00 시작 전부터 존재한 unrelated working-tree 변경이다.
이 단계에서 수정·reset·checkout·commit하지 않는다.

### Generated tooling and retired-runtime residue

- `git ls-files -- '.codex/**' '.omx/**'`: tracked residue 0개.
- 두 경로는 `.gitignore`의 generated local tooling 경계로 유지된다.
- `npm run test:remote-runtime-removal`: exit 0. 13개 검색 항목,
  allowlisted historical/compatibility match 309개, forbidden match 0개, release frontend input
  `../dist`.
- Authoritative gate가 tracked `.codex/**`는 직접 거부하지만 tracked `.omx/**`는
  직접 세지 않는다. Phase 00은 두 경로를 별도 Git query로 확인했다.

### Reproducible verification baseline

명령은 `docs/composition-v2/DEVELOPER_VERIFICATION.md`의 순서로 실행했다.
`test:composition`은 category suite를 포함하므로 행의 수를 합산하지 않는다.

| 명령 | Exit | Suite/check count | 결과와 증거 |
| --- | ---: | --- | --- |
| `npm ci` | 0 | 391 packages added; 392 audited | clean install; reported vulnerabilities 0 |
| `npm ls --all` | 0 | 1,030 output lines | invalid/extraneous error 없음; 비현재 platform과 optional peer의 `UNMET OPTIONAL` 표시는 존재 |
| `npm run lint` | 0 | ESLint, max warnings 0 | PASS |
| `npm run build` | 0 | 2,339 modules transformed | `tsc && vite build`; `dist/` 생성 |
| `npm run test:unit` | 0 | 12 files, 42/42 tests | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 tests | PASS |
| `npm run test:composition` | 0 | 73 files discovered | 72 files passed, 1 skipped; 579 tests passed, 3 skipped out of 582 |
| `npm run test:migration` | 0 | 13 files, 113/113 tests | PASS; Node local-storage warning 2회는 실패가 아님 |
| `npm run test:characterization` | 0 | 6 files, 40/40 tests | PASS |
| `npm run test:nai-core` | 0 | 44/44 checks | PASS |
| `npm run test:smart-tools` | 0 | 3/3 tests | PASS; fallback case의 primary provider failure log는 expected behavior |
| `npm run test:responsive-layout` | 0; closure sequence 1, 0, 0 | 39 route/viewport scenarios | Initial baseline PASS. Post-ledger first attempt timed out; both subsequent runs passed every scenario. |
| `npm run test:android-port` | 0 | 1 contract gate | PASS |
| `npm run test:android-release-contract` | 0 | 1 contract gate | PASS |
| `npm run test:remote-runtime-removal` | 0 | 1 authoritative gate | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS in 8.42s |

`STATUS.md`에 기록된 578 passed tests와 현재 579 passed tests의 차이는 regression이
아니다. 해당 count를 기록한 commit `4de2cfb`이후 `1bef671`이 retired-runtime
source contract test 1개를 추가했다. 72 passed suite count는 기존 문서와 일치하며,
추가로 discovery된 1 suite/3 tests는 opt-in live suite라 정상적으로 skip됐다.

Post-ledger closure에서 responsive gate의 첫 시도는 390×844 `/tools`의
interactive-element wait 20초 timeout으로 exit 1이었다. 브라우저/page console log는
비어 있었고, 기능·테스트를 변경하지 않은 즉시 재시도에서 39개 전부가
통과했다. Ledger 작성 전 독립 실행도 39개 전부가 통과했다.
마지막 독립 확인에서도 39개 전부가 exit 0으로 다시 통과했다.
첫 실패를 숨기지 않고 non-reproduced timing/environment failure로 분리하며,
확인된 code regression으로 분류하지 않는다.

### Artifact paths

- Production frontend build: `dist/index.html`, `dist/assets/**` (ignored generated output)
- Rust check cache/output root: `src-tauri/target/` (ignored generated output)
- Verification authority: 이 ledger의 명령/exit/count 표와 현재 Git commit history
- Responsive screenshots: 생성하지 않음; evidence directory opt-in이 설정되지 않음

### Environment-limited or intentionally not executed

| 검증 | 상태 | 정확한 이유 |
| --- | --- | --- |
| Opt-in NovelAI live smoke | NOT RUN | Phase 00은 live credential 사용을 금지하며 live opt-in flag를 설정하지 않음. `.env`를 읽거나 credential을 출력하지 않음. |
| `tests/live/nai-client-live.test.ts` | SKIPPED | 위와 같은 opt-in 불성립으로 1 suite/3 tests skip; baseline의 expected 결과 |
| Android debug APK init/build/verifier | NOT RUN | Phase 00 필수 명령이 아니며 generated Android project를 재생성하는 mutation을 요청받지 않음. 정적 Android contract는 PASS. |
| Signed Android release/update/restore drill | NOT RUN | release keystore, protected signing authority, immutable release baseline, install target이 필요한 release 환경 gate |
| Physical-device manual regression | NOT RUN | 물리 device가 이 local baseline에 제공되지 않음 |
| Android idle tracking | NOT RUN | 장시간 운영 gate이며 Phase 00 reproducible command matrix 밖 |
| Responsive closure first attempt | TRANSIENT FAIL | 390×844 `/tools`의 interactive wait timeout, exit 1. Console log 없음. 이전 독립 실행과 두 번의 후속 전체 실행이 모두 exit 0이어서 재현되지 않음. |

재현된 code/contract failure는 없다. Responsive timing failure는 PASS로 재포장하지
않고 위와 같이 별도 기록한다. NOT RUN 항목도 PASS로
간주하지 않으며, production v2 authority cutover나 authenticated Android generation의
성공 근거로 사용하지 않는다.

## Current risk inventory

### Open

| ID | 요약 | 후속 gate |
| --- | --- | --- |
| R-005 | Wildcard 선택의 비결정성이 engine parity를 흔들 수 있음 | injectable deterministic processor와 captured fixture |
| R-006 | 기존 key 삭제 helper가 dual-read rollback을 깨뜨릴 수 있음 | v2 전용 dual-read/single-write; cleanup 분리 |
| R-007 | IndexedDB write 실패가 debounce/log 경계에서 성공처럼 보일 수 있음 | write-readback과 flush 결과 검증 |
| R-015 | Persisted workflow mode와 fresh process authority가 다름 | production-like startup cutover 전 legacy 경로 보존 |
| R-016 | 실제 NovelAI workflow matrix가 격리 credential 환경에 의존 | opt-in redacted live evidence |
| R-019 | Android scoped HTTP transport의 response/abort 완료가 입증되지 않음 | 실기기/별도 network에서 body와 abort 조사 |

### Watching

- R-001: Main, Scene, Style Lab materialization 의미의 미세한 drift.
- R-002: resolver 공통화가 disabled/default/v1 compatibility 경로에 주는 영향.
- R-003: Scene worker/session/cancel/requeue/finalize/image-release race.
- R-004: payload parity는 V4/V4.5만 verified이며 V3/Furry V3는 미검증.
- R-012: Windows에서 실행 중인 Vite/esbuild가 `npm ci`를 EPERM으로 막을 수 있음.
- R-014: comparison checkout을 현재 authority로 오인할 수 있음.
- R-017: signed Android update/restore가 protected secret과 immutable baseline에 의존.
- Phase 00 observation: responsive interactive wait가 1회 timeout됐으나 세 번의 전체
  PASS 사이에서 재현되지 않음. 후속 UI phase는 동일 gate의 timing 안정성을 계속 관찰한다.

### Mitigated contracts that remain mandatory

R-008, R-009, R-010, R-011, R-013, R-018은 mitigated 상태지만 삭제 근거가
아니다. Old backup/import, OutputWriter/metadata, executable category tests, startup side-effect
경계, checkout-local Rust target, session-only migration diagnostics 계약을 후속 phase에서도
계속 보존한다.

## Phase 01–14 dependencies

현재 authoritative checkout은 Phase 01–14의 개별 기능 브리프를 포함하지 않는다.
따라서 아래 표는 사용자가 정한 sequential handoff dependency만 고정하며,
없는 기능 배치를 historical 자료로 발명하지 않는다.

| Phase | Required local predecessor | 시작 gate |
| --- | --- | --- |
| 01 | Phase 00 local commit + handoff | 이 baseline의 unexplained regression 0; Phase 01 brief |
| 02 | Phase 01 local commit + handoff | Phase 01 완료/rollback 가능; Phase 02 brief |
| 03 | Phase 02 local commit + handoff | Phase 02 완료/rollback 가능; Phase 03 brief |
| 04 | Phase 03 local commit + handoff | Phase 03 완료/rollback 가능; Phase 04 brief |
| 05 | Phase 04 local commit + handoff | Phase 04 완료/rollback 가능; Phase 05 brief |
| 06 | Phase 05 local commit + handoff | Phase 05 완료/rollback 가능; Phase 06 brief |
| 07 | Phase 06 local commit + handoff | Phase 06 완료/rollback 가능; Phase 07 brief |
| 08 | Phase 07 local commit + handoff | Phase 07 완료/rollback 가능; Phase 08 brief |
| 09 | Phase 08 local commit + handoff | Phase 08 완료/rollback 가능; Phase 09 brief |
| 10 | Phase 09 local commit + handoff | Phase 09 완료/rollback 가능; Phase 10 brief |
| 11 | Phase 10 local commit + handoff | Phase 10 완료/rollback 가능; Phase 11 brief |
| 12 | Phase 11 local commit + handoff | Phase 11 완료/rollback 가능; Phase 12 brief |
| 13 | Phase 12 local commit + handoff | Phase 12 완료/rollback 가능; Phase 13 brief |
| 14 | Phase 13 local commit + handoff | Phase 13 완료/rollback 가능; Phase 14 brief |

현재 문서에서 입증되는 coarse chain은 baseline → fixture → domain
schema/primitives → pure CompositionEngine → payload parity → workflow adapter/shadow
comparison/integration이다. `tests/fixtures/README.md`에 따라 Phase 01 이후 engine
비교는 각 workflow의 `current-workflow.json`을 golden authority로 사용한다.

전 phase에 공통으로 적용되는 추가 dependency gate는 다음과 같다.

- Pure engine과 fixture parity가 workflow cutover보다 먼저다.
- Main/Scene/Style Lab adapter는 shadow/parity 증거 후 순차 cutover한다.
- Scene worker 수, token slot, streaming single-worker, session/cancel/stale guard,
  retry/requeue, rotation, image release는 adapter 작업의 재설계 대상이 아니다.
- NAI payload builder는 model fixture parity 없이 교체하지 않는다.
- Migration은 dual-read/single-write며 old data를 rollback 증거 전에 삭제하지 않는다.
- Backup compatibility는 retired-runtime cleanup보다 먼저다.
- 전면 UI 변경은 pure engine과 workflow cutover 후에만 가능하다.
- Production authority 증거는 legacy builder/feature flag 삭제보다 먼저다.
- Output commit은 OutputWriter가 소유하고 portable document와 platform
  materialization을 분리한다.

## Secret canary policy

1. Canary는 `fixture-only-*`처럼 실제 credential로 오인할 수 없는 유일한
   합성값만 사용한다. `.env`, keystore, token, account identifier, user path,
   signed URL, prompt 전문, image bytes를 canary로 사용하지 않는다.
2. Fixture/log/artifact를 저장하기 전 `tests/helpers/redaction.ts`의
   `redactSnapshot()` 또는 `redactSnapshotJson()`을 적용한다.
3. 모든 canary가 serialized output에 남지 않음과 예상한
   `[REDACTED:...]` marker와 non-secret shape가 남음을 동시에 assert한다.
4. Token, authorization header, signed URL query, prompt 전문, image base64/binary,
   API error body는 terminal, test artifact, log에 출력하지 않는다. 필요한
   경우 redacted shape/count/hash만 기록한다.
5. Live smoke는 명시적 opt-in, ignored local environment, subscription 확인이
   모두 있을 때만 process-scoped로 실행한다. 일반 baseline과 CI에서는
   실행하지 않는다.

## Rollback baseline

- Phase 00 runtime behavior는 변경되지 않았다. 되돌릴 대상은 ledger commit뿐이다.
- Phase 00을 되돌릴 때는 unrelated dirty change를 보존한 상태에서 이 ledger commit만
  `git revert` 한다. `reset --hard`, `checkout --`, `clean`을 사용하지 않는다.
- 후속 phase의 rollback anchor는 직전 phase local commit과 handoff이다. 데이터를
  삭제하지 않고 필요한 경우 검증된 authority API로 legacy에 fail closed한다.
- Release rollback은 published tag/asset을 이동하지 않고 known-good commit에서
  더 높은 patch version을 만든다. Android package identity, monotonic versionCode,
  signer continuity를 보존한다.
- 하나라도 baseline regression, Scene cancel 후 commit, old backup/image 손실,
  unexplained model payload diff, dependency/lockfile scope drift가 생기면 cutover를 중단한다.

## Phase 00 handoff

- Phase: 00 — POST-CLEANUP BASELINE LOCK
- Base HEAD: `4fce6de2f04e805b3a4c99dc162980e986c863fa`
- Resulting local commit: `SELF` (this ledger commit; resolve with `git rev-parse HEAD`)
- Changed files: `docs/composition-v2/IMPLEMENTATION_LEDGER.md`
- Behavior added/changed: runtime behavior change 없음; reproducible baseline과 ledger만 추가
- Preserved contracts: CompositionEngine, repository/migration, OutputWriter, portable capability,
  NAI payload parity, Scene orchestration, old importers/readers/fixtures, user data, generated tooling exclusion
- Tests and exit codes: 모든 필수 gate의 final run exit 0. Responsive는 독립
  PASS 후 closure 첫 시도 exit 1, 두 번의 후속 전체 실행 exit 0을 모두 기록함.
- Artifact paths: `docs/composition-v2/IMPLEMENTATION_LEDGER.md`, `dist/`, `src-tauri/target/`
- Not tested and exact reason: 위 environment-limited/intentionally not executed 표 참조
- Remaining risks: R-005, R-006, R-007, R-015, R-016, R-019 Open; Watching 7건;
  responsive timing observation 1건
- Rollback procedure: unrelated change를 보존하고 Phase 00 ledger commit만 revert
- Next phase readiness: READY — 단, 개별 Phase 01 brief가 기능 scope를 제공해야 함

## Phase 01 — secret-safe backup projection

기준 시각: 2026-07-13T16:50:15+09:00 (Asia/Seoul)

### Identity and scope

| 항목 | 확인값 |
| --- | --- |
| Base HEAD | `f8af7537586eec3f4d189c7da67f152a716394b8` |
| Branch | `main` |
| Initial working tree | ` M AGENTS.md` |
| Phase authority | current runtime/tests + Phase 01 user brief |
| Dependency change | 없음 |
| Auth store schema change | 없음; Credential Vault는 도입하지 않음 |

`AGENTS.md`의 수정은 Phase 시작 전부터 존재한 unrelated user change이며 이 Phase에서
수정·stage·commit하지 않는다. `.codex/**`, `.omx/**`도 tracked source에 추가하지 않았다.

### Behavior and contracts

- `BackupProjectionPurpose`와 `projectStoreForBackup()`를 manual/full, local auto,
  disk auto, store snapshot, restore preflight의 단일 store projection 경계로 사용한다.
- `nais2-auth`는 token/token2, runtime Anlas, raw/unknown provider fields를 제거한다.
  verified flags는 false이며 slot enabled와 알려진 tier display metadata만 남는다.
- Full envelope와 per-store snapshot의 manifest/file hash는 sanitized payload로 계산한다.
- 로컬 raw migration archive 자체는 변경하지 않지만 portable backup/snapshot projection의
  중첩 auth 직렬값은 sanitize하고 projected source hash/count를 다시 계산한다.
- Legacy v2, 과거 raw-auth v3 envelope, store-snapshot/1과 /2를 preflight할 수 있다.
  Auth restore payload는 항상 sanitize되고 `W_AUTH_CREDENTIAL_REENTRY_REQUIRED`와
  localized “자격 증명 재입력 필요” summary가 표시된다.
- 기존 disk backup을 검색·삭제·수정하지 않았다. Existing artifact risk는 R-020과
  KNOWN_LIMITATIONS 14에 기록했다.
- CompositionEngine, repository/migration authority, OutputWriter, portable capability,
  Scene worker/session/cancel/requeue/rotation/image-release, NAI payload builder는 변경하지 않았다.

### Verification

`test:composition`은 category suite를 포함하므로 행의 test count를 합산하지 않는다.

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| 수정 전 `vitest run tests/migration/secret-redaction.test.ts` | 1 | 1 file; 0/7 passed | Expected characterization failure: 기존 raw auth export/restore 확인 |
| `npm run test:secret-redaction` | 0 | 2 files, 12/12 tests | manual/full, local auto, disk auto, per-store snapshot, nested migration archive, old legacy/v3 restore, dry-run, auth-only snapshot; canary 0 |
| targeted backup/migration compatibility | 0 | 3 files, 54/54 tests | v3, old-store roundtrip, migration transaction PASS |
| `npm ci` | 0 | 391 packages; 392 audited | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous error 없음; platform optional 표시는 expected |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,340 modules | `tsc && vite build` PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | PASS |
| `npm run test:composition` | 0 | 73 passed, 1 skipped files; 589 passed, 3 skipped tests | PASS; live opt-in suite expected skip |
| `npm run test:migration` | 0 | 14 files, 123/123 | PASS; old backup Stop Gate open 아님 |
| `npm run test:characterization` | 0 | 6 files, 40/40 | PASS |
| `npm run test:nai-core` | 0 | 44/44 checks | PASS |
| `npm run test:smart-tools` | 0 | 3/3 | PASS; primary provider failure log은 fallback characterization |
| `npm run test:responsive-layout` | 0 | 39 route/viewport scenarios | PASS |
| `npm run test:android-port` | 0 | 1 gate | PASS |
| `npm run test:android-release-contract` | 0 | 1 gate | PASS |
| `npm run test:remote-runtime-removal` | 0 | 1 authoritative gate | PASS; tracked Codex tooling 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| Android init/signing patch | 0 | generated debug project | PASS |
| first Android x86_64 debug build | 1 | Rust cross-build | standalone Rust PATH가 rustup target sysroot를 보지 못한 environment failure |
| rustup-shim Android x86_64 debug build | 0 | 1 universal debug APK | PASS; source 변경 없이 PATH precedence만 교정 |
| `npm run test:android-debug -- --apk ...` | 0 | 1 APK | package `com.sunakgo.nais2.dev`, v2.8.1, minSdk 24, targetSdk 36, x86_64 verified |

### Artifacts and gaps

- Production build: `dist/index.html`, `dist/assets/**` (ignored generated output)
- Android debug APK:
  `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- Rust/Android generated caches: `src-tauri/target/**`, `src-tauri/gen/android/**`
- Verification entrypoint: `scripts/verify-secret-redaction.mjs`, package script
  `test:secret-redaction`
- Live NovelAI/R2 smoke: NOT RUN. Explicit opt-in과 credential 사용 권한이 없으며 이
  local canary verifier에는 실제 credential이 필요하지 않다.
- Signed release/update/restore drill: NOT RUN. Protected keystore, release signing authority,
  immutable release baseline과 install target이 필요한 external release gate다.
- Physical-device/emulator authenticated generation: NOT RUN. Phase 01 backup projection과
  무관하며 credential/network가 필요한 opt-in gate다.

### HANDOFF REPORT

- Phase: 01 — SECRET-SAFE BACKUP PROJECTION
- Base HEAD: `f8af7537586eec3f4d189c7da67f152a716394b8`
- Resulting local commit: `SELF` (this Phase commit; resolve with `git rev-parse HEAD`)
- Changed files: central backup projection; IndexedDB/full/auto/snapshot/restore wiring;
  restore dialogs/settings/i18n; verifier/tests/package script; composition-v2 decision/risk/limitation/ledger docs
- Behavior added/changed: 새 backup/snapshot과 restore write에서 raw auth secret 복제를 차단하고 credential 재입력 summary 제공
- Preserved contracts: existing auth store schema, v3/legacy/snapshot compatibility, exact local migration archive, repository/migration, OutputWriter, portable capability, Scene orchestration, NAI payload parity, user data
- Tests and exit codes: 위 Verification 표 참조; required final gates exit 0. Android 첫 environment attempt exit 1 후 동일 source rustup PATH run exit 0
- Artifact paths: `dist/**`, debug APK path, ignored Rust/Android build caches, this ledger
- Not tested and exact reason: live credential smoke, signed release drill, physical-device authenticated generation은 위 Gaps 참조
- Remaining risks: R-020 existing pre-Phase backup exposure; 기존 Open R-005/R-006/R-007/R-015/R-016/R-019 유지
- Rollback procedure: unrelated `AGENTS.md` 변경과 user data를 보존하고 Phase 01 commit만 `git revert <phase-01-commit>`; 기존 backup 파일을 자동 삭제하지 않음
- Next phase readiness: READY

## Phase 02 — diagnostic kernel

기준 시각: 2026-07-13T17:37:00+09:00 (Asia/Seoul)

### Identity and scope

| 항목 | 확인값 |
| --- | --- |
| Base HEAD | `f96d064c6affe24b35b38c220dd699cd05812500` |
| Branch | `main` |
| Initial working tree | ` M AGENTS.md` |
| Dependency change | 없음; 기존 `tauri-plugin-log`와 Radix toast/dialog만 재사용 |
| Generated tooling | `.codex/**`, `.omx/**` 추가 없음 |

`AGENTS.md`의 수정은 Phase 시작 전부터 있던 unrelated user change이며 이 Phase에서
수정·stage·commit하지 않는다.

### Behavior and contracts

- `DiagnosticEvent` v1, bounded in-memory `diagnostics-store`, common redactor, category
  registry, exporter와 fixed-threshold `OperationMonitor`를 추가했다.
- NovelAI client/stream/ref, Scene failure path, Main/Style Lab failure rendering,
  OutputWriter/recovery, startup migration/recovery와 R2 deploy가 동일한 safe summary와
  redacted developer projection을 사용한다. `payload.ts`와 successful request payload는
  변경하지 않았다.
- `NovelAIHttpError.message`와 Rust command error는 raw provider body를 포함하지 않는다.
  raw body는 registry의 allowlisted/bounded projection만 통과하며 token, Authorization,
  cookie/session/query token, presigned query, home/AppData path, prompt, image/base64/binary는
  toast, drawer, clipboard, JSON export와 structured file logging에서 제외한다.
- streaming progress는 monitor heartbeat를 갱신한다. monitor는 timeout/stalled event를
  관찰할 뿐 Scene worker 수, dual-token, streaming single-worker, generationSessionId,
  cancel/stale guard, retry/requeue, rotation, image-release를 변경하거나 요청을 abort하지
  않는다.
- Diagnostic toast는 user-action failure에만 non-blocking summary를 표시한다. startup event는
  drawer에 남지만 launch overlay를 만들지 않으며, fatal startup/storage error는 기존 splash
  recovery surface에서 safe summary만 보여 준다. Drawer는 native button keyboard/touch
  activation, collapse/expand, summary/full copy와 JSON export를 제공한다.
- production `tauri-plugin-log`은 `nais2_diagnostic` target만 file log로 허용하며,
  1,000,000 byte file과 `KeepSome(5)` rotation을 사용한다.

### Verification

최초 `npm run test:diagnostics`는 kernel module/UI가 아직 없는 상태에서 exit 1로 실패해
characterization baseline을 고정했다. 구현 후 해당 suite와 다음 final runs는 모두 exit 0이다.
`test:composition`은 category suite를 포함하므로 test count를 합산하지 않는다.

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| `npm ci` | 0 | 391 packages; 392 audited | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; non-host optional dependency 표시는 expected |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,350 modules | `tsc && vite build` PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | PASS |
| `npm run test:composition` | 0 | 76 passed, 1 skipped files; 614 passed, 3 skipped tests | PASS |
| `npm run test:migration` | 0 | 14 files, 123/123 | PASS |
| `npm exec vitest run tests/services/output/output-writer.test.ts` | 0 | 1 file, 10/10 | final rollback-cleanup diagnostic reporting PASS |
| `npm run test:diagnostics` | 0 | 3 files, 25/25 | category mapping; HTTP/DNS/ZIP/disk fixtures; canary; monitor; clipboard/export; UI/log contract PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 12/12 | existing backup/restore secret-redaction gate remains PASS |
| `npm run test:characterization` | 0 | 6 files, 40/40 | Scene/Main/Style Lab contract PASS |
| `npm run test:nai-core` | 0 | 44/44 checks | payload and transport parity gate PASS |
| `npm run test:smart-tools` | 0 | 3/3 | PASS; expected fallback failure text is test fixture behavior |
| `npm run test:responsive-layout` | 0 | 39 route/viewport scenarios | PASS after fixing diagnostic trigger/mobile dock and startup-toast overlap |
| `npm run test:android-port` | 0 | 1 gate | PASS |
| `npm run test:android-release-contract` | 0 | 1 gate | PASS |
| `npm run test:remote-runtime-removal` | 0 | 1 gate | PASS; tracked Codex tooling 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |

Responsive gate의 첫 세 시도는 새 fixed diagnostic launcher가 390px mobile dock, startup
diagnostic toast가 Style Lab header, 1536px fixed launcher가 existing CTA와 겹쳐 각각 exit
1이었다. 각각 safe-area offset, startup toast suppression, user-action diagnostic이 있을 때만
launcher rendering으로 수정한 뒤 final 39 scenario run이 exit 0이었다. 이는 수정 후 숨긴
failure가 아니라 Phase 내 발견·수정된 UI regression이다.

최종 rollback-cleanup reporting 보완 뒤에는 OutputWriter targeted suite, diagnostic suite,
lint, build, cargo check와 `git diff --check`를 다시 실행해 모두 exit 0을 확인했다.

### Artifacts and gaps

- Frontend build: `dist/index.html`, `dist/assets/**` (ignored generated output)
- Rust cache/output: `src-tauri/target/**` (ignored generated output)
- Diagnostic source/test entrypoints: `src/domain/diagnostics/**`, `src/services/diagnostics/**`,
  `src/stores/diagnostics-store.ts`, `src/components/diagnostics/**`, `tests/diagnostics/**`,
  `npm run test:diagnostics`
- Live NovelAI/R2 smoke: NOT RUN. Explicit credential opt-in was not provided; no `.env` or live
  token was read.
- Android debug APK/emulator and signed release/update/restore drill: NOT RUN in this Phase. The
  baseline source-contract gates passed; generated Android mutation, signing authority and physical
  target are outside this diagnostic-kernel scope.

### HANDOFF REPORT

- Phase: 02 — DIAGNOSTIC KERNEL
- Base HEAD: `f96d064c6affe24b35b38c220dd699cd05812500`
- Resulting local commit: `SELF` (this Phase commit; resolve with `git rev-parse HEAD`)
- Changed files: diagnostic domain/service/store/component/tests; NovelAI/Rust safe error path;
  Scene/Main/Style Lab/OutputWriter/startup/R2 integrations; package script and composition-v2 docs
- Behavior added/changed: redacted central error event, fixed operation monitoring, non-blocking
  safe toast/detail drawer/export, and structured bounded production diagnostic logging
- Preserved contracts: CompositionEngine, repository/migration semantics, OutputWriter transaction
  ownership, portable capability boundary, NAI payload parity, Scene orchestration/cancel/retry/
  rotation/image release, old importers/readers/fixtures, user data, generated tooling exclusion
- Tests and exit codes: Verification table above; all final gates exit 0. Responsive had three
  in-phase UI failures before the final PASS and is recorded rather than concealed.
- Artifact paths: `dist/**`, `src-tauri/target/**`, diagnostics source/tests, this ledger
- Not tested and exact reason: live credential smoke, Android generated APK/emulator, signed release
  drill and physical-device flow require opt-in credential, generated-project mutation, protected
  signing authority or unavailable hardware.
- Remaining risks: R-021 diagnostic adoption/redaction coverage is Watching; existing R-005,
  R-006, R-007, R-015, R-016, R-019 and R-020 remain unchanged.
- Rollback procedure: preserve unrelated `AGENTS.md` change and user data, then
  `git revert <phase-02-commit>`; do not reset/clean. Existing pre-Phase diagnostic artifacts are
  not automatically modified or deleted.
- Next phase readiness: READY

## Phase 03 — persistence correctness and rescue mode

기준 시각: 2026-07-13T18:20:41+09:00 (Asia/Seoul)

### Identity and scope

| 항목 | 확인값 |
| --- | --- |
| Base HEAD | `a89b083cddcfe9691f5f443311c80a0dff5f1332` |
| Branch | `main` |
| Initial working tree | ` M AGENTS.md` |
| Dependency/lockfile change | 없음 |
| Generated tooling | `.codex/**`, `.omx/**` 추가 없음 |

`AGENTS.md`는 Phase 시작 전부터 존재한 unrelated user change다. 이 Phase에서 수정,
stage, commit하지 않는다. Composition repository/strict adapter와 backup restore의 기존
authority/readback 경계를 교체하지 않고 공통 IndexedDB failure semantics만 강화했다.

### Behavior and contracts

- `rawSetItem`은 quota, abort, timeout과 transaction 실패를 더 이상 성공처럼 반환하지
  않는다. `PersistenceFault`가 stable code, operation, store key, criticality를 보존하고
  Phase 02의 redacted `DiagnosticEvent`로 변환된다.
- durability classification은 UI preference allowlist(`layout`, `theme`, `shortcuts`, `tools`,
  `update`)만 best-effort/debounce로 유지한다. 그 밖의 사용자 데이터와 auth, Scene,
  Composition repository/migration backup, reserved restore journal/queue repository key는
  critical이며 immediate transaction + readback을 통과해야 성공한다.
- key별 write serialization을 추가해 strict readback과 compare-and-set이 같은 key의
  pending write와 경합하지 않게 했다. 기존 Composition repository CAS/strict storage
  interface와 restore compensation API는 유지했다.
- `flushAllPendingWrites()`는 pending/in-flight write를 `allSettled`로 수집하되 실패를
  숨기지 않고 key별 `PersistenceFlushError.failures`로 throw한다. Debounced value는 commit
  성공 전 삭제하지 않는다.
- titlebar/Tauri close는 flush failure를 진단하고 “안전하게 저장되지 않음”을 알린 뒤
  종료를 정확히 한 번 수행한다. 알림 surface 자체가 실패해도 별도 diagnostic을 남기고
  종료를 건너뛰거나 close loop를 만들지 않는다.
- startup은 `StartupMode = normal | rescue` gate를 사용한다. IndexedDB unavailable/blocked는
  migrations, `App`, post-render scheduler, generation/edit/save entry를 mount하지 않고
  rescue screen으로 전환한다. 건강한 DB의 migration/hydration failure는 legacy authority를
  유지한 normal mode이며 old source는 삭제하지 않는다.
- rescue screen은 재시도, bounded/redacted diagnostic JSON export, desktop/Android backup
  위치 안내와 안전 종료를 제공한다. native buttons, focus-visible ring과 44px touch target을
  사용한다.
- Electron, better-sqlite3, Sharp, retired remote catalog/auth/deep-link, dependency와
  lockfile 변경은 없다. NAI payload, Scene orchestration, OutputWriter, portable capability,
  old backup/v1/metadata importer와 migration fixture는 변경하지 않았다.

### Verification

`test:composition`은 category suite를 포함하므로 행의 test count를 합산하지 않는다.

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| 구현 전 `npm exec vitest run tests/persistence` | 1 | 3 files, 12 contract cases | Expected characterization failure: typed fault/classification/startup/rescue/close APIs가 아직 없음 |
| 구현 중 첫 `npm run test:migration` | 1 | source-order contract 1건 | startup 함수 추출 시 migration-before-render source ordering이 깨져 발견; ordering을 복원하고 아래 final run 통과 |
| `npm ci` | 0 | 391 packages; 392 audited | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; non-host optional dependency 표시는 expected |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,353 modules | `tsc && vite build`; rescue chunk 포함 |
| `npx tsc --noEmit` | 0 | TypeScript project | PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | PASS |
| `npm run test:composition` | 0 | 79 passed, 1 skipped files; 627 passed, 3 skipped tests | PASS; live opt-in suite expected skip |
| `npm run test:migration` | 0 | 14 files, 123/123 | PASS; healthy-DB migration failure keeps legacy/normal startup |
| `npm run test:diagnostics` | 0 | 3 files, 25/25 | PASS; persistence projection remains redacted/bounded |
| `npm run test:persistence` | 0 | 3 files, 13/13 + 1 Chromium startup scenario | quota, abort, blocked DB, readback mismatch, flush/close failure, notification failure, startup mode, rescue contract PASS |
| `npm run test:characterization` | 0 | 6 files, 40/40 | PASS |
| `npm run test:nai-core` | 0 | 44/44 checks | payload/transport boundary PASS |
| `npm run test:smart-tools` | 0 | 3/3 | PASS; BRIA failure text is expected fallback behavior |
| `npm run test:responsive-layout` | 0 | 39 route/viewport scenarios | PASS |
| `npm run test:android-port` | 0 | 1 contract gate | PASS |
| `npm run test:android-release-contract` | 0 | 1 contract gate | PASS |
| `npm run test:remote-runtime-removal` | 0 | 1 authoritative gate | PASS; allowlisted 309, forbidden 0, tracked Codex tooling 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS in 0.54s |
| `git diff --check` | 0 | worktree diff | whitespace error 없음 |

Chromium rescue gate는 production startup에 blocked IndexedDB를 주입하고 390×844 coarse
pointer viewport에서 rescue mode만 표시되는지 확인했다. retry native button을 keyboard
Enter와 touchscreen tap으로 각각 활성화해 DB open attempt 증가를 관찰했고, 세 버튼의
44px height, backup 안내, Main/Scene generation action 부재를 확인했다. screenshot/evidence
directory는 만들지 않았다.

### Artifacts, gaps, and risk

- Frontend build: `dist/index.html`, `dist/assets/**` (ignored generated output; rescue chunk 포함)
- Rust cache/output: `src-tauri/target/**` (ignored generated output)
- Phase source/tests: `src/domain/persistence/fault.ts`, `src/lib/startup-mode.ts`,
  `src/components/startup/RescueScreen.tsx`, `tests/persistence/**`,
  `scripts/verify-rescue-mode.mjs`
- Live NovelAI/R2 smoke: NOT RUN. 명시적 opt-in과 credential 권한이 없고 Phase 03은
  persistence fault/startup scope다. `.env`, token, request payload를 읽거나 출력하지 않았다.
- Generated Android APK/emulator/physical-device rescue smoke: NOT RUN. 이 Phase는 generated
  Android project mutation이나 hardware target을 제공받지 않았고 source-contract gates만
  실행했다. Chromium production startup에서 blocked DB rescue interaction은 실행했다.
- Signed release/update/restore drill: NOT RUN. protected signing authority, immutable release
  baseline과 install target이 필요한 external release gate다.
- R-007은 Mitigated다. R-022는 large critical Zustand store의 immediate serialization/write
  pressure를 Watching으로 남긴다. best-effort allowlist 확대는 데이터 의미와 durability
  review 없이 하지 않는다.

### HANDOFF REPORT

- Phase: 03 — PERSISTENCE CORRECTNESS AND RESCUE MODE
- Base HEAD: `a89b083cddcfe9691f5f443311c80a0dff5f1332`
- Resulting local commit: `SELF` (this Phase commit; resolve with `git rev-parse HEAD`)
- Changed files: persistence fault/startup mode/rescue UI; IndexedDB/close/startup wiring;
  diagnostics integration; persistence unit/browser tests; package script and composition-v2 docs
- Behavior added/changed: critical write failure propagation/readback, keyed flush failure,
  diagnostic close handling, DB-unavailable rescue startup with retry/export/backup/exit
- Preserved contracts: CompositionEngine, repository/migration strict/CAS authority, OutputWriter,
  portable capability, NAI payload parity, Scene worker/token/session/cancel/retry/rotation/image
  release, old importers/readers/fixtures, user data, generated tooling exclusion
- Tests and exit codes: Verification table above; all final executable gates exit 0. Expected
  pre-implementation persistence failure and in-phase ordering failure are recorded separately.
- Artifact paths: `dist/**`, `src-tauri/target/**`, Phase source/tests/browser verifier, this ledger
- Not tested and exact reason: live credential smoke, generated Android/emulator/physical-device
  rescue and signed release drill은 위 Gaps의 authority/environment 제한 참조
- Remaining risks: R-022 immediate critical-write pressure Watching; live/Android external gates와
  pre-existing open risks remain
- Rollback procedure: unrelated `AGENTS.md`와 user data를 보존하고
  `git revert <phase-03-commit>`; reset/clean이나 destructive migration을 사용하지 않음
- Next phase readiness: READY

## Phase 04 — credential vault

기준 시각: 2026-07-13T19:26:54+09:00 (Asia/Seoul)

### Identity and scope

| 항목 | 확인값 |
| --- | --- |
| Base HEAD | `4c7df7299b9fa2ebb1966ad1bc6c1ee90191366a` |
| Branch | `main` |
| Initial working tree | ` M AGENTS.md` |
| Dependency change | exact `@tauri-apps/plugin-stronghold`/`tauri-plugin-stronghold` 2.3.1; MIT OR Apache-2.0 |
| Generated tooling | `.codex/**`, `.omx/**` 추가 없음 |

`AGENTS.md`는 Phase 시작 전부터 존재한 unrelated user change이며 수정·stage·commit하지
않는다. Official Stronghold plugin은 frontend API module과 Rust Stronghold/crypto graph
(Cargo lock 신규 package 85개)를 추가한다. Production build에서 Tauri vendor chunk는
30.34 kB(gzip 7.97 kB), auth-store chunk는 36.87 kB(gzip 11.97 kB)였고 Rust/APK size
증가는 별도 release artifact 비교 대상이다. 직접 암호화, Base64/plain fallback과 hardcoded
machine key는 도입하지 않았다.

### Behavior and contracts

- `CredentialVault`, `CredentialRef`, 세 credential kind와 safe error code를 domain boundary로
  추가했다. Runtime backend는 official Stronghold JS API만 감싸고 app-local Argon2 salt,
  encrypted snapshot, exact write/readback/delete verification과 metadata manifest를 소유한다.
  Custom Rust secret command를 추가하지 않아 기존 renderer NovelAI transport 외 별도 secret
  IPC surface를 만들지 않았다.
- Desktop/mobile capability는 initialize, client create/load, store get/save/remove, snapshot
  save/destroy만 명시하며 broad default permission을 사용하지 않는다. Rust startup은
  `Builder::with_argon2`로 plugin을 등록한다.
- AuthState v3는 NovelAI slot 1/2 reference, enabled, tier metadata만 strict storage에 저장한다.
  Token, verified runtime state, Anlas와 session plaintext는 Zustand memory에만 있고 vault
  lock/process restart에 비운다. Auth slot parser와 backup projection은 stable NovelAI ref
  ID/kind 외 R2/arbitrary ref를 거부한다.
- Post-hydration v2 migration은 raw source detection → user unlock → vault set/readback → v3
  IndexedDB write/readback → retained localStorage sanitize/readback → completion marker 순서다.
  Vault write 또는 marker 직전 종료 fixture에서 marker/source 상태를 검증하고 retry/resume한다.
  실패 시 v3에 raw secret을 쓰거나 plaintext storage로 전환하지 않는다.
- Settings raw-token reveal/input card를 `CredentialVaultDialog`와 last-four-only summary로
  교체했다. Register/replace/delete/reverify/enable/lock, wrong-passphrase/unavailable 상태,
  legacy backup privacy warning과 별도 destructive cleanup confirmation을 제공한다.
- 새 manual/auto/snapshot/export는 AuthState v3 reference projection만 포함한다. Explicit
  cleanup은 managed local auto/full/snapshot artifact를 값 노출 없이 structural scan하고
  credential-bearing artifact 전체만 삭제한다. 기존 파일과 user data는 자동 삭제하지 않는다.
- Main, Scene, Style Lab, Smart Tools, metadata regeneration과 character rotation 시작/resume가
  active session token 부재 시 global unlock dialog를 요청한다. Existing `getActiveTokens()`
  순서와 dual-token/streaming worker 동작은 변경하지 않았다.
- CompositionEngine, repository/migration authority, OutputWriter transaction, portable resource/
  capability adapter, `payload.ts`, Scene worker/session/cancel/stale/retry/requeue/rotation/image
  release, old backup/v1 profile/legacy metadata readers와 fixtures를 교체하거나 삭제하지 않았다.

### Verification

구현 전 Phase 전용 tests는 missing domain/backend/UI/plugin 때문에 expected exit 1이었고,
기존 `test:secret-redaction` 12/12와 characterization 40/40은 baseline으로 통과했다. 구현 중
Auth backup expectation을 v2에서 v3로 바꾸기 전 secret-redaction 10건과 Android source
import regex 1건이 실패했고 계약/fixture를 고친 뒤 final pass했다. 다음 표의 final test는
모두 raw credential, passphrase, prompt, image payload를 출력하지 않았다.

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| `npm ci` | 0 | 392 packages; 393 audited | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; non-host optional dependency 표시는 expected |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,360 modules | `tsc && vite build` PASS |
| `npx tsc --noEmit` | 0 | TypeScript project | PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | PASS |
| `npm run test:composition` | 0 | 82 passed, 1 skipped files; 643 passed, 3 skipped tests | final aggregate PASS |
| `npm run test:migration` | 0 | 14 files, 124/124 | PASS; v3 backup projection/legacy restore 포함 |
| `npm run test:diagnostics` | 0 | 3 files, 25/25 | PASS |
| `npm run test:persistence` | 0 | 3 files, 13/13 + 1 Chromium rescue scenario | PASS |
| `npm run test:credential-vault` | 0 | 3 files, 15/15 | two slots, interruption/resume, wrong passphrase, unavailable, delete, cleanup, source/capability, ref-kind gate PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | v3 ref-only backup/snapshot/export/restore PASS |
| `npm run test:characterization` | 0 | 6 files, 40/40 | dual-token generation/Scene/Style Lab contract PASS |
| `npm run test:nai-core` | 0 | 44/44 checks | payload/transport boundary PASS |
| `npm run test:smart-tools` | 0 | 3/3 | PASS; primary provider failure line은 fallback fixture behavior |
| `npm run test:responsive-layout` | 0 | 39 route/viewport scenarios | PASS |
| `npm run test:android-port` | 0 | 1 contract gate | minimum Stronghold mobile capability와 Argon2 registration 포함 PASS |
| `npm run test:android-release-contract` | 0 | 1 contract gate | PASS |
| first `npm run test:remote-runtime-removal` | 1 | forbidden documentation match 1 | 기존 Phase 03 ledger의 제품명 표현 발견; runtime residue 아님 |
| final `npm run test:remote-runtime-removal` | 0 | authoritative search gate | 표현을 generic retired-stack wording으로 고친 뒤 forbidden 0, tracked tooling 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | Stronghold host graph PASS |
| first Android x86_64 debug build | 1 | Rust sysroot | standalone Rust가 rustup shim보다 앞선 host PATH environment failure |
| rustup-path Android build | 1 | libsodium C build | Windows가 transitive Unix `configure`를 직접 실행하지 못함; source regression과 분리 |
| WSL+NDK libsodium prebuild attempt 1 | 1 | archive step | Windows `llvm-ar`가 WSL path를 해석하지 못함 |
| WSL+NDK libsodium prebuild attempt 2 | 1 | install step | static library 생성 성공 후 dependency-file path 때문에 `make install`만 실패 |
| first `SODIUM_LIB_DIR` link | 1 | native link | crate host cfg가 `liblibsodium.a` 이름을 요구함을 확인 |
| final process-local static link + Android build | 0 | 1 universal debug APK | Stronghold/libsodium/NAIS2 x86_64 Rust와 Gradle APK PASS; tracked binary 없음 |
| `npm run test:android-debug -- --apk ...` | 0 | 1 APK | package `com.sunakgo.nais2.dev`, v2.8.1, minSdk 24, targetSdk 36, x86_64 verified |
| emulator vault UI/lifecycle | 0 | create → unlocked → lock | Android API 35; privacy warning, password input, two slots, encrypted snapshot names와 final locked state 확인 |

Android emulator QA는 installed debug user data를 보존하고 `pm clear`를 실행하지 않았다.
UI tree는 allowlisted i18n key/bounds만 출력하고 temporary XML을 즉시 삭제했다. 첫 두 create
interaction은 soft keyboard가 좌표를 바꿔 app onClick에 도달하지 않은 automation failure였고,
UI-tree focus + Enter로 같은 enabled button을 activation해 native create/unlocked/lock을
통과했다. Screenshot은 prompt/user data가 artifact에 남지 않도록 생성하지 않았다.

### Artifacts, gaps, and risk

- Frontend build: `dist/index.html`, `dist/assets/**` (ignored generated output)
- Android debug APK:
  `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- Rust/Android/WSL helper artifacts: `src-tauri/target/**`, `src-tauri/gen/android/**`
  (ignored; official archive-derived target static library 포함, tracked source 아님)
- Phase source/tests: `src/domain/credentials/**`, `src/services/credentials/**`,
  `src/components/credentials/**`, `tests/credentials/**`, `npm run test:credential-vault`
- Emulator app-private evidence: `credential-vault.salt`, `nais2-credentials-v1.hold`; emulator는
  final locked 후 종료. Passphrase는 random process memory에만 있었고 출력/파일 저장하지 않음.
- Live NovelAI/R2 and authenticated dual-token generation: NOT RUN. Explicit credential opt-in이
  없고 ignored `.env`나 existing provider token을 읽지 않았다.
- Desktop native Stronghold lifecycle와 Android process-restart re-unlock: NOT RUN. Android
  create/lock은 통과했지만 ephemeral QA passphrase를 보존하지 않았고 desktop test profile을
  생성하지 않았다.
- Signed release/update/rollback drill: NOT RUN. Protected signing authority, immutable release
  baseline과 install target이 필요한 external gate다.
- Remaining risk는 R-020 legacy copies, R-023 passphrase recovery, R-024 authenticated native
  matrix, R-025 Windows libsodium cross-build와 기존 open production authority/network gate다.

### HANDOFF REPORT

- Phase: 04 — CREDENTIAL VAULT
- Base HEAD: `4c7df7299b9fa2ebb1966ad1bc6c1ee90191366a`
- Resulting local commit: `SELF` (this Phase commit; resolve with `git rev-parse HEAD`)
- Changed files: credential domain/Stronghold backend/AuthState v3 migration/storage/cleanup;
  auth/generation callers; vault UI/settings/i18n; backup projection; Tauri dependency/plugin/
  capability; credential/redaction/Android contracts; composition-v2 operations docs
- Behavior added/changed: native encrypted credential storage, post-unlock two-phase v2→v3
  migration, ref-only durable auth/backup state, global unlock request and last-four-only management
- Preserved contracts: CompositionEngine, repository/migration, OutputWriter, portable capability,
  NAI payload fixture parity, Scene worker/dual-token/streaming/session/cancel/retry/rotation/image
  release, compatibility importers/readers/fixtures, non-destructive user data
- Tests and exit codes: Verification table above; final executable gates exit 0 after recorded
  contract/environment/automation failures were corrected or explicitly separated
- Artifact paths: `dist/**`, debug APK path, ignored `src-tauri/target/**` and
  `src-tauri/gen/android/**`, Phase source/tests and this ledger
- Not tested and exact reason: live NovelAI/R2 + authenticated dual-token lacked explicit credential
  opt-in; desktop native profile was not mutated; Android re-unlock passphrase was intentionally not
  persisted; signed release drill lacked protected authority/baseline
- Remaining risks: R-020, R-023, R-024, R-025 and pre-existing production authority/network gates
- Rollback procedure: preserve unrelated `AGENTS.md`, encrypted vault and user data, then
  `git revert <phase-04-commit>`; never restore raw token to IndexedDB/localStorage. Older code cannot
  consume AuthState v3 refs, so use credential re-entry or a forward fix; vault deletion requires
  separate user confirmation.
- Next phase readiness: READY

## Phase 05 — Android NAI transport and cancellation

기준 시각: 2026-07-13T21:09:11+09:00 (Asia/Seoul)

### Identity and scope

| 항목 | 확인값 |
| --- | --- |
| Base HEAD | `4898e9384f09deee4894572c1d2b8b392a8b007e` |
| Branch | `main` |
| Initial working tree | ` M AGENTS.md` |
| Dependency change | 없음; 기존 `reqwest`, `tokio`, Tauri `Channel`, HTTP plugin 재사용 |
| Generated tooling | `.codex/**`, `.omx/**` 추가 없음 |

`AGENTS.md`는 Phase 시작 전부터 존재한 unrelated user change이며 수정·stage·commit하지
않는다. Browser/test native fetch와 desktop capability-scoped Tauri HTTP plugin은 유지하고,
Phase 04에서 standard/stream response와 abort가 제한 시간 안에 끝나지 않은 Android
generation만 fixed-endpoint Rust adapter로 격리했다. `payload.ts`, package/Cargo lockfile과
repository schema는 변경하지 않았다.

### Behavior and contracts

- `NaiTransport`는 browser/test fetch, desktop Tauri HTTP plugin, Android Rust reqwest 세
  adapter를 한 request contract 뒤에 둔다. Android command는 caller URL을 받지 않고
  `standard | stream` enum만 NovelAI 두 고정 endpoint에 매핑한다. Auxiliary/source-edit
  FormData는 기존 scoped plugin/browser fetch 경계를 유지한다.
- Standard/stream 모두 JS에서 120초 total deadline을 가진다. Android native path는 15초
  connect timeout과 response body 완료까지의 120초 reqwest deadline을 중첩한다. Plugin 또는
  IPC가 abort를 무시해도 caller는 typed `cancelled | timeout`으로 유한 시간에 종료한다.
- Tauri raw body `Channel<Response>`와 metadata channel이 response headers/body chunks를
  전달한다. Request ID별 oneshot과 header/body 각 `tokio::select!`가 cancel을 active socket
  drop에 연결한다. Host loopback server는 body 전달, active response close와 timeout을
  credential 없이 검증한다.
- OperationMonitor는 `dns-connect`, `request-sent`, `response-headers`, `body-first-byte`,
  `stream-heartbeat`, `decode` 단계만 받는다. Token, Authorization header, payload, provider
  body와 image bytes를 transport event/Rust log에 넣지 않는다.
- Scene request controller는 session/slot/request별로 소유하며 실제 standard/stream call의
  `AbortSignal`로 전달한다. Cancel은 기존 generation session을 먼저 무효화하고 해당 session의
  active controller를 abort한다. Cancel-before-request, active fetch, streaming body와
  cancel-before-output fixture에서 sequence commit, OutputWriter/history/image save, queue ghost
  resurrection이 없고 worker 종료 뒤 button lock이 풀림을 확인했다.
- 429는 기존 retryable 정책을 유지한다. Timeout은 provider outcome이 불명확하므로 queue item은
  보존하되 자동 duplicate retry를 하지 않는 fatal result로 종료한다. Existing retry/requeue,
  dual-token, streaming single-worker, rotation, image release와 generationSessionId 계약은
  교체하지 않았다.
- Source image/mask는 계속 ZIP/non-streaming 경로를 사용한다. Existing fixed-seed metadata,
  payload parity, old backup/v1 Asset Profile/legacy metadata/migration fixtures와 OutputWriter
  transaction은 그대로 보존했다.

### Characterization before implementation

| 명령 | Exit | 관찰 |
| --- | ---: | --- |
| `npx --no-install vitest run tests/characterization/scene-workflow.test.ts` | 0 | 기존 9/9 Scene worker/session/save 계약 baseline |
| `npm run test:nai-core` | 0 | 기존 payload/transport boundary 44/44 baseline |
| 첫 `npx --no-install vitest run tests/transport` | 1 | expected: 아직 `NaiTransport`/Scene controller module이 없음 |
| 새 Scene signal characterization의 첫 실행 | 1 | expected: active request에 `AbortSignal`이 전달되지 않아 1 failed/9 passed |
| request 직전 session guard 추가 후 Scene characterization | 1 | brittle source count가 의도적 guard 추가로 11→12가 됨; exact count를 12로 갱신 후 behavior 12/12 통과 |

실패를 skip/loosen/catch-ignore로 숨기지 않았다. 새 behavior를 구현하고 exact source guard를
실제 guard 수에 맞춘 뒤 아래 final matrix를 통과했다.

### Verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| `npm ci` | 0 | 392 packages; 393 audited | vulnerabilities 0; 실행 중 unrelated Node process는 종료하지 않음 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; non-host optional dependency 표시는 expected |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,362 modules | `tsc && vite build` PASS |
| focused `npx --no-install tsc --noEmit` | 0 | TypeScript project | PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | payload builder unchanged PASS |
| `npm run test:composition` | 0 | 84 passed, 1 skipped files; 658 passed, 3 skipped tests | aggregate PASS; live opt-in expected skip |
| `npm run test:migration` | 0 | 14 files, 124/124 | old/import/interruption compatibility PASS |
| `npm run test:diagnostics` | 0 | 3 files, 25/25 | redacted diagnostic contract PASS |
| `npm run test:persistence` | 0 | 3 files, 13/13 + Chromium rescue | PASS |
| `npm run test:credential-vault` | 0 | 3 files, 15/15 | PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | PASS |
| `npm run test:characterization` | 0 | 6 files, 43/43 | Scene standard/stream cancel, no late save, source ZIP, fixed-seed metadata 포함 PASS |
| `npm run test:nai-transport` | 0 | 2 files, 12/12 | browser/plugin standard+stream, pre-cancel, active cancel, body cancel/timeout, 429, Android channels PASS |
| `npm run test:nai-core` | 0 | 50/50 checks | fixed endpoint, finite timeout, stages, payload/source-edit/Scene contracts PASS |
| `npm run test:smart-tools` | 0 | 3/3 | expected provider fallback line 포함 PASS |
| `npm run test:responsive-layout` | 0 | 39 route/viewport scenarios | PASS |
| `npm run test:android-port` | 0 | 1 contract gate | native command/channel/cancel 및 기존 capability PASS |
| `npm run test:android-release-contract` | 0 | 1 contract gate | PASS |
| `npm run test:remote-runtime-removal` | 0 | authoritative search gate | allowlisted 309, forbidden 0, tracked tooling 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml nai_transport::tests --lib` | 0 | 5/5 | fixed endpoints, request scope, loopback body, socket cancel, timeout PASS |
| `rustfmt --edition 2021 --check src-tauri/src/nai_transport.rs` | 0 | new Rust source | PASS |
| first repository-wide `cargo fmt --check` | 1 | existing Rust files + initial new file | 새 파일 formatting은 교정해 독립 check 0; pre-existing `build.rs`, `lib.rs`, `main.rs`는 broad unrelated reformat하지 않음 |
| final Android x86_64 debug build | 0 | 1 universal debug APK | process-local generated libsodium link; tracked binary/dependency 없음 |
| `npm run test:android-debug -- --apk ...` | 0 | 1 APK | package `com.sunakgo.nais2.dev`, v2.8.1, minSdk 24, targetSdk 36, x86_64 PASS |
| final emulator install/start/Scene route | 0 | API 35 x86_64 | `install -r`, Main foreground, UI-tree Scene route, run/force-stop crash buffer empty |
| `git diff --check` | 0 | worktree diff | whitespace error 없음; line-ending warnings only |

Android AVD는 installed user data를 보존하고 `pm clear`를 실행하지 않았다. Navigation tap은
`uiautomator` tree의 current i18n key/bounds에서만 계산했다. 첫 relaunch 직후 Scene node wait는
loading 중 exit 1이었고 5초 뒤 동일 final APK에서 통과했다. Raw UI XML, screenshot, prompt,
image와 credential artifact는 저장하지 않았다.

Phase 04 APK 대비 final universal debug APK는 432,532,527→433,457,519 bytes,
+924,992 bytes(약 0.214%)다. Dependency/lockfile 추가는 없고 frontend/native debug code 증가다.
최종 APK를 재빌드·재설치한 뒤 Scene route에서 crash buffer는 비어 있었다. 별도 Back 종료
probe에서는 NAI request 전에도 destroyed-mutex FORTIFY line이 두 process에서 재현되어
transport success와 섞지 않고 R-026으로 등록했다. `force-stop` 종료는 crash buffer가 비었다.

### Artifacts, gaps, and risk

- Frontend build: `dist/index.html`, `dist/assets/**` (ignored generated output)
- Android debug APK:
  `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
  (433,457,519 bytes)
- Rust/Android helper output: `src-tauri/target/**`, `src-tauri/gen/android/**`, Phase 04
  process-local libsodium artifact (모두 ignored; tracked source 아님)
- Phase source/tests: `src/services/nai/transport.ts`, `src-tauri/src/nai_transport.rs`,
  `src/lib/scene-generation/request-cancellation.ts`, `tests/transport/**`, Scene characterization
- Live NovelAI/R2 and authenticated Android image output: NOT RUN. 이번 Phase에 명시적 credential
  opt-in이 없었고 ignored `.env`, existing vault token, Authorization/payload를 읽거나 사용하지 않았다.
- Desktop native Tauri live standard/stream: NOT RUN. Browser/plugin adapter behavior test와 host
  prior live evidence는 있으나 이번 Phase의 explicit credential opt-in이 없어 native profile/network를
  변형하지 않았다.
- Physical Android device, alternate carrier/network, signed release/update/rollback: NOT RUN.
  Device, protected signing authority와 immutable release baseline이 없다.
- Android emulator authenticated standard/stream success는 선언하지 않는다. Host Rust mock과
  final APK/emulator startup/Scene route만 증거이며 R-019는 Watching이다.
- R-026 Back-exit native teardown fatal log는 Open이다. Request-free exit에서 재현됐고 Phase 05
  cancel/no-late-save stop gate와 분리했지만 base artifact/physical device 비교가 남았다.

### HANDOFF REPORT

- Phase: 05 — ANDROID NAI TRANSPORT AND CANCELLATION
- Base HEAD: `4898e9384f09deee4894572c1d2b8b392a8b007e`
- Resulting local commit: `SELF` (this Phase commit; resolve with `git rev-parse HEAD`)
- Changed files: NAI transport interface/runtime adapters; Android fixed-endpoint reqwest/channel
  command; Scene request-controller ownership/cancel wiring; typed result/diagnostic stages; focused
  behavior/source contracts; composition-v2 decision/risk/verification/rollback/ledger docs
- Behavior added/changed: finite standard/stream timeout, Android native body/cancel completion,
  Scene network abort with no sequence/output/queue resurrection and eventual button unlock
- Preserved contracts: browser fetch, desktop scoped plugin, payload builder/fixture parity,
  source-edit ZIP, worker count/dual-token/streaming single-worker/generationSessionId/stale/retry/
  requeue/rotation/image release, CompositionEngine, repository/migration, OutputWriter, portable
  capability, old importers/readers/fixtures and non-destructive user data
- Tests and exit codes: final matrix above; all executable required gates exit 0. Expected
  pre-implementation failures, one exact-count update, repository-wide pre-existing fmt drift and
  transient emulator loading wait are separately recorded.
- Artifact paths: `dist/**`, final universal debug APK, ignored `src-tauri/target/**` and
  `src-tauri/gen/android/**`, Phase source/tests and this ledger
- Not tested and exact reason: authenticated Android/desktop live generation lacked explicit
  credential opt-in; physical/signed/update drill lacked device, signing authority and immutable baseline
- Remaining risks: R-019 Watching until authenticated device/network matrix; R-026 Open for Android
  Back-exit teardown; R-005/R-006/R-015/R-016 and existing credential/release risks remain
- Rollback procedure: preserve unrelated `AGENTS.md`, Stronghold/user data and generated caches, then
  `git revert <phase-05-commit>` only. Revert exposes the prior Android plugin hang, so disable Android
  authenticated generation or forward-fix; never reset/clean/delete data or change payload/OutputWriter.
- Next phase readiness: BLOCKED

Phase 06 readiness는 user brief에 따라 BLOCKED다. Host mock과 emulator evidence는 최대한
수집했지만 authenticated Android image output, physical device/network와 signed release gate를
실행하지 못했으므로 READY로 과대 보고하지 않는다.

## Phase 06 — Production v2 authority cutover gate

기준 시각: 2026-07-13T21:48:55+09:00 (Asia/Seoul)

### Identity and scope

| 항목 | 확인값 |
| --- | --- |
| Base HEAD | `fc25aa27687f45ad9b879b0825cb197d76933ad6` |
| Branch | `main` (`public/main`보다 6 commits ahead at phase start) |
| Initial working tree | ` M AGENTS.md` |
| Dependency change | 없음; package/Cargo manifests와 lockfile 변경 없음 |
| Generated tooling | `.codex/**`, `.omx/**` 추가 없음 |

`AGENTS.md`는 Phase 시작 전부터 존재한 unrelated user change이며 읽기만 하고 수정·stage·commit하지
않는다. Phase 05 resulting commit `fc25aa27687f45ad9b879b0825cb197d76933ad6`와 BLOCKED handoff를
기준으로 진행했다. Payload builder, Scene orchestration, repository schema, OutputWriter와 portable
capability boundary는 변경하지 않았다.

### Cutover gate verdict

| Gate | 판정 | 근거 |
| --- | --- | --- |
| fresh/canonical-v2/upgrade/both/old-backup/interrupted/corrupt/rollback-forward local fixture | PASS | actual repository/startup transaction 11/11 Phase 06 tests |
| unexplained payload diff 0 | PASS | `test:payload-parity` 20/20; `payload.ts` unchanged |
| host Main/Scene/Style Lab online matrix | NOT RUN | 이번 Phase의 명시적 NovelAI credential opt-in 없음 |
| Android transport production gate | BLOCKED | source contract와 Rust mock 5/5는 PASS; authenticated Android image/output은 Phase 05부터 미실행 |
| rollback export/restore drill | PARTIAL | synthetic v3/old-backup/rollback-forward tests PASS; signed artifact install/restore baseline 없음 |
| fresh default authority change | NOT APPROVED | 위 online/Android/signed gates 미충족; default remains `legacy` |

따라서 Phase 06은 authority panel과 tests만 production source에 추가하고 fresh default를 변경하지
않는다. Legacy builder, shadow path, compatibility projection과 feature flag를 유지한다.

### Behavior and contracts

- Diagnostics launcher는 event 유무와 관계없이 접근 가능하다. Mobile에서는 command dock 위
  safe-area 위치를 유지하고 `sm+`에서는 shell toolbar 안에 배치해 workspace CTA와 겹치지 않는다.
- Composition Authority panel은 strict repository read에서 persisted authority, process runtime,
  configured startup preference, repository revision/hash, migration status, startup verification과
  last startup result를 표시한다. Main/Scene/Style Lab의 persisted requested mode와 authority가
  강제한 effective mode를 같은 표에 표시한다.
- One-action rollback은 `applyCompositionAuthorityFeatureFlag('legacy')`만 호출한다. Runtime을 먼저
  legacy로 fail-close하고 repository write/readback과 feature flag persist를 수행하며 committed v2
  document/hash와 migration archive를 삭제하지 않는다. Panel은 v2 activation button을 제공하지 않는다.
- V2 activation helper는 기존 startup migration/repository verification 뒤 runtime document hash와
  committed hash를 다시 비교한다. 최종 repository read가 실패하거나 authority/document/hash가
  일치하지 않으면 runtime/feature flag를 legacy로 fail-close하고 activation을 reject한다.
- Persisted v2지만 runtime install이 실패한 successful transaction도 더 이상 console-only silent
  fallback이 아니다. Stable reason을 startup observation에 남기고 main startup이
  `E_COMPOSITION_AUTHORITY_FALLBACK` redacted DiagnosticEvent로 기록한다.
- Corrupted repository fixture는 원문을 덮어쓰거나 삭제하지 않고 `repository-invalid`/
  `E_REPOSITORY_JSON_INVALID`로 inspect되며 process authority는 legacy다.
- Fresh no-flag/no-repository fixture는 migration document를 준비해도 persisted/runtime authority가
  legacy임을 고정한다. Default authority code는 변경하지 않았다.

### Characterization and test-first evidence

| 명령 | Exit | 관찰 |
| --- | ---: | --- |
| pre-change focused authority/repository/startup/Main/Scene/Style Lab/diagnostics | 0 | 7 files, 58/58 baseline |
| new Phase 06 tests before runtime implementation | 1 expected | 2 files: 10 failed, 3 passed; missing inspection/panel/injected activation boundary를 정확히 노출 |
| first implemented focused run | 1 | 21 passed/1 failed; specific fallback reason보다 generic mismatch가 우선됨 |
| final focused Phase 06 run | 0 | 3 files, 23/23 |

실패를 skip, assertion 완화, catch-ignore로 숨기지 않았다. Fallback reason 우선순위를 고치고,
responsive CTA overlap은 launcher 배치를 수정한 뒤 같은 전체 gate를 재실행했다.

### Verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| `npm ci` | 0 | 392 packages; 393 audited | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; non-host optional dependency 표시는 expected |
| `npm run lint` (final) | 0 | ESLint max warnings 0 | PASS |
| `npm run build` (final) | 0 | 2,363 modules | `tsc && vite build` PASS |
| focused `npx --no-install tsc --noEmit` | 0 | TypeScript project | PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | payload/provenance PASS |
| `npm run test:composition` | 0 | 85 passed, 1 skipped files; 670 passed, 3 skipped tests | aggregate PASS; live opt-in expected skip |
| `npm run test:migration` | 0 | 15 files, 135/135 | production startup matrix, old backup, interruption, restore 포함 PASS |
| `npm run test:diagnostics` | 0 | 3 files, 26/26 | authority panel/fallback redaction contract 포함 PASS |
| `npm run test:persistence` | 0 | 3 files, 13/13 + Chromium rescue | PASS |
| `npm run test:credential-vault` | 0 | 3 files, 15/15 | PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | PASS |
| `npm run test:characterization` | 0 | 6 files, 43/43 | Main/Scene/Style Lab behavior unchanged PASS |
| `npm run test:nai-transport` | 0 | 2 files, 12/12 | PASS |
| `npm run test:nai-core` | 0 | 50/50 checks | payload/transport/Scene source contract PASS |
| `npm run test:smart-tools` | 0 | 3/3 | expected provider fallback line 포함 PASS |
| responsive run 1 | 1 | reached 1536 Asset Modules | diagnostic launcher overlapped Prompt CTA; layout fixed |
| responsive run 2 | 1 | reached 1536 Scene | opposite bottom placement overlapped Resolved Plan CTA; layout fixed |
| `npm run test:responsive-layout` final | 0 | 39 route/viewport scenarios | desktop toolbar + mobile safe-area launcher PASS |
| `npm run test:android-port` | 0 | 1 contract gate | PASS |
| `npm run test:android-release-contract` | 0 | 1 contract gate | PASS |
| `npm run test:remote-runtime-removal` | 0 | authoritative search gate | allowlisted 313, forbidden 0, tracked tooling 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml nai_transport::tests --lib` | 0 | 5/5 | fixed endpoint/body/cancel/timeout mock PASS |

### Artifacts, gaps, and risk

- Frontend build: `dist/index.html`, `dist/assets/**` (ignored generated output).
- Phase fixture: `tests/fixtures/legacy/production-authority-startup.json`, registered in fixture README
  and machine-readable provenance.
- Phase tests: `tests/migration/composition-production-startup.test.ts`, startup and diagnostics contracts.
- No screenshot, UI XML, prompt, image, token, Authorization header, signed URL or base64 artifact was saved.
- In-app browser manual click-through: NOT RUN. Local Vite endpoint returned HTTP 200, but browser runtime
  discovery returned no available in-app/Chrome backend; server/process tree was then stopped.
- Live NovelAI/R2 and host online matrix: NOT RUN. No explicit credential opt-in; ignored env/vault secrets
  were not read or used.
- Authenticated Android generation/image OutputWriter: NOT RUN. Phase 05 mock/source/APK readiness does not
  prove authenticated output; R-019 remains Watching.
- Signed desktop/Android export→rollback install→restore→forward drill: NOT RUN. Protected signer,
  immutable release baseline and release artifact authority are unavailable.
- Physical device/network and R-026 Back-exit comparison: NOT RUN. Device and signed artifact unavailable.

### HANDOFF REPORT

- Phase: 06 — PRODUCTION V2 AUTHORITY CUTOVER
- Base HEAD: `fc25aa27687f45ad9b879b0825cb197d76933ad6`
- Resulting local commit: `SELF` (this Phase commit; resolve with `git rev-parse HEAD`)
- Changed files: Composition startup inspection/observation and verified activation; diagnostics authority
  panel/drawer/shell launcher; startup fallback event; production-like fixture/tests/provenance; composition-v2
  status/decision/risk/limitation/verification/migration/rollback/ledger docs
- Behavior added/changed: persisted/runtime/repository/migration/workflow authority visibility; one-action
  non-destructive legacy rollback; verified forward activation contract; redacted silent-fallback evidence;
  fresh/upgrade/recovery/rollback startup matrix. Fresh default remains legacy.
- Preserved contracts: legacy builders/shadow/feature flag, CompositionEngine, repository schema/migration,
  OutputWriter, portable capability, payload fixtures/builder, Scene worker/dual-token/streaming single-worker/
  generationSessionId/cancel/stale/retry/requeue/rotation/image release, old backup/v1 importer/legacy metadata,
  non-destructive user data and retired runtime removal
- Tests and exit codes: final matrix above; all executable required gates exit 0. Expected test-first failures
  and two responsive overlap failures were corrected without relaxing tests.
- Artifact paths: `dist/**`, `tests/fixtures/legacy/production-authority-startup.json`, Phase source/tests/docs;
  no live/sensitive/screenshot artifact
- Not tested and exact reason: live host/Android online matrix lacked explicit credential opt-in; signed
  rollback drill lacked protected signer and immutable release baseline; physical Android lacked device;
  manual browser click-through lacked an available browser backend
- Remaining risks: R-015 Open until production default evidence; R-016 Open for supported-model online
  matrix; R-019 Watching for authenticated Android output; R-026 Open for Back-exit teardown; release/signing,
  credential and existing R-005/R-006 risks remain
- Rollback procedure: if runtime is v2, first use the panel or verified helper to apply legacy and confirm
  persisted/runtime legacy; preserve unrelated `AGENTS.md`, repository/backup/vault/user data and generated
  caches, then `git revert <phase-06-commit>` only. Do not reset/clean/delete data or alter payload/OutputWriter.
- Next phase readiness: BLOCKED

Phase 06 completion condition is not met because production-like default v2 startup is intentionally not
enabled. The authority panel, local fixtures, rollback action and all executable regression gates are ready,
but supported-model online evidence, authenticated Android output and signed restore drill are mandatory
before a separate cutover approval can change the fresh default.
