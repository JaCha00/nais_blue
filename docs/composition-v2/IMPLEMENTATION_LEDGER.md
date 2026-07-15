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

## Phase 06 continuation — physical Android transport evidence

기준 시각: 2026-07-14 (Asia/Seoul)

### Identity and scope

| 항목 | 확인값 |
| --- | --- |
| Base HEAD | `64c061b3ef1d90118f4b77dc0cce9d9223260bb8` |
| Initial working tree | ` M AGENTS.md` |
| Credential authority | ignored `.env`의 `NAI_TOKEN` 사용을 user가 명시적으로 opt-in |
| Physical testbed | Android API 34, arm64-v8a, model `M500_MIKU` |
| Dependency change | 없음; 기존 direct `base64 = "0.22"` 재사용 |
| Production authority | 변경 없음; fresh default `legacy` |

`AGENTS.md`는 시작 전부터 존재한 unrelated user change이며 읽기만 하고 수정·stage·commit하지
않는다. Token, Authorization header, prompt 전문, signed URL, response/image base64는 terminal,
test artifact 또는 log에 남기지 않았다. Computer Use는 native Windows pipe가 없어 사용할 수
없었고, embedded Android WebView는 adb와 redacted CDP inspection으로 조작했다.

### Test-first physical diagnosis and implementation

1. Subscription smoke는 Opus tier를 확인했고 raw endpoint 512×512/1-step PNG 및 host production
   client standard PNG/metadata, msgpack stream final, AbortSignal cancel이 모두 통과했다.
2. Existing Phase 06 arm64 APK를 fresh debug package에 설치하고 physical Stronghold vault를
   만들었다. Ignored `.env` token은 UI input으로만 전달했으며 slot 1 remote verify/write/readback이
   성공했다.
3. Main standard와 stream은 response headers까지 도달했지만 각각 empty ZIP과 no-image stream으로
   실패했다. Redacted diagnostics는 standard body length 0과 stream image absence만 보였고 output,
   history 또는 image commit은 없었다.
4. 새 behavior test는 mobile-safe body chunk가 headers/end와 같은 event channel에 있고 `onBody`가
   없어야 한다고 고정했다. 구현 전 12개 중 해당 1개만 expected failure였고 나머지 11개는
   통과했다.
5. Rust raw `Channel<Response>`를 `NaiTransportEvent::BodyChunk { bytesBase64 }`로 교체했다. JS는
   같은 ordered channel에서 chunk를 `Uint8Array`로 복원한다. Separate channel end race와 mobile
   raw-body incompatibility를 함께 제거하며 payload/client/OutputWriter/Scene orchestration은
   변경하지 않았다.
6. JS adapter 12/12와 Rust loopback 5/5가 reconstructed bytes 및
   headers→body-chunk→end order를 통과했다. NAI core/Android source contract, lint, build, arm64
   cross-build, APK metadata와 overwrite install도 통과했다.

### Physical post-fix blocker

Overwrite install 뒤 M500_MIKU의 Google Play Services 26.20.31 persistent process가
`ACCESS_BROADCAST_RESPONSE_STATS` permission denial `SecurityException`으로 1~2초마다 crash했다.
Android exit-info는 NAIS2를 native crash가 아닌 FontsProvider `DEPENDENCY DIED`로 분류했다.
Device reboot 후에도 같은 crash loop가 재현됐다. Agent는 privileged permission grant, GMS
disable/data clear 또는 app-data clear를 수행하지 않았다. 따라서 post-fix standard/stream/cancel,
Main/Scene/Style Lab과 OutputWriter physical evidence는 통과가 아니라 정확한 environment-blocked다.

### Cutover gate verdict

| Gate | 판정 | 근거 |
| --- | --- | --- |
| local production startup fixture | PASS | prior Phase 06 repository/startup matrix 유지, full baseline 재실행 |
| host live smoke | PARTIAL PASS | raw endpoint와 production client standard/stream/cancel 통과; full workflow/model/format matrix 아님 |
| Android transport source/host gate | PASS | JS 12/12, Rust 5/5, arm64 APK build/verify/install |
| Android authenticated physical gate | BLOCKED | pre-fix empty body 확인; post-fix는 device-wide GMS crash로 app 생존 불가 |
| signed rollback drill | NOT RUN | protected signer와 immutable release baseline 없음 |
| fresh default authority | NOT APPROVED | full online/Android/signed gates 미충족; `legacy` 유지 |

### Final verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| regression test before implementation | 1 expected | 1 failed, 11 passed | mobile JSON body event contract가 기존 raw channel을 정확히 실패시킴 |
| focused transport after implementation | 0 | 1 file, 12/12 | ordered body event PASS |
| `npm ci` | 0 | 392 packages; 393 audited | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | host-excluded optional dependency만 표시 |
| `npm run lint` | 0 | max warnings 0 | PASS |
| `npm run build` | 0 | 2,363 modules | `tsc && vite build` PASS |
| `npm run test:composition` | 0 | 85 passed/1 skipped files; 671 passed/3 skipped tests | aggregate PASS; live opt-in tests는 baseline에서 expected skip |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | unexplained payload diff 0 |
| `npm run test:migration` | 0 | 15 files, 135/135 | production startup/old backup/interruption/rollback PASS |
| `npm run test:diagnostics` | 0 | 3 files, 26/26 | redaction/authority panel PASS |
| `npm run test:persistence` | 0 | 3 files, 13/13 + Chromium rescue | PASS |
| `npm run test:credential-vault` | 0 | 3 files, 15/15 | PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | PASS |
| `npm run test:characterization` | 0 | 6 files, 43/43 | Main/Scene/Style Lab contracts PASS |
| `npm run test:nai-core` | 0 | 50/50 | fixed endpoint/single-channel source contract PASS |
| `npm run test:nai-transport` | 0 | 2 files, 13/13 | fetch/native/cancel/body PASS |
| `npm run test:smart-tools` | 0 | 3/3 | PASS; expected provider fallback line |
| `npm run test:responsive-layout` | 0 | 39 route/viewport scenarios | PASS |
| `npm run test:android-port` | 0 | contract gate | PASS |
| `npm run test:android-release-contract` | 0 | contract gate | PASS |
| `npm run test:remote-runtime-removal` | 0 | allowlisted 313; forbidden 0; tracked tooling 0 | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| Rust `nai_transport::tests` | 0 | 5/5 | bytes/order/socket cancel/timeout PASS |
| subscription/raw endpoint/client live smoke | 0 | tier 3; PNG signature; client 3/3 | redacted opt-in PASS |
| initial arm64 build without correct `SODIUM_LIB_DIR` | 1 environment | frontend passed; libsodium configure failed | R-025, no code regression |
| corrected arm64 debug APK build | 0 | 1 universal APK | process-local official libsodium archive 사용 |
| `test:android-debug` | 0 | package/version/minSdk/targetSdk/arm64/signer | PASS |
| physical overwrite install/cold launch | 0 | M500_MIKU | install PASS; post-fix run later blocked by R-027 |
| `git diff --check` | 0 | tracked Phase diff | PASS |

### HANDOFF REPORT

- Phase: 06 — PRODUCTION V2 AUTHORITY CUTOVER / Android evidence continuation
- Base HEAD: `64c061b3ef1d90118f4b77dc0cce9d9223260bb8`
- Resulting local commit: `SELF` (resolve with `git rev-parse HEAD`)
- Changed files: Android JS/Rust transport and regression/static contracts; composition-v2
  status/decision/risk/limitation/verification/rollback/ledger docs
- Behavior added/changed: Android native body chunks use one ordered JSON/base64 event channel instead of
  a separate raw response channel; browser/desktop transports and authority default are unchanged
- Preserved contracts: CompositionEngine, repository/migration, OutputWriter, portable capability,
  payload builder/fixtures, Scene worker count/dual-token/streaming limit/session/cancel/stale/retry/requeue/
  rotation/image release, legacy builders/importers/readers, user data and Stronghold data
- Tests and exit codes: final verification table above; all executable code gates exit 0. Expected
  test-first and wrong local libsodium-path failures are separately classified and were not hidden
- Artifact paths: `dist/**`; `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`;
  ignored process-local libsodium build under `src-tauri/target/phase06-sodium-aarch64-v1/**`
- Not tested and exact reason: post-fix physical matrix blocked by Google Play Services permission crash;
  full host workflow/model/format matrix not provided by existing live smoke; signed restore drill lacks
  protected signer and immutable release baseline
- Remaining risks: R-015, R-016, R-019, R-026, R-027 and signed release/rollback evidence
- Rollback procedure: preserve unrelated `AGENTS.md`, vault/app/user/output data and generated cache; revert
  only this hardening commit. Revert restores the proven Android empty-body path, so disable Android
  authenticated generation until a forward fix. Do not reset/clean/clear data or alter payload/OutputWriter.
- Next phase readiness: BLOCKED

Fresh production default는 계속 `legacy`다. 정상화된 physical device에서 post-fix Android matrix와
full supported-model workflow online matrix, signed export/restore drill이 모두 통과하기 전 v2 default
authority를 변경하지 않는다.

## Phase 06 continuation — Windows production-like actual-app evidence

기준 시각: 2026-07-14 (Asia/Seoul)

### Identity, safety boundary, and build

| 항목 | 확인값 |
| --- | --- |
| Base HEAD | c6a0ea0d5b051d9ad400e27295ba20de8a63a44e |
| Initial working tree | unrelated user change M AGENTS.md만 존재 |
| Source package | NAIS2 2.8.1, Tauri Windows x64 |
| Isolated identifier | com.sunakgo.nais2.phase06win20260714c |
| Isolated executable SHA-256 | 1FB043A4E9858672577D79E7DE57BE47B04F65AD904B09B4E4AEF54EC65DFA6C |
| Isolated WebView profile | C:\Users\User\AppData\Local\com.sunakgo.nais2.phase06win20260714c\EBWebView |
| Credential authority | ignored .env NAI_TOKEN 사용을 user가 명시적으로 opt-in; UI direct typing만 사용 |
| Production authority | 변경 없음; fresh default legacy |

Computer Use의 screenshot과 UI Automation 연결을 먼저 확인한 뒤 실제 Tauri 창을 조작했다.
Screenshot은 일시적인 inspection에만 사용했고 파일 artifact로 저장하지 않았다. Token,
Authorization header, prompt 전문, response body, image/base64, signed URL은 terminal, log,
tracked file 또는 evidence artifact에 출력하지 않았다. Character reference와 uncached vibe는
요청대로 generation matrix에서 제외했다. 확인 과정에서 잘못 연 reference upload에는 generation을
실행하지 않았고 즉시 UI delete action으로 제거했다.

기존 사용자 profile은 삭제, 덮어쓰기 또는 clear하지 않았다. 세션 전후 canonical directory의
LastWriteTimeUtc는 각각 다음 값으로 동일했다.

- Roaming com.sunakgo.nais2: 2026-07-07T10:42:46.7109093Z
- Local com.sunakgo.nais2: 2026-01-17T10:42:41.9965824Z

최초 isolated C 실행에서는 child command line의 전용 user-data-dir를 확인했으나 전용 parent가
존재하지 않아 첫 online session의 WebView persistence가 다음 launch에 보이지 않았다. Source의
directory creation 경계는 이미 존재했으므로 product code를 추측 수정하지 않았다. 존재하지 않던
전용 parent만 비파괴적으로 생성한 뒤 fresh start와 true process restart를 다시 수행했다. 종료 시
전용 profile은 344 files이고 nais2 process는 0이다. 이 bootstrap 차이는 test-harness/runtime
observation으로 남기며 canonical user data에는 손대지 않았다.

현재 source의 final production bundle build는 exit 0, 148.2초였다.

| Artifact | Bytes | SHA-256 | Version / signature |
| --- | ---: | --- | --- |
| src-tauri/target/release/nais2.exe | 27,338,240 | B51263C738606CF0366BF915AEC71EE2F946A49A6E3F5D94B1CBCFDA7C3D2202 | 2.8.1 / Authenticode NotSigned |
| src-tauri/target/release/bundle/nsis/NAIS2_2.8.1_x64-setup.exe | 141,694,794 | 5CDD112435F12C72EA895EA770DD3319A4E4529E9D26B05DE5B7FF9A6F1CE75D | 2.8.1 / Authenticode NotSigned |
| src-tauri/target/release/bundle/msi/NAIS2_2.8.1_x64_en-US.msi | 144,117,760 | A0D78BA08FDD06A96306D979EF591F6CA958704809BEDA3FD90C5B4F13399498 | Authenticode NotSigned |
| NSIS updater .sig | 416 | 25A3041F3F595F588E5C70606DD10F367BAA1C2B7B5D32924763006739060EB0 | 존재만 확인 |
| MSI updater .sig | 416 | A2080662892DFDB71A96BB9CC563C76A8FF23C1C8FCF1B1E518FF483F9B22A64 | 존재만 확인 |

Updater signature 파일 존재는 Authenticode signing이나 signed
export→rollback→restore→forward drill 통과를 뜻하지 않는다.

### Actual Composition Authority UI and restart

Computer Use로 Diagnostics / Composition Authority panel을 실제로 열었다. 전용 persistent
profile의 fresh start와 true restart readback은 다음과 같다.

| Run | Persisted / runtime | Revision / repository hash | Migration | Startup verification |
| --- | --- | --- | --- | --- |
| persistent fresh | legacy / legacy | 4 / sha256:e052e79e2955300ce381a16ef19c6f4b17dbfc168e2d647888f79766426b1b04 | committed | 2026-07-14T00:58:08.720Z |
| true restart | legacy / legacy | 8 / sha256:a8183af890438570b42fcb07973b694fa1120403cbff109c47b2f8a3748742d1 | committed | 2026-07-14T01:06:13.510Z |

두 run 모두 Main, Scene, Style Lab requested mode는 v2이고 effective mode는 legacy였다. Silent
fallback diagnostic은 없었고 startup verification timestamp는 restart에서 갱신됐다. Revision과
hash가 repository readback을 통해 유지·전진했고 repository authority와 migration record는 user
data clear 없이 보존됐다.

Actual profile은 이미 legacy였으므로 Legacy active action은 disabled였다. Actual UI에서 지원되는
v2 activation operation도 노출되지 않았다. 따라서 private store, DevTools, IndexedDB mutation으로
v2를 강제하지 않았고 실제 v2→legacy transition은 실행하지 않았다. Public
applyCompositionAuthorityFeatureFlag('legacy')와 repository verification 경계의 one-action rollback은
production startup focused suite에서만 통과했으며 actual-app rollback PASS로 대체 보고하지 않는다.

### Actual Windows online cases

Subscription preflight는 exit 0으로 Opus tier를 확인했다. 모든 generation case는 512×512,
4 steps, 1 output이며 UI 예상 비용은 0 Anlas였다. 다음은 실행한 case 전부이며 full Cartesian
matrix가 아니다.

| ID | Workflow | Transport / format / model | Actual result |
| --- | --- | --- | --- |
| A-W1 | Main | standard / PNG / V4.5 Full | 120초 typed timeout, button unlock, output/history/file 0. Pre-fix duplicate UNKNOWN과 stale prepare stage를 재현 |
| A-W2 | Main | stream / WebP / V4 Full | 실제 cancel button, typed cancel, unlock, output/history/file 0 |
| A-S1 | Scene | stream / WebP / V4 Full | 실제 cancel, queue 0, images 0, output/history/file 0; shared generationMode가 남는 regression 재현 |
| B-T0 | Style Lab | stream / WebP / V4 Full | global shared CTA가 conflict-disabled여서 cancel 불가, 120초 typed timeout, late output 0 |
| B-T1 | Style Lab | stream / WebP / V4 Full | dedicated Stop을 8.6초에 실행, typed cancel, 약 1.5초 안에 unlock, 30초 late output/history 0 |
| C-W3 | Main | standard / PNG / V4.5 Full | 2.608초에 final image UI commit와 unlock, history 및 file commit PASS |
| C-W4 | Main | stream / WebP / V4 Full | 3.309초에 final image UI commit와 unlock, history 및 file/sidecar commit PASS |
| C-S2 | Scene | stream / WebP / V4 Full | 3.522초에 Scene image commit, queue 1→0, generated images 1, unlock와 completion PASS |
| C-T1 | Style Lab | stream / WebP / V4 Full | 3.920초에 preview commit, unlock와 file/sidecar commit PASS |
| C-C1 | Style Lab | stream / WebP / V4 Full | shared PromptPanel cancel을 약 462ms에 실행; typed cancel와 unlock, 50.728초 뒤 late preview/file/history resurrection 0 |
| C-E1 | Main source edit | streaming setting ON, I2I UI | History→Image to Image로 source mode 진입. Restarted isolated vault가 unavailable로 fail-closed하여 request 전 BLOCKED; output/file/history 변화 0 |

첫 source/transport 실패의 원인은 package-lock의 JavaScript
@tauri-apps/plugin-http 2.5.4가 push-style fetch_read_body를 호출하는 반면 Cargo.lock의 Rust
tauri-plugin-http 2.5.9는 pull-style body protocol을 제공한 version skew였다. Headers는 도착했지만
body가 UI까지 commit되지 않아 standard와 stream 모두 hard timeout에 도달했다. Test-first version
contract를 추가한 뒤 JS/Rust manifest와 lock을 exact 2.5.9로 일치시켰다.

Restart 뒤 source edit case는 stale credential reference가 보였지만 native vault는 unavailable였다.
Backup delete, Stronghold clear, plaintext fallback 또는 canonical profile 사용으로 우회하지 않았다.
따라서 actual standard ZIP request/response endpoint는 이 세션에서 증명되지 않았다. Existing static
and characterization source-edit contract 통과만으로 actual-app PASS를 선언하지 않는다.

### Redacted output evidence

Output root는 C:\Users\User\OneDrive\图片\NAIS_Phase06_Windows_20260714C 이다. Cancel과 blocked
source-edit 확인 후에도 정확히 7 files, 1,281,453 bytes이고 newest timestamp는
2026-07-14T00:51:53.9942861Z로 변하지 않았다.

- Main PNG 1개: 398,380 bytes, 89 50 4E 47 0D 0A 1A 0A, image/png, 512×512.
- Main/Scene/Style Lab WebP 각 1개: RIFF/WEBP, image/webp, 512×512.
- WebP 각 1개의 matching .nais2.json sidecar: version 2와 valid redactedPayloadHash 존재.
- PNG embedded nais2-params: version 2, v2 marker와 valid redactedPayloadHash 존재.
- PNG keyword 이름만 확인: Comment, Description, Generation_time, nais2-params, Software, Source, Title.
- WebP chunk 이름만 확인: VP8X, VP8L, EXIF.

Prompt, token, embedded payload 내용, image body는 출력하거나 별도 artifact로 복제하지 않았다.
Successful session의 cross-workflow history는 4까지 증가했고 cancel case는 이를 늘리지 않았다.

### Characterization-first fixes

1. OperationMonitor transition event가 시작 시점 stage가 아니라 현재 observation stage를 기록하도록
   behavior test를 먼저 추가하고 slow/stalled/timeout stage propagation을 수정했다.
2. Main typed termination test를 먼저 추가하고 timeout/cancelled result를
   transport-timeout/transport-cancelled로 분류해 duplicate UNKNOWN failure를 제거했다.
3. Scene cancel race test를 먼저 추가하고 last active worker만 최종 cleanup을 소유하되 worker가
   없는 orphan cancellation은 scene generationMode를 해제하도록 했다.
4. Actual Style Lab global cancel regression을 UI contract로 red 고정한 뒤 always-mounted PromptPanel의
   shared action이 Style Lab generation을 cancel하도록 conflict 조건 한 줄만 수정했다. Scene의
   separate cancellation ownership은 그대로다.
5. Actual body timeout을 version parity contract로 red 고정한 뒤 Tauri HTTP JS/Rust plugin을 exact
   2.5.9로 pin했다. Electron, better-sqlite3, Sharp나 remote runtime은 추가하지 않았다.

### Final verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| initial authority/startup focused suite | 0 | 3 files, 23/23 | baseline PASS |
| HTTP plugin version test before fix | 1 expected | 1/1 failed | JS 2.5.4 / Rust 2.5.9 skew를 정확히 고정 |
| PromptPanel cancel contract before fix | 1 expected | 1 failed | disabled shared cancel regression 고정 |
| focused diagnostics/Main/Scene/transport after fixes | 0 | 4 files, 71/71 | PASS |
| final Scene orphan-cleanup focused review | 0 | 1 file, 14/14 | no-active-worker cancellation unlock PASS |
| npm ci | 0 | 392 packages | vulnerabilities 0 |
| npm ls --all | 0 | dependency tree | invalid/extraneous 없음; host-excluded optional dependencies만 표시 |
| npm run lint | 0 | ESLint max warnings 0 | PASS |
| npm run build | 0 | 2,363 modules | tsc && vite build PASS |
| npm run test:unit | 0 | 12 files, 42/42 | PASS |
| npm run test:payload-parity | 0 | 5 files, 20/20 | unexplained payload diff 0 |
| npm run test:composition | 0 | 86 passed/1 skipped files; 677 passed/3 skipped tests | aggregate PASS |
| npm run test:migration | 0 | 15 files, 135/135 | PASS |
| npm run test:diagnostics | 0 | 3 files, 27/27 | PASS |
| npm run test:persistence | 0 | 3 files, 13/13 + Chromium rescue | PASS |
| npm run test:credential-vault | 0 | 3 files, 15/15 | PASS |
| npm run test:secret-redaction | 0 | 2 files, 13/13 | PASS |
| npm run test:characterization | 0 | 6 files, 46/46 | PASS |
| npm run test:nai-core | 0 | 50/50 verifier checks | PASS |
| npm run test:nai-transport | 0 | 3 files, 14/14 | standard/stream/cancel/timeout/version parity PASS |
| npm run test:smart-tools | 0 | 3/3 | expected BRIA fallback line 포함 PASS |
| npm run test:responsive-layout | 0 | 39 route/viewport checks | PASS |
| npm run test:android-port | 0 | contract gate | PASS |
| npm run test:android-release-contract | 0 | contract gate | PASS |
| npm run test:remote-runtime-removal | 0 | forbidden 0; tracked tooling 0; allowlisted 313 | PASS |
| cargo check --manifest-path src-tauri/Cargo.toml | 0 | Rust dev profile | PASS |
| cargo test --manifest-path src-tauri/Cargo.toml nai_transport::tests --lib | 0 | 5/5 | PASS |
| npm run smoke:nai-subscription | 0 | tier 3 Opus | redacted credential preflight PASS |
| npm run tauri:build -- --bundles nsis,msi | 0 | app + NSIS + MSI + updater sig files | current-source production bundle PASS |

Node의 invalid localstorage-file warning과 smart-tools intentional BRIA unavailable fallback은 passing
contract의 expected diagnostics다. Test skip이나 assertion 완화, catch-and-ignore로 실패를 숨기지
않았다.

### Gate verdict and handoff

| Gate | 판정 | 근거 |
| --- | --- | --- |
| actual Windows startup/restart authority | PASS within executed scope | isolated persistent repository revision/hash/timestamp 전진, legacy 유지 |
| actual host online matrix | PARTIAL PASS | Main standard+stream, Scene stream, Style Lab stream와 cancel 성공; full Cartesian matrix 아님 |
| source edit standard ZIP | BLOCKED | actual UI 진입 후 isolated native vault unavailable로 request 전 fail-closed |
| one-action actual rollback transition | NOT RUN | actual state가 이미 legacy이고 action disabled; supported v2 activation 없음 |
| Android authenticated post-fix | BLOCKED | M500_MIKU device-wide Google Play Services permission crash |
| signed rollback drill | NOT RUN | artifacts Authenticode NotSigned; protected signer/immutable baseline 없음 |
| fresh default v2 | NOT APPROVED | mandatory Android/full-host/signed gates 미충족 |

- Phase: 06 — PRODUCTION V2 AUTHORITY CUTOVER / Windows production-like continuation
- Base HEAD: c6a0ea0d5b051d9ad400e27295ba20de8a63a44e
- Resulting local commit: SELF (resolve with git rev-parse HEAD)
- Changed files: Tauri HTTP plugin exact-version manifests/lock/contract; diagnostics, Main typed termination,
  Scene cancel cleanup and Style Lab shared cancel source/tests; this ledger
- Behavior added/changed: Windows Tauri body protocol version skew 제거; typed stage/termination 보존;
  Scene cancel state unlock; Style Lab shared CTA actual cancel
- Preserved contracts: fresh default legacy, CompositionEngine, repository/migration, OutputWriter,
  portable capability, payload builder/fixtures, Scene worker/session/token/stream/cancel/stale/requeue/
  rotation/image-release, legacy builders/shadow/importer/readers, user/vault/output data
- Computer Use flows exercised: isolated app launch/restart; vault slot state; Diagnostics/Composition
  Authority; Main/Scene/Style Lab generate; standard/stream; PNG/WebP; actual Stop/shared cancel; History
  source-edit entry; output/history/button/queue and late-resurrection inspection
- Online cases actually executed: exact table above; 4 successful generation commits, 4 typed cancels,
  2 pre-fix timeouts, 1 request-before-vault block. Full matrix PASS claim 없음
- Tests and exit codes: final verification table above; executable baseline and production bundle all exit 0
- Artifact paths: dist/**; src-tauri/target/release/**;
  src-tauri/target/phase06-windows-isolated-c/release/nais2.exe;
  C:\Users\User\AppData\Local\com.sunakgo.nais2.phase06win20260714c; redacted output root; no screenshot
  or sensitive artifact
- Not tested and exact reason: Scene/Style Lab standard, their PNG paths, remaining model/format Cartesian
  pairs were not executed; source edit request blocked before network by isolated native vault unavailable;
  actual rollback transition impossible from already-legacy state without prohibited private activation;
  Character reference/uncached vibe excluded by request; Android blocked by R-027; signed drill lacks signer
- Remaining risks: R-015, R-016, R-019, R-026, R-027; incomplete host matrix; isolated profile bootstrap/
  vault restart observation; unsigned production packages and no signed restore evidence
- Rollback procedure: when runtime is v2, use only the public legacy panel/helper action, verify persisted and
  runtime legacy plus repository revision/hash, then restart. Preserve unrelated AGENTS.md, repository,
  backup, vault, user/output data and generated caches; revert only this continuation commit if code rollback
  is required. Do not reset/clean/clear data or mutate private stores.
- Next phase readiness: BLOCKED

Fresh production authority remains legacy. A separate approval must not change it until the complete host
workflow matrix, post-fix authenticated Android gate or explicit Android-exclusion decision, and signed
export→rollback→restore→forward drill all pass with unexplained payload diff 0.

## Phase 07 — VAULT RESTART LIFECYCLE / ANDROID PERMISSION CLASSIFICATION

기준 시각: 2026-07-14 (Asia/Seoul)

### Baseline and characterization-first evidence

- Base HEAD: `f7c029a048e9dc97a41f40f49d338354c57ea297`
- Initial working tree: unrelated user change `M AGENTS.md`와 generated untracked
  `src-tauri/src-tauri/**`가 있었고 변경·삭제하지 않았다.
- Initial red tests: credential-vault source contract 2 failed, persistence lifecycle behavior 2 failed.
  Native parent directory creation, cleanup ordering, cleanup failure diagnosis, I2I readiness와 common
  relaunch wrapper 부재를 각각 정확히 고정했다.
- Android contract는 기존 manifest에 privileged permission이 없어서 처음부터 통과했다. 이는
  runtime permission 구현 증거가 아니라 잘못된 GMS privileged permission 추가 방지 gate다.

### Behavior and boundary changes

1. Rust setup이 Stronghold plugin 등록 전에 `app_data_dir`와 `app_local_data_dir`를
   `create_dir_all`로 비파괴 생성한다. Snapshot/salt format이나 위치는 바꾸지 않았다.
2. `closeApplicationWithFlush`가 persistence flush 뒤 Stronghold `lock()`/official `unload()`를
   await한 후 exit한다. Cleanup 실패는 `credential-vault.shutdown` diagnostic과 사용자 안내를 남기고
   process exit는 한 번 수행한다.
3. Updater, legacy import, full backup restore와 per-store restore의 모든 `relaunch()` caller를
   `relaunchApplication()`으로 모아 같은 flush→unload→relaunch 순서를 사용한다.
4. Credential hydration은 single-flight다. History→I2I는 hydration과 진행 중 unlock의 terminal
   state를 await하며 기다리는 동안 bounded spinner overlay를 표시한다. `unavailable/error`이면 vault
   dialog를 열고 source image, I2I mode와 navigation을 commit하지 않는다.
5. Android logcat/dumpsys는 NAIS2 crash가 아닌 GMS privileged permission failure와 FontsProvider
   dependency death를 확인했다. NAIS2 manifest/runtime permission이나 Google Play dependency를
   추가하지 않았다.

### Android physical evidence

M500_MIKU API 34의 historical crash buffer에서 `com.google.android.gms.persistent`가
`ACCESS_BROADCAST_RESPONSE_STATS`, `com.google.android.gms`가
`READ_SAFETY_CENTER_STATUS`/`SEND_SAFETY_CENTER_UPDATE` denial로 종료됐다. Device package manager
protection level은 각각 `signature|privileged|development`, `signature|privileged`,
`internal|privileged`였다. NAIS2 exit-info는 `reason=12 (DEPENDENCY DIED)`와
`com.google.android.gms/.fonts.provider.FontsProvider` dependency를 기록했다.

Logcat clear 뒤 기존 debug package를 명시적으로 cold launch한 결과 status `ok`, PID `13588`이었고
full local baseline 뒤에도 PID가 유지됐으며 새 crash buffer match는 없었다. Historical exit-info는
남아 있다. Device/Play Services를 grant, disable, clear 또는 reset하지 않았다. 이 short survival은
authenticated Android generation/output matrix PASS가 아니다.

### Final verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| initial `test:credential-vault` before implementation | 1 expected | 2 failed | directory/readiness/relaunch contract red |
| initial `test:persistence` before implementation | 1 expected | 2 failed | cleanup ordering/failure behavior red |
| `npm ci` | 0 | 392 packages | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음 |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,364 modules | tsc + Vite PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | unexplained diff 0 |
| `npm run test:composition` | 0 | 87 passed/1 skipped files; 683 passed/3 skipped tests | aggregate PASS |
| `npm run test:migration` | 0 | 15 files, 135/135 | PASS |
| `npm run test:diagnostics` | 0 | 3 files, 27/27 | PASS |
| `npm run test:persistence` | 0 | 3 files, 15/15 + Chromium rescue | PASS |
| `npm run test:credential-vault` | 0 | 4 files, 19/19 | lifecycle/readiness PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | PASS |
| `npm run test:characterization` | 0 | 6 files, 46/46 | PASS |
| `npm run test:nai-core` | 0 | 50/50 | payload/source-edit contract PASS |
| `npm run test:nai-transport` | 0 | 3 files, 14/14 | PASS |
| `npm run test:smart-tools` | 0 | 3/3 | expected BRIA fallback 포함 PASS |
| `npm run test:responsive-layout` | 0 | 39 route/viewport cases | PASS |
| `npm run test:android-port` | 0 | source/generated manifest contract | privileged permission absent PASS |
| `npm run test:android-release-contract` | 0 | release contract | PASS |
| `npm run test:remote-runtime-removal` | 0 | forbidden 0; allowlisted 313; tracked tooling 0 | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| Rust `nai_transport::tests` | 0 | 5/5 | PASS |
| adb cold launch/PID/new crash buffer | 0 | 1 physical package | launch/PID PASS; authenticated matrix 미실행 |
| `git diff --check` | 0 | final tracked diff | PASS |

Node invalid localstorage-file warning과 Smart Tools BRIA unavailable line은 passing contract의 expected
diagnostic이다. Test skip, assertion 완화, catch-and-ignore 또는 device 권한 조작으로 실패를 숨기지 않았다.

### HANDOFF REPORT

- Phase: 07 — VAULT RESTART LIFECYCLE / ANDROID PERMISSION CLASSIFICATION
- Base HEAD: `f7c029a048e9dc97a41f40f49d338354c57ea297`
- Resulting local commit: `SELF` (resolve with `git rev-parse HEAD`)
- Changed files: Rust Stronghold startup; credential auth/readiness; persistence/relaunch lifecycle; History
  source-edit UI; updater/restore relaunch callers; Android contract; credential/persistence tests;
  composition-v2 status/decision/risk/limitation/verification/rollback/ledger docs
- Behavior added/changed: native data dirs exist before Stronghold initialization; close/relaunch awaits vault
  unload; I2I entry waits for vault readiness; GMS privileged permissions are rejected from NAIS2 manifest
- Preserved contracts: fresh authority legacy, CompositionEngine, repository/migration, OutputWriter,
  portable capability, payload builder/fixtures, source-edit ZIP, Scene worker/dual-token/stream/session/cancel/
  stale/retry/requeue/rotation/image release, legacy builders/importers/readers, existing user/vault data
- Tests and exit codes: final verification table above; all final executable gates exit 0
- Artifact paths: `dist/**`; `src-tauri/target/**`;
  ignored `artifacts/phase07-vault-android-redacted.txt`; this ledger
- Not tested and exact reason: existing encrypted Windows vault unlock→restart→re-unlock and actual source-edit
  request need passphrase/live credential opt-in; Android authenticated standard/stream/cancel/output was not
  run because no credential opt-in and historical R-027 remains intermittent; signed rollback lacks protected
  signer/immutable baseline
- Remaining risks: R-015, R-016, R-019, R-024, R-026, R-027, R-028; actual existing-vault restart and
  authenticated Android/signed release gates remain open
- Rollback procedure: preserve unrelated `AGENTS.md`, generated caches, Stronghold snapshot/salt, app/user/output
  data; revert only this Phase 07 local commit. Do not reset/clean/delete vault data, grant privileged Android
  permissions, disable/clear Play Services, or mutate payload/OutputWriter/Scene contracts.
- Next phase readiness: BLOCKED — credential-opt-in existing-vault restart, Android authenticated output와
  signed rollback evidence가 남아 있다.

## Phase 07 — DURABLE QUEUE DOMAIN

기준 시각: 2026-07-14 (Asia/Seoul)

### Baseline and characterization-first evidence

- Base HEAD: `a62aa14ecd34996a42ad621c036b234932fcdb11`
- Initial working tree: unrelated user change `M AGENTS.md`와 generated untracked
  `src-tauri/src-tauri/**`가 있었고 변경·삭제·stage하지 않았다.
- Initial focused characterization command는 exit 1 expected였다. Queue modules가 아직 없어 domain/
  repository suites가 import 단계에서 실패했고, Vault availability path test는 absolute `exists` 호출을
  검출했다. Assertion 완화나 skip 없이 source implementation 뒤 같은 suites를 green으로 전환했다.
- Fresh production authority와 legacy/payload fixture는 변경하지 않았다. `src/services/nai/payload.ts`,
  Scene worker, generation-store, OutputWriter, composition repository/migration과 portable capability caller는
  diff에 없다.

### Durable queue behavior and boundaries

1. Pure `GenerationJob` domain은 queued/leased/running/succeeded/failed/cancelled/skipped/blocked/recovering
   상태와 모든 allowed/invalid transition, terminal-state 불변을 명시한다.
2. Enqueue snapshot은 final prompt/params/output policy/resources/resumability를 canonical immutable document로
   고정하고 `sha256:` hash를 만든다. Token, Authorization, base64, signed URL/cache secret field와 data URL/
   Bearer value를 거부하며 error에는 secret 값을 포함하지 않는다. Volatile resource는 explicit
   non-resumable reason 없이는 저장할 수 없다.
3. 별도 `nais2-durable-generation-queue` IndexedDB database version 2가 normalized `batches`, `jobs`,
   `attempts`, `leases`, `resources` store를 사용한다. Critical mutation은 transaction 뒤 strict readback을
   수행하고 unique idempotency index, indexed priority/ordinal/id pagination과 CAS lease token을 사용한다.
4. Lease expiry는 leased/running job을 recovering으로 원자 전환하고 active attempt를 interrupted로 끝낸다.
   Restart recovery는 resource ref/digest와 retry budget을 확인해 queued/blocked/failed 중 하나로 한 번만
   전환한다. Missing/digest-mismatch/non-resumable work를 retry loop로 반복하지 않는다.
5. Version 1 job에 내장된 lease를 version 2 `leases` store로 옮긴다. Malformed upgrade는 transaction을
   abort해 v1 record를 보존한다.
6. `fake-indexeddb@6.2.5` exact devDependency(Apache-2.0, Node >=18)를 test-only로 추가했다. Production 및
   Android bundle input에는 import되지 않는다.

### Vault `$APPDATA` ACL investigation

- Generated production capability JSON에 `$APPDATA/**`가 있음을 확인했다.
- 별도 identifier `com.sunakgo.nais2.phase07queue20260714`와 별도 Cargo target directory로 production
  binary를 만들었다. WebView2 CDP probe는 actual path를 출력하지 않고 boolean만 반환했다.
- `snapshotParentMatchesResolvedAppData`, `appDataLeafMatchesBuildIdentifier`, `absoluteAclAllowed`,
  `relativeBaseDirAclAllowed`, `bothResolversObservedSameExistence`가 모두 `true`였다.
- 따라서 `$APPDATA`와 `BaseDirectory.AppData`의 resolved path 차이는 Vault 접근 차단 원인이 아니다.
  Previous `unavailable`은 directory/bootstrap/load lifecycle과 broad availability error classification의
  관찰이며, Phase 07 lifecycle fix와 분리한다.
- Stronghold official load는 기존 absolute snapshot path를 유지한다. Availability의 file existence check만
  ACL 표현과 동일한 relative filename + `BaseDirectory.AppData`로 바꿔 permission/path ambiguity를 없앴다.
  Snapshot/salt/passphrase/credential data는 읽거나 출력하지 않았다.

### Final verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| initial focused characterization before implementation | 1 expected | queue imports + Vault path contract | red baseline 고정 |
| `npm ci` | 0 | 393 packages | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; platform optional만 unmet |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,364 modules | tsc + Vite PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | unexplained payload diff 0 |
| `npm run test:composition` | 0 | 92 passed/1 skipped files; 704 passed/3 skipped tests | aggregate PASS |
| `npm run test:migration` | 0 | 15 files, 135/135 | legacy/migration fixtures PASS |
| `npm run test:diagnostics` | 0 | 3 files, 27/27 | PASS |
| `npm run test:persistence` | 0 | 3 files, 15/15 + Chromium rescue | PASS |
| `npm run test:credential-vault` | 0 | 5 files, 20/20 | BaseDirectory path contract PASS |
| `npm run test:queue` | 0 | 4 files, 20/20 | 10,000 jobs/CAS/restart/upgrade/abort PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | PASS |
| `npm run test:characterization` | 0 | 6 files, 46/46 | preserved runtime behavior PASS |
| `npm run test:nai-core` | 0 | 50/50 | payload/source-edit contract PASS |
| `npm run test:nai-transport` | 0 | 3 files, 14/14 | PASS |
| `npm run test:smart-tools` | 0 | 3/3 | expected BRIA fallback 포함 PASS |
| `npm run test:responsive-layout` | 0 | 39 route/viewport checks | PASS |
| `npm run test:android-port` | 0 | contract gate | PASS |
| `npm run test:android-release-contract` | 0 | contract gate | PASS |
| `npm run test:remote-runtime-removal` | 0 | forbidden 0; allowlisted 313; tracked tooling 0 | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| Rust `nai_transport::tests` | 0 | 5/5 | PASS |
| isolated `npx tauri build --no-bundle` | 0 | production binary | ACL probe binary PASS |
| generated capability/actual resolver boolean probe | 0 | 1 capability + 5 booleans | all expected true; raw path 없음 |

첫 isolated Tauri build invocation은 64초 tool timeout으로 exit 124가 되었고 code diagnostic 없이 runner가
process를 종료했다. 같은 separate target build를 즉시 이어 실행해 exit 0으로 완료했으므로 environment
duration과 code regression을 분리했다. Node invalid localstorage-file warning과 Smart Tools BRIA unavailable
line은 기존 passing contract의 expected diagnostic이다.

### HANDOFF REPORT

- Phase: 07 — DURABLE QUEUE DOMAIN
- Base HEAD: `a62aa14ecd34996a42ad621c036b234932fcdb11`
- Resulting local commit: `SELF` (resolve with `git rev-parse HEAD`)
- Changed files: queue domain/state/retry; queue snapshot/repository/recovery; queue/Vault path tests;
  Stronghold availability path; exact devDependency/package scripts; composition-v2 status/decision/risk/
  limitation/verification/rollback/ledger docs
- Behavior added/changed: independent immutable durable jobs, normalized IndexedDB stores, CAS leases,
  deterministic recovery/pagination/migration; Vault availability uses relative BaseDirectory.AppData ACL form
- Preserved contracts: no runtime workflow/UI/network cutover; fresh authority legacy; CompositionEngine,
  repository/migration, OutputWriter, portable capability, payload builder/fixtures, Scene worker/dual-token/
  stream/session/cancel/stale/retry/requeue/rotation/image release, legacy importers/readers, existing user data
- Tests and exit codes: final verification table above; every final executable gate exit 0
- Artifact paths: `dist/**`; generated ignored
  `src-tauri/target/phase07-queue-acl/release/nais2.exe`; this ledger. No secret-bearing artifact
- Not tested and exact reason: real-browser quota/eviction and multi-process lease scheduling need a later browser
  integration phase; enqueue/worker/UI/network and managed AppData byte-copy producer were explicitly prohibited
  from this domain phase; live Vault re-unlock/NovelAI/R2 need credential opt-in; signed/Android release evidence is
  unrelated to pure queue completion and remains under existing gates
- Remaining risks: R-015, R-016, R-019, R-024, R-026, R-027, R-028, R-029, R-030; real-browser queue fault
  matrix, workflow cutover and managed resource producer remain open
- Rollback procedure: preserve unrelated `AGENTS.md`, `src-tauri/src-tauri/**`, generated target, Vault/app/user/
  output/IndexedDB data; `git revert` only this Phase 07 local commit. Do not reset/clean/delete queue DB or alter
  payload/OutputWriter/Scene contracts
- Next phase readiness: READY — pure durable queue acceptance is complete; workflow cutover requires a separately
  scoped phase with characterization/shadow enqueue and must not be inferred from this commit.

## Phase 08 — QUEUE WORKFLOW CUTOVER

기준 시각: 2026-07-14 (Asia/Seoul)

### Baseline and characterization-first evidence

- Base HEAD: `6b45a81ed37f9eed1972ca4d2579e46cfa04e7ba`
- Branch: `agent/public-release-sync-20260714`
- Phase 시작 working tree에는 unrelated user change `M AGENTS.md`와 generated untracked
  `src-tauri/src-tauri/**`가 있었다. 둘 다 읽기 외 변경·삭제·stage하지 않았다.
- 구현 전 `npm run test:queue`는 exit 0, 4 files/20 tests였고 기존 domain/repository behavior를 고정했다.
  Main/Scene/OutputWriter characterization도 exit 0, 3 files/47 tests로 current transport/save/session/
  cancel/output ordering을 고정했다. 새 failure/virtualization/recovery acceptance는 production assertion을
  완화하거나 skip하지 않고 Phase 08 source와 함께 추가했다.
- `src/services/nai/payload.ts`, CompositionEngine/repository/migration, portable capability, old backup/v1
  Asset Profile/legacy metadata reader와 migration fixture는 교체·삭제하지 않았다. Electron,
  better-sqlite3, Sharp와 retired remote catalog dependency/runtime도 추가하지 않았다.

### Durable enqueue, execution and recovery

1. Main의 `generate({ capturePrepared: true })`와 Scene adapter가 current Composition plan, wildcard/seed,
   parameters와 output policy를 transport 전에 capture한다. Required resource를 content-addressed managed
   AppData에 materialize한 뒤 batch/jobs/resources를 한 IndexedDB transaction으로 등록한다.
2. Operation ID는 DB commit acknowledgement 전까지 persisted pending identity로 재사용하고 성공 확인
   뒤에만 회전한다. Repository unique idempotency key가 concurrent double-click과 uncertain restart replay를
   중복 batch/artifact 없이 수렴시킨다.
3. Queue coordinator는 Main 1 slot, active NovelAI token별 Scene 2 slots와 streaming T2I 1-slot 제한을
   유지하며 workflow 간 slot을 직렬화한다. Lease/attempt/heartbeat, generationSessionId/cancel AbortSignal,
   current transport/save, fragment sequence CAS와 token balance/release를 executor adapter에서 실행한다.
4. 401/auth와 typed local I/O/ENOSPC는 batch를 pause한다. 429/timeout/transient failure는 bounded ready-at
   backoff로 requeue하고 decode item failure는 다음 job을 계속한다. Continue/pause-on-fatal/
   stop-on-first-error policy, item cancel/skip와 retry-failed-only lineage가 repository state를 소유한다.
5. OutputWriter transaction과 artifact는 terminal job commit 전에 prebind된다. `sourceJobId`는 metadata와
   diagnostic sidecar에 전달되고 path 존재만으로 success를 판단하지 않는다. files-committed journal은
   startup에서 generic orphan보다 먼저 queue-linked recovery되고 성공 job 재실행은 output을 만들지 않는다.
6. Startup gate는 queue-linked output recovery → generic OutputWriter orphan recovery → prior-process lease
   recovery → runtime start 순서다. Active request cancel signal을 DB round trip보다 먼저 abort하고 terminal
   commit에 session/lease를 재검사하므로 cancel 뒤 late response가 저장되지 않는다.

### Queue Center and compatibility release

- `/queue` Queue Center는 fixed-range list virtualization, batch summary, queued/running/succeeded/failed/
  cancelled/skipped/blocked projection, pause/resume, item/batch cancel, retry failed, skip, failure policy,
  item/total progress, recent throughput, bounded ETA와 redacted diagnostic drawer를 제공한다.
- Keyboard Home/End/Arrow navigation, visible focus와 44px mobile touch target/safe-area를 contract로 고정했다.
  10,000 lightweight projections에서 rendered row를 bounded하게 유지한다.
- Main page, shared PromptPanel과 shortcuts는 durable generation command를 사용한다. Scene page도 durable
  batch를 enqueue하되 legacy rollback flag에서는 retained `useSceneGeneration` worker를 사용한다.
- 기존 Scene `queueCount`는 UI confirmation 뒤 현재 parameters를 snapshot하여 durable jobs로 변환할 수
  있지만 자동 삭제/decrement하지 않는다. Queue execution authority default는 `durable`이고 `legacy`는
  compatibility release의 explicit rollback이다. Rotation은 기존 worker/session 계약을 계속 사용한다.
- Asset Studio의 기존 virtual list 계산을 shared fixed-range utility로 옮겨 Queue Center와 재사용했다.
  새 runtime 또는 test dependency는 추가하지 않았다.

### Final verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| initial `npm run test:queue` before implementation | 0 | 4 files, 20/20 | Phase 07 repository baseline PASS |
| initial Main/Scene/OutputWriter characterization | 0 | 3 files, 47/47 | executor boundary baseline PASS |
| `npm ci` | 0 | added 393; audited 394 | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; platform optional만 unmet |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,382 modules | tsc + Vite PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | unexplained payload diff 0 |
| `npm run test:composition` | 0 | 98 passed/1 skipped files; 732 passed/3 skipped tests | aggregate PASS; live opt-in only skipped |
| `npm run test:migration` | 0 | 15 files, 135/135 | legacy/migration fixtures PASS |
| `npm run test:diagnostics` | 0 | 3 files, 27/27 | redaction/diagnostic PASS |
| `npm run test:persistence` | 0 | 3 files, 15/15 + Chromium rescue | PASS |
| `npm run test:credential-vault` | 0 | 5 files, 20/20 | PASS |
| `npm run test:queue` | 0 | 9 files, 42/42 | cutover/recovery/concurrency/UI store PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | PASS |
| `npm run test:characterization` | 0 | 6 files, 47/47 | legacy/current workflow behavior PASS |
| `npm run test:nai-core` | 0 | 50/50 | payload/source-edit contract PASS |
| `npm run test:nai-transport` | 0 | 3 files, 14/14 | browser/desktop/Android typed cancel/timeout PASS |
| `npm run test:smart-tools` | 0 | 3/3 | expected BRIA fallback 포함 PASS |
| `npm run test:responsive-layout` | 0 | route/viewport matrix + 5 Queue Center sizes | PASS |
| `npm run test:android-port` | 0 | source/generated manifest contract | PASS |
| `npm run test:android-release-contract` | 0 | release contract | PASS |
| `npm run test:remote-runtime-removal` | 0 | forbidden runtime/tracked tooling gate | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| Rust `nai_transport::tests` | 0 | 5/5 | loopback cancel/timeout PASS |
| `git diff --check` | 0 | tracked Phase diff | PASS |

`test:queue`의 behavior matrix는 atomic enqueue/resource reuse, pause/restart/resume, immediate old lease
recovery, dual-slot max concurrency, streaming single slot, retry failed only, 401 pause, 429 backoff, decode
continue, missing resource blocked, wrapped ENOSPC pause, cancel no-late-output, output recovery linkage,
idempotent operation ID와 legacy rollback을 포함한다. Responsive authoritative rerun은 `/queue`를
390×844, 412×915, 768×1024, 1280×800, 1536×960에서 검사했다. Test skip, assertion loosen,
catch-and-ignore 또는 failure 숨김은 추가하지 않았다.

### Known residual constraints

- Multi-job sequential wildcard snapshot은 앞 job commit 전에 같은 sequence proposal base를 가질 수 있다.
  Fragment CAS는 stale publication과 duplicate artifact를 차단하지만 job 간 durable dependency projection은
  없으므로 conflict item이 retry/fail될 수 있다(R-031).
- Managed resource는 content-deduplicated지만 reference-aware GC가 없고, Queue Center는 DOM을 virtualize해도
  selected batch lightweight projection을 polling한다(R-032, R-034).
- Startup lease invalidation은 single desktop app process를 가정한다. Multi-process execution fencing,
  real-browser quota/eviction/background throttle과 장시간 10,000+ profiling은 별도 evidence가 없다(R-033).
- Live credential을 사용한 NovelAI kill/restart recovery, actual disk-full와 Android APK/emulator/physical
  output은 opt-in 환경이 아니어서 실행하지 않았다. Synthetic/fault-injected code gates는 모두 통과했다.

### HANDOFF REPORT

- Phase: 08 — QUEUE WORKFLOW CUTOVER
- Base HEAD: `6b45a81ed37f9eed1972ca4d2579e46cfa04e7ba`
- Resulting local commit: `SELF` (resolve with `git rev-parse HEAD`)
- Changed files: durable queue domain/repository/coordinator/startup/recovery/resource materializer and Main/Scene
  adapters; queue UI store/runtime hook/Queue Center/route/shortcuts/layout/i18n; Main/Scene command callers;
  OutputWriter/metadata/scene save linkage; shared virtualization/responsive gate; queue/output/UI/metadata/
  characterization tests; composition-v2 architecture/status/decision/risk/limitation/verification/rollback/ledger
- Behavior added/changed: Main/Scene durable immutable enqueue; managed resumable resources; lease/attempt executor;
  restart recovery and idempotent output transaction; 10,000-job Queue Center; explicit non-destructive legacy
  conversion/rollback
- Preserved contracts: CompositionEngine and composition repository/migration; portable capability; payload source/
  fixtures; current dual-token/streaming/source-edit/session/cancel/stale/retry/requeue/rotation/image release;
  OutputWriter boundary; old backup/v1 Asset Profile/legacy metadata/migration fixtures; all existing user data
- Tests and exit codes: final verification table above; every executable final gate exit 0
- Artifact paths: ignored `dist/**`; ignored `src-tauri/target/**`; this tracked ledger. No token, prompt, signed URL,
  image/base64 or response body artifact was created
- Not tested and exact reason: live NovelAI/R2 was not used because this checkout had no explicit credential opt-in;
  Android init/build/APK/emulator/physical install was not run because no isolated device/release environment was
  authorized; actual disk-full, browser quota/eviction and multi-process fencing need controlled destructive or
  multi-runtime environments. Static Android gates, typed JS/Rust transport tests and fault injection passed
- Remaining risks: R-015, R-016, R-019, R-024, R-026, R-027, R-028, R-031, R-032, R-033, R-034; especially
  sequential fragment dependency projection, managed resource retention and live restart/device release evidence
- Rollback procedure: stop/cancel durable runtime, select Queue Center `legacy` execution authority, restart and verify
  retained direct Main/Scene behavior; preserve queue DB, managed AppData, journals, legacy queueCount, user output,
  unrelated `AGENTS.md` and generated `src-tauri/src-tauri/**`; revert only this Phase 08 local commit. Never
  reset/clean/delete DB/resources/user data or alter payload/Composition/OutputWriter/Scene contracts
- Next phase readiness: READY — durable queue recovery, failed-only retry, duplicate-output prevention and both stop
  gates are covered by deterministic behavior tests; opt-in live/release evidence remains an external gate, not a
  Phase 08 code regression.

## Phase 09 — NATIVE R2 INTEGRATION

기준 시각: 2026-07-14 (Asia/Seoul)

### Baseline and characterization-first evidence

- Base HEAD: `69566af4a6d5f5f89b5c7c077a105d7f1f81da74`
- Branch: `agent/public-release-sync-20260714`
- 시작 working tree의 unrelated `M AGENTS.md`와 generated untracked `src-tauri/src-tauri/**`를 보존했고
  읽기 외 변경·삭제·stage하지 않았다.
- 구현 전에 legacy Python/Wrangler의 current-session/delta/full-sync/dry-run exact request와 non-secret
  Asset Profile R2 projection을 characterization test로 고정했다. 최초 hoisted mock ordering failure는 test
  harness 문제였고 `vi.hoisted`로 수정한 뒤 focused baseline 3 files/38 tests가 exit 0이었다.
- Existing CompositionEngine/repository/migration, OutputWriter, portable capability, payload builder/fixtures,
  Scene worker/dual-token/stream/session/cancel/stale/retry/requeue/rotation/image release와 legacy importer/
  reader/migration fixtures를 교체·삭제하지 않았다. Retired remote catalog runtime도 재도입하지 않았다.

### Native profile, credential and upload boundaries

1. `R2ProfileV2`는 account/jurisdiction/endpoint/bucket/prefix, `credentialRef`, transport, conflict policy와
   public mode만 저장한다. Existing Asset Profile에는 bucket/keyPrefix/publicBaseUrl/accountId non-secret
   projection만 기록한다.
2. Renderer는 credential pair를 OS vault에 one-way 등록한 뒤 입력 state를 지운다. Rust만 `credentialRef`로
   keyring secret을 resolve하며 renderer secret read command가 없다. Repository는 secret-shaped field,
   Bearer value와 signed URL을 거부하고 diagnostics는 fixed typed error만 받는다.
3. Desktop Rust adapter는 official `aws-sdk-s3=1.122.0`의 SigV4, rustls, streamed ByteStream, conditional
   request와 multipart API를 사용한다. `keyring=4.1.4`와 AWS SDK는 desktop target dependency이고 Android
   dependency tree에는 없다. File hashing은 1 MiB chunks, upload는 file/range stream이다.
4. Guided setup은 transport, account/jurisdiction/endpoint, OS vault, connection HEAD, bucket/prefix,
   temporary put→head→delete, path preview, conflict, public/custom domain, save의 10단계를 제공한다. Relay,
   mobile native upload와 background worker는 explicit unsupported다.
5. Existing Python/Wrangler panel과 네 deploy mode는 그대로다. Native directory UI는 current-session을
   전체 directory로 재해석하지 않고 generation output의 explicit artifact set이 필요하다고 안내한다.

### Conflict, queue and restart safety

- Dry-run은 local scan/hash와 remote HEAD만 수행해 new/same/conflict/explicit overwrite/suffix availability를
  표시하며 object나 multipart state를 만들지 않는다.
- `fail`, `skip-same`, `suffix`의 single PUT과 multipart complete는 `If-None-Match: *`를 사용한다.
  `skip-same`은 `x-amz-meta-nais2-sha256`, suffix는 content hash 첫 12자리의 deterministic key를 쓴다.
  `overwrite`만 명시적 unconditional policy다.
- Separate normalized IndexedDB repository가 profile, UploadJob과 manifest v2를 immediate transaction/readback,
  unique dedupe key, CAS version과 terminal immutability로 저장한다. Retry는 bounded exponential ready-at이며
  foreground runtime이 1초 간격으로 ready job을 다시 claim한다. Partial failure는 다음 object를 계속한다.
- Multipart upload ID와 each completed part를 즉시 commit한다. Startup은 running을 queued로 회수하고 같은
  upload ID에서 missing part만 전송한다. Cancel은 active multipart abort 뒤 terminal state를 쓴다. Complete
  response가 유실되고 remote object가 checksum상 완료된 경우 `E_R2_ALREADY_COMPLETE`로 manifest를
  reconcile해 처음부터 재업로드하지 않는다.
- Manifest v2의 remote key/hash/size가 completed object를 delta plan에서 제외한다. Mobile은 profile read만
  지원하고 foreground/background upload는 silent fallback 없이 unsupported다.

### Dependency decision and impact

- Selected: exact official AWS S3 SDK 1.122.0, Apache-2.0, Rust 1.88 compatible; minimal HTTP1/Tokio/rustls
  features. Compatible AWS/Smithy transitive releases는 lockfile에 exact resolution됐다.
- Selected: keyring 4.1.4, MIT OR Apache-2.0, desktop OS vault. Selected direct sha2 0.10,
  MIT OR Apache-2.0, streaming digest.
- Rejected: latest AWS S3 SDK because it requires Rust 1.94.1; handwritten SigV4/lower-level signer because request
  canonicalization, conditional/multipart lifecycle와 safe error parsing을 재구현해야 한다.
- Bundle/mobile: Rust dependencies do not enter the renderer bundle and `cargo tree --target aarch64-linux-android
  -i aws-sdk-s3` prints no dependency. Desktop cold compile/binary graph grows; same-options clean Phase 08 binary가
  없어 exact size delta는 측정하지 않았고 release artifact observation gate로 남겼다.

### Final verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| `npm ci` | 0 | added 393; audited 394 | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; platform optional만 unmet |
| `npm run test:r2` | 0 | 4 files, 18/18 | profile/queue/conflict/restart/1,000 partial/legacy parity PASS |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,389 modules | tsc + Vite PASS |
| `npm run test:composition` | 0 | 102 passed/1 skipped files; 750 passed/3 skipped tests | aggregate PASS; opt-in live only skipped |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | payload diff 0 |
| `npm run test:migration` | 0 | 15 files, 135/135 | compatibility fixtures PASS |
| `npm run test:diagnostics` | 0 | 3 files, 27/27 | redaction/diagnostic PASS |
| `npm run test:persistence` | 0 | 3 files, 15/15 + Chromium rescue | PASS |
| `npm run test:credential-vault` | 0 | 5 files, 20/20 | existing vault contracts PASS |
| `npm run test:queue` | 0 | 9 files, 42/42 | generation queue regression PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | PASS |
| `npm run test:characterization` | 0 | 6 files, 47/47 | legacy/current workflow PASS |
| `npm run test:nai-core` | 0 | 50/50 | payload/source-edit PASS |
| `npm run test:nai-transport` | 0 | 3 files, 14/14 | transport PASS |
| `npm run test:smart-tools` | 0 | 3/3 | expected fallback 포함 PASS |
| `npm run test:responsive-layout` | 0 | route/viewport matrix | Asset Modules 포함 PASS |
| `npm run test:android-port` | 0 | contract gate | PASS |
| `npm run test:android-release-contract` | 0 | contract gate | PASS |
| `npm run test:remote-runtime-removal` | 0 | forbidden 0; allowlisted 313; tracked tooling 0 | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| Rust `nai_transport::tests` | 0 | 5/5 | existing transport PASS |
| Rust `r2_native::` | 0 | 7/7 | SigV4/403/clock/404/412/multipart PASS |
| Android-target inverse AWS dependency tree | 0 | no dependency printed | desktop-only boundary PASS |
| `git diff --check` | 0 | tracked Phase diff | PASS |

Diagnostic runs during implementation found three code/test issues and did not hide them: initial Rust fake server
classified HEAD clock-skew as generic 403 because HEAD has no parsed body; the fixture now uses GET and provider code
precedes status classification. A new adapter mock was first inserted into a profile fixture and caused DataCloneError;
it was moved to the adapter. Aggregate source-contract wording expected English while UI text was Korean; the assertion
now checks the language-independent artifact-set contract. A multipart lost-complete test then exposed stale CAS version
use; reconciliation now re-reads the latest job before terminal commit. All final commands above were rerun at exit 0.

### HANDOFF REPORT

- Phase: 09 — NATIVE R2 INTEGRATION
- Base HEAD: `69566af4a6d5f5f89b5c7c077a105d7f1f81da74`
- Resulting local commit: `SELF` (resolve with `git rev-parse HEAD`)
- Changed files: Rust native R2 adapter/commands and Cargo pins; R2 domain/profile/upload repository/coordinator/runtime;
  guided setup UI and platform capabilities; R2/legacy/fake server tests; package script; composition-v2 architecture,
  status, decision, risk, limitation, verification, rollback and ledger docs
- Behavior added/changed: desktop one-way OS-vault setup, SDK-signed streamed native upload, read-only conflict preview,
  conditional policy enforcement, resumable multipart/retry/abort, manifest v2 dedupe and foreground restart recovery
- Preserved contracts: existing Python/Wrangler backend and four modes; Asset Profile non-secret projection;
  CompositionEngine/repository/migration, OutputWriter, portable capability, payload fixture parity, Scene worker/
  dual-token/stream/session/cancel/stale/retry/requeue/rotation/image release; legacy importers/readers/fixtures; user data
- Tests and exit codes: final verification table above; every final executable gate exit 0
- Artifact paths: ignored `dist/**`; ignored `src-tauri/target/**`; tracked implementation ledger. No credential,
  Authorization, signed URL, local file content or image/base64 artifact was created
- Not tested and exact reason: live Cloudflare R2/jurisdiction/custom domain and real WAN restart were not used because
  no explicit isolated credential opt-in was provided; Android APK/emulator/physical M500_MIKU was not run because
  native upload is intentionally unsupported on mobile and the existing device system-service blocker remains;
  background upload is Phase 12; exact desktop binary delta lacks a same-options clean Phase 08 artifact
- Remaining risks: R-015, R-016, R-019, R-024, R-026, R-027, R-031~R-034, R-037, R-038; provider-side multipart
  expiry/reconciliation, live R2 evidence and desktop binary size observation remain open
- Rollback procedure: stop/resume no new native work and abort active multipart; preserve R2 DB/manifest, OS vault,
  Asset Profile, remote objects, user output, unrelated `AGENTS.md`, generated `src-tauri/src-tauri/**`/target and all
  other user data; switch to retained Wrangler workflow and revert only this Phase 09 local commit. Never reset/clean,
  delete bucket/DB/vault, sweep multipart or perform destructive migration without separate user confirmation
- Next phase readiness: READY — native desktop upload, conditional safety, restart missing-part resume and all three stop
  gates have deterministic coverage; live provider and background-worker evidence remain explicit later gates.

## Phase 10 — ORGANIZER AND DISTRIBUTION ARTIFACTS

기준 시각: 2026-07-14 (Asia/Seoul)

### Baseline and characterization-first evidence

- Base HEAD: `ac3612e0d633cba67e38c67943185a0ed91c92d4`
- Branch: `agent/public-release-sync-20260714`
- 시작 working tree의 unrelated `M AGENTS.md`와 generated untracked `src-tauri/src-tauri/**`를 보존했고
  읽기 외 변경·삭제·stage하지 않았다.
- 구현 전 `OutputWriter`, filename policy, metadata v2와 existing R2 coordinator focused suite를 실행해
  4 files/28 tests exit 0으로 현재 file/sidecar transaction과 portable path 동작을 고정했다.
- Existing CompositionEngine/repository/migration, current OutputWriter, portable capability, payload builder/fixture,
  Scene worker/dual-token/stream/session/cancel/stale/retry/requeue/rotation/image release, old backup/v1 Asset
  Profile/legacy metadata/migration fixtures는 교체·삭제하지 않았다. Retired online catalog/client runtime과
  callback/deep-link도 재도입하지 않았다.

### Artifact authority and distribution boundary

1. Separate `nais2-organizer-artifacts` repository는 `ArtifactRecord`의 immutable original variant, source
   job/scene identity, content checksum, portable file/thumbnail/sidecar reference, distribution variants와 remote
   object reference만 저장한다. Raw absolute path, opaque platform token, image/base64, prompt, credential,
   Authorization 및 signed URL은 repository validation에서 거부한다.
2. Managed collection은 portable AppData ref를 사용한다. External folder는 current desktop process의 explicit
   capability token registry에서만 materialize하며 authority data에 raw path를 남기지 않는다. Restart 또는
   다른 platform에서는 silent fallback 없이 folder reselect/repair가 필요하다.
3. Original checksum, size, format, portable ref는 immutable이다. Rename/convert/metadata strip은 distribution
   variant만 만든다. Image, metadata와 artifact sidecar는 OutputWriter의 같은 journal/stage/rename/rollback
   transaction으로 commit되며 artifact sidecar도 filename collision preflight에 포함된다.
4. Metadata strict mode는 PNG/WebP/JPEG raw metadata container와 decoded alpha-LSB/color 결과를 모두 검증한다.
   Same-format preserve는 raw path를 우선하고 Canvas conversion은 PNG/WebP만 지원한다. Canvas가 lossless WebP
   또는 arbitrary ICC parity를 증명할 수 없으므로 lossless WebP request는 typed failure로 끝난다.
5. Optional R2 action은 non-secret profile/key policy로 existing foreground R2 coordinator에 enqueue만 한다.
   Organizer는 credential, signing, multipart/manifest, mobile upload 또는 background worker를 재구현하지 않는다.

### Organizer interaction and responsive contract

- `/organizer`는 managed/external collection, sibling folder PageUp/PageDown, adaptive thumbnail fixed-grid window,
  keyboard Enter 다음 빈 slot, pointer/touch drag slot assignment와 duplicate block을 제공한다. 10,000 item은
  bounded range/thumbnail cache로 필요한 tile만 materialize한다.
- Policy panel은 actual filename, R2 key와 collision preview, copy/rename/strip/convert path, PNG/WebP,
  quality/alpha/matte, strict metadata와 foreground R2 availability를 표시한다. Progress는 OutputWriter commit 및
  enqueue 상태를 분리해 표시하고 failed-only distribution/R2 retry만 허용한다.
- Organizer route를 responsive matrix에 넣었고, mobile diagnostic launcher의 safe-area position과 compact desktop
  navigation overflow를 보정했다. 새 nav item 때문에 1536px Asset Modules tab이 clip되는 중간 failure를 발견해
  compact desktop에서 ninth item 뒤 `More` overflow를 사용하도록 수정했다.

### Dependency decision and implementation diagnostic

- 새 npm/Rust dependency, Electron, Sharp, better-sqlite3, SQLite 또는 retired remote client를 추가하지 않았다.
  Existing browser Canvas와 Tauri file/capability layer를 사용하므로 renderer/mobile bundle graph를 새 codec/native
  library로 확장하지 않는다. License/bundle 영향이 있는 추가 dependency decision은 발생하지 않았다.
- Initial generic OutputWriter checksum insertion은 every save before staging에 async yield를 추가해 existing Scene
  concurrent golden의 collision ordering을 흔들었다. Full composition suite가 이를 발견했고, checksum calculation을
  `artifactSidecarBytes`가 있는 Organizer transaction으로만 제한했다. Re-run scene characterization과 aggregate
  suite가 통과했으며 existing generation timing/worker contract에는 추가 await가 남지 않았다.
- Test skip, assertion loosen, catch-and-ignore 또는 failure masking은 추가하지 않았다. Live NovelAI/R2 credential,
  external user folder mutation, raw prompt/image/secret artifact는 사용하거나 생성하지 않았다.

### Final verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| `npm ci` | 0 | added 393; audited 394 | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; platform/peer optional만 unmet |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,399 modules | tsc + Vite PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | fixture parity PASS |
| `npm run test:composition` | 0 | 107 passed/1 skipped files; 772 passed/3 skipped tests | aggregate PASS |
| `npm run test:migration` | 0 | 15 files, 135/135 | compatibility fixtures PASS |
| `npm run test:diagnostics` | 0 | 3 files, 27/27 | redaction/diagnostic PASS |
| `npm run test:persistence` | 0 | 3 files, 15/15 + Chromium rescue | PASS |
| `npm run test:credential-vault` | 0 | 5 files, 20/20 | vault/legacy scan PASS |
| `npm run test:queue` | 0 | 9 files, 42/42 | retained worker/output contracts PASS |
| `npm run test:r2` | 0 | 4 files, 18/18 | profile/queue/conflict/restart PASS |
| `npm run test:organizer` | 0 | 5 files, 20/20 | virtualization/assignment/artifact/sanitize/retry/UI PASS |
| Phase 10 OutputWriter focus | 0 | 4 files, 30/30 | image/metadata/artifact-sidecar journal/collision/rollback PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | PASS |
| `npm run test:characterization` | 0 | 6 files, 47/47 | existing workflow/output PASS |
| `npm run test:nai-core` | 0 | 50/50 | payload source untouched/PASS |
| `npm run test:nai-transport` | 0 | 3 files, 14/14 | JS transport PASS |
| `npm run test:smart-tools` | 0 | 3/3 | expected provider fallback 포함 PASS |
| `npm run test:responsive-layout` | 0 | route/viewport matrix | `/organizer` 포함 PASS |
| `npm run test:android-port` | 0 | contract gate | PASS |
| `npm run test:android-release-contract` | 0 | contract gate | PASS |
| `npm run test:remote-runtime-removal` | 0 | allowlisted 313; tracked tooling 0 | forbidden runtime/dependency residue 없음 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| Rust `nai_transport::tests` | 0 | 5/5 | existing transport PASS |
| Rust `r2_native::` | 0 | 7/7 | existing R2 native PASS |
| `git diff --check` | 0 | Phase diff | PASS |

### HANDOFF REPORT

- Phase: 10 — ORGANIZER AND DISTRIBUTION ARTIFACTS
- Base HEAD: `ac3612e0d633cba67e38c67943185a0ed91c92d4`
- Resulting local commit: `SELF` (resolve with `git rev-parse HEAD`)
- Changed files: Organizer artifact domain/repository/sanitizer/coordinator/runtime/collection adapter and route UI;
  fixed-grid utility; OutputWriter/filename artifact-sidecar transaction support; nav/layout/responsive contract;
  organizer/output tests; composition-v2 architecture/status/decision/risk/limitation/verification/rollback/ledger docs
- Behavior added/changed: immutable originals linked by artifactId to distribution variants/sidecar/R2 refs; managed and
  explicit-capability external collections; 10,000-item virtual browser; keyboard/touch assignment; strict metadata
  sanitation; policy/conflict/R2 preview; OutputWriter-owned copy/rename/convert/strip transaction and failed-only retry
- Preserved contracts: CompositionEngine/repository/migration, current OutputWriter ownership, portable capability,
  payload fixture parity, Scene worker/dual-token/stream/session/cancel/stale/retry/requeue/rotation/image release,
  retained old importers/readers/fixtures, user data and retired remote-runtime removal
- Tests and exit codes: final verification table above; every executable final gate exit 0
- Artifact paths: ignored `dist/**`; ignored `src-tauri/target/**`; tracked implementation ledger. No token, prompt,
  Authorization, signed URL, raw external path, image/base64 or provider response-body artifact was created
- Not tested and exact reason: live NovelAI/R2 and WAN R2 completion were not used because no explicit isolated
  credential opt-in was provided; actual external user folder mutation, actual disk-full and long-running WebView
  color/profile/quota observations need a controlled environment; Android APK/emulator/physical M500_MIKU Organizer flow
  was not run because no isolated release/device authorization was provided and the known system-service blocker remains
- Remaining risks: R-015, R-016, R-019, R-024~R-028, R-031~R-034, R-037~R-041; especially Canvas ICC/lossless limits,
  external-token repair, long-running thumbnail memory and live R2/device observation remain open
- Rollback procedure: stop/cancel Organizer distribution and R2 follow-up; allow OutputWriter journal recovery; preserve
  organizer/R2 DB, managed artifacts, originals, sidecars, remote objects, user output, unrelated `AGENTS.md` and
  generated `src-tauri/src-tauri/**`; revert only this Phase 10 local commit. Never reset/clean/delete DB/artifacts or
  perform a destructive migration
- Next phase readiness: READY — deterministic Organizer distribution and retained output/worker/R2 contracts are covered;
  live provider, physical Android and controlled filesystem/browser observation remain explicit release gates.

## Phase 11 — LOCAL-FIRST SYNC CORE

기준 시각: 2026-07-15 (Asia/Seoul)

### Baseline and characterization-first evidence

- Base HEAD: `619d0d230fad714013c20943a9e19acbc7141f69`
- Branch: `agent/public-release-sync-20260714`
- 시작 시 `git status --short`, HEAD와 branch를 직접 확인했다. Unrelated `M AGENTS.md`와 generated untracked
  `src-tauri/src-tauri/**`를 보존했으며 reset, checkout, clean, overwrite 또는 stage하지 않았다.
- 구현 전 영향 경계의 existing behavior selection은 5 files, 32/32 tests, exit 0으로 고정했다. 새 sync tests를
  먼저 추가한 첫 `npm run test:sync`는 source module이 아직 없어 7 files가 collection에서 실패하는 expected
  RED였다. Source를 추가한 뒤 assertion skip/loosen 또는 catch-and-ignore 없이 최종 7 files, 144/144로 닫았다.
- 시작 residue gate는 Base HEAD의 Phase 10 ledger 문장 두 곳 때문에 exit 1이었다. Allowlist를 넓히지 않고
  historical 문장을 neutral wording으로 고쳤으며 final gate는 allowlisted 313, forbidden 0, exit 0이다.
- 새 npm/Rust dependency와 lockfile 변경은 없다. Production caller, network transport, user-facing sync control,
  background worker, encryption/key management 또는 existing user-data migration을 연결하지 않았다.
- 추가 adversarial sanitizer canary는 unpadded/MIME/raw/offset image·binary, encoded key/URL/path, credential shape와
  opaque-ID 오분류를 실제 envelope/outbox 경계에서 먼저 RED로 재현했다. Broad classifier가 normal prompt/model/ID를
  막은 중간 regression도 positive fixtures로 드러났으며, skip/loosen/catch-ignore 없이 exact semantic context와
  structured signature 검사로 좁혔다. Padded/unpadded trailing text, arbitrary whitespace alignment, rolling
  strong-binary evidence, 최소 PNG signature의 모든 2,048 whitespace partition, high-byte binary의 모든
  32,768 whitespace partition, Unicode whitespace, wrapped/half-nibble hex와 repository no-write 회귀를 추가한 뒤
  final focused/full sync suite를 다시 통과했다. Canary는 synthetic 값만 썼고
  live credential, provider response, user prompt/image/path는 출력하거나 artifact로 남기지 않았다.

### Deterministic envelope and sanitizer boundary

1. `SyncEnvelope` schema v1은 `schemaVersion`, stable op/entity identity, `upsert | delete`,
   `revision = baseRevision + 1`, exact predecessor `baseOpId`, device/user identity, canonical UTC timestamp,
   `encrypted: false`와 canonical sanitized payload를 고정한다. Normal non-root operation은 predecessor 없이
   생성할 수 없다. Schema-v0 upgrade만 `baseOpId: null`, `lineageUnknown: true`를 durable marker로 보존한다.
2. Whole-envelope safety invariant는 unknown key, forbidden secret/auth/session shape, signed query, absolute/local
   path, data/blob/content URI, encoded/numeric image signature, thumbnail/base64/blob, OutputWriter journal,
   queue lease/controller와 raw diagnostic shape를 reject한다. Encoded key/value와 URL component는 bounded
   fixed-point decode하며 full bounded value의 every-offset raw/hex/Base64/MIME image signature, bounded strong-binary,
   JWT/PEM/provider credential을 검사한다. Standalone generic opaque ID/reference 예외는 explicit semantic field
   allowlist만 사용한다. Ordinary prose와 구분 불가능한 unpadded printable encoding limitation은 명시하되
   prose/ID도 known image/strong-binary/credential/path 검사를 우회하지 않는다. Error는 canary 원문을 echo하지 않는다.
3. Active target은 Composition document/profile/recipe/module, Scene preset/card, prompt preset/fragment,
   allowlisted UI preference, artifact metadata와 succeeded R2 object identity다. Composition/artifact는 current
   canonical validator를 먼저 재사용하며 nested `extensions`와 portable display path는 projection에서 제거한다.
   Immutable generation snapshot은 no-merge policy-only entity이고 active sanitizer/outbox target이 아니다.

### Operation-set conflict and tombstone authority

1. Conflict result는 pairwise arrival mutation이 아니라 retained primary/conflict/inbox/outbox/tombstone의 unique
   operation set 전체에서 매번 재계산한다. Exact predecessor ancestry, maximal branch heads, semantic-equivalent
   cohort 대표와 locale-independent UTF-16 code-unit order가 delivery permutation과 host locale에 무관한
   primary/conflict/status를 만든다.
2. UI preference만 documented LWW다. Complex Composition/Scene/prompt/artifact concurrent edit는 field merge하지
   않고 deterministic primary와 conflict copy를 보존한다. Delete가 하나라도 retained되면 tombstone이 primary며
   concurrent/descendant upsert는 complex target의 conflict copy일 수 있어도 primary entity를 부활시키지 않는다.
3. Tombstone store는 entity row가 없어도 independent authority다. Ordinary local upsert는 typed
   `E_SYNC_TOMBSTONED`로 거부하고 stale/duplicate/reordered remote upsert도 recomputation에서 delete primary를
   바꾸지 못한다. Per-entity unique operation set은 2,048개를 넘으면 fail closed하며 Phase 11은 causality를
   추정해 record를 compact하거나 삭제하지 않는다.

### Transactional local repository

1. `nais2-local-sync--<user-hash>` IndexedDB는 account별 physical namespace와 exact bound-user check를 사용한다.
   Entities/outbox/inbox/tombstones/checkpoints, scoped indexes와 record schema v2를 소유한다. Cross-user same-ID
   operation/entity/checkpoint는 같은 authority를 공유하지 않는다.
2. Local mutation은 sanitized sync shadow entity 또는 tombstone, local receipt와 outbox record를 같은 sync DB
   transaction에서 commit/readback한다. 이 transaction은 production Composition/Scene/prompt/artifact source edit를
   포함하지 않으며 runtime caller도 없으므로 end-user source + outbox atomicity로 보고하지 않는다.
3. Inbox는 exact op hash로 duplicate를 판별하고 cross inbox/outbox op collision을 reject한다. Missing-parent
   upsert는 deferred되고 parent arrival 뒤 같은 transaction에서 reproject된다. Delete는 missing parent에서도
   resurrection 방지를 위해 authority를 세울 수 있다.
4. Outbox는 pending/in-flight/retry/acked, attempt count, typed failure code, next attempt, 60-second default lease와
   monotonic ack/checkpoint를 보존한다. Live lease의 duplicate claim은 거부하고 process reopen 뒤 expired
   `in-flight`는 ready listing에 다시 나타나 retry 또는 새 attempt로 진행할 수 있다. Ack record는 ancestry
   compaction 없이 retained된다. Retry transition은 claim에서 받은 attempt count와 exact lease를 CAS fence로
   요구하므로 이전 attempt의 늦은 failure가 더 새 in-flight attempt를 덮을 수 없다.
5. Schema upgrade는 v0 envelope와 schema-v1의 authoritative entity/outbox/tombstone/checkpoint records를 current
   validated record로 올린다. V1에 없던 inbox는 빈 current store로 생성한다. Unknown lineage marker는
   receive/local child 경계까지 운반되며 이 legacy store의 malformed record가 하나라도 있으면 upgrade
   transaction을 abort해 previous database를 보존한다. Blocked/timeout open도 upgrade를 계속 성공처럼
   정착시키지 않는다.

### Final verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| `npm ci` | 0 | added 393; audited 394 | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; platform/peer optional만 unmet |
| Phase 11 focused Vitest | 0 | 4 files, 134/134 | envelope/sanitizer/conflict/repository PASS |
| `npm run test:sync` | 0 | 7 files, 144/144 | two-device/offline/duplicate/reorder/reconnect/conflict/delete/upgrade PASS |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,399 modules | tsc + Vite PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | fixture parity PASS; payload source untouched |
| `npm run test:composition` | 0 | 114 passed/1 skipped files; 916 passed/3 skipped tests | aggregate PASS |
| `npm run test:migration` | 0 | 15 files, 135/135 | retained importer/reader fixtures PASS |
| `npm run test:diagnostics` | 0 | 3 files, 27/27 | PASS |
| `npm run test:persistence` | 0 | 3 files, 15/15 + rescue contract | PASS |
| `npm run test:credential-vault` | 0 | 5 files, 20/20 | PASS |
| `npm run test:queue` | 0 | 9 files, 42/42 | worker/session/output contracts PASS |
| `npm run test:r2` | 0 | 4 files, 18/18 | profile/queue/conflict/restart PASS |
| `npm run test:organizer` | 0 | 5 files, 20/20 | artifact/sanitizer/retry/UI PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | PASS |
| `npm run test:characterization` | 0 | 6 files, 47/47 | existing workflow/output PASS |
| `npm run test:nai-core` | 0 | 50/50 checks | payload/worker source contracts PASS |
| `npm run test:nai-transport` | 0 | 3 files, 14/14 | existing JS transport PASS |
| `npm run test:smart-tools` | 0 | 3/3 | expected provider fallback 포함 PASS |
| `npm run test:responsive-layout` | 0 | route/viewport matrix | PASS |
| `npm run test:android-port` | 0 | source contract | PASS |
| `npm run test:android-release-contract` | 0 | release contract | PASS |
| `npm run test:remote-runtime-removal` | 0 | allowlisted 313; forbidden 0; tracked tooling 0 | closure gate PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| Rust `nai_transport::tests` | 0 | 5/5 | retained transport PASS |
| Rust `r2_native::` | 0 | 7/7 | retained native R2 PASS |
| `git diff --check` | 0 | Phase diff | PASS |

`test:composition`, migration과 secret-redaction에서 Node의 invalid empty `--localstorage-file` warning이
출력됐지만 모든 해당 suite는 exit 0이었다. 이를 code regression이나 PASS 대체 근거로 사용하지 않았다.
Live credential, provider request, raw prompt, image/base64/blob, Authorization value와 signed URL은 사용하거나
test artifact/log로 남기지 않았다.

### HANDOFF REPORT

- Phase: 11 — LOCAL-FIRST SYNC CORE
- Base HEAD: `619d0d230fad714013c20943a9e19acbc7141f69`
- Resulting local commit: `SELF` (resolve with `git rev-parse HEAD`)
- Changed files: `package.json`; `src/domain/sync/**`; `src/services/sync/**`; `tests/domain/sync/**`;
  composition-v2 status/architecture/decision/risk/limitation/verification/rollback/ledger docs
- Behavior added/changed: network-free deterministic envelope/sanitizer; user-scoped transactional sync shadow/outbox;
  explicit lineage; operation-set conflict projection; independent tombstone; duplicate/deferred/retry/lease/ack/checkpoint;
  fail-closed upgrade and two-device simulation. No production caller or transport was connected
- Preserved contracts: current CompositionEngine/repository/migration, payload builder/fixtures, OutputWriter,
  portable capability, generation queue worker count/dual-token/streaming/session/cancel/stale/retry/requeue/rotation/
  image release, old backup/v1 profile/legacy metadata readers/fixtures, existing user data and retired runtime removal
- Tests and exit codes: final verification table above; every executable final gate exit 0
- Artifact paths: ignored `dist/**` and `src-tauri/target/**`; tracked implementation ledger. Pre-existing generated
  `src-tauri/src-tauri/**` remains unrelated/untracked. No Phase 11 payload or test artifact contains secret/path/image data
- Not tested and exact reason: real network transport/encryption/WAN reconnect and live credentials were not run because
  they are outside this local-only phase and no explicit isolated credential opt-in was provided; actual browser quota,
  eviction, multi-tab/process ownership and account lifecycle were not run because the repository has no production
  caller and focused simulation uses fake IndexedDB; physical M500_MIKU was not run because Phase 11 adds no Android UI,
  network path or runtime caller and the known system-service blocker remains
- Remaining risks: R-042~R-045, R-047~R-049; especially sanitizer/schema drift, production source-outbox crash recovery,
  2,048-op compaction/retention, conservative migrated lineage, real browser/account lifecycle and later transport UX
- Rollback procedure: preserve all app/user/output/sync records, tombstones, conflict copies, checkpoints, unrelated
  `AGENTS.md` and generated `src-tauri/src-tauri/**`; revert only this Phase 11 local commit. Never reset/clean/delete the
  sync database, rewrite lineage/revision, force-ack attempts or perform destructive schema downgrade
- Next phase readiness: READY — network-free two-device results converge, forbidden payload canaries are zero and
  tombstone-only resurrection tests pass. Later production caller/transport work remains gated by R-043/R-044/R-049.

## Phase 12 — SECURE SYNC TRANSPORT

기준 시각: 2026-07-15 (Asia/Seoul)

### Baseline and characterization-first evidence

- Base HEAD: `879ddcca7ca4d515bb570633a981d6ca1089eb82`
- Branch: `agent/public-release-sync-20260714`
- 시작 시 HEAD, branch와 `git status --short`를 직접 확인했다. 시작 전부터 있던 unrelated `M AGENTS.md`와
  generated untracked `src-tauri/src-tauri/**`를 reset, checkout, clean, overwrite 또는 stage하지 않았다.
- 구현 전 Phase 11 sync/Vault/R2/runtime-capability selection은 11 files, 158/158 tests, exit 0으로 고정했다.
  새 behavior는 paired/unpaired/expired/replay/tamper/revoke, interruption/duplicate/tombstone/R2-missing과
  Android lifecycle contract test로 먼저 잠근 뒤 source를 연결했다.
- Live NovelAI/R2 credential, user prompt/image, certificate private key, Authorization, signed URL 또는 provider
  response body를 사용하거나 test/log artifact에 남기지 않았다.

### Secure desktop LAN boundary

1. Desktop listener는 vault unlock 뒤 explicit start만 받고 loopback/private/link-local bind, explicit CIDR,
   unprivileged port와 one-active-peer policy를 강제한다. Wildcard/public bind, discovery, port forwarding,
   browser Origin/CORS와 unauthenticated manifest는 허용하지 않는다.
2. 최대 120초 one-use pairing capability와 독립 6자리 확인 코드, CSR signing, TLS 1.3 mTLS를 사용한다.
   `rustls`/`aws-lc-rs`가 key agreement, AEAD/record nonce, certificate validation과 ciphertext integrity를,
   `rcgen`이 CA/server/client certificate와 CSR을 소유한다. Application-defined crypto primitive 조합은 없다.
3. Host/client private identity는 Stronghold Credential Vault가 authority다. Native two-slot journal에는 peer
   fingerprint/revoke, scope, monotonic sequence/recent nonce, inbound/outbound durable queue와 receipt 같은
   non-secret state만 남긴다. Host-local fingerprint revoke와 authenticated self-revoke를 분리했다.
4. Authenticated manifest/push/pull/ack/revoke는 2 MiB/100-operation, method/content-type/concurrency/timeout bound,
   request cancellation과 persistent replay fence를 적용한다. Unknown/revoked/wrong-CA client는 같은 fixed denial로
   끝나며 entity/count/checkpoint/manifest를 받지 않는다. Production TLS config를 재사용한 in-memory TLS 1.3
   application record bit-flip test는 authentication failure와 plaintext 0 bytes를 확인한다.
5. Renderer adapter는 native DTO exact-key/size/endpoint/fingerprint를 다시 검증한다. Server ingress는 native
   peek → Phase 11 receive/dedupe → exact native ack, egress는 canonical delivery ID enqueue → durable remote receipt
   → Phase 11 outbox ack → native receipt ack 순서라 interruption은 duplicate replay만 만들고 committed data를
   제거하지 않는다. Pull/push checkpoint namespace를 분리하고 retry lease CAS를 보존한다.

### Image, relay and Android gates

1. JSON image fallback은 없다. Default image sync는 sanitized succeeded R2 object reference이며 missing object는
   `E_SYNC_R2_OBJECT_MISSING`이다. Optional blob은 descriptor/policy/size/SHA-256/resume interface뿐이고 native
   partial temp write/full checksum/atomic commit가 없어 `lanBlobTransfer=false`다.
2. Relay는 provider-neutral `RelayTransport`와 local authenticated contract뿐이다. Production URL/provider/auth,
   removed provider/catalog runtime, OAuth/deep-link 또는 silent failover는 추가하지 않았다.
3. Tracked Android plugin은 API 34+ UIDT와 API 24–33 foreground WorkManager, visible notification,
   pause/resume/cancel/retry, secret-free ticket/checkpoint와 recovery source를 정의한다. Current Tauri Kotlin 1.9.25와
   compatible한 Android-only Apache-2.0 WorkManager 2.10.5를 exact pin했다. UIDT pending job을 fallback보다 우선하고
   default app process의 execution gate로 UIDT/WorkManager 동시 byte execution을 막는다.
4. `TransferExecutionRegistry`에 Stronghold-safe R2/LAN executor가 없으면 visible
   `E_TRANSFER_EXECUTOR_UNAVAILABLE`로 blocked된다. Mobile sync client command도 현재 `E_SYNC_UNSUPPORTED`다.
   따라서 secure LAN, LAN blob, R2 foreground/background capability는 모두 false이고 generation request의
   장기 background 실행은 활성화하지 않았다.

### Final verification

| 명령 | Exit | Suite/check count | 결과 |
| --- | ---: | --- | --- |
| pre-change characterization selection | 0 | 11 files, 158/158 | Phase 11/Vault/R2/capability PASS |
| Phase 12 focused sync Vitest | 0 | 7 files, 36/36 | adapter/pairing/agent/coordinator/restart PASS |
| focused Android transfer Vitest | 0 | 1 file, 5/5 | tracked plugin/closed capability/single-owner source PASS |
| focused TLS ciphertext test | 0 | 1/1 | production-config TLS 1.3 bit-flip releases no plaintext |
| `npm ci` | 0 | added 393; audited 394 | vulnerabilities 0 |
| `npm ls --all` | 0 | dependency tree | invalid/extraneous 없음; platform/peer optional만 unmet |
| `npm run lint` | 0 | ESLint max warnings 0 | PASS |
| `npm run build` | 0 | 2,399 modules | tsc + Vite PASS |
| `npm run test:unit` | 0 | 12 files, 42/42 | PASS |
| `npm run test:payload-parity` | 0 | 5 files, 20/20 | fixture parity PASS; payload source untouched |
| `npm run test:composition` | 0 | 122 passed/1 skipped files; 957 passed/3 skipped tests | aggregate PASS |
| `npm run test:migration` | 0 | 15 files, 135/135 | retained importer/reader fixtures PASS |
| `npm run test:diagnostics` | 0 | 3 files, 27/27 | PASS |
| `npm run test:persistence` | 0 | 3 files, 15/15 + rescue contract | PASS |
| `npm run test:credential-vault` | 0 | 5 files, 20/20 | PASS |
| `npm run test:queue` | 0 | 9 files, 42/42 | worker/session/output contracts PASS |
| `npm run test:sync` | 0 | 14 files, 180/180 | Phase 11 + LAN transport contracts PASS |
| `npm run test:r2` | 0 | 4 files, 18/18 | profile/queue/conflict/restart PASS |
| `npm run test:organizer` | 0 | 5 files, 20/20 | PASS |
| `npm run test:secret-redaction` | 0 | 2 files, 13/13 | PASS |
| `npm run test:characterization` | 0 | 6 files, 47/47 | existing workflow/output PASS |
| `npm run test:nai-core` | 0 | 50/50 checks | payload/worker source contracts PASS |
| `npm run test:nai-transport` | 0 | 3 files, 14/14 | existing JS transport PASS |
| `npm run test:smart-tools` | 0 | 3/3 | expected fallback 포함 PASS |
| `npm run test:responsive-layout` | 0 | 49 route/viewport checks | PASS |
| `npm run test:android-port` | 0 | source contract | PASS |
| `npm run test:android-transfer` | 0 | 1 file, 5/5 | PASS |
| `npm run test:android-release-contract` | 0 | release contract | PASS |
| `npm run test:remote-runtime-removal` | 0 | allowlisted 313; forbidden 0; tracked tooling 0 | closure gate PASS |
| Rust `sync_transport` | 0 | 14/14 | actual TLS loopback + durable/replay/tamper/revoke PASS |
| Android plugin Rust `--lib` | 0 | 3/3 | bounded secret-free ticket PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | Rust dev profile | PASS |
| Rust `nai_transport::tests` | 0 | 5/5 | retained transport PASS |
| Rust `r2_native::` | 0 | 7/7 | retained native R2 PASS |
| changed-file `rustfmt --check` | 0 | LAN + Android plugin Rust files | PASS |
| `cargo fmt --all --check` | 1 | pre-existing `build.rs/lib.rs/main.rs` style diff | unrelated baseline; 이번 파일을 재포맷하지 않음 |
| `git diff --check` | 0 | working phase diff | PASS |

Android full build는 3회 제한 안에서 완료하지 못했다. 첫 process output channel은 유실됐고 새 APK가 없었다.
두 번째 `aarch64` build는 PATH의 standalone Rust 1.93이 rustup Android sysroot를 보지 못해 `E0463`으로 실패했다.
세 번째는 rustup 1.96 target을 사용했으나 기존 Stronghold transitive `libsodium-sys-stable`의 Unix `./configure`를
Windows가 실행하지 못해 Cargo exit 101이었다. 이 failure는 R-025 environment limitation이며 새 LAN server
dependency는 desktop target table에만 있다.

Tracked Kotlin source의 분리 Gradle compile도 3회에서 중단했다. 첫 시도는 temporary module inclusion ordering,
둘째는 WorkManager 2.11.2/Kotlin metadata mismatch, 셋째는 2.10.5로 metadata gate를 지난 뒤 final
`CoroutineWorker.onStopped` override 오류를 발견했다. Final source에서 unsupported override를 제거하고 existing
`CancellationException` + durable RUNNING recovery로 고쳤지만 제한에 따라 네 번째 compile은 실행하지 않았다.
따라서 최종 Kotlin compile/APK는 PASS가 아니다. Temporary generated include와 build logs는 제거했고 generated
source를 tracked authority로 추가하지 않았다.

Physical ADB read-only check는 serial `?`의 M500_MIKU, API 34, online, existing package installed/process stopped를
확인했다. 새 APK가 없고 executor/capability가 false라 install, UI-tree notification action, pause/cancel/retry,
process kill/relaunch를 실행하지 않았다. Offline `emulator-5566`은 evidence로 사용하지 않았다.

### HANDOFF REPORT

- Phase: 12 — SECURE SYNC TRANSPORT
- Base HEAD: `879ddcca7ca4d515bb570633a981d6ca1089eb82`
- Resulting local commit: `SELF` (resolve with `git rev-parse HEAD`)
- Changed files: desktop native LAN TLS/journal/commands; sync transport domain, pairing/agent/client/native queue
  adapters and ingress/egress/reconnect coordinators; R2 reference guard; tracked Android transfer plugin/capability;
  focused tests; Cargo/package integration; composition-v2 network policy/decision/risk/limitation/verification/rollback/ledger
- Behavior added/changed: explicit desktop TLS 1.3 mTLS listener and short-lived pairing; one paired peer/revoke;
  authenticated bounded manifest/push/pull/ack/replay fence; crash-safe native queue receipts and Phase 11 duplicate-safe
  apply/ack; R2-reference-only default; provider-free relay/blob contracts; disabled Android UIDT/WorkManager lifecycle shell
- Preserved contracts: current CompositionEngine/repository/migration, Phase 11 repository/sanitizer/tombstone authority,
  payload fixture parity, OutputWriter/portable capability, Scene worker/dual-token/stream/session/cancel/stale/retry/requeue/
  rotation/image-release, old backup/v1 profile/legacy metadata readers/fixtures, user data and removed-runtime closure
- Tests and exit codes: final verification table above. All executable host/source/Rust gates passed; Android full
  cross-build and final Kotlin compile did not pass for the exact reasons above
- Artifact paths: ignored `dist/**`, `src-tauri/target/**`, plugin `target/**` and generated Android Gradle cache/report;
  tracked implementation ledger. No new APK or credential-bearing artifact was produced; temporary build logs were removed
- Not tested and exact reason: production Composition/Scene/prompt/artifact source caller and source/outbox crash recovery
  are absent; auth-store lock is not wired to live listener/client disposal; mobile paired JSON client and R2/LAN executor
  are unsupported; native blob partial/checksum/atomic channel is absent; final Android Kotlin/APK build hit the validation
  limit after environment/toolchain/source findings; M500_MIKU notification/cancel/process-recreation therefore had no
  runnable current artifact; Android 16 device was unavailable; live NovelAI/R2 was not opt-in and was unnecessary
- Remaining risks: R-043, R-044, R-049~R-054 plus limitation 56~62. In particular production caller atomicity,
  vault-lock lifecycle, mobile mTLS client, Android executor/final build/physical evidence, blob commit and multi-peer remain
- Rollback procedure: close pairing; stop listener/cancel requests; pause/cancel Android ticket if any; preserve Phase 11
  sync records/tombstones/checkpoints, native non-secret journal, Stronghold identities, R2 objects, user data, unrelated
  `AGENTS.md` and generated `src-tauri/src-tauri/**`; revert only this Phase 12 local commit. Never reset/clean/delete/
  rewrite tombstones, vaults, journals, partials or user data
- Next phase readiness: BLOCKED — desktop paired sanitized transport and interruption primitives are tested, but the phase
  completion condition is not met until production caller/vault-lock lifecycle and supported mobile/Android execution,
  final Android build/physical recovery, and any claimed blob path pass their gates.
