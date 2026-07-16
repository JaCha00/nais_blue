# Composition v2 architecture

기준일: 2026-07-15 (Asia/Seoul)

```mermaid
flowchart LR
    GUI["Main / Scene / Queue Center / Organizer / Style Lab / AssetModuleStudio"]
    CMD["Typed authoring commands\nchange set + base revision"]
    REPO["CompositionRepository\nCAS + canonical v2 document"]
    ENGINE["CompositionEngine\npure resolve + validation + provenance"]
    ADAPTER["Workflow adapters\nMain / Scene / Style Lab"]
    QUEUE["Durable queue repository\nbatches / jobs / attempts / leases / resources"]
    EXEC["Main / Scene executor adapters\ndual-token / session / cancel / transport"]
    R2Q["R2 upload repository\nprofiles / jobs / manifest v2"]
    R2N["Native R2 Rust adapter\nOS vault / SigV4 / multipart"]
    ART["Artifact repository\noriginal / distribution / sidecar / R2 refs"]
    ORG["Organizer adapter\nvirtual browser / portable folder capability"]
    OUT["OutputWriter\nstage / session gate / atomic commit / recovery"]
    CAP["RuntimeCapabilities\ndesktop / Android adapters"]
    LEGACY["Compatibility import/read layer\nold backup / v1 profile / metadata"]

    subgraph SYNCLOCAL["Phase 11 local-first sync core (no production caller)"]
        SSAN["Sync sanitizer\nschema validation / allowlist / safety scan"]
        SDOM["Sync domain\nenvelope / lineage / operation-set resolver"]
        SDB["User-scoped sync repository\nshadow / outbox / inbox / tombstone / checkpoint"]
        SSAN --> SDOM --> SDB
    end

    GUI --> CMD --> REPO
    REPO --> ENGINE --> ADAPTER
    ADAPTER --> QUEUE --> EXEC --> OUT
    GUI --> R2Q --> R2N
    GUI --> ORG --> ART
    ART --> OUT
    ART --> R2Q
    QUEUE --> GUI
    CAP --> GUI
    CAP --> OUT
    LEGACY --> REPO
```

## Boundaries

- `src/domain/composition/**`: React, Zustand, Tauri, IndexedDB, Node, filesystem, Sharp, SQLite를 import하지 않는 pure domain.
- `CompositionRepository`: authority, revision, CAS, staging, migration lease와 canonical command commit의 유일한 persistence boundary.
- `CompositionEngine`: recipe/modules/characters/params/random/output을 deterministic plan으로 resolve하고 warning/error/random trace/provenance를 반환.
- workflow adapters: Main/Scene/Style Lab의 입력을 engine input으로 materialize한다. Main/Scene enqueue adapter는 resolved plan을 immutable queue snapshot으로 고정하고 required resource를 managed AppData에 materialize한다.
- durable queue repository: Main/Scene의 새 enqueue와 claim/snapshot/status authority다. CAS lease, attempt,
  progress, retry lineage, batch failure policy와 output transaction linkage를 transaction/readback으로 소유한다.
- executor adapters: current dual-token scheduler, streaming/source-edit 제한, generationSessionId/cancel/stale
  guard, NovelAI transport, save/history/image release 경계를 재사용한다. Queue는 이 계약을 대체하지 않는다.
- R2 upload repository: non-secret R2ProfileV2, resumable UploadJob의 upload ID/completed parts와 manifest v2를
  별도 IndexedDB에 저장한다. Rust adapter만 OS vault secret을 읽고 official S3 SDK request를 수행한다.
- Organizer artifact repository: `ArtifactRecord`가 immutable original checksum, portable file reference, thumbnail
  cache identity, distribution variants/sidecar와 R2 object reference만 별도 IndexedDB에 저장한다. Raw absolute
  path, opaque platform token, prompt/image byte, credential, Authorization과 signed URL은 authority data가 아니다.
- Organizer collection adapter: managed AppData collection과 desktop external folder를 RuntimeCapabilities/portable
  token registry로 materialize한다. External raw path는 process-local platform token에만 존재하고 UI/adapter가
  OutputWriter를 우회해 file mutation을 수행하지 않는다.
- `RuntimeCapabilities`: absolute path, file watch, tagger, embedded browser, legacy R2 tooling, native R2 profile/
  foreground/background upload, embedded PNG metadata, image formats를 platform adapter로 분리한다.
- `OutputWriter`: API response를 temp에 stage한 뒤 session `canCommit()`, atomic rename, workflow callback,
  journal recovery 순서로 저장한다. Durable execution은 prebound transaction/sourceJob ID를 사용하고
  terminal job commit 뒤 cleanup fault가 artifact rollback으로 되돌아가지 않게 한다.
  Organizer distribution은 image/metadata sidecar/organizer artifact sidecar를 같은 recovery journal에서
  commit·rollback하며 output checksum을 result로 반환한다.
- compatibility layer: historical data를 canonical v2로 import/read하지만 새 authoring write authority가 아니다.

## Phase 11 local-first sync boundary

- `src/domain/sync/**`는 envelope schema, active entity type, deterministic revision, explicit predecessor
  `baseOpId`, upgrade-only `lineageUnknown`, forbidden-material invariant와 operation record contract를 정의한다.
  React, transport, Composition repository, generation queue와 filesystem을 import하지 않는다.
- `src/services/sync/sanitizer.ts`는 Composition document/profile/recipe/module을 current canonical schema로
  검증하고 entity-specific top-level allowlist를 projection한다. Nested `extensions`는 항상 제거하며
  Scene/prompt/UI/artifact/R2 projection도 whole-envelope key/string/image-signature safety scan을 통과한다.
- `src/services/sync/conflict-resolver.ts`는 retained unique operation set에서 ancestry/frontier를 재계산한다.
  Normal non-root operation은 exact predecessor를 가리키고, migrated unknown lineage는 conservative root로 남는다.
  Locale-independent UTF-16 code-unit order로 deterministic primary/conflict copy/status를 만들고 simple UI
  preference 외 complex entity를 field merge하지 않는다.
- `src/services/sync/outbox-repository.ts`는 `userId` hash로 분리된 물리 IndexedDB와 exact-user
  binding을 사용한다. Entities/outbox/inbox/tombstones/checkpoints의 retained envelope를 모아
  mutation/delivery마다 projection을 재계산하고 duplicate/reordering, tombstone dominance, retry,
  ack/checkpoint와 fail-closed schema upgrade를 소유한다.
- Local mutation은 sanitized sync shadow, inbox/outbox, tombstone를 하나의 sync database transaction으로
  commit/readback한다. Production Composition/Scene/prompt/artifact source mutation은 같은 transaction 참여자가
  아니고 Phase 11 caller도 없으므로, diagram의 disconnected subgraph를 end-user source + outbox
  atomicity로 해석하지 않는다.
- Per-entity retained unique operation set은 2,048개로 bounded하고 초과 시 fail closed한다. Phase 11은
  compaction/retention을 수행하지 않는다. Tombstone은 primary entity가 없어도 authority며 60초
  outbox lease가 만료된 `in-flight` record는 ready selection에 다시 포함된다.
- Network transport, background worker, user-facing sync control, encryption/key management은 Phase 11 boundary
  밖이다. `encrypted` field는 reserved하지만 current envelope는 `false`만 허용한다.

## Current authority caveat

아키텍처의 canonical target은 v2지만 production startup의 fresh default authority는 아직 `legacy`다. Repository가 v2를 검증하고 명시적으로 활성화한 session만 v2 document를 workflow에 제공한다. 그러므로 diagram의 legacy layer를 final cleanup에서 제거하면 현재 fallback과 rollback contract가 깨진다.

Queue execution authority는 Composition authority와 별도다. Phase 08의 기본은 `durable`이며 명시적
rollback에서만 retained legacy Main/Scene 실행을 선택한다. 기존 Scene `queueCount`는 한 release 동안
읽기/변환 compatibility로 남고 변환 뒤에도 자동 삭제되지 않는다. Durable queue record, managed resource,
OutputWriter journal을 rollback 과정에서 삭제하거나 output path만으로 성공을 추론하지 않는다.

## Phase 10 organizer distribution boundary

Organizer는 current collection의 thumbnail을 fixed-grid virtualization으로만 읽고, Enter/drag/touch slot
assignment는 pure assignment helper로 duplicate artifact를 막는다. Distribution policy는 portable destination,
sanitized filename/collision, PNG/WebP quality, alpha/matte, metadata strip/preserve와 optional existing R2 profile
reference를 snapshot한다. Rename/copy/strip의 same-format preserve path는 raw container bytes를 쓰며,
conversion은 WebView Canvas만 사용한다. Canvas가 lossless WebP를 증명할 수 없으면 성공처럼 re-encode하지
않고 typed failure로 멈춘다.

PNG/WebP/JPEG raw chunk/segment scanner와 decode-level alpha/color verifier를 함께 사용한다. Original은
checksum이 달라지면 distribution 전에 fail-closed하며 never mutate한다. Successful distribution mutation은
OutputWriter commit callback이 ArtifactRecord sidecar/variant link를 atomic file commit 뒤에만 쓰고, optional
R2는 existing resumable queue에 enqueue만 한다.
