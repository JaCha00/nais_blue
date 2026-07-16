# Phase 14 legacy retirement gate

기준일: 2026-07-16 (Asia/Seoul)

## 판정

**BLOCKED — legacy runtime source deletion 0.**

Phase 14 gate는 모든 필수 증거가 동시에 존재해야 열리는 conjunctive gate다. 현재 checkout은
fresh production Composition authority를 여전히 `legacy`로 시작하며, Main/Scene/Style Lab의
legacy builder와 migration shadow가 production entry graph에 남아 있다. Full online matrix,
authenticated Android transport, signed desktop/Android rollback drill과 한 release observation
window도 완료되지 않았다. 따라서 legacy authority rollback이 더 이상 필요 없다는 decision
record를 만들 근거가 없고 D-012/D-024 및 현재 rollback policy를 유지한다.

## 감사 기준

| 항목 | 값 |
| --- | --- |
| Branch | `agent/public-release-sync-20260714` |
| Base HEAD | `59b5920a5f4c8ff911d2b35d451eb22fc1bad89e` |
| Initial branch state | `public/agent/public-release-sync-20260714`보다 10 local commits ahead |
| Initial tracked deletion | 0 |
| Phase 14 runtime deletion | 0 |
| New dependency/version/tag/release | 없음 |

시작 시점의 dirty working tree에는 `AGENTS.md`, Cloudflare transfer source/test/config,
`package.json`, responsive UI files와 generated/untracked tooling이 이미 존재했다. 이 변경은
reset, checkout, clean, overwrite하거나 Phase 14 변경으로 귀속하지 않았다. `.codex/**`,
`.omx/**`, `.idea/**`, `src-tauri/src-tauri/**`와 generated Android/build output은 authority나
Phase 14 staging 대상이 아니다.

## 필수 gate matrix

| Gate | 판정 | 현재 증거와 한계 |
| --- | --- | --- |
| Fresh production authority = v2 | **MISSING** | `src/lib/composition-migration-startup.ts:176`은 default activation을 `legacy`로 둔다. `tests/migration/composition-production-startup.test.ts:155`는 unapproved fresh install의 legacy default를 behavior로 고정한다. 실제 Windows fresh/restart도 `legacy / legacy`였다. |
| Upgrade production authority = v2 | **MISSING** | `tests/migration/composition-production-startup.test.ts:191`의 upgrade는 explicit verified `applyCompositionAuthorityFeatureFlag('v2')` fixture다. Released population의 production upgrade 관측이 아니다. |
| Old-backup production authority = v2 | **MISSING** | `tests/migration/composition-production-startup.test.ts:227`의 old-backup case는 importer/fixture와 explicit v2 activation을 검증한다. Signed production restore와 release-population authority evidence가 아니다. |
| Supported Main/Scene/Style Lab online matrix | **MISSING** | `IMPLEMENTATION_LEDGER.md`의 Phase 06 actual-app matrix는 partial이다. Scene/Style Lab standard, PNG paths, remaining model/format pairs와 actual source-edit ZIP request가 완료되지 않았다. |
| Android transport result | **MISSING** | JS/Rust loopback, source contract와 signed debug APK/install evidence는 있지만 post-fix authenticated standard/stream/cancel/no-late-save/OutputWriter physical result가 없다. 2026-07-16 M500_MIKU/API 34와 installed 2.8.1은 read-only로 확인했으나 explicit live credential opt-in이 없어 request를 실행하지 않았다. Device presence는 transport PASS가 아니다. |
| Signed desktop/Android backup → rollback install → restore → forward migration | **MISSING** | Android signed debug evidence만 있고 immutable prior same-ID release baseline과 signed desktop rollback artifact가 없다. Phase 06 desktop bundles는 unsigned였고 drill은 실행되지 않았다. |
| One release observation window migration/fallback diagnostics | **MISSING** | `KNOWN_LIMITATIONS.md:6`과 `STATUS.md`의 next release gate가 released population observation 부재를 명시한다. Tracked observation report/artifact가 없다. |
| Rollback 외 production legacy caller 0 | **FAIL — NONZERO** | Main inline builder, Scene/Style Lab legacy builders와 startup migration shadow가 모두 `src/main.tsx` production graph에서 reachable하다. 아래 caller audit 참조. |
| Unexplained payload diff 0 | **PASS — fixture scope** | Checked-in captured/synthetic fixture contract에서 unexplained diff는 0이다. `PAYLOAD_PARITY_GAPS.md`의 transport gaps는 분류돼 있고 V3/Furry V3 및 일부 combinations는 아직 unverified이므로 universal parity로 확대하지 않는다. |
| Old backup restore | **PASS — deterministic behavior** | `tests/migration/backup-envelope-v3.test.ts`, `store-backup-roundtrip.test.ts`, production-startup old-backup fixture가 retired keys를 제외하고 retained data를 복원한다. Importer/fixture는 removal 대상이 아니다. |
| OutputWriter recovery | **PASS — fault-injected behavior** | `tests/services/output/output-writer.test.ts`의 interrupted `files-committed` recovery와 queue-linked retry가 통과한다. Live credential process-kill/actual disk-full evidence로 확대하지 않는다. |
| Durable queue recovery | **PASS — deterministic IndexedDB behavior** | IndexedDB restart lease recovery, prior-process recovery와 queue-linked OutputWriter recovery가 통과한다. Live credential kill/restart evidence로 확대하지 않는다. |

PASS인 네 항목은 필요한 compatibility/recovery 기반을 보존한다는 뜻이지, 누락된 production/release
gate를 대체하지 않는다.

## `rg` 및 TypeScript caller graph

Current `tsconfig.json`과 installed TypeScript resolver를 사용해 `src/main.tsx`에서 runtime import와
dynamic import edge를 따라갔다. `legacy/**` historical tree는 production graph에 없지만 다음 current
runtime module은 reachable하다.

```text
src/main.tsx -> src/stores/generation-store.ts
src/main.tsx -> src/App.tsx -> src/hooks/useSceneGeneration.ts
  -> src/lib/scene-generation/build-scene-params.ts
  -> src/lib/scene-generation/legacy-build-scene-params.ts
src/main.tsx -> src/App.tsx -> src/pages/StyleLab.tsx
  -> src/services/style-lab-generation.ts
  -> src/lib/style-lab/build-style-lab-params.ts
  -> src/lib/style-lab/legacy-build-style-lab-params.ts
src/main.tsx -> src/lib/composition-migration-startup.ts
  -> src/lib/composition-migration-shadow.ts
```

### Production runtime

| Surface | Definition/branch | Production inbound edge | 분류 |
| --- | --- | --- | --- |
| Main | `src/stores/generation-store.ts:938`, `1209-1371` | Main direct generation과 durable capture가 effective authority에 따라 legacy request를 실제 선택한다. | Active production authority path + shadow comparison |
| Scene | `src/lib/scene-generation/legacy-build-scene-params.ts:105` | `build-scene-params.ts:579`의 legacy path와 `:594`의 shadow path; retained Scene worker와 durable enqueue가 facade를 호출한다. | Active production authority path + shadow comparison |
| Scene compatibility projection | `legacy-build-scene-params.ts:43` | v2 materialization도 output/Asset Module compatibility를 위해 `build-scene-params.ts:437`에서 legacy resolver를 사용한다. | Active compatibility runtime |
| Style Lab | `src/lib/style-lab/legacy-build-style-lab-params.ts:44` | `build-style-lab-params.ts:148-163`에서 effective legacy authority일 때 실제 builder를 호출한다. | Active production authority path |
| Migration shadow | `src/lib/composition-migration-shadow.ts:357` | `composition-migration-startup.ts:189`가 startup transaction의 independent legacy comparison으로 전달한다. | Active migration safety runtime |
| Fail-closed authority | `src/lib/composition-authority.ts:5`, `29-38` | Startup verification 전 모든 requested v2/shadow mode를 legacy로 강제한다. | Active production gate |

### Rollback-only 또는 explicit compatibility control

- `src/components/diagnostics/CompositionAuthorityPanel.tsx:58`의 one-action Composition authority rollback.
- `src/stores/queue-store.ts`와 `src/services/queue/generation-command.ts:8`의 explicit queue execution rollback.
- `src/main.tsx:445`의 store hydration failure rollback. Composition authority와 queue execution authority는
  서로 다른 gate이며 어느 쪽도 이번 phase에서 삭제하지 않는다.

### Importer/parser/fixture/historical

- Old backup importer: `src/lib/auto-backup.ts:808`, `1228`; production Settings restore caller 유지.
- v1 Asset Profile와 legacy store migration: `src/domain/composition/migrations/**`; startup/runtime caller 유지.
- Legacy metadata/PNG/sidecar readers: `src/lib/metadata-parser.ts`, `src/lib/nais2-png-meta.ts`,
  `src/services/output/metadata-apply.ts`; current import UI/preview caller 유지.
- Raw migration backup/recovery journal, payload provenance와 `tests/fixtures/legacy/**`는 active recovery/test
  authority다.
- `legacy/**`는 historical source이며 release input이 아니지만 검색 결과를 줄이기 위해 삭제하지 않는다.

## Removal candidate 판정

Definition-only runtime function/module candidate는 **0**이다. Legacy builder와 shadow function은 모두
production inbound edge가 있다. 네 개의 internally used type에 외부 importer가 없는 cosmetic `export`
modifier가 있지만 runtime retirement가 아니며 blocked Phase 14에서 별도 cleanup하지 않는다.

따라서 작은 removal commit, legacy-authority-not-needed decision record, version bump, tag, release
publication을 만들지 않는다. Current `ROLLBACK_POLICY.md`의 immutable tag/artifact와 non-destructive
authority rollback 규칙은 그대로 유효하다. 향후 gate 재평가에는 최소한 다음 redacted artifacts가
필요하다.

1. signed desktop와 Android immutable artifact/checksum/source commit
2. pre-cutover backup envelope/checksum과 migration report
3. rollback/forward artifact identity와 install/restore/migration timestamps
4. 한 release observation window의 bounded migration/fallback diagnostic aggregate
5. supported workflow/model/format/source-edit online matrix와 Android cancel/no-late-save result

## Verification

최초 characterization은 문서 변경 전에 실행했다.

| Command | Exit | Result |
| --- | ---: | --- |
| focused authority/workflow/OutputWriter/queue recovery Vitest | 0 | 7 files, 76/76 tests |
| `npm ci`; `npm ls --all` | 0; 0 | 423 packages, audit 0 vulnerabilities; only host-excluded optional dependencies |
| focused backup/OutputWriter/durable queue recovery Vitest | 0 | 5 files, 57/57 tests |
| `npm run lint`; `npm run build` | 0; 0 | lint clean; npm-ci production bundle, 2,404 modules |
| payload parity; characterization; migration; queue suites | 0 each | 20/20; 50/50; 135/135; 42/42 tests |
| `npm run test:composition` | 0 | 128 passed + 1 skipped files; 984 passed + 3 skipped tests |
| unit; diagnostics; credential vault; sync; R2; organizer; secret-redaction suites | 0 each | 42; 27; 20; 180; 18; 20; 13 tests passed |
| NAI core; NAI transport; smart-tools suites | 0 each | 50/50; 14/14; 3/3 tests |
| persistence + rescue-mode browser contract | 0 each | 15/15 tests; rescue contract PASS |
| responsive layout | 0 | 50 route/viewport checks; pass depends on pre-existing, out-of-scope responsive working-tree changes |
| Android source/release/transfer; Cloudflare transfer; release-version; remote-runtime-removal | 0 each | all contracts PASS; tracked `.codex`/`.omx` count 0 |
| default `cargo check --manifest-path src-tauri/Cargo.toml` | 1 | existing `src-tauri/target` cache referenced removed `nais2-main` checkout; environment artifact, not source regression |
| fresh isolated-target `cargo check` | 0 | completed without source changes |
| fresh-target Rust NAI transport; R2; sync transport; Android transfer tests | 0 each | 5/5; 7/7; 14/14; 3/3 tests |

`npm ci` 뒤 production bundle을 만들었지만, 시작부터 존재한 unrelated working-tree 변경 때문에
repository 자체를 clean checkout이라고 주장하지 않는다. Default Cargo 실패는 기존 target을 삭제하지
않고 process-local `CARGO_TARGET_DIR`로 재검증해 환경 제한과 code regression을 분리했다.
Live NovelAI/R2 credential, signed release install/restore와 release observation은 local deterministic
baseline으로 대체하지 않는다.

## Gate 재개 조건

위 MISSING/FAIL 항목이 모두 실제 production/release evidence로 PASS하고, fresh/upgrade/old-backup이
명시적 test override 없이 v2 authority를 사용하며, TypeScript production graph가 rollback 외 legacy
caller 0을 보일 때만 별도 phase에서 removal candidate를 다시 계산한다. 그 전까지 다음 phase
readiness는 **BLOCKED**다.
