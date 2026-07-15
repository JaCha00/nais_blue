# Release, data export, and rollback policy

기준일: 2026-07-15 (Asia/Seoul)

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

## Vault restart lifecycle rollback

Phase 07은 credential schema, snapshot format과 user data를 migration하지 않는다. Rollback은
unrelated `AGENTS.md`, Stronghold snapshot/salt, app data, output과 generated caches를 보존하고 해당
local commit만 `git revert`한다. Revert하면 native parent-directory precreation, close/relaunch unload,
I2I readiness wait와 privileged-permission manifest gate가 함께 제거되므로 Windows restart source-edit와
Android system-crash 분류를 다시 검증하기 전 release하지 않는다. Snapshot/salt 삭제, plaintext export,
Play Services grant/disable/data clear와 app data clear는 rollback 절차가 아니다.

## Durable queue domain rollback

Durable queue phase는 기존 Main/Scene workflow를 cutover하거나 user generation data를 migration하지
않는다. Rollback은 unrelated `AGENTS.md`, generated caches, existing IndexedDB/Vault/app/output data를
보존하고 해당 local commit 하나만 `git revert`한다. `reset --hard`, `clean`과 queue database 삭제는
rollback 절차가 아니다.

Phase 07 commit 단독 시점에는 runtime caller가 없었으므로 source revert만으로 기존 generation
behavior로 돌아갔다. Phase 08 cutover 뒤에는 아래 operational rollback으로 enqueue/worker authority를
legacy adapter로 먼저 되돌리고 committed queue records와 managed resource를 보존한다. OutputWriter,
Scene worker/session/cancel/requeue 계약이나 composition/payload repository를 queue rollback 과정에서
별도로 변경하지 않는다.

## Queue workflow cutover rollback

Phase 08 operational rollback은 먼저 Queue Center에서 execution authority를 `legacy`로 명시적으로
선택한다. 이 setting은 persisted `nais2-queue-ui` projection의 `executionAuthority`만 바꾸며 durable
batch/job/attempt/lease/resource, linked OutputWriter journal, managed AppData resource, legacy Scene
`queueCount`와 user output을 삭제하지 않는다. 이미 running인 durable executor는 정상 cancel/shutdown
guard로 멈춘 뒤 legacy generation을 시작하고, DB를 직접 편집해 terminal state를 만들지 않는다.

기존 `queueCount`를 durable jobs로 변환하는 UI는 현재 parameter snapshot을 새 batch로 등록하지만 count를
자동 삭제하거나 decrement하지 않는다. 따라서 rollback을 위해 count를 복원하거나 durable job을
duplicate enqueue하지 않는다. 성공 job 재실행, output path 존재만으로 success 표시, files-committed
journal 삭제는 rollback 절차가 아니다.

Source rollback은 unrelated `AGENTS.md`, `src-tauri/src-tauri/**`, generated cache와 모든 app/user/output
data를 보존하고 Phase 08 local commit 하나만 `git revert`한다. `reset --hard`, `clean`, IndexedDB/AppData
삭제와 destructive migration은 금지한다. Revert 전에 execution authority가 legacy인지 확인하고 running
durable work를 cancel/shutdown한 뒤 restart한다. Revert 뒤 Main direct generation, Scene legacy queueCount,
dual-token/stream/session/cancel/stale/retry/requeue/rotation/image-release와 Android typed timeout/cancel을
focused characterization으로 다시 확인한다. Phase 07 durable records는 future forward recovery를 위해 남긴다.

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

## Native R2 rollback

Phase 09 source rollback은 먼저 새 upload 시작을 중지하고 foreground runtime이 active multipart를 abort하도록
한다. Existing object, completed manifest, R2 upload IndexedDB와 OS credential vault를 삭제하지 않는다.
Legacy Python/Wrangler panel과 current-session/delta/full-sync/dry-run backend는 그대로 유지되므로 native
transport를 사용하지 않고 해당 workflow로 전환할 수 있다.

그 뒤 unrelated `AGENTS.md`, generated `src-tauri/src-tauri/**`/target, user output, Asset Profile, queue DB와
vault를 보존하고 Phase 09 local commit 하나만 `git revert`한다. `reset --hard`, `clean`, bucket delete,
multipart sweeping, credential deletion과 destructive migration은 rollback 절차가 아니다. Revert한 binary는
R2ProfileV2/UploadJob을 읽지 않지만 records는 future forward recovery를 위해 남긴다. Conditional conflict,
secret exposure 또는 multipart duplication stop gate가 발생했다면 provider audit 뒤 credential rotation/
remote multipart cleanup은 사용자의 별도 확인을 받아 수행한다.

## Organizer distribution artifact rollback

Phase 10 rollback은 Organizer에서 새 distribution/R2 enqueue를 중지하고 running OutputWriter transaction이
cancel/rollback 또는 terminal journal recovery를 끝내도록 한다. Original image, successful distribution variant,
`.nais2.artifact.json` sidecar, `nais2-organizer-artifacts` IndexedDB, R2 UploadJob/manifest, external folder, managed
AppData collection, unrelated `AGENTS.md`와 generated `src-tauri/src-tauri/**`/target은 삭제하지 않는다.

Operational fallback은 Organizer route를 사용하지 않고 retained output/library/R2 workflow를 사용한다. Existing
ArtifactRecord는 future forward recovery를 위해 남기며 raw path를 repository에 주입하거나 direct filesystem
rename/delete로 cleanup하지 않는다. Metadata/sanitization issue가 발견되면 new execution을 stop하고 failed record와
OutputWriter journal을 inspect/recover하며, already successful distribution을 automatic destructive rollback 대상으로
취급하지 않는다.

Source rollback이 필요한 경우 user data와 unrelated working tree를 보존한 채 Phase 10 local commit 하나만
`git revert`한다. `reset --hard`, `clean`, organizer/R2/queue IndexedDB deletion, artifact/original/output deletion,
credential rotation 또는 destructive migration은 rollback 절차가 아니다. Revert 뒤 OutputWriter baseline,
legacy metadata reader, queue/session/cancel contract와 retained R2 workflow를 focused test로 확인한다.

## Local-first sync core rollback

Phase 11은 production Composition/Scene/prompt/artifact caller, network transport, user-facing control,
encryption/key management 또는 existing user-data migration을 연결하지 않는다. Operational rollback에서
끄거나 전환할 sync runtime authority가 없으며 current workflow behavior는 계속 existing authority를 사용한다.

Source rollback은 unrelated `AGENTS.md`, generated `src-tauri/src-tauri/**`, Composition/queue/R2/Organizer
database, Stronghold, OutputWriter journal, user output과 existing app data를 보존한 채 Phase 11 local commit
하나만 `git revert`한다. `reset --hard`, `checkout --`, `clean`을 사용하지 않는다.

User-scoped `nais2-local-sync--<user-hash>` database의 entity, outbox, inbox, tombstone, conflict copy와
checkpoint를 rollback 과정에서 삭제하거나 직접 편집하지 않는다. 이전 binary는 별도
database를 사용하지 않으며 records는 forward fix/recovery를 위해 남긴다. Tombstone 삭제,
revision/`baseOpId` 재작성, `lineageUnknown` marker 제거, `in-flight` record의 임의 ack/requeue,
2,048 cap을 회피하기 위한 record 삭제와 destructive schema downgrade는 rollback 절차가 아니다.

Forbidden payload, cross-user read, arrival-order divergence, stranded expired attempt 또는 tombstone
resurrection이 관찰되면 later caller/transport cutover를 중단한다. Revert 전후에 current
CompositionEngine/repository/migration, payload parity, generation queue/session/cancel, OutputWriter와 old
importer/reader fixture를 focused baseline으로 확인한다. Production source + outbox atomic recovery는
Phase 11 rollback을 넘어서 추정하지 않는다.

## Secure LAN sync transport rollback

Phase 12 operational rollback은 먼저 새 pairing을 닫고 LAN listener와 active sync request를 명시적으로
stop/cancel한다. Android transfer ticket이 있으면 pause/cancel state와 마지막 checkpoint를 commit한 뒤 worker를
중지한다. Existing Phase 11 outbox/inbox/checkpoint/tombstone, native non-secret replay journal, resumable partial file,
Stronghold의 device/peer identity와 R2 object를 삭제하지 않는다. 이전 binary가 이 authority를 사용하지 않더라도
forward recovery와 duplicate/tombstone 검증을 위해 보존한다.

Operational fallback은 LAN agent를 꺼 둔 local-only Phase 11 shadow와 기존 R2 foreground workflow다. Relay,
removed provider/catalog runtime, unauthenticated HTTP 또는 JSON image fallback으로 자동 전환하지 않는다. Vault lock 전에
native listener를 stop해 in-memory identity를 해제하고, stop 실패는 diagnostic typed code로 기록하되 secret이나
endpoint/path 원문을 기록하지 않는다.

Source rollback은 unrelated `AGENTS.md`, generated `src-tauri/src-tauri/**`/`src-tauri/gen/android/**`, target/cache,
user output, Stronghold, Composition/queue/R2/Organizer/sync database와 Android app data를 보존한 채 Phase 12 local
commit 하나만 `git revert`한다. `reset --hard`, `checkout --`, `clean`, certificate/vault/peer journal/partial file 삭제,
tombstone rewrite와 destructive migration은 금지한다. Revert 뒤 Phase 11 network-free contract, sanitizer,
two-device/reconnect/tombstone baseline과 existing credential/R2/NAI/queue/OutputWriter category를 다시 확인한다.

Unpaired metadata disclosure, TLS verification bypass, replay acceptance, ciphertext tamper가 handler에 도달하는 현상,
revoked device 재접속, JSON token/image/path 또는 tombstone resurrection이 관찰되면 listener를 즉시 끄고 cutover를
중단한다. Certificate/private identity가 실제로 노출된 경우에만 영향 범위를 먼저 확인하고, remote device revoke나
credential rotation/destructive cleanup은 사용자의 별도 확인 뒤 수행한다.

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
- credential/Authorization/signed URL이 renderer, terminal, diagnostic 또는 artifact에 노출된다.
- non-overwrite R2 conflict가 existing object를 변경한다.
- restart된 multipart가 persisted completed part를 처음부터 다시 보낸다.
