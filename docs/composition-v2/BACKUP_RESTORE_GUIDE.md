# Backup and restore guide

기준일: 2026-07-13 (Asia/Seoul)

## Current format

새 backup은 `nais2-backup-envelope` format version 3이다. Envelope에는 다음 integrity 정보가 포함된다.

- app version과 선택적 source commit
- Composition schema/authority/document
- store manifest의 key, version/schemaVersion, canonical hash, logical count
- wildcard content manifest
- allowlisted Asset Profile file의 exact JSON과 hash
- 포함/제외 파일 목록
- rollback을 위한 retained legacy store snapshots

Full auto backup은 media base directory의 `NAIS_Backup/full` 아래에 기록하며 최대 10개를 유지한다. 자동 backup과 수동 restore 모두 동일한 v3 preflight 경계를 사용해야 한다.

`nais2-auth`는 AuthState v3 allowlist projection만 포함한다. 두 slot의 `CredentialRef`와 enabled,
tier/display metadata는 보존하지만 NovelAI/R2 secret, session token, verified runtime flag와
Anlas cache는 backup/snapshot/export에 포함하지 않는다. Reference는 다른 vault의 secret을
복원하지 않으므로 target profile에서 vault unlock 후 credential 재등록이 필요할 수 있다.

## Restore sequence

1. 원본 backup을 변경하지 않고 보관한다.
2. `prepareBackupRestore()` 또는 `dryRunBackupRestore()`로 format, future schema, hash/count, composition reference와 restore capability를 검사한다.
3. UI에서 restore keys, ignored keys, warnings/errors를 확인한다.
4. wildcard atomic writer와 Asset Profile finalize/rollback capability가 필요한지 확인한다.
5. restore transaction을 실행한다.
6. 모든 store를 write-readback한다.
7. file finalize가 실패하면 store/wildcard/file preimage를 rollback한다.
8. app을 재시작하고 migration/startup marker가 정상인지 확인한다.

`canRestore=false` 또는 error가 하나라도 있으면 write를 시작하지 않는다. Future backup/store schema를 현재 reader로 강제 복원하지 않는다.

## Old backups

Legacy v2 object backup도 compatibility importer를 거쳐 복원한다. 현재 store allowlist에 없는 key는 쓰지 않고 ignored report에 남긴다. Retired remote catalog/auth key는 전용 ignored reason으로 분류해 복원 대상에서 제외한다. NovelAI auth, scenes, fragments, presets 등 allowlisted local data는 유지한다.

CI fixture:

`tests/fixtures/legacy/old-backup-with-obsolete-remote-state.json`

이 fixture는 obsolete remote state가 있어도 restore가 성공하고, retired credentials/session key가 clean storage에 기록되지 않으며, local workflow data가 보존되는지를 검증한다. 구체적인 retired key 목록은 전용 runtime removal note에만 기록한다.

Phase 01 이전 backup에는 raw credential이 남아 있을 수 있다. Restore projection은 이를
AuthState v3 metadata로 sanitize하고 raw value를 durable storage에 쓰지 않는다. 원본 legacy
artifact는 민감 파일로 격리하며 자동 삭제하지 않는다. Credential Vault dialog의 관리 대상
backup cleanup은 값을 표시하지 않고 structural field만 검사하고, 별도 destructive
confirmation 뒤 credential-bearing artifact 전체를 삭제한다. 외부 복사본은 이 cleanup의
범위가 아니다.

## Composition-specific behavior

- v3 envelope에 repository record가 있으면 committed document와 authority를 검증해 복원한다.
- `staged`, `migrationLock`, raw migration archive는 transient/diagnostic data이므로 live state로 복원하지 않는다.
- legacy stores만 있는 backup은 v2 document를 deterministic하게 생성하되 rollback source를 함께 보존한다.
- Asset Profile JSON은 normalization 없이 exact allowlisted file preimage로 restore하며, write 전에 rollback capability를 요구한다.
- restore 후 repository가 `legacy` authority이면 workflow compatibility path는 계속 필요하다.

## Operator checklist

Release 또는 migration 전에 v3 export와 원본 backup hash를 별도 보관한다. Restore 후에는 다음을 실행한다.

```text
npm run test:migration
npm run test:remote-runtime-removal
```

실사용 데이터 검증에서는 scene/fragment local import-export, image byte 보존, active recipe, character stable ID, unresolved portable resource 표시를 추가 확인한다.
