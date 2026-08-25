# V5 Full 작가 태그 혼합 연구

> 상태: A02 전역 순서 모델 성립, A06 역할형 부분 성공·A09 다중 artist 역할 묶음 설계 · 최종 갱신: 2026-08-22

## 연구 질문과 현재 판정

| 질문 | 현재 판정 |
|---|---|
| 작가 태그가 혼합되는가 | 가능. 다만 요소별 합성이 아니라 이미지 전체를 조건화하는 `전역 순서형 혼합`으로 관찰됨 |
| 요소별 작가 귀속이 가능한가 | 완전 격리는 불가능. 다만 `render ... by artist:`가 상단·중단 artist의 얼굴·채색 방향을 유의미하게 편향함 |
| 조합으로 독자적 그림체를 만들 수 있는가 | 유력하나 미확정. 순서 레시피가 여러 장면에서 같은 지문을 보이는지 A04에서 검증해야 함 |

혼합은 단순히 결과가 예쁜지가 아니라 `전역 공존`, `순서별 역할 편향`, `반복성`, `한 작가로의 지배 여부`로 판정한다.

## 공식 근거와 실험 가정

- NovelAI 공식 그림체 가이드는 스타일 태그가 이미지 전체에 영향을 주므로 프롬프트 앞쪽에 두라고 권장하며, 여러 스타일 태그의 조합을 허용한다.
- 구형 `A|B` Prompt Mixing은 공식 문서상 V3 이하 전용이다. V5에서는 쉼표로 나열한 `artist:` 태그와 수치 가중치만 사용한다.
- 기본 품질 태그도 특정 스타일로 밀 수 있으므로 Prompt 프리셋과 UC 프리셋은 기존처럼 `None`으로 유지한다.
- A03 결과, 구조형 섹션명과 `scope` 문장은 작가 태그를 특정 요소에 결박하지 못했다. 이후 작가 태그는 모두 하나의 전역 레시피로 관리한다.
- A06 사용자 실험에서는 `render ... by artist:`가 `like`보다 강했고 얼굴·채색에서 부분 귀속에 성공했다. 이는 공식 동작 보증이 아니라 현재 조건의 경험적 결과다.
- `year 2026`은 하단 장면 모듈에서 모든 분기에 같은 위치와 세기로 유지한다. 이번 실험에서는 시대감 효과를 따로 해석하지 않는다.
- 작가 태그가 자체적으로 색이나 분위기를 움직일 수는 있다. 글로벌 프롬프트에서 이를 미리 지정하지 않고 작가별 누출 효과로 기록한다.
- 현재 작업 가설의 영향 우선순위는 `작가에 대한 모델의 재현 강도 > artist 태그 순서 > 섹션명·scope 자연어`다. 실제 학습 이미지 수는 관측할 수 없으므로, 여기서 재현 강도는 단독 태그의 지배력과 순서를 내려도 남는 전역 영향으로 추정한다.
- 세 번째 태그의 영향은 실제 별도 후보정 단계가 아니라 배경, 팔레트, 광원과 질감의 `후처리처럼 보이는 전역 마감`을 뜻한다.

공식 자료: [NovelAI 그림체 가이드](https://docs.novelai.net/en/image/tutorial-artstyles/), [태그 순서와 연도 태그](https://docs.novelai.net/en/image/tags/), [수치 가중치](https://docs.novelai.net/en/image/strengthening-weakening/), [구형 Prompt Mixing 범위](https://docs.novelai.net/en/image/promptmixing/)

## 고정 조건과 프롬프트 소유권

- 공통 생성값은 [기본 연구 문서](./v5-full-prompting.md)의 832×1216, Steps 28, Guidance 7, Euler Ancestral을 그대로 사용한다.
- Prompt 필드의 `GLOBAL DRAWING METHOD:`는 매체, 선, 엣지, 명암 적층과 브러시 논리처럼 `어떻게 그리는가`를 소유한다.
- 모든 `artist:` 태그는 `GLOBAL DRAWING METHOD:` 안의 단일 `ARTIST RECIPE:`에 순서대로 모은다. 얼굴·의상·배경 섹션이나 Character Prompt에 작가 태그를 분산하지 않는다.
- 같은 필드의 하단 모듈은 인원수, 시대, 구도, 색 구성, 조명, 분위기, 배경과 컷처럼 `무엇을 어떻게 연출하는가`를 소유한다.
- Character Prompt 1은 인물의 정체성, 외형, 의상, 포즈와 소품을 소유한다.
- 현재 A01~A03 증거에서는 Character Position을 사용하지 않았다. A02 순서 비교도 이 조건을 유지해 위치 UI를 새 변수로 만들지 않는다.
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

각 지문은 대표 1장 기준의 임시값이다. A03은 세 작가 모두 범위 밖까지 번진다는 방향성 판정에 사용했고, 세부 지문과 발생률은 독립 Seed가 누적될 때 갱신한다.

## A02 전역 순서형 작가 레시피

현재 작가 태그는 의미상 하위 요소가 아니라 순서가 있는 전역 스타일 스택으로 취급한다.

| 위치 | 우세하게 관찰된 역할 | 해석 한계 |
|---|---|---|
| 첫 번째 | 얼굴 추상화와 전반적인 그림체 | 학습·재현 강도가 큰 후순위 작가가 전역에 계속 남을 수 있음 |
| 두 번째 | 의상, 소품과 미세 설계 | 특정 요소에만 격리되는 것은 아님 |
| 세 번째 | 배경, 팔레트, 광원과 마감 | 실제 후보정 단계가 아니라 그렇게 보이는 시각 효과 |

`FACE STYLE`, `OUTFIT STYLE`, `BACKGROUND STYLE` 같은 의미 라벨은 사용하지 않고 아래처럼 순서만 노출한다.

```text
ARTIST RECIPE:
artist:mika pikazo
artist:neco
artist:lack
```

### A02 순열 관찰과 다음 분기

| 분기 | 작가 순서 | Seed | 관찰 |
|---|---|---:|---|
| A02-MNL | mika pikazo → neco → lack | 2702512718 | Mika형 얼굴·전체 인상, Neco형 의상·기계 세부, Lack형 배경·공기감이 우세 |
| A02-NLM-1 | neco → lack → mika pikazo | 756289163 | Neco형 얼굴, 부드러운 재질 표현, Mika형 고채도 배경·그래픽 마감이 우세 |
| A02-NLM-2 | neco → lack → mika pikazo | 2363705683 | 범위 설명을 서로 뒤바꿔도 NLM-1과 같은 순서 경향이 유지됨 |
| A02-NLM-3 | neco → lack → mika pikazo | 144720563 | 둥글고 평면적인 Neco형 얼굴과 Mika형 고채도 도시 마감이 다시 나타남 |
| A02-LMN | lack → mika pikazo → neco | 1271821360 | NLM보다 부드럽고 성숙한 얼굴·암부, 복합 홍채와 의상 강조, 기하학적 도시 세부가 결합됨 |

MNL, NLM, LMN으로 세 작가가 각 순서를 한 번씩 차지하는 순환 행렬이 완성됐다. NLM은 독립 Seed 세 장에서 첫 태그 특유의 얼굴·전체 인상을 반복했고, LMN으로 첫 태그를 Lack으로 바꾸자 같은 내용 프롬프트에서도 얼굴과 전체 명암이 이동했다. 동시에 Mika의 복합 홍채와 고채도 그래픽 지문은 두 번째나 세 번째에서도 전역에 남았다.

표본 수는 MNL 1장, NLM 3장, LMN 1장으로 균형적이지 않으므로 순서별 발생률까지 추정할 수는 없다. 핵심 순서 효과는 성립한 것으로 판정하고, LMN의 반복성은 A04의 여러 장면·독립 Seed 시험에서 함께 추적한다. 수치 가중치는 그 뒤에만 별도 변수로 다룬다.

### A02 결론: artist 태그를 섞는 규칙

1. 작가 태그는 요소별 재료가 아니라 모두 이미지 전역에 남는 재료다.
2. 얼굴과 기본 그림체로 삼고 싶은 작가를 첫 번째에 둔다.
3. 의상·소품·세부 설계 쪽으로 기울이고 싶은 작가를 두 번째에 둔다.
4. 배경·팔레트·광원·마감 쪽으로 기울이고 싶은 작가를 세 번째에 둔다.
5. 재현 강도가 큰 작가는 후순위로 내려도 전역에서 사라지지 않는다. 전역 노출을 원하지 않는 작가는 순서만으로 격리하지 않는다.
6. 일반 `FACE STYLE`·`scope` 라벨은 사용하지 않는다. 역할 편향이 필요하면 반응이 확인된 얼굴·채색에 한해 `render ... by artist:`를 해당 artist의 순서 자리에 둔다.

현재 pixiv·X형 세련된 서브컬처 일러스트 목표의 우선 A04 후보는 `lack → mika pikazo → neco`다. Lack을 얼굴·전체 명암 앵커로, Mika를 화려한 인물 세부로, Neco를 기하학적 테크 배경·마감 편향으로 사용하는 레시피다.

## A03 요소별 귀속 — 폐기

세 단독 실험은 작가 태그 하나를 서로 다른 구조형 섹션과 `scope` 문장에 배치했다. PNG 메타데이터상 생성값은 모두 V5, 832×1216, Steps 28, Guidance 7, Euler Ancestral, 빈 UC였으며 Character Position은 사용하지 않았다.

| 분기 | 표면상 지정 | Seed | 실제 관찰 | 판정 |
|---|---|---:|---|---|
| A03-F | mika pikazo를 얼굴에만 지정 | 2004992812 | 복합 홍채, 고채도 그래픽 색면과 도시까지 전역 Mika화 | 귀속 실패 |
| A03-O | neco를 의상·소품에만 지정 | 3205679390 | 둥근 얼굴, 검은 덩어리 명암과 평면 도시까지 전역 Neco화 | 귀속 실패 |
| A03-B | lack을 배경에만 지정 | 4096478263 | 성숙한 얼굴, 부드러운 그라데이션과 공기감까지 전역 Lack화 | 귀속 실패 |

세 실험 모두 목표 요소 밖의 얼굴, 색, 명암, 구도와 배경이 함께 이동했다. 따라서 일반 `scope` 지시는 지역 마스크처럼 작동하지 않는다. A06에서 더 구체적인 관계형 문법이 부분 성공했으므로, 완전 격리 실패와 목표 축 편향 가능성을 구분한다.

## A06 `render ... by artist:` 역할형 귀속 — 부분 성공

사용자 실험에서 `render` 관계형은 작동했고 같은 대상에서 `by`가 `like`보다 강했다. 다만 artist 순서와 지정 축에 따라 결과가 달라졌다.

| 지정 | 상단·중단 artist | 하단 artist | 현재 용도 |
|---|---|---|---|
| `render facial features by` | 효과 확실 | 아직 일반화 보류 | 얼굴 조형 편향 |
| `render coloring by` | 효과 확실 | 약함. 머리카락에는 영향 미확인 | 인물·의상 채색 편향 |
| `render background by` | 배경 생성은 확실 | 없던 배경이 생기나 전체 조합 화풍으로 렌더링 | 특정 artist 귀속에는 사용하지 않음 |
| `render linework by` | 효과 미미 | 효과 미미 | 사용 보류 |
| `render light and shadow by` | 효과 미미 | 효과 미미 | 사용 보류 |

현재 운영 레시피는 순서 편향과 역할 편향을 같은 방향으로 맞춘다.

```text
ARTIST RECIPE:
render facial features by artist:<첫 번째 작가>
render coloring by artist:<두 번째 작가>
artist:<세 번째 작가>

SCENE RENDERING:
render background
```

이는 각 작가를 해당 요소에 가두는 문법이 아니다. 첫째·둘째 artist가 이미 강하게 접근하는 인물 영역에서 얼굴·채색 방향을 보강한다. 셋째 artist는 직접 태그로 유지한다. 위 `render background`는 결합문에서 관찰된 배경 생성 효과를 artist 이름과 분리하기 위한 A08 후보이며 아직 단독 유효성이 확정되지 않았다. 생성된 배경의 화풍은 특정 셋째 artist가 아니라 전체 artist 조합을 따랐다. 선화와 명암은 artist 역할 문구 대신 직접적인 선 굵기·필압·그림자 경계·광원 방향 문장으로 관리한다.

## A09 다중 artist 역할 묶음 — 설계

21개 artist의 개별 숫자 가중치를 모두 제거하고, 한 렌더링 축의 `by` 뒤에 여러 이름을 병렬로 배치한다. 기존 단일 artist 역할에서 확인한 결과를 여러 artist 목록에 바로 일반화하지 않는다. 쉼표 뒤 이름이 전역 태그로 풀리는 것을 줄이기 위해 마지막 이름 앞에 `and`를 둔 자연어 목록을 우선 시험한다.

- 역할 앵커 7개는 기존 지정 대상을 유지한다.
- 나머지 artist의 슬롯 배치는 원래 상대 순서를 보존한 탐색 후보이며 화풍에 대한 사실 분류가 아니다.
- 각 artist는 전체 레시피에서 한 번만 사용한다.
- 선화·빛과 그림자는 이전 실험상 약한 축이므로 실패해도 다중 묶음 전체를 폐기하지 않는다.
- 하단·최하단 artist는 특정 부위 귀속보다 전역 마감과 스타일 모드 변화로 평가한다.

정확한 A09-F 평면 기준선과 A09-G 묶음 입력은 [기본 연구 문서](./v5-full-prompting.md)의 A09 절을 단일 출처로 사용한다.

## A04 독자적 그림체 판정

1. A02에서 가장 반복성이 높은 작가 순서 레시피 하나를 고른다.
2. 옥상, 주간 실내, 자연광 야외의 세 장면에서 같은 조합을 독립 Seed 2개씩 생성한다.
3. 반복되는 얼굴 추상화, 선·엣지, 명암 적층, 브러시 질감과 세부 위계를 작가명 없는 `STYLE_FINGERPRINT` 문장으로 기록한다. 색, 조명, 분위기와 구도는 제외한다.
4. 작가 태그를 제거하고 지문만 사용해 같은 세 장면을 다시 생성한다.

지문 단독 결과가 조합의 특징을 유지하면 독자적이고 이식 가능한 그림체로 채택한다. 작가를 제거하자 기본 V5 그림체로 돌아가면 순서 레시피는 유효하지만 아직 독립된 스타일 문법으로 추출되지 않은 것이다.

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
