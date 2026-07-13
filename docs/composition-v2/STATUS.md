# Composition Domain v2 최종 상태

기준일: 2026-07-13 (Asia/Seoul)

## 결론

Composition Domain v2의 core, workflow adapter, repository/migration, authoring UI, OutputWriter, portable resource/capability adapter와 responsive Android 계약은 구현되어 있다. 그러나 **fresh production startup은 아직 v2 authority를 기본 활성화하지 않는다.** Main/Scene/Style Lab의 persisted mode 기본값은 `v2`지만 process authority가 `legacy`이면 effective mode가 legacy로 강제된다. Vitest setup은 workflow 테스트를 위해 authority를 `v2`로 올리므로 테스트 통과만으로 production cutover를 선언할 수 없다.

따라서 이번 최종 정리에서는 caller search로 definition-only임이 확인된 작은 public alias만 제거했다. legacy request builder, shadow 비교, migration projection, authority feature flag와 recovery importer/parser는 삭제하지 않았다.

## 선행 조건 판정

| 조건 | 판정 | 코드·테스트 근거 |
| --- | --- | --- |
| Main이 v2 engine을 사용 | 조건부 충족 | `generation-store`의 v2 adapter/materialization과 Main adapter tests는 통과한다. Runtime authority가 v2일 때만 실제 요청에 사용한다. |
| Scene이 v2 engine을 사용 | 조건부 충족 | Scene builder가 v2 plan을 소비하고 queue/session orchestration은 보존된다. Runtime authority가 legacy이면 legacy builder로 되돌아간다. |
| Style Lab이 v2 engine을 사용 | 조건부 충족 | Style Lab facade가 engine plan을 materialize하고 invalid-plan/cancel characterization을 갖는다. Runtime authority gate가 남아 있다. |
| repository authority와 migration 안정성 | migration 충족, cutover 미충족 | CAS/lock/interrupted cleanup/source-hash/startup re-read/backup restore tests와 무변경 Android 재시작 `already-current`가 통과한다. fresh repository의 기본 authority는 legacy다. |
| old backup import fixture가 CI에 존재 | 충족 | `tests/fixtures/legacy/old-backup-with-obsolete-remote-state.json`을 `test:migration`이 실행하며 PR/main source-contract에 연결했다. |
| retired online catalog 제거 | 충족 | route/UI/auth/dependency/deep-link/CI env가 제거됐고 allowlist gate가 통과한다. 과거 backup key classifier와 historical source만 허용한다. |
| rollback release/tag/export 정책 | 문서 충족 | `ROLLBACK_POLICY.md`, `BACKUP_RESTORE_GUIDE.md`, `RELEASING.md`가 tag, immutable artifact, backup/export, authority rollback 순서를 정의한다. 실제 signed release restore drill은 별도 환경이 필요하다. |
| production legacy mode 불필요 근거 | **미충족** | fresh startup authority가 legacy이고 credential 기반 online smoke가 없다. legacy runtime compatibility 삭제 gate는 닫혀 있다. |

## 최종 아키텍처

- `src/domain/composition/**`: React/Zustand/Tauri/IndexedDB/Node/filesystem과 분리된 schema, commands, resolver, engine, repository와 migration model.
- workflow adapter: Main, Scene, Style Lab이 engine plan을 각 workflow request와 state transition으로 materialize한다. Scene queue worker 구조는 변경하지 않았다.
- repository authority: CAS revision, stale conflict, migration lock/journal, shadow comparison과 fail-closed runtime authority.
- authoring: `AssetModuleStudio`와 shared composition workspace가 typed draft/validate/commit/undo/conflict/repair 흐름을 repository command로 수행한다.
- output: 공통 OutputWriter가 destination, temp stage, image/metadata/thumbnail, session recheck, atomic commit, state callback, rollback과 recovery journal을 소유한다.
- platform: portable path/resource reference와 RuntimeCapabilities adapter가 desktop/Android materialization 차이를 격리한다.
- UI: desktop command bar/stack/inspector, compact sheets, mobile safe-area command dock, list virtualization과 responsive/accessibility gates.

자세한 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md), 불변 결정은 [DECISIONS.md](./DECISIONS.md), 위험은 [RISK_REGISTER.md](./RISK_REGISTER.md)를 따른다.

## 완료된 phase

- Phase 00~10: baseline, fixtures, domain schema, fragment/module/params/output primitives, pure engine, payload parity gate.
- Phase 11~17: Main/Scene/Style Lab adapter, shadow path와 workflow integration.
- Phase 18: repository migration, backup v3, old backup ignored-key compatibility, authoring conflict transaction.
- Phase 19: retired online catalog/remote auth/deep-link runtime와 dependency 제거.
- Phase 20 구현: OutputWriter/metadata v2, canonical authoring studio, Main/Scene information architecture, portable resource/capability adapter, Android/responsive contracts.
- 최종 cleanup: caller audit, definition-only export 정리, CI compatibility gates와 운영 문서 연결.

Production authority cutover와 legacy builder retirement는 별도 release gate로 남는다.

## 보존한 compatibility

- old backup importer와 ignored retired-key preview
- v1 Asset Profile importer
- legacy metadata/PNG/sidecar reader와 compatibility parser
- migration, payload, characterization, historical fixtures
- Main/Scene/Style Lab legacy builders와 shadow comparison
- fragment legacy runtime/projection과 rollback feature flag
- repository migration bridge, raw rollback snapshot과 recovery journal

보존 이유와 정확한 caller 분류는 [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)와 [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)에 기록한다.

## 제거한 compatibility/dead surface

- retired online catalog route, pages/components, remote auth client/store와 dependency
- catalog 전용 OAuth callback/deep-link scheme, Tauri/Android plugin·permission·CI env
- caller가 없는 wildcard counter reset wrapper
- caller가 없는 Scene fragment sequence commit wrapper
- caller가 없는 FragmentState random/sequential line wrappers
- caller가 없는 Style Lab formatting/signature type/function alias
- 이전 OutputWriter 통합 전 NAI verifier의 stale source-shape assertion

## Verification

실행 명령과 환경 요구사항은 [DEVELOPER_VERIFICATION.md](./DEVELOPER_VERIFICATION.md)를 따른다. 최종 로컬 run은 clean install, lint, TypeScript/Vite build, 72-suite/578-test Vitest aggregate, payload/migration/characterization/NAI/smart tools, responsive sizes, Android contracts, dependency tree, retired-runtime residue gate, Cargo와 debug APK를 포함한다.

Emulator에서 Asset Profile의 session 진단값 `lastLoadedAt`이 exact legacy source hash를 매번 바꾸는 문제가 발견됐다. 이 값은 persistence projection에서 제외했고, 기존 persisted 값이 한 번 정리된 뒤 연속 무변경 재시작이 `already-current; authority=legacy`로 안정됨을 확인했다.

Ignored `.env`의 Opus token으로 실제 NovelAI live smoke도 실행했다. Raw endpoint 512×512/1 step PNG와 production client 512×512/4 steps fixed-seed T2I, msgpack streaming final, Metadata v2/redacted payload hash, AbortSignal cancel이 모두 통과했다. Android v2 Main은 WebView CORS를 피하도록 capability-scoped Tauri HTTP transport로 연결했고 실제 request/cancel 상태까지 진입했지만, emulator에서 standard/stream 응답이 제한 시간 안에 완료되지 않아 Android image/output commit은 성공으로 선언하지 않는다.

실제 NovelAI generation, Android signed release/update install과 390/768/1280/1536 실기기 전체 수동 회귀는 credential, keystore 또는 물리 device가 없어 완료로 선언하지 않는다. emulator는 startup/migration, navigation, sheets, capability explanation, process recreation과 AppData persistence를 검증하며 API token이 필요한 지점에서 중단한다.

## 운영 문서

- [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
- [BACKUP_RESTORE_GUIDE.md](./BACKUP_RESTORE_GUIDE.md)
- [AGENT_JSON_EDITING_GUIDE.md](./AGENT_JSON_EDITING_GUIDE.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DEVELOPER_VERIFICATION.md](./DEVELOPER_VERIFICATION.md)
- retired online catalog runtime removal note
- [ROLLBACK_POLICY.md](./ROLLBACK_POLICY.md)
- [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)

## 다음 release gate

1. production-like fresh/upgrade/old-backup startup에서 default v2 authority를 명시적으로 승인한다.
2. supported NovelAI model의 Main/Scene/Style Lab online matrix를 redacted evidence로 통과한다.
3. signed desktop/Android artifact로 backup export → rollback install → restore → forward migration drill을 실행한다.
4. 한 release observation window 뒤 legacy builder caller를 다시 검색한다.
5. 그때 caller 0, rollback drill 성공, payload gap 해소가 모두 성립하면 별도 PR에서 legacy runtime을 제거한다.
