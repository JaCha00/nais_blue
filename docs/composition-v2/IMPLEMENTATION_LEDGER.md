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
