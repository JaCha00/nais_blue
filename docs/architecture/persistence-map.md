# NAIS blue persistence map

이 문서는 런타임의 영속화 책임과 복구 경계를 한곳에 기록한다. 새 저장소를 추가할 때는 소유권, 백업 포함 여부, secret 처리, 정리 정책을 이 표와 `BACKUP_STORE_KEYS`에 함께 반영한다.

## 핵심 원칙

- Composition 의미의 기준은 `nais2-composition-repository`이며 revision/hash/CAS를 우회해 쓰지 않는다.
- 생성 실행의 기준은 durable queue의 `GenerationJob`, 생성 결과의 기준은 organizer의 `ArtifactRecord`다. Zustand의 선택·표시 상태는 기준 데이터가 아니다.
- `nais2-auth`에는 credential reference와 표시용 메타데이터만 둔다. 실제 token은 Stronghold에만 저장하며 backup/export/snapshot에는 raw secret을 넣지 않는다.
- legacy store와 migration preimage는 rollback 관찰 기간 동안 읽기·백업 대상으로 남긴다. 별도 파기 승인 없이 자동 삭제하거나 현재 authority로 승격하지 않는다.
- transient UI state, in-flight controller, object URL, decoded image bytes는 persistence projection에서 제외한다.

## Zustand와 composition key-value 저장소

아래 key는 기본적으로 IndexedDB `nais2-db/keyval`의 `indexedDBStorage`를 사용한다. `src/lib/indexed-db.ts`가 write queue, flush, readback, 장애 진단과 backup registry를 소유한다.

| Key | 책임 | 기준/복구 메모 |
| --- | --- | --- |
| `nais2-generation` | Main 생성 입력, compatibility history, composition mode | 입력 호환 계층이다. 실행/결과 authority로 사용하지 않으며 history는 ArtifactRecord 전환 후 폐기한다. |
| `nais2-character-store` | character/vibe image reference와 편집 상태 | 큰 image bytes는 projection에서 제외하거나 file-backed lazy load를 사용한다. |
| `nais2-character-prompts` | character prompt group·위치 | Composition adapter가 읽는 authoring source다. |
| `nais2-presets` | 저장된 generation preset과 선택 상태 | generation draft를 자동 저장하지 않는다. Save/Revert 명령만 preset을 변경한다. |
| `nais2-settings` | 사용자 설정과 출력 정책 기본값 | 경로는 플랫폼 capability와 OutputWriter에서 재검증한다. |
| `nais2-auth` | vault reference, slot 상태, 비밀이 아닌 표시 정보 | critical. raw token/password를 저장하거나 backup projection으로 내보내지 않는다. |
| `nais2-scenes` | Scene authoring compatibility state | durable job과 ArtifactRecord를 복제하지 않는다. legacy import를 위해 schema 호환을 유지한다. |
| `nais2-character-rotation` | rotation 계획과 재개 snapshot | worker controller 자체는 저장하지 않고 재개 가능한 계획만 저장한다. |
| `nais2-shortcuts` | 사용자 단축키 | best-effort UI preference. |
| `nais2-theme` | theme | best-effort UI preference. |
| `nais2-wildcards` | wildcard/fragment metadata와 counter | 실제 content는 별도 `nais2-wildcard-content` DB에 있다. sequence commit은 revision/CAS 규칙을 지킨다. |
| `nais2-prompt-library` | prompt editor tabs | 사용자 작성 데이터이므로 critical 취급한다. |
| `nais2-layout` | dock 표시 preference | best-effort. 열린 Sheet 같은 transient state는 `partialize`에서 제외한다. |
| `nais2-library` | library index와 grid preference | selection/drag/edit mode는 제외한다. 디스크 원본의 대체 authority가 아니다. |
| `nais2-tools` | tool preference와 최근 입력 | transient 실행 결과는 제외한다. |
| `nais2-update` | update 확인 preference/cache | best-effort이며 설치 기준 데이터가 아니다. |
| `nais2-style-lab` | Style Lab authoring state | 생성 실행과 결과는 queue/artifact 경계를 따른다. |
| `nais2-asset-modules` | Asset profile의 managed projection | 외부 JSON과 충돌할 때 profile revision/mtime 규칙을 사용한다. |
| `nais2-queue-ui` | Queue Center 선택과 execution rollback switch | UI projection이다. job/status authority는 durable queue DB다. |
| `nais2-composition-repository` | canonical v2 document, revision, hash, migration marker | critical CAS authority. repository command 외 직접 덮어쓰기를 금지한다. |
| `nais2-composition-migration-backup` | migration raw preimage/rollback source | 자동 병합하지 않고 복구·진단에만 사용한다. |

## 독립 IndexedDB 저장소

| Database | Object stores / 책임 | 보존 및 연결 |
| --- | --- | --- |
| `nais2-durable-generation-queue` | `batches`, `jobs`, `attempts`, `leases`, `resources` | `GenerationJob` 실행 기준. immutable snapshot, CAS lease, retry/restart recovery를 소유하며 성공 output을 ArtifactRecord로 연결한다. |
| `nais2-organizer-artifacts` | `artifacts` | `ArtifactRecord` 결과 기준. `sourceJobId`/`sourceSceneId`, checksum, original과 distribution variant를 보존한다. token, prompt, signed URL, absolute path는 거부한다. |
| `nais2-r2-upload-queue` | `profiles`, `jobs`, `manifest` | R2 foreground upload 상태와 portable remote reference. secret/signed URL은 profile record에 넣지 않는다. |
| `nais2-local-sync[-user]` | `entities`, `outbox`, `inbox`, `tombstones`, `checkpoints` | per-user sync authority. lease/CAS와 tombstone retention을 유지한다. |
| `nais2-wildcard-content` | `contents` | fragment 본문. `nais2-wildcards` metadata와 stable id/path로 연결된다. |

## 파일·브라우저 저장소

| 위치 | 책임 | 정책 |
| --- | --- | --- |
| Stronghold AppData `nais2-credentials-v1.hold` | 실제 provider credential | 암호화된 유일 secret authority. plaintext/Base64 fallback, passphrase 저장, 자동 삭제를 금지한다. |
| media base `NAIS_Backup/full/nais2-full_*.json` | full disk auto backup | v3 envelope, manifest/hash, 최대 10개. secret redaction 후 기록한다. mobile은 AppData, desktop은 Pictures 기준이다. |
| media base `NAIS_Backup/<store>/...json` | per-store snapshot | `store-snapshot/2`, store당 최대 30개. 중앙 backup projection과 restore preflight를 사용한다. |
| `localStorage: nais2-auto-backup` | startup compatibility backup | 최근 3개. disk backup의 보조 수단이며 동일한 redaction projection을 사용한다. |
| `localStorage: nais2-last-auto-backup`, `nais2-last-disk-auto-backup` | backup scheduling timestamp | 데이터 authority가 아닌 best-effort bookkeeping이다. |
| plugin-store `webview-settings.json` | embedded WebView의 최소 설정 | WebView 전용. Composition/credential/generation 상태를 넣지 않는다. |
| `sessionStorage: nais2-organizer-handoff` | Library/History → Organizer 단발 handoff | 소비 후 삭제되는 transient navigation payload이며 backup하지 않는다. |
| managed AppData content-addressed resources | queue source/mask/character/vibe bytes | SHA-256 address, temp+rename, readback digest를 사용한다. DB에는 portable reference만 두며 reference-aware GC 전 임의 삭제하지 않는다. |
| 사용자 출력·scene/library 디렉터리 | 생성 원본과 export 파일 | OutputWriter와 platform adapter가 소유한다. DB 경로는 index/reference이며 파일 자체의 대체 authority가 아니다. |

## 변경 체크리스트

1. canonical owner와 중복 projection을 지정한다.
2. critical/best-effort, retention, migration/rollback 정책을 정한다.
3. `BACKUP_STORE_KEYS` 포함 여부와 restore preflight를 갱신한다.
4. secret, signed URL, raw prompt, absolute path, image bytes의 허용 여부를 명시하고 redaction 테스트를 추가한다.
5. 브라우저, desktop Tauri, Android에서 지원 capability와 대체 흐름을 문서화한다.
