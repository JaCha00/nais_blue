# Release, data export, and rollback policy

기준일: 2026-07-14 (Asia/Seoul)

## Release rollback

- release tag는 `v<package.json version>`과 정확히 일치하고 이미 `main`에 포함된 commit을 가리켜야 한다.
- published tag와 asset을 이동·교체하지 않는다. 문제가 있는 release는 알려진 정상 commit에서 더 높은 patch version을 만들어 새 immutable tag로 배포한다.
- Android는 기존 application ID, versionCode monotonicity, pinned signer certificate를 유지한다. 서명 key 교체는 rollback이 아니라 별도 signing-key migration이다.
- source archive, installer/APK, checksum, release manifest를 release 단위로 함께 보관한다.

## Data rollback prerequisite

Composition cutover 또는 migration release 전에 다음을 보존한다.

1. v3 backup envelope와 checksum
2. exact Asset Profile JSON preimage
3. `nais2-composition-migration-backup` raw source archive
4. release tag와 source commit
5. migration dry-run/report와 verification 결과

backup에는 auth credential을 새로 복제하지 않으며, diagnostic artifact는 redaction 규칙을 적용한다.

## Credential vault rollback

AuthState v3 migration이 vault write/readback과 sanitized storage readback을 완료하면 raw token을
IndexedDB/localStorage에 되돌리지 않는다. Phase 04 source commit을 revert해도 Stronghold
snapshot을 자동 삭제하지 않으며 encrypted secret을 plaintext legacy AuthState로 export하는
rollback은 금지한다.

Phase 04 rollback이 필요한 경우 unrelated working-tree와 user data를 보존한 채 해당 commit만
`git revert`한다. 이전 binary는 AuthState v3 reference로 generation credential을 읽을 수
없으므로 provider credential 재입력 또는 forward-fix build가 필요하다. 기존 legacy backup을
사용하는 경우 먼저 credential-bearing artifact로 격리하고 restore가 raw credential을 durable
storage에 재기록하지 않는 현재 preflight 경계를 유지한다. Vault/snapshot 삭제는 별도 사용자
확인과 recovery 판단 없이 수행하지 않는다.

## Android NAI transport rollback

Phase 05 transport는 repository schema, payload format, output format과 user data를 migration하지
않는다. Rollback은 unrelated working-tree, Stronghold snapshot과 generated Android cache를
보존한 채 Phase 05 local commit 하나만 `git revert`한다. `reset --hard`, `clean`, credential
삭제와 output 삭제는 사용하지 않는다.

Revert하면 browser/test fetch와 desktop Tauri HTTP plugin은 원래 경계로 돌아가지만 Android도
response/abort 무한 대기가 관찰된 JS HTTP plugin으로 돌아간다. 따라서 forward fix 또는
별도 검증 전 Android authenticated generation을 지원 완료로 표시하지 않는다. Payload builder,
source-edit ZIP, Scene worker/dual-token/streaming 제한, session/stale guard와 OutputWriter를
rollback 과정에서 별도로 변경하지 않는다.

2026-07-14 mobile body hardening은 schema, payload, output 또는 user data를 migration하지 않고
raw `Channel<Response>`를 같은 ordered JSON event channel의 base64 body chunk로 바꿨다. 이
hardening commit만 revert하면 browser/desktop은 유지되지만 M500_MIKU에서 관찰한 Android 0-byte
standard/stream failure가 다시 생긴다. Phase 05 commit까지 함께 revert하지 않으며, 어느 revert도
Stronghold snapshot, app data, output 또는 generated cache 삭제를 요구하지 않는다. Post-fix physical
gate가 불완전하더라도 device system service를 임의로 grant/disable/clear하여 rollback evidence를
만들지 않는다.

## Authority rollback

Repository는 committed v2 document를 지우지 않고 authority만 `legacy`로 변경할 수 있다. Operational hotfix는 `applyCompositionAuthorityFeatureFlag('legacy')`와 repository `setAuthority('legacy')` 경계를 사용하며, 임의로 IndexedDB JSON을 수정하지 않는다. Startup hydration failure도 같은 fail-closed path를 사용한다.

Phase 06부터 Diagnostics의 Composition Authority panel이 end-user one-action legacy rollback을
제공한다. 버튼은 직접 repository JSON을 수정하지 않고 `applyCompositionAuthorityFeatureFlag('legacy')`
만 호출한다. V2 activation control은 panel에 없으며 release gate를 통과한 operation도 같은 helper의
startup migration, authoritative document re-read와 committed hash 검증을 모두 통과해야 한다.

Rollback 후 확인할 항목:

- Main/Scene/Style Lab이 legacy authority로 강제되는가
- old store source가 삭제되지 않았는가
- v2 committed document와 migration archive가 재승격을 위해 남아 있는가
- Scene cancel/session guard와 output commit ordering이 유지되는가
- fresh restart에서 staging/expired lock cleanup이 성공하는가

Phase 06 source rollback이 필요하면 현재 authority가 v2인 경우 먼저 panel 또는 검증된 helper로
legacy rollback을 완료하고 persisted/runtime가 모두 legacy인지 확인한다. 그 뒤 unrelated
working-tree와 user data를 보존한 채 Phase 06 local commit만 `git revert`한다. Phase 06은 fresh
default나 repository schema를 바꾸지 않았으므로 reset/clean, repository/backup 삭제 또는
destructive migration은 필요하지 않다.

## Stop conditions

다음이면 cutover 또는 cleanup을 중단하고 compatibility layer를 유지한다.

- fresh install이 명시적 flag 없이 v2 authority로 안정적으로 시작하지 않는다.
- shadow parity 또는 payload fixture가 다르다.
- old backup/Asset Profile v1/legacy metadata를 읽지 못한다.
- interrupted migration recovery가 source를 손상한다.
- Android update signer, package identity, process recreation persistence가 불명확하다.
- authenticated generation/output smoke를 실행하지 못했다.
- Android request가 success 또는 typed timeout/cancel로 유한 시간 안에 끝나지 않는다.
- Scene cancel 뒤 sequence proposal, OutputWriter, history/image save 또는 queue resurrection이 발생한다.
