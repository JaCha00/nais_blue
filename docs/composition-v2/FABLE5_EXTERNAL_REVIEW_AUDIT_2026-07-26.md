# Fable 5 외부 리뷰 대조 감사 기록

기준일: 2026-07-26 (Asia/Seoul)

## 범위와 전제

- 입력은 사용자가 제공한 `전체 로그.txt`와 `nais_blue 분석 보고서`다. 두 파일은 현재 저장소의 규범 문서가 아니다.
- 리뷰어가 비교한 별도 개조 프로젝트의 source는 제공되지 않았으므로 “우리 구현보다 낫다/다르다”는 비교 결론은 검증하지 않았다.
- 현재 E-drive runtime, 도달 가능한 UI, freshly passing tests와 실제 2.11.1 release 증거를 우선했다.
- 정적 payload parity는 요청 구조의 회귀를 막지만 NovelAI production 성공 자체를 증명하지 않는다. Live test는 별도 opt-in이다.

## 동의하며 바로 고친 항목

| 리뷰 지적 | 현재 판정 | 조치 |
| --- | --- | --- |
| Tab/Shift+Tab이 페이지 이동에 쓰여 폼 포커스를 막는다 | 동의. 전역 기본 바인딩이 실제로 unmodified Tab이었다. | Native Tab traversal을 항상 보존하고 페이지 순환을 Ctrl+PageDown/PageUp으로 옮겼다. 기존 persisted Tab 기본값도 hydration에서 승격한다. |
| `/asset-modules` route가 없는데 버튼이 이동한다 | 동의. standalone studio를 퇴역시킨 뒤 Main/Scene/Guidance caller가 남았다. | 존재하지 않는 route를 호출하는 edit/repair affordance를 제거하고 R2 안내 CTA는 실제 `/r2`로 연결했다. 읽기 전용 module/plan 검사는 유지한다. |
| toast limit 1 때문에 연속 알림이 사라진다 | 동의. reducer가 최신 한 건만 보존했다. | 화면을 덮지 않는 범위에서 최근 3건을 보존하도록 변경했다. |
| WD Tagger가 현재 UI 기능처럼 설명되지만 front-end 호출이 없다 | 동의. 분석 UI는 Kaloscope만 호출하면서 locale 문구는 WD Tagger도 사용한다고 표시했다. | 세 locale을 실제 동작인 online Kaloscope와 외부 가용성 경계에 맞게 수정했다. Sidecar 자체는 Danbooru 검증 등 다른 caller가 있어 제거하지 않았다. |
| 원격 Kaloscope 의존은 가용성 위험이다 | 동의. 로컬 ONNX 실행이 아니다. | UI 설명에서 인터넷과 외부 서비스 의존성을 숨기지 않도록 했다. |

## 부분 동의 또는 시점이 지난 항목

| 리뷰 주장 | 대조 결과 |
| --- | --- |
| Composition v2가 꺼져 있어 legacy만 돈다 | Fresh production authority가 fail-closed `legacy`인 것은 사실이다. 그러나 v2 engine/repository/adapters가 “안 돌아가는 코드”인 것은 아니다. 명시적 verified activation과 test fixture에서는 v2가 실행되며, production cutover는 online matrix·rollback 관측을 요구하는 별도 안전 gate다. 리뷰는 UX/authority 불일치를 정확히 짚었지만 강제 기본 전환은 현재 근거보다 위험하다. |
| Scene module stack/inspector가 렌더되지만 보이지 않는다 | `simplified`는 제품 표면에서 내부 rollout UI를 숨기는 명시적 계약이다. 따라서 숨김 자체는 렌더 버그가 아니다. 다만 퇴역 route callback까지 전달하던 드리프트는 사실이어서 제거했다. |
| undo/redo 구현 후 UI가 없다 | 서비스와 테스트는 존재하지만 standalone authoring studio route가 퇴역해 production UI caller가 없다. 지적에 동의한다. 현재 앱이 이 기능을 제공한다고 문서화하지 않도록 아키텍처 문서를 바로잡았고, 불완전한 편집기를 다시 노출하지 않았다. |
| Android 동기화는 BLOCKED/미완성이다 | 리뷰 시점보다 진행됐다. Hiby signed 2.11.1에서 USB tunnel을 통한 실제 native TLS/preset push가 통과했다. 다만 tunnel 없는 Private LAN QR pairing은 invitation 만료로 수동 1회가 남아 있으므로 “완료”도 아니다. 현재 판정은 session-only 제한 프리뷰다. |
| 캐릭터 레퍼런스가 작동한다 | payload builder, 이미지 정규화와 parity 검증이 존재한다는 데 동의한다. 하지만 synthetic/web-fixture parity만으로 provider end-to-end 성공을 단정할 수 없다. NAI credential opt-in live case가 최종 증거다. |
| 2.11.0 기준 기능/릴리스 상태 | 보고서 이후 2.11.1이 main/tag/public release에 배포됐다. 릴리스 및 backup restore 관련 평가는 일부 낡았다. |

## 반박 가능하거나 품질 판정에 쓰지 않은 항목

- `AGENTS.md`와 문서량만으로 “사실상 AI가 대량 생산한 코드”라고 확정할 수 없다. 설령 도구를 사용했더라도 결함 판정은 caller, runtime behavior와 test evidence로 해야 한다.
- star/fork 수와 한 달간의 release 속도는 채택도 정보일 뿐 코드 정확성이나 UX 완성도의 증거가 아니다.
- 정적 전수조사만으로 각 기능에 `완성`을 부여한 표는 과신이다. 예를 들어 live NAI matrix는 credential opt-in이고 기본 test run에서는 skip된다.
- GPL 경고는 비교 프로젝트가 NAIS 코드를 복사할 때의 별도 라이선스 판단이며 NAIS 앱 결함이 아니다. 이 감사에서는 법적 결론을 내리지 않았다.
- 리뷰의 “우리 생성기에 합칠 우선순위”는 source가 없는 별도 프로젝트의 backlog다. NAIS의 수정 우선순위로 역수입하지 않았다.

## 이미 현재 앱에 존재해 새 작업이 아닌 제안

- msgpack streaming preview와 중간 step throttling
- 캐릭터 레퍼런스 payload 구조와 fidelity 반전
- Variety+ 해상도 비례 sigma 공식
- `qualityToggle`/`ucPreset` metadata 역추론
- 생성/취소 단일 액션, 진행 상태, 낮은 steps 경고와 복원 CTA
- 휴지통 기반 삭제, Data Hub 대량 metadata, Agent Workspace

## 남은 검증 순서

1. Hiby에서 fresh QR을 즉시 scan해 tunnel 없는 Private LAN preset push를 1회 확인한다.
2. 사용자가 기기에 NAI token을 직접 입력한 뒤 character reference 포함 live generation을 실행한다. Token은 로그나 채팅에 기록하지 않는다.
3. Composition v2 production cutover는 위 실기기 결과만으로 열지 않는다. supported online matrix, signed rollback drill과 한 release observation window를 함께 충족할 때 별도 결정한다.
4. WD `/tag` endpoint와 model packaging 제거는 Danbooru verifier/postprocess sidecar 의존을 분리한 뒤 수행한다.
