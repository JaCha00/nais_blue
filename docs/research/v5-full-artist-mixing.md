# V5 Full 작가 태그 혼합 연구

> 상태: A01 독립 Seed 탐색 완료, 반복성 확인 대기 · 최종 갱신: 2026-08-21

## 연구 질문과 판정

| 질문 | 성공 판정 |
|---|---|
| 작가 태그가 혼합되는가 | 같은 이미지 안에 두 단독 지문의 특징이 함께 나타나고, Seed가 바뀌어도 한 작가로만 번갈아 이동하지 않음 |
| 요소별 작가 귀속이 가능한가 | 작가 배치를 서로 바꿨을 때 목표 요소만 대응해 바뀌고 얼굴·의상·배경 사이의 누출이 제한됨 |
| 조합으로 독자적 그림체를 만들 수 있는가 | 세 장면에서 같은 혼합 지문이 반복되고, 작가명을 제거한 서술형 지문으로도 주요 특징을 재현함 |

혼합은 단순히 결과가 예쁜지가 아니라 `동시 공존`, `반복성`, `부모 작가 중 하나로의 모드 전환 여부`로 판정한다.

## 공식 근거와 실험 가정

- NovelAI 공식 그림체 가이드는 스타일 태그가 이미지 전체에 영향을 주므로 프롬프트 앞쪽에 두라고 권장하며, 여러 스타일 태그의 조합을 허용한다.
- 구형 `A|B` Prompt Mixing은 공식 문서상 V3 이하 전용이다. V5에서는 쉼표로 나열한 `artist:` 태그와 수치 가중치만 사용한다.
- 기본 품질 태그도 특정 스타일로 밀 수 있으므로 Prompt 프리셋과 UC 프리셋은 기존처럼 `None`으로 유지한다.
- 작가 태그의 요소별 적용은 공식 지역 제어 기능으로 확인되지 않았다. 구조형 자연어와 캐릭터 프롬프트 경계가 만드는 귀속 정도를 실험한다.
- `year 2026`은 하단 장면 모듈에서 모든 분기에 같은 위치와 세기로 유지한다. 이번 실험에서는 시대감 효과를 따로 해석하지 않는다.
- 작가 태그가 자체적으로 색이나 분위기를 움직일 수는 있다. 글로벌 프롬프트에서 이를 미리 지정하지 않고 작가별 누출 효과로 기록한다.

공식 자료: [NovelAI 그림체 가이드](https://docs.novelai.net/en/image/tutorial-artstyles/), [태그 순서와 연도 태그](https://docs.novelai.net/en/image/tags/), [수치 가중치](https://docs.novelai.net/en/image/strengthening-weakening/), [구형 Prompt Mixing 범위](https://docs.novelai.net/en/image/promptmixing/)

## 고정 조건과 프롬프트 소유권

- 공통 생성값은 [기본 연구 문서](./v5-full-prompting.md)의 832×1216, Steps 28, Guidance 7, Euler Ancestral을 그대로 사용한다.
- Prompt 필드의 `GLOBAL DRAWING METHOD:`는 매체, 선, 엣지, 명암 적층과 브러시 논리처럼 `어떻게 그리는가`만 소유한다.
- 같은 필드의 하단 모듈은 인원수, 시대, 구도, 색 구성, 조명, 분위기, 배경과 컷처럼 `무엇을 어떻게 연출하는가`를 소유한다.
- Character Prompt 1은 인물의 정체성, 외형, 의상, 포즈와 소품을 소유한다.
- 첫 A01~A03 비교에서는 Character Position을 화면 `x=0.46, y=0.52` 부근으로 고정한다.
- 장면 모듈은 위나 아래 중 한 곳에만 둔다. A01~A03은 공식 권장에 맞춰 글로벌 프롬프트를 먼저, 장면 모듈을 하단에 둔다.
- 각 분기는 서로 다른 무작위 Seed로 최소 2장을 생성한다. 한 작가 안에서도 결과 모드가 갈리면 4장까지 확장한다.
- Seed는 분기 사이에 맞추지 않는다. 픽셀·구도 일치가 아니라 반복되는 스타일 지문, 발생률과 변동성을 비교한다.
- 수동 UC는 비운다.

## 새 목표 캐릭터와 시각 가설

`월면 특송원`은 이전의 단발 인디고 머리·트렌치코트 인물과 겹치지 않는 성인 여성 OC다.

- 긴 흑발의 높은 사이드 포니테일, 시안색 언더다이, 적안, 왼쪽 눈 아래 작은 점
- 하이넥 슬리브리스의 검은 치파오형 테크웨어, 비대칭 시안 회로 자수와 마젠타 안감
- 은색 기계식 머리핀, 검은 장갑, 투명 홀로그램 배송 케이스
- 낮은 시점의 역동적인 3/4 구도, 청색 시간대의 미래 도시 옥상과 큰 달

치파오, 하이넥 슬리브리스, 흑발·적안과 극적인 원근은 2025년 pixiv 공식 인기 기사에서 반복된 시각 훅을 조합한 것이다. 실제 pixiv·X 인기도는 결과 이미지로 별도 평가한다.

참고 자료: [pixivision 2025 연간 인기 기사](https://www.pixivision.net/en/a/11393), [2025년 10월 인기 기사](https://www.pixivision.net/en/a/11160)

## 캐릭터 세분화 규칙

- 머리카락은 `전체 실루엣·기본색`, `앞머리`, `옆머리`, `뒷머리`, `보조색`까지만 나눈다.
- 눈은 `눈매`, `윗눈매·아이라인`, `홍채 구조`, `홍채 색`, `대표 하이라이트`까지만 나눈다.
- 얼굴은 얼굴형, 눈썹과 비대칭 표식처럼 축소 이미지에서도 인상을 바꾸는 항목만 둔다.
- 의상은 실루엣, 목선, 주재료, 주색·보조색과 대표 장식만 둔다. 화면에 나오지 않는 봉제선이나 부속은 생략한다.
- 한 하위 항목은 하나의 시각 결정을 소유한다. 색·형태·재료를 한 문장에 과도하게 결합하지 않는다.
- 브러시, 선 굵기, 엣지와 명암 방식은 캐릭터 프롬프트에 반복하지 않고 글로벌 그리기 방식이 소유한다.

우선순위는 `머리 실루엣 → 눈매와 홍채 → 얼굴 표식 → 의상 실루엣 → 소품`이다. 결과에서 구분되지 않는 세부 항목은 더 늘리지 않고 제거한다.

캐릭터 이행은 `머리 전체·앞·옆·뒤·언더다이`, `눈매·윗눈매·홍채·색`, `얼굴 표식`, `의상 실루엣·색`, `대표 소품`을 각각 `성공·부분·실패`로 기록한다. 작가 지문 평가는 이 이행표와 분리한다.

## 작가 후보

| 기호 | 정확한 태그 | 구분하려는 후보 지문 |
|---|---|---|
| A | `artist:mika pikazo` | 고채도 색면과 그래픽 강조 |
| B | `artist:neco` | 날카로운 선과 테크웨어 실루엣 |
| C | `artist:lack` | 회화적인 광원과 재질·공기감 |

표의 지문은 결과가 아니라 작가를 고른 이유다. 공식 UI 자동완성의 정확한 태그와 인지도 표시를 먼저 확인하고, 단독 결과에서 실제 지문을 다시 정의한다.

## A01 입력 템플릿

아래는 A01-A용 기본 Prompt다. 다른 분기에서는 작가 한 줄만 삭제하거나 교체한다.

```text
GLOBAL DRAWING METHOD:
artist influence: artist:mika pikazo
medium: digital illustration
linework: clean deliberate linework with controlled varied line weight
shading: layered cel shading with restrained soft blending
edge control: crisp hard edges on focal details and softer edges on secondary forms
finish consistency: one coherent brush and rendering logic across face, costume, props, and environment

SCENE STRUCTURE:
subject: 1girl, solo, original
era: year 2026
detail density: high complexity
spatial depth: depthness
framing: portrait key visual, cowboy shot
camera: dramatic low-angle three-quarter view
placement: the character stands slightly left of center as the only focal point
silhouette: strong and immediately readable

COLOR AND ATMOSPHERE:
base palette: deep black and charcoal
accent palette: vivid cyan and magenta
color separation: the character remains clearly separated from the environment
lighting: cool moonlight with cyan and magenta city bounce light
mood: electric but calm nocturnal atmosphere

BACKGROUND:
location: a blue-hour rooftop above a dense futuristic city
far background: luminous signs far below and a huge pale moon behind thin clouds
atmospheric motion: holographic delivery slips moving in the wind
depth arrangement: clear foreground, middle ground, and distant city layers

FORMAT:
canvas use: the artwork fills the entire canvas
panel layout: one uninterrupted full-bleed illustration
```

Character Prompt 1:

```text
IDENTITY:
role: young adult woman, lunar courier
identity anchors: high side ponytail, scarlet eyes, left-eye beauty mark, qipao-shaped techwear

FACE:
shape: slender oval face with a slightly pointed chin
eyebrows: straight dark eyebrows
signature mark: one small beauty mark directly below her left eye

HAIR:
base color: deep black
overall silhouette: sleek weighty hair with a high side ponytail tied on her right side
front hair: soft center-parted bangs with one thin curved strand between the eyes
side hair: two clean face-framing sidelocks ending near the jaw
back hair: one thick ponytail falling diagonally behind her right shoulder
secondary color: cyan underdye visible only on the inner lower half and tips

EYES:
eye shape: slender almond-shaped eyes with slightly raised outer corners
upper eye line: pronounced upper eyelid line ending in a short sharp outer wing
lower eye line: minimal lower eyelash line
iris structure: medium round irises with a crisp dark outer ring and small pupils
iris color: deep scarlet red with a subtle orange inner gradient
catchlight: one small diamond-shaped catchlight in each eye

OUTFIT:
silhouette: fitted qipao-inspired techwear dress with a clean asymmetric hem
neckline and sleeves: high neck and sleeveless shoulders
material: matte black technical fabric
base color: black
accent detail: cyan circuit embroidery along one side
inner lining: small flashes of magenta visible only at moving edges

ACCESSORIES AND PROP:
hair accessory: one silver mechanical hairpin securing the ponytail
handwear: fitted black gloves
main prop: one rectangular transparent holographic courier case with a cyan rim

ACTION AND EXPRESSION:
body action: turning toward the viewer while stepping onto a rooftop ledge
leg pose: one knee bent
hand action: holding the courier case in one hand
gaze: looking toward the viewer
expression: calm confident half-smile
```

### A01 단독 지문 분기

| 분기 | 글로벌 그리기 방식의 작가 줄 |
|---|---|
| A01-0 | 작가 줄 삭제 |
| A01-A | `artist:mika pikazo` |
| A01-B | `artist:neco` |
| A01-C | `artist:lack` |

얼굴·눈, 선화, 채색·명암, 의상·재질, 광원, 배경·구도를 작가별 지문으로 기록한다. 한 작가가 두 Seed에서 전혀 다른 모드로 나오면 혼합 후보에서 제외하거나 더 많은 반복으로 보류한다.

### A01 독립 Seed 탐색 관찰

- PNG 메타데이터는 네 결과 모두 V5, 832×1216, Steps 28, Guidance 7, Euler Ancestral, 빈 UC와 동일한 기본·캐릭터 프롬프트를 사용했음을 확인한다.
- Character Position은 비활성화되어 있었다. 화면 배치는 좌표가 아니라 `SCENE STRUCTURE:`의 자연어만으로 형성됐다.
- 네 결과 모두 검은 사이드 포니테일, 시안 보조색, 적안, 검은 치파오형 테크웨어, 시안 회로, 마젠타 안감, 장갑, 투명 케이스, 굽힌 무릎, 미래 도시·달·날리는 전표를 유지했다. 세부 구조가 작가 태그가 바뀌어도 큰 의미 앵커를 보존했다.
- 앞·옆·뒷머리의 정확한 분리, 시안 언더다이의 노출 위치, 점의 방향·개수와 다이아몬드 캐치라이트는 불안정했다. `sleeveless`는 mika pikazo 결과에서만 명확하고 나머지는 긴소매에 가깝다.
- 작가 태그는 그리는 방식에만 머물지 않았다. 얼굴 구조, 의상 해석, 색 포화도, 배경 밀도와 광원까지 함께 움직여 전역 누출이 확인됐다.

| 분기 | Seed | 임시 단독 지문 |
|---|---:|---|
| A01-0 | 1517025908 | 가장 중립적인 현대 애니메이션형 얼굴, 균일한 어두운 윤곽, 정돈된 셀 명암, 선명한 회로·케이스와 안정적인 도시 배경 |
| A01-A | 1457696876 | 큰 복합 홍채와 날카로운 눈 장식, 매우 높은 청·시안·마젠타 포화도, 그래픽 색면, 역동적 근접 구도와 프리즘형 케이스 |
| A01-B | 3052486526 | 둥글고 어린 얼굴, 각진 테크웨어와 기계적 얼굴 표식, 큰 검은 명암 면, 평면적인 화면·도시 그래픽과 강한 흑백 대비 |
| A01-C | 3932814009 | 길고 성숙한 얼굴과 좁은 눈, 부드러운 선·그라데이션, 천의 완만한 입체감, 청록 안개와 가장 강한 대기 원근 |

각 지문은 대표 1장 기준의 임시값이다. 같은 작가의 독립 Seed 결과에서 반복되는 항목만 A02·A03의 판정 기준으로 승격한다.

## A02 전역 혼합

A01에서 가장 선명하고 상보적인 두 작가를 선택한다. 기본 후보는 A와 B다.

| 분기 | 글로벌 작가 줄 | 목적 |
|---|---|---|
| A02-AB | `artist:mika pikazo, artist:neco` | 무가중 혼합 |
| A02-BA | `artist:neco, artist:mika pikazo` | 순서 효과 |
| A02-A12B08 | `1.2::artist:mika pikazo ::, 0.8::artist:neco ::` | A 우세 혼합 |
| A02-A08B12 | `0.8::artist:mika pikazo ::, 1.2::artist:neco ::` | B 우세 혼합 |

두 작가가 한 이미지 안에서 공존하는지, 한 작가가 다른 작가를 덮는지, Seed마다 A형과 B형으로 번갈아 갈 뿐인지 구분한다. 가중치는 `3`을 넘기지 않는다.

## A03 요소별 귀속

한 번에 작가 하나와 범위 하나만 추가한다. `GLOBAL DRAWING METHOD:`에서는 모든 작가 태그를 제거하고 공통 그리기 방식은 유지한다. 각 분기는 독립 Seed로 최소 2장 생성한다.

### A03-F 얼굴 단독

Character Prompt의 `FACE:` 바로 위에 추가한다.

```text
FACE STYLE:
artist influence: artist:mika pikazo
scope: face shape, eyebrows, eyes, irises, and facial mark only
```

### A03-O 의상·소품 단독

Character Prompt의 `OUTFIT:` 바로 위에 추가한다.

```text
OUTFIT STYLE:
artist influence: artist:neco
scope: clothing, fabric, embroidery, gloves, hairpin, and courier case only
```

### A03-B 배경 단독

기본 Prompt의 `BACKGROUND:` 바로 아래에 추가한다.

```text
BACKGROUND STYLE:
artist influence: artist:lack
scope: rooftop, city, sky, moon, delivery slips, and environmental lighting only
```

각 단독 분기에서 목표 요소에 A01의 해당 지문이 반복되고 비목표 요소에는 나타나지 않아야 귀속 성공이다. 전체 이미지가 함께 이동하면 전역 누출, 지문 자체가 나타나지 않으면 범위 지시가 작가 태그를 약화한 것으로 판정한다. 세 단독 분기가 통과한 뒤에만 한 Prompt에서 결합한다.

## A04 독자적 그림체 판정

1. A02에서 가장 반복성이 높은 조합과 비율을 하나 고른다.
2. 옥상, 주간 실내, 자연광 야외의 세 장면에서 같은 조합을 독립 Seed 2개씩 생성한다.
3. 반복되는 얼굴 추상화, 선·엣지, 명암 적층, 브러시 질감과 세부 위계를 작가명 없는 `STYLE_FINGERPRINT` 문장으로 기록한다. 색, 조명, 분위기와 구도는 제외한다.
4. 작가 태그를 제거하고 지문만 사용해 같은 세 장면을 다시 생성한다.

지문 단독 결과가 조합의 특징을 유지하면 독자적이고 이식 가능한 그림체로 채택한다. 작가를 제거하자 기본 V5 그림체로 돌아가면 조합은 유효하지만 아직 독립된 스타일 문법으로 추출되지 않은 것이다.

## 컷·상하단 배치 후속 모듈

작가 조합이 확정되기 전에는 컷 구성을 넣지 않는다. 이후 `FORMAT:`만 아래 문장으로 교체한다.

```text
FORMAT:
one full-bleed main illustration with one small borderless eye close-up inset at the upper right,
the main character and background remain continuous and the artwork fills the entire canvas
```

배치 비교에서는 `SCENE STRUCTURE:`부터 `FORMAT:`까지의 하단 모듈 전체를 `GLOBAL DRAWING METHOD:` 위 또는 아래로 이동하며 내용은 수정하지 않는다.

## 결과 기록

| ID | Seed | 얼굴 추상화 | 선·엣지 | 명암 적층 | 질감·세부 위계 | 색·분위기 누출 | 지배·공존·전환 | 결정 |
|---|---|---|---|---|---|---|---|---|
| A01-0 | 1517025908 | 중립적 현대 애니메이션형 | 균일하고 선명함 | 정돈된 셀 명암 | 회로·케이스 우선 | 지정 팔레트 안에서 안정적 | 기준선 | 채택 |
| A01-A | 1457696876 | 큰 복합 홍채와 눈 장식 | 날카롭고 그래픽함 | 고대비 색면 | 눈·케이스 장식 우선 | 고채도 청·시안·마젠타 전역 확장 | 전역 영향 | 반복 대기 |
| A01-B | 3052486526 | 둥글고 어린 얼굴 | 각지고 검은 면이 큼 | 평면·덩어리 명암 | 테크웨어·기계 표식 우선 | 흑백·시안 그래픽 전역 확장 | 전역 영향 | 반복 대기 |
| A01-C | 3932814009 | 길고 성숙한 얼굴 | 부드럽고 가늘음 | 회화적 그라데이션 | 천·공기감 우선 | 청록 안개·대기 원근 전역 확장 | 전역 영향 | 반복 대기 |
