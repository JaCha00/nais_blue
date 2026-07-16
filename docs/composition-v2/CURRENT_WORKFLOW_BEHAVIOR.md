# Composition v2 현행 workflow 동작

기준일: 2026-07-14 (Asia/Seoul)

이 문서는 공통 `CompositionEngine` 도입 전 Main, Scene, Style Lab의 현행 조합·요청·저장 동작을 고정한다. 이후 engine의 결과는 아래 golden fixture와 비교한다. 이 단계는 제품 runtime 결과를 바꾸지 않으며, 관찰된 불일치와 비결정성도 호환성 기준에 포함한다.

2026-07-12부터 Main과 Scene의 기본 caller는 Composition v2다. 이 문서의 Main/Scene 섹션과 golden은 rollback용 `legacy` 기준선으로 계속 보존한다. Production cutover 계약과 승인된 차이는 [MAIN_V2_CUTOVER.md](./MAIN_V2_CUTOVER.md)와 [SCENE_V2_CUTOVER.md](./SCENE_V2_CUTOVER.md)를 따른다. Style Lab 표는 아직 현행 production 동작이다.

2026-07-14 Phase 08부터 Main/Scene의 기본 generation command는 이 문서의 조합 경계를 capture한 뒤
durable queue에 immutable job을 등록한다. 아래 worker/queueCount 설명은 retained legacy rollback 및
executor compatibility의 기준선이다. Durable executor는 current transport/save/session 기능을 재사용하되
claim/status/retry authority는 queue repository에 둔다. Queue Center에서 execution authority를 `legacy`로
명시적으로 바꾼 경우에만 기존 direct Main/Scene launch가 사용된다. Scene rotation은 compatibility release
동안 retained legacy session/worker를 계속 사용한다.

## 실행 가능한 기준선

| Workflow | Characterization test | Golden fixture |
| --- | --- | --- |
| Main | `tests/characterization/main-workflow.test.ts` | `tests/fixtures/workflows/main/current-workflow.json` |
| Scene | `tests/characterization/scene-workflow.test.ts` | `tests/fixtures/workflows/scene/current-workflow.json` |
| Style Lab | `tests/characterization/style-lab-workflow.test.ts` | `tests/fixtures/workflows/stylelab/current-workflow.json` |
| 공통 primitive | `tests/characterization/workflow-fixtures.test.ts` | `tests/fixtures/fragments/inline-selection.json`, `tests/fixtures/workflows/stylelab/prompt-template.json` |

테스트는 실제 Zustand store, workflow builder, wildcard processor, Asset Module resolver, NAI adapter/payload builder/client를 실행한다. 네트워크 경계인 `window.fetch`만 synthetic ZIP/msgpack 응답으로 대체하며 실제 NovelAI 요청은 하지 않는다. IndexedDB, Tauri 파일 API, thumbnail, event도 side-effect boundary에서만 대체한다. 응답에는 유효한 최소 PNG를 사용하고, memory event 또는 mock filesystem에 기록된 최종 PNG에서 `readNais2Params()`로 metadata를 다시 읽거나 실제 sidecar JSON을 읽어 계획값과 비교한다. `Date.now()`와 `Math.random()`은 고정하고, 캡처에는 token, 원본 image bytes, 전체 cache key를 남기지 않는다.

`PromptPanel.tsx`는 Main generate와 preset load를 연결하는 UI trigger이며 자체 prompt 조합기는 아니다. 따라서 characterization은 JSX를 snapshot하지 않고 실제 `preset-store.loadPreset()`과 `generation-store.generate()`를 호출한다. `character-prompt-store`는 text/position 입력, `character-store`는 image/vibe reference 입력, `generation-metadata`는 최종 PNG/history metadata 경계로 각각 실제 경로에 참여한다.

## 세 workflow 차이 요약

| 항목 | Main | Scene | Style Lab |
| --- | --- | --- | --- |
| 조합 소유자 | `generation-store.generate()` | `buildSceneGenerationParams()` + slot worker | `buildGenerationParams()` + preview queue |
| positive 기본 순서 | base → inpainting → additional → detail | base → 조건부 inpainting → additional → scene prompt → detail | 설정 template 순서. 기본은 base → 조건부 inpainting → artist tags → additional → detail |
| inpainting 포함 조건 | `i2iMode`와 무관하게 문자열이 있으면 항상 포함 | `i2iMode === 'inpaint'` | `i2iMode === 'inpaint'`이고 template이 placeholder를 사용할 때 |
| global negative | 주석만 제거 | 주석만 제거 | 주석만 제거 |
| wildcard | merged positive와 character positive/negative | merged positive와 character positive/negative | rendered template와 character positive/negative |
| character object | enabled character를 spread하므로 name 등 유지 | prompt/negative/enabled/position만 새로 만들어 name 제거 | enabled character를 spread하므로 name 등 유지 |
| 위치 | `positionEnabled`; module character면 강제 true | `positionEnabled`; module character면 강제 true | `positionEnabled` |
| resolution | Main selected resolution; source image가 있으면 source 치수 우선 | scene width/height가 global보다 우선; source image가 최종 우선 | Main selected resolution; source image가 있으면 source 치수 우선 |
| Asset Module | 지원. prompt group 활성 시 Main prompt/character 전체 교체 | 지원. scene/preset context를 filename resolver에 추가 | 연결되지 않음 |
| seed 선택 시점 | seed 선택/advance 후 wildcard | seed 선택 후 Asset/wildcard | template wildcard 후 seed 선택 |
| 실행 동시성 | batch를 한 함수에서 순차 처리 | streaming text generation은 첫 활성 토큰 하나만, non-stream/source edit은 모든 active slot | 중복 ID 제거 후 preview를 순차 처리, primary token만 사용 |
| source edit transport | streaming 설정과 무관하게 non-streaming | worker 수는 모든 slot, 각 요청은 non-streaming | streaming 설정과 무관하게 non-streaming |
| output | auto-save filesystem 또는 memory event | 항상 scene filesystem 경로 | auto-save filesystem 또는 memory event |
| history | filesystem/memory 모두 추가 | scene image와 global history 모두 추가 | filesystem만 추가; memory preview는 history에 추가하지 않음 |
| metadata mode | settings 또는 module override 적용 | settings 또는 module override 적용 | `GenerationParams.metadataMode`에 전달하지 않으며 sidecar도 쓰지 않음 |
| session 판정 | `isCancelled` + `generationSessionId` | `isGenerating` + `!isCancelling` + `generationSessionId` | AbortSignal + `isCancelled` + `generatingMode`; session ID는 검사하지 않음 |

모든 workflow의 `GenerationParams`에는 model, width/height, steps, CFG/CFG rescale, sampler, scheduler, SMEA/SMEA DYN, variety, seed, quality toggle, UC preset, character/reference/source 정보가 들어간다. 이후 공통 payload builder가 quality suffix를 positive에 추가하고 UC preset을 negative 앞에 붙인다. 따라서 fixture는 조합 직후의 `finalPositive`/`finalNegative`와 실제 payload의 `input`/`negativePrompt`를 별도로 고정한다. 현행 adapter는 `smea`와 `smea_dyn`을 최종 payload 필드로 전달하지 않고 payload의 `autoSmea`는 false로 고정한다.

## Prompt composition

### Main

Asset Module prompt가 활성화되지 않은 direct path는 다음과 같다.

```text
positive = processWildcards(join(", ", [
  removeComments(basePrompt),
  removeComments(inpaintingPrompt),
  removeComments(additionalPrompt),
  removeComments(detailPrompt),
]))

negative = removeComments(negativePrompt)
```

`inpaintingPrompt`는 source image나 `i2iMode`를 확인하지 않는다. generation preset은 base/additional/detail/negative와 model/parameter/resolution을 바꾸지만 seed, batch, inpainting/source/mask, character state는 바꾸지 않는다. 따라서 preset fixture에서도 기존 inpainting prompt가 보존되어 base 뒤에 들어간다.

enabled recipe와 실제 module이 있고 prompt group 하나라도 비어 있지 않으면 module plan의 positive, negative, character가 Main 입력 전체를 대체한다. metadata의 prompt parts도 final positive/negative 하나로 평탄화되고 additional/detail/inpainting은 빈 문자열이 된다. enabled recipe가 missing module만 참조하거나 resolver가 실패하면 direct path로 돌아간다. prompt contribution이 없는 유효 plan은 direct prompt를 쓰되 plan의 output/metadata 정책은 유지할 수 있다.

### Scene

Asset Module prompt가 활성화되지 않은 path는 다음과 같다.

```text
positive = processWildcards(join(", ", compactNonEmpty([
  removeComments(main.basePrompt),
  main.i2iMode === "inpaint" ? removeComments(main.inpaintingPrompt) : null,
  removeComments(main.additionalPrompt),
  removeComments(scene.scenePrompt),
  removeComments(main.detailPrompt),
])))

negative = removeComments(main.negativePrompt)
```

scene의 width/height가 truthy이면 Main resolution을 override하고 각각 64 배수로 반올림한다. source image가 있으면 source 치수가 다시 우선한다. 회전 중 `scene.excludePinned`가 true이면 pinned character를 character prompt 목록에서 제외한다.

Scene metadata의 direct `promptParts`는 Main의 raw 다섯 필드만 보존한다. 최종 positive에 들어간 `scene.scenePrompt`는 prompt parts에 없고, 실제 조합에서 제외됐더라도 Main의 raw inpainting prompt는 metadata에 남는다. 이 비대칭은 현행 계약이다.

### Style Lab

artist/style tag는 weight를 0.2~2.0으로 정규화하고 artist를 `<weight>::artist:<name> ::` 형태로 만든 뒤 template의 `{{artist_tags}}`에 넣는다. 기본 template은 다음과 같다.

```text
{{basePrompt}}, {{inpaintingPrompt}}, {{artist_tags}}, {{additionalPrompt}}, {{detailPrompt}}
```

template에 `{{artist_tags}}`가 없으면 formatted tags를 맨 뒤에 붙인다. 빈 placeholder가 만든 중복 comma를 compact한 뒤 전체 rendered prompt에 wildcard를 적용한다. fixture의 custom template은 base → artist tags → additional → detail 순서를 고정하며 단일 artist와 복수 artist weight/order를 각각 캡처한다.

Style Lab의 metadata prompt parts는 constituent를 보존하지 않고 `base=finalPrompt`, additional/detail은 빈 문자열로 평탄화한다. negative와 조건부 inpainting만 Main raw 값을 보존한다. Asset Module plan은 없다.

### 공통 negative wildcard gap

세 workflow 모두 global negative에는 `processWildcards()`를 호출하지 않는다. 예를 들어 `<bad anatomy|lowres>`는 payload에도 literal로 남는다. 반면 character negative와 Asset Module resolver가 처리하는 module negative group은 wildcard 처리된다. 이후 engine이 global negative wildcard를 해석하면 의도와 무관하게 현행 결과가 바뀐다.

## 요청, worker, 저장 순서

### Main call order

```text
token/conflict check → session 생성 → batch/session guard
→ seed 선택 및 unlocked next-seed advance
→ Asset plan 또는 direct wildcard composition
→ reference image load → character wildcard composition
→ GenerationParams → adapter/payload → streaming 또는 non-streaming transport
→ post-transport session guard → thumbnail
→ filesystem/memory event → history → Anlas refresh
→ 다음 batch → finally reference release
```

streaming은 source/mask가 없을 때만 허용된다. Main은 transport에 AbortSignal을 전달한다. guard는 batch 진입 전과 transport 직후에만 있으므로 thumbnail 생성 이후 output/history side effect 사이에는 추가 guard가 없다.

### Scene call order

```text
worker session/slot guard → queue item 선점(decrement)
→ builder → pre-transport guard → transport
→ post-transport guard → pre-saver guard
→ saver entry guard → output resolve 전 guard
→ image/optional sidecar write → thumbnail → post-thumbnail guard
→ event → scene image → global history → Anlas/progress
→ 다음 queue item → worker finalize/release
```

`streamingView && !sourceEditActive`일 때만 active token 목록의 첫 항목 하나를 사용한다. 이는 slot 1 고정이 아니다. Characterization은 `tokens.slice(0, 1)` 선택식을 source contract로 고정하고 behavioral golden에서는 streaming worker 하나의 queue 처리를 실행한다. hook 자체를 mount해 slot 1 비활성·slot 2 활성 launch를 별도로 재현하는 테스트는 아니다. non-streaming 또는 source/mask가 있으면 모든 active slot이 queue를 동시에 선점한다. Scene transport에는 AbortSignal을 전달하지 않으므로 cancel은 진행 중 요청을 중단하지 않고 callback/result를 guard로 버린다.

Scene output은 `media root / scene root / sanitized preset / optional rotation character / sanitized scene / filename` 정책이다. module filename이 없으면 `NAIS_SCENE_<Date.now()>_<Math.random suffix>.<format>`을 쓴다. saver guard는 file/sidecar write 직전·직후에는 없으므로 cancel 시 store 반영은 막혀도 이미 쓴 orphan file이 남을 수 있다.

### Style Lab call order

```text
입력 ID 중복 제거 → queue running
→ preview loop guard/combination lookup → preview running 표시
→ template/artist/wildcard builder → reference/character load
→ pre-transport guard → transport → post-transport guard
→ thumbnail → filesystem/memory save/event
→ preview state update → Anlas refresh → queue progress/delay
→ finally queue/runtime clear, generation state reset, reference release
```

Style Lab은 preview마다 Main/character/settings store를 다시 읽으므로 queue 실행 중 편집이 후속 요청에 반영된다. auto-save off는 `memory://NAIS_STYLELAB_<Date.now()>.<format>` event와 preview state만 만들고 global history는 추가하지 않는다. auto-save on은 configured style root 또는 `nais-style`에 저장하고 history를 추가한다. filesystem characterization은 settings가 `strip-and-sidecar`여도 PNG metadata가 그대로 embedded되고 sidecar는 0개라는 현행 동작까지 고정한다.

## Cancel/session guard와 알려진 손실 경로

| Workflow | Guard 위치 | 알려진 gap |
| --- | --- | --- |
| Main | batch loop 진입 전, transport 직후 | thumbnail/output/history 사이 guard 없음 |
| Scene | process 진입, builder 후, streaming callback, transport 후, saver 전, saver entry, output resolve 전, thumbnail 후, saver 후 | transport AbortSignal 없음; dequeue 후 cancel은 queue를 복원하지 않음; write 구간 cancel은 orphan file 가능 |
| Style Lab | loop 진입, builder 후, streaming callback, transport 후, catch error update 전 | `generationSessionId`를 저장하지만 검사하지 않음; thumbnail/save 구간 guard 없음 |

Scene의 cancel-after-dequeue fixture는 queue count가 1에서 0으로 감소한 뒤 cancel되고, 결과·파일·history 없이 끝나지만 queue item도 재삽입되지 않는 현행 손실을 고정한다.

HTTP 400 fatal fixture에서는 item을 먼저 queue에 재삽입한 뒤 `setIsGenerating(false)`가 session ID를 바꾼다. 이어지는 `finalizeWorkers()`는 session mismatch로 조기 반환하여 generation store의 `generatingMode`가 `scene`에 남고 reference image release도 실행하지 않는다. 이 fatal cleanup gap을 성공 정리로 해석해서는 안 된다.

Style Lab은 session ID 대신 signal/`isCancelled`/mode만 검사한다. 또한 settings의 `metadataMode`를 `GenerationParams`에 넣지 않으므로 `strip-and-sidecar` 또는 `sidecar-only` 설정이 preview에 반영되지 않으며 Style save path에는 sidecar 작성도 없다. transport 직후 cancel 검사는 있지만 thumbnail 또는 save await 중 cancel되면 파일/event/preview update가 계속될 수 있다.

Guard 목록은 production source의 조건식·호출 수와 위치 설명을 함께 고정한다. Scene의 dequeue cancel과 fatal requeue는 실제 상태 전이까지 실행하지만, Main/Style의 모든 await 사이에 cancel을 주입하는 exhaustive timing test는 아니다. 따라서 표의 gap은 “안전함을 검증했다”는 뜻이 아니라 현재 guard가 없는 구간을 명시한 것이다.

## Seed와 비결정성

- store 초기 seed, unlocked seed, locked-zero reroll, wildcard 선택은 `Math.random()`에 의존한다.
- Main의 locked nonzero seed는 batch마다 재사용된다. locked zero는 각 batch의 current seed만 reroll하고 store에는 0이 남는다. unlocked zero는 current seed와 next seed에 각각 random을 소비한다.
- Scene과 Style Lab도 locked nonzero seed를 queue item/preview마다 재사용하고 locked zero는 매번 reroll한다. Scene queueCount 2 이상에서 동일 payload/seed가 반복될 수 있다.
- generation seed는 wildcard random을 seed하지 않는다. 같은 fixed seed라도 wildcard 결과가 달라질 수 있다.
- Main/Scene은 seed를 positive wildcard보다 먼저 결정하지만 Style Lab은 rendered positive wildcard 뒤에 seed를 결정한다.
- Scene filename suffix와 history ID는 generation seed와 별개의 `Math.random()`을 쓴다.
- `Date.now()`는 session, history/image ID, Style combination update timestamp와 기본 filename에 쓰인다. runtime history timestamp는 별도의 `new Date()`로 만들어지며 golden에서 제외한다. 고정 clock에서는 여러 Scene/Style output이 같은 filename을 만든다.
- Scene multi-worker는 preset 순서대로 claim하지만 response/save 완료 순서는 transport race에 달려 있다.
- Style combination ID, random combination 선택, tag 순서/weight/evolution도 random에 의존한다. fixture는 주입한 combination ID와 고정 random으로 이 경로를 안정화한다.
- sequential file wildcard는 persisted counter 상태에도 의존하므로 fixture에서는 counter 초기화가 필요하다.

요청된 executable golden은 세 workflow 모두 locked nonzero fixed seed를 사용한다. 위의 unlocked·zero reroll 설명은 현재 source characterization이며 별도 golden scenario가 아니므로, 이후 engine이 그 경로까지 바꿀 때는 sequence-valued random fixture를 추가해야 한다.

## Fixture scenario mapping

| Workflow | Fixture scenario | 고정하는 동작 |
| --- | --- | --- |
| Main | `base-only-non-streaming-fixed-seed` | base-only, non-streaming, locked fixed seed, default params/payload/output/metadata |
| Main | `base-additional-detail-negative-streaming` | positive 순서, comment 제거, global negative, msgpack stream |
| Main | `inpainting-source-forces-non-streaming` | inpainting prompt, source/mask/strength/noise, source 치수, ZIP transport |
| Main | `wildcards-character-positive-negative-manual-position` | positive wildcard, literal global negative wildcard, character 양방향 wildcard, manual coords |
| Main | `generation-preset-applied` | preset parameter 적용과 preset 밖 inpainting/seed 보존 |
| Main | `asset-module-recipe-active` | Main prompt replacement, module character/position, module directory/filename filesystem save, sidecar-only metadata |
| Main | `asset-module-missing-falls-back-to-direct` | missing module direct fallback |
| Scene | `streaming queue-two with scene resolution override` | Main+scene prompt, scene resolution, queue 2, streaming worker 하나, first-active 선택 source contract, fixed duplicate request |
| Scene | `rotation excludes pinned character` | rotation active + `excludePinned`, rotation output folder |
| Scene | `non-streaming-multiple-workers-claim-queue-two` | 두 token worker의 동시 claim/save와 동일 fixed seed |
| Scene | `api-failure-reinserts-queue-item` | fatal HTTP failure의 queue 재삽입과 cleanup gap |
| Scene | `session-cancel-after-dequeue-discards-without-reinsert` | cancel result discard와 dequeue item 손실 |
| Style Lab | `single artist combination` | weighted 단일 artist, wildcard/character/fixed seed, preview/output/metadata |
| Style Lab | `multiple artist combination` | 복수 artist 순서/weight와 여러 preview의 sequential 동작 |
| Style Lab | `filesystemOutput` | auto-save 경로, image/history 수, event data 생략, metadata mode 무시와 embedded PNG metadata |

Style fixture 입력은 `single → multi → single`이지만 ID를 dedupe하므로 실제 요청은 2개다. 현재 golden JSON은 redacted payload summary, prompt parts, final positive/negative, characters/positions, model/steps/CFG/sampler/scheduler/seed, source presence, output policy, metadata, call order와 final queue/store state를 함께 저장한다.

## Redaction 및 비교 시 주의점

runtime의 sent-payload metadata redactor는 image, mask, inline character reference와 vibe bytes를 가리지만 cached reference의 full cache secret은 자체적으로 가리지 않는다. characterization의 `redactedGolden()`이 이를 다시 제거한다. 이후 engine 비교도 raw token, 원본 bytes, 전체 cache key 또는 사용자 절대 경로를 fixture에 기록해서는 안 된다.

`promptParts`와 `finalPositive`는 같은 값이라는 보장이 없다. Main/Scene direct metadata는 raw Main 입력을 보존하고, Style Lab과 Asset Module 활성 경로는 final prompt를 base 하나로 평탄화한다. 비교기는 이 차이를 정규화하거나 숨기지 말고 별도 필드로 비교해야 한다.
