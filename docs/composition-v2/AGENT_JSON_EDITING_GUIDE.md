# Agent JSON editing guide

기준일: 2026-07-13 (Asia/Seoul)

## Canonical boundary

Composition v2의 canonical authority는 IndexedDB의 `nais2-composition-repository` record다. Agent와 GUI 모두 raw record, revision, hash, migration marker를 직접 덮어쓰지 않는다. 모든 변경은 repository change-set command로 수행한다.

권장 코드 경계:

1. `createCompositionAuthoringRepository()`로 authoritative document를 읽는다.
2. 읽은 document와 revision을 base로 유지한다.
3. typed `CompositionChange` 목록을 만든다.
4. `createCompositionChangeSet()`으로 baseRevision, next revision, actor, timestamp를 명시한다.
5. schema와 semantic validation 및 diff preview를 제공한다.
6. `repository.applyChangeSet()`을 한 transaction으로 실행한다.
7. `E_AUTHORING_STALE_REVISION` 또는 `E_REPOSITORY_CONFLICT`이면 base/local/external을 다시 읽어 3-way merge한다.

Actor는 `{ kind: 'agent', id, displayName? }`처럼 stable identity를 사용한다. 같은 entity를 여러 번 upsert하거나 keystroke마다 full document를 쓰지 않는다.

## Safe JSON rules

- `schemaVersion`, document/entity stable ID, revision, created/updated actor와 timestamp를 유지한다.
- prompt target, params override, character slot/position, output policy, random rule은 domain type의 값만 사용한다.
- OS absolute path를 document에 넣지 않는다. `app-data`, `pictures`, `user-selected`, relative/display path를 분리한 portable reference를 사용한다.
- resource bytes는 document에 inline하지 않고 stable library ID, optional hash, portable file reference로 참조한다.
- unknown legacy data는 importer가 `extensions.legacy`/orphan report에 보존하도록 두고 임의로 제거하지 않는다.
- output policy에 R2 credential이나 full request payload를 넣지 않는다.

## Conflict workflow

Agent가 읽은 base revision 이후 GUI 또는 disk update가 발생할 수 있다. 단순 overwrite를 하지 말고 다음 네 값을 제공한다.

- base: agent가 읽은 원본
- local: agent가 제안한 draft
- external: 현재 repository document
- merge result: 충돌별 선택을 반영한 결과

Merge 결과를 current external revision 기반의 새 change set으로 다시 생성하고 validation/diff를 재실행한다. GUI의 authoring session도 같은 stale revision 경계를 사용한다.

## Compatibility file warning

`AppData/asset-profiles/default.json`은 legacy Asset Profile disk compatibility와 desktop file-watch를 위한 파일이다. 이 파일을 편집했다고 canonical Composition repository가 직접 수정되었다고 가정하지 않는다. Android는 external profile file watch capability가 없으며 해당 경로를 silently emulate하지 않는다.

Backup JSON도 editing transport가 아니다. Restore는 preflight, allowlist, hash/count, atomic rollback capability를 요구하므로 raw store 값을 추출해 직접 주입하지 않는다.
