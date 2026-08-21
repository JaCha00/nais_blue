# V5 Full 작가 태그 혼합 연구

> 상태: A01 단독 작가 지문 실험 준비 · 최종 갱신: 2026-08-21

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
- 각 분기는 같은 Seed 2개로 최소 2장을 생성한다. 수동 UC는 비운다.

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
artist:mika pikazo,
digital illustration,
clean deliberate linework, controlled varied line weight,
layered cel shading with restrained soft blending,
coherent hard-and-soft edge hierarchy,
consistent brush logic across face, costume, props, and environment

SUBJECT COUNT:
1girl, solo, original

ERA:
year 2026

DETAIL AND DEPTH:
high complexity, depthness

COMPOSITION:
portrait key visual, cowboy shot, dramatic low-angle three-quarter view,
the character stands slightly left of center as one clear focal point,
strong readable silhouette

COLOR SCRIPT:
deep black and charcoal base,
vivid cyan and magenta accents,
the character colors remain distinct from the environment

LIGHTING AND MOOD:
cool moonlight, cyan and magenta city bounce light,
electric but calm nocturnal atmosphere

BACKGROUND:
blue-hour rooftop above a dense futuristic city,
luminous signs far below, a huge pale moon behind thin clouds,
windblown holographic delivery slips, strong foreground-to-background depth

FORMAT:
one uninterrupted full-bleed illustration occupying the entire canvas
```

Character Prompt 1:

```text
IDENTITY:
young adult woman, lunar courier

FACE:
slender oval face with a slightly pointed chin,
straight dark eyebrows,
small beauty mark directly below her left eye

HAIR OVERALL:
deep black hair with a sleek, weighty silhouette,
high side ponytail tied on her right side,
cyan underdye visible only on the inner layer

HAIR FRONT:
soft center-parted bangs,
one thin curved strand between the eyes

HAIR SIDES:
two clean face-framing sidelocks ending near the jaw

HAIR BACK:
one thick ponytail falling diagonally behind her right shoulder,
cyan inner layer visible near the lower half and tips

EYES SHAPE:
slender almond-shaped eyes with slightly raised outer corners

EYES LINE:
clean pronounced upper eyelid line with a short sharp outer wing,
minimal lower eyelash line

EYES IRIS:
medium-sized round irises with a crisp dark outer ring and small pupils,
deep scarlet red irises with a subtle orange inner gradient,
one small diamond-shaped catchlight in each eye

OUTFIT SILHOUETTE:
fitted high-neck sleeveless qipao-inspired techwear dress,
clean asymmetric hem visible within the cowboy shot

OUTFIT MATERIAL AND COLOR:
matte black technical fabric,
cyan circuit embroidery along one side,
small flashes of magenta inner lining at moving edges

ACCESSORIES AND PROP:
one silver mechanical hairpin securing the ponytail,
fitted black gloves,
rectangular transparent holographic courier case with a cyan rim

ACTION:
turning toward the viewer while stepping onto a rooftop ledge,
one knee bent, holding a transparent holographic courier case,
calm confident half-smile
```

### A01 단독 지문 분기

| 분기 | 글로벌 그리기 방식의 작가 줄 |
|---|---|
| A01-0 | 작가 줄 삭제 |
| A01-A | `artist:mika pikazo` |
| A01-B | `artist:neco` |
| A01-C | `artist:lack` |

얼굴·눈, 선화, 채색·명암, 의상·재질, 광원, 배경·구도를 작가별 지문으로 기록한다. 한 작가가 두 Seed에서 전혀 다른 모드로 나오면 혼합 후보에서 제외하거나 더 많은 반복으로 보류한다.

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

먼저 Character Prompt와 글로벌 배경 사이의 거친 귀속을 시험하고, 통과할 때만 얼굴과 의상의 미세 귀속을 시험한다.

### A03-C 거친 귀속

- Character Prompt 맨 위: `CHARACTER STYLE: Render the character only with artist:mika pikazo and artist:neco.`
- 기본 Prompt의 `BACKGROUND:` 맨 위: `BACKGROUND STYLE: Render only the environment and lighting with artist:lack.`
- `GLOBAL DRAWING METHOD:`에서는 모든 작가 태그를 제거하고 공통 그리기 방식은 유지한다.

### A03-F 미세 귀속

Character Prompt 맨 위에 다음을 추가한다.

```text
FACE STYLE:
Apply artist:mika pikazo only to the face, eyes, and hair rendering.

COSTUME STYLE:
Apply artist:neco only to the clothing, accessories, and courier case rendering.
```

A03-S에서는 두 작가를 서로 바꾼다. 얼굴과 의상이 함께 바뀌거나 배경까지 따라 바뀌면 요소별 귀속이 아니라 전역 누출로 판정한다.

## A04 독자적 그림체 판정

1. A02에서 가장 반복성이 높은 조합과 비율을 하나 고른다.
2. 옥상, 주간 실내, 자연광 야외의 세 장면에서 같은 조합을 Seed 2개씩 생성한다.
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

배치 비교에서는 `SUBJECT COUNT:`부터 `FORMAT:`까지의 하단 모듈 전체를 `GLOBAL DRAWING METHOD:` 위 또는 아래로 이동하며 내용은 수정하지 않는다.

## 결과 기록

| ID | Seed | 얼굴 추상화 | 선·엣지 | 명암 적층 | 질감·세부 위계 | 색·분위기 누출 | 지배·공존·전환 | 결정 |
|---|---|---|---|---|---|---|---|---|
| A01-0 | - | - | - | - | - | - | - | 미실행 |
| A01-A | - | - | - | - | - | - | - | 미실행 |
| A01-B | - | - | - | - | - | - | - | 미실행 |
| A01-C | - | - | - | - | - | - | - | 미실행 |
