# Release, data export, and rollback policy

기준일: 2026-07-13 (Asia/Seoul)

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

## Authority rollback

Repository는 committed v2 document를 지우지 않고 authority만 `legacy`로 변경할 수 있다. Operational hotfix는 `applyCompositionAuthorityFeatureFlag('legacy')`와 repository `setAuthority('legacy')` 경계를 사용하며, 임의로 IndexedDB JSON을 수정하지 않는다. Startup hydration failure도 같은 fail-closed path를 사용한다.

현재 end-user용 authority rollback UI는 없다. 따라서 이 절차는 release maintainer가 검증된 hotfix/build에서 수행하는 recovery boundary이지 일반 설정 안내가 아니다.

Rollback 후 확인할 항목:

- Main/Scene/Style Lab이 legacy authority로 강제되는가
- old store source가 삭제되지 않았는가
- v2 committed document와 migration archive가 재승격을 위해 남아 있는가
- Scene cancel/session guard와 output commit ordering이 유지되는가
- fresh restart에서 staging/expired lock cleanup이 성공하는가

## Stop conditions

다음이면 cutover 또는 cleanup을 중단하고 compatibility layer를 유지한다.

- fresh install이 명시적 flag 없이 v2 authority로 안정적으로 시작하지 않는다.
- shadow parity 또는 payload fixture가 다르다.
- old backup/Asset Profile v1/legacy metadata를 읽지 못한다.
- interrupted migration recovery가 source를 손상한다.
- Android update signer, package identity, process recreation persistence가 불명확하다.
- authenticated generation/output smoke를 실행하지 못했다.
