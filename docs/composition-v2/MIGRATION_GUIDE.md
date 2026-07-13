# Composition v2 migration guide

기준일: 2026-07-13 (Asia/Seoul)

## Authority model

`nais2-composition-repository`가 v2 문서와 revision의 canonical 저장소다. 다만 현재 production startup은 fail-closed이다. 프로세스는 항상 `legacy` authority로 시작하고, repository migration·readback·shadow parity·startup marker 검증을 모두 통과한 경우에만 `v2`를 활성화한다.

Authority 선택 순서는 다음과 같다.

1. 호출자가 명시한 authority
2. `nais2-composition-authority` localStorage 값
3. 검증된 repository record의 authority
4. fresh repository의 기본값 `legacy`

따라서 현재 fresh install을 자동으로 v2로 승격한다는 근거는 없다. Main, Scene, Style Lab의 v2 adapter가 구현되어 있어도 authority가 `legacy`이면 공통 gate가 legacy path를 강제한다. 이 사실이 production legacy compatibility를 아직 삭제할 수 없는 주된 이유다.

## Startup transaction

Startup은 UI store hydration보다 먼저 다음 순서를 수행한다.

1. renamed IndexedDB/localStorage key를 새 key로 복사하고 원본을 보존한다.
2. IndexedDB store, wildcard content, allowlisted Asset Profile JSON의 exact source snapshot을 수집한다.
3. migration lease를 획득한다.
4. `nais2-composition-migration-backup`에 source hash/count와 raw preimage를 write-readback한다.
5. deterministic migration dry-run과 schema/reference validation을 실행한다.
6. legacy resolve와 v2 resolve의 shadow comparison을 실행한다.
7. v2 문서를 staging record에 쓴다.
8. repository CAS로 atomic commit하고 migration marker를 기록한다.
9. compatibility sidecar를 materialize하고 source hash를 다시 확인한다.
10. committed hash/count와 startup marker를 재검증한 뒤 authority를 finalize한다.
11. Composition-connected Zustand store를 migration 이후에 rehydrate한다.

Source hash가 post-commit projection 때문에 바뀌면 startup wrapper는 한 번 재시도한다. 두 번째에도 안정화되지 않으면 legacy authority를 유지한다.

Asset Profile의 `lastLoadedAt`은 매 startup마다 달라지는 session 진단값이므로 persisted migration source에 포함하지 않는다. Profile JSON, source path, disk mtime, save/conflict state는 계속 보존한다. Android emulator의 무변경 연속 재시작은 repository revision/source hash가 더 바뀌지 않고 `already-current`를 반환해야 한다.

## Interrupted migration and recovery

- 살아 있는 lease는 다른 process/tab이 소유한 것으로 취급해 덮어쓰지 않는다.
- 만료된 lock 또는 남은 staged document는 다음 startup의 `cleanupInterruptedMigration()`이 제거한다.
- transaction failure는 자신이 소유한 staging/lock만 abort한다.
- committed v2 document는 authority를 legacy로 되돌려도 삭제하지 않는다.
- restore는 `staged`와 `migrationLock`을 transient state로 보고 복원하지 않는다.
- raw migration archive는 audit/rollback 자료이며 application state로 복원하지 않는다.

동작 근거는 `composition-repository`, `composition-migration-transaction`, `composition-migration-startup`, `backup-envelope-v3` migration tests에 있다.

## Importer retention

다음 계층은 runtime caller 수만으로 삭제하지 않는다.

- old backup v2/v3 compatibility importer
- Asset Profile v1 → CompositionDocument v2 importer
- legacy store aliases와 same-shape copy bridge
- legacy metadata reader와 recovery parser
- migration, payload, historical fixtures

삭제 gate는 production authority가 v2로 기본 활성화되고, release telemetry 또는 반복된 clean-upgrade evidence가 legacy fallback을 사용하지 않음을 보여 주며, rollback export를 독립적으로 복원할 수 있을 때 별도 phase로 수행한다.

## Verification

```text
npm run test:migration
npm run test:characterization
npm run test:composition
```

CI의 Android `source-contract` job도 migration suite를 실행한다. 이 suite에는 retired remote key가 포함된 old backup fixture의 clean restore, interrupted lock cleanup, stale revision, v1 Asset Profile import, v3 round-trip이 포함된다.
