# Scene Mode CompositionEngine v2 전환 계약

기준일: 2026-07-12 (Asia/Seoul)

이번 단계는 Scene의 prompt와 typed generation parameter 조합만 `CompositionEngine`으로 옮긴다. `useSceneGeneration`의 queue claim, worker 수, `generationSessionId`, cancel, 실패 item 재삽입, rotation, streaming preview, saver, scene image, thumbnail, history와 import/export 구조는 유지한다.

## Rollout과 rollback

`nais2-scenes` persisted store의 `sceneCompositionMode` 하나로 전환한다. 기본값은 `v2`이며 Scene 화면에서 generation 중이 아닐 때 `legacy`, `shadow`, `v2`를 선택할 수 있다.

| Mode | Engine | 실제 요청 | Fragment counter |
| --- | --- | --- | --- |
| `legacy` | 실행하지 않음 | 이전 Scene builder 결과 | 이전 processor 정책 |
| `shadow` | preview resolve | legacy 결과로 요청 1회 | commit하지 않음 |
| `v2` | generate resolve | 유효한 engine plan | transport 성공과 session guard 뒤 CAS commit |

문제가 있으면 Scene workflow mode만 `legacy`로 바꾼다. Main의 `compositionMode`와 독립적이며 Scene preset이나 Asset Profile migration/revert는 필요하지 않다.

## SceneCard v2 reference

`SceneCard.compositionRef`는 optional이다. 구형 IndexedDB snapshot, legacy import와 composition field가 없는 외부 preset은 backfill 없이 정상 hydrate된다.

- `recipeId`: Asset recipe이면 저장된 raw ID를 그대로 보존한다.
- `selectionKind`: `asset`과 synthetic `direct`를 구분한다. 따라서 실제 Asset recipe ID가 `scene:direct`여도 direct option과 충돌하지 않는다.
- `recipeRevision`: 선택 당시 source Asset Profile revision이다.
- `sceneContributions`, `paramsOverride`, `characterOverrides`, `outputOverride`: serializable typed override다.
- `migrationMarker`: legacy `scenePrompt` compatibility 경계를 표시한다.
- unknown data는 `extensions`에만 보존한다.

UI의 Select value는 persisted recipe ID가 아니다. Direct selection과 percent-encoded Asset selection token을 decode한 뒤 raw recipe ID와 `selectionKind`만 SceneCard에 저장한다.

## Resolve mapping

`build-scene-params.ts`는 store snapshot을 읽어 pure `scene-adapter.ts`에 전달하고, 결과를 기존 `GenerationParams`로 투영하는 facade다. 이전 prompt assembly와 `processWildcards()` 경로는 `legacy-build-scene-params.ts`에 격리했다.

| Engine layer/target | Scene source |
| --- | --- |
| engine defaults | Main generation model, global resolution, steps, CFG, sampler/scheduler, SMEA, variety, seed, quality/UC, strength/noise, position mode |
| profile/module/step/recipe | 선택된 Asset Profile recipe |
| `main.workflow` contribution | 기존 `scene.scenePrompt` |
| request contributions | `compositionRef.sceneContributions` |
| scene override | legacy Scene width/height 뒤 `compositionRef.paramsOverride`; false와 0 보존 |
| character patch | stable character ID 기반 `compositionRef.characterOverrides` |
| transport-derived override | source/mask mode, source-derived dimensions와 resource ID, strength/noise |

Positive canonical order는 `base → conditional inpainting → additional → workflow(scene) → detail`이다. Negative와 character target은 서로 분리한다. Full-line comment, seeded fragment/wildcard, exact-token dedupe와 params precedence는 공통 engine 규칙을 사용한다. Old scene에 explicit reference가 없으면 adapter가 현재 legacy policy와 같이 첫 enabled Asset recipe, 없으면 synthetic direct recipe를 concrete ID로 선택한다. Engine 자체는 recipe를 암묵 선택하지 않는다.

Runtime schema는 persisted/imported Scene override를 engine 앞에서 다시 검사한다. 잘못된 prompt target, params/output/character shape, unknown top-level field는 `E_DOCUMENT_SCHEMA_INVALID` item error가 되며 prompt processor exception이나 silent fallback으로 진행하지 않는다.

## Worker/session 불변 조건

Queue item state model은 바꾸지 않았다.

```text
session guard
→ decrementFirstQueuedScene (기존 queue claim)
→ facade/resolve
→ API 직전 session guard
→ 기존 streaming 또는 ZIP transport
→ API 직후/session + save 전 guard
→ v2 sequence CAS
→ 기존 saveSceneResult
→ Anlas/progress
```

- streaming이고 source edit이 없으면 첫 active slot 한 개만 사용한다.
- non-streaming 또는 source/mask가 있으면 기존처럼 모든 active slot을 사용한다.
- invalid plan은 이미 claim한 해당 item만 오류로 소비하고 API/save를 호출하지 않으며 worker는 다음 item으로 계속한다.
- HTTP retryable/fatal의 현재 queue 재삽입과 worker stop/retry 정책은 유지한다.
- stale/cancel session은 API 전이면 요청하지 않고, API 뒤이면 결과를 저장하지 않는다.
- shadow는 second transport를 만들지 않는다.
- preview/invalid/API failure/cancel은 v2 sequence proposal을 commit하지 않는다.

`sceneCompositionResults`는 per-scene warning/error와 plan hash만 보관하는 runtime map이며 persist하지 않는다. Prompt, resolution, recipe/ref 변경과 새 generation session은 stale record를 지운다.

## Character와 resource materialization

Engine은 stable character ID, positive/negative, enabled state와 manual/AI position을 resolve한다. Rotation store와 `excludePinned` filtering은 snapshot 작성 전에 기존 위치에서 적용한다. Character/vibe 원본 bytes는 document와 plan에 넣지 않고 기존 `ensureImagesLoaded()` 뒤 transport adapter에서 stable resource ID로 결합한다. Source/mask bytes도 resolve 시작 snapshot을 유지해 plan hash와 실제 payload가 서로 다른 live state를 보지 않게 한다.

## Output 경계

이번 단계는 output writer cutover가 아니다. `saveSceneResult.ts`, preset/rotation/scene directory, filename writer, thumbnail, scene image/history와 sidecar 흐름을 그대로 사용한다. Engine의 output policy와 `compositionRef.outputOverride`는 resolve/provenance/hash에 남지만 실제 Scene destination과 writer ownership은 후속 output 단계 전까지 legacy다. 따라서 Scene plan hash는 prompt/params/character composition identity이며 현재 filesystem filename의 완전한 parity hash로 해석하지 않는다.

Asset recipe의 기존 filename/metadata 호환 객체가 필요할 때 facade는 legacy Asset resolver 결과의 output 부분만 사용하고 prompt/typed params/character 값은 반드시 engine plan으로 다시 투영한다. 실제 최종 prompt를 legacy resolver 결과로 재조합하지 않는다.

## 최소 UX

- Scene 화면: Scene-only mode switch, scene card의 effective recipe와 Override badge, 다중 선택 recipe 일괄 적용.
- Scene 상세: per-scene recipe 선택, reset-to-recipe, Resolved action.
- Reset은 recipe identity/revision/migration marker/extensions와 queue/images/rotation flag는 유지하고 `scenePrompt`, Scene width/height와 contribution/params/character/output override를 지운다.
- Resolved dialog는 화면의 debounce 전 `localPrompt`를 직접 preview resolve하며 positive/negative, params, issues와 plan hash를 표시한다. Preview는 queue/API/counter를 변경하지 않는다.

## 검증

Scene legacy golden은 기존 fixture와 exact match를 유지한다. 추가 contract는 old hydration, direct-ID collision, slot ordering, recipe+scene override, false/0 precedence, bulk/reset, invalid-item continuation, streaming queue 2, shadow single transport, cancel-before-API, sequential API failure/success commit과 Scene UI를 실행한다.

최종 gate:

```powershell
npm run test:characterization
npm run test:payload-parity
npm run test:composition
npm run test:unit
npm run test:nai-core
npm run lint
npm run build
```
