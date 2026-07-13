# Composition Domain v2 위험 등록부

기준일: 2026-07-13 (Asia/Seoul)

상태 값: `Open`, `Watching`, `Mitigated`. 심각도는 영향과 발생 가능성을 함께 반영한다.

| ID | 위험 | 근거 | 심각도 | 완화 및 검증 gate | 상태 |
| --- | --- | --- | --- | --- | --- |
| R-001 | 세 workflow의 composition 의미가 미세하게 다르다 | Main, Scene builder, Style Lab adapter가 공통 engine을 소비하지만 workflow materialization은 각자 유지한다 | High | workflow별 characterization, engine adapter, payload parity를 함께 실행 | Watching |
| R-002 | Asset Profile resolver를 공통화하면서 현재 비활성 workflow까지 동작이 바뀔 수 있다 | resolver fallback과 compatibility import가 공존한다 | High | default/disabled profile과 v1 import fixture, resolved-plan diff를 유지 | Watching |
| R-003 | Scene worker/session/cancel race regression | slot worker set, session guard, requeue, finalize, image release가 module-level state와 store state에 걸쳐 있다 | Critical | orchestration은 수정하지 않고 cancel-before-call, cancel-after-call, cancel-before-save, requeue characterization 유지 | Watching |
| R-004 | NAI model payload parity가 과대 선언될 수 있다 | 현재 source와 verifier가 V4/V4.5만 verified로 명시하고 V3/Furry V3는 경고한다 | Critical | model별 captured fixture 없이는 builder 교체·parity 완료 금지 | Watching |
| R-005 | wildcard 결과가 비결정적이어서 engine parity가 흔들릴 수 있다 | `processWildcards()`는 `Math.random()`을 사용하고 resolver seed와 직접 연결되지 않는다 | High | injectable deterministic wildcard processor와 captured result fixture 사용; production 선택 순서는 보존 | Open |
| R-006 | migration helper의 기존 key 삭제가 dual-read rollback을 깨뜨릴 수 있다 | `migrateIndexedDBKeys()`는 copy/length verify 후 old key를 삭제한다 | Critical | v2 migration 전용 dual-read/single-write adapter를 별도로 설계하고 cleanup을 후속 gate로 분리 | Open |
| R-007 | IndexedDB write 실패가 상위 호출에 충분히 전파되지 않을 수 있다 | `rawSetItem()`은 최종 catch에서 log 후 반환하며 writes는 debounce된다 | High | migration/backup phase에서 write-readback 및 flush 기반 결과를 별도 검증; log만으로 성공 판정 금지 | Open |
| R-008 | backup/import compatibility와 image memory가 손상될 수 있다 | 다수 store key, 별도 wildcard DB, character/vibe base64와 retired remote key가 한 backup에 공존할 수 있다 | Critical | backup v3 fixture, old backup fixture, ignored-key preview, repository rollback과 wildcard round-trip을 CI에서 실행 | Mitigated |
| R-009 | output/metadata parity 손실 | PNG/WebP, embedded/sidecar metadata, portable path와 memory history가 workflow별로 분기한다 | High | OutputWriter fault injection, metadata v2/legacy reader, format/sidecar characterization 유지 | Mitigated |
| R-010 | automated test shape가 contract script에 편중되어 있다 | Playwright와 `node:test`는 사용하지만 일반 test/spec/config suite는 없었다 | Medium | Vitest 기반 category script, executable fixture, helper unit/provenance test를 추가하고 static source assertion과 behavior test를 구분 | Mitigated |
| R-011 | App startup lifecycle 회귀 | Scene hook은 `AppContent` mount에 남아 있지만 retired remote auth 초기화는 제거 대상이었다 | High | Scene hook은 route 밖에 유지하고 startup network/auth side effect 부재를 contract로 검증 | Mitigated |
| R-012 | clean install 재현성이 실행 중 dev server에 의존한다 | Vite/esbuild process가 `node_modules` binary를 잠글 수 있다 | Medium | dev server 종료 후 `npm ci`; 종료 권한이 없으면 실패를 환경 제약으로 기록 | Watching |
| R-013 | Rust target이 checkout 경로에 종속된 stale artifact를 포함할 수 있다 | 최초 `cargo check`가 과거 OneDrive 절대 경로의 generated permissions를 참조했다 | Medium | checkout 이동 후 workspace 내부 target을 clean하고 fresh `cargo check` 실행 | Mitigated |
| R-014 | 비교 저장소를 현재 설계로 오인할 수 있다 | NAIS3에서 CompositionEngine/AssetProfile/composition-v2 직접 검색 결과가 없었다 | Medium | 비교는 behavior/fixture 참고로 제한하고 현재 checkout contract를 우선 | Watching |
| R-015 | UI의 v2 기본값과 process authority가 다르다 | store mode는 v2지만 fresh repository startup은 fail-closed `legacy`; Vitest setup은 authority를 v2로 강제한다 | Critical | production-like startup cutover와 online smoke 전 legacy builders/shadow/feature flag 삭제 금지; UI와 runtime authority를 진단 가능하게 유지 | Open |
| R-016 | 실제 NovelAI 온라인 회귀가 credential에 의존한다 | emulator/local 자동 검증은 token 없이 API 직전까지만 진행 가능하다 | High | credential이 있는 격리 smoke에서 Main/Scene/Style Lab supported-model matrix를 실행하고 redacted artifact만 보존 | Open |
| R-017 | Android release 서명/업데이트 검증이 CI secret에 의존한다 | 로컬 debug APK는 가능하지만 release keystore와 immutable baseline 다운로드는 별도 권한이 필요하다 | High | protected GitHub environment에서 signed-build, signed-install, checksum, update baseline gate 유지 | Watching |
| R-018 | volatile store 진단값이 migration source hash를 흔들 수 있다 | Android 연속 재시작에서 Asset Profile `lastLoadedAt` 때문에 같은 target이 반복 commit됐다 | High | session-only timestamp를 persistence projection에서 제외하고 contract test 및 emulator `already-current` 재시작 검증 | Mitigated |
| R-019 | Android HTTP plugin이 NovelAI 응답을 완료하지 못할 수 있다 | authority=v2 emulator에서 standard/stream request와 cancel은 시작됐지만 제한 시간 안에 response/fetch cancel이 완료되지 않았다 | Critical | WebView fetch 대신 scoped plugin transport 유지; 실기기와 별도 네트워크에서 response body/abort 조사 전 Android authenticated generation 완료 선언 금지 | Open |
| R-020 | Phase 01 이전에 생성된 backup/snapshot 파일에 raw auth credential이 남아 있을 수 있다 | 새 export/restore 경로는 sanitize하지만 기존 사용자 disk 파일은 동의 없이 삭제·수정하지 않는다 | Critical | restore preflight는 secret을 저장하지 않고 재입력 경고를 표시; 기존 파일은 값 노출 없는 사용자 주도 scan/폐기 workflow가 생기기 전까지 민감 파일로 취급 | Watching |

## 공통 stop 조건

다음 중 하나가 발생하면 해당 phase의 cutover를 중단하고 직전 adapter/format으로 rollback한다.

- 기존 fixture 또는 fresh baseline 명령의 regression
- Scene session/cancel 이후 API 결과가 저장되는 현상
- old backup을 읽지 못하거나 image bytes가 손실되는 현상
- NAI payload에서 model별 fixture와 설명되지 않는 차이
- 제거 대상이 아닌 NovelAI auth, system opener 또는 single-instance가 함께 사라지는 현상
- dependency/lockfile 변경이 phase 범위를 넘어서는 현상
