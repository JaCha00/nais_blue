# ADR-001: Modular Monolith 경계와 Runtime 주입

- 상태: 채택
- 날짜: 2026-07-29

## 배경

생성·Queue 경로가 Zustand store, UI, NovelAI 전송, 파일 저장을 직접 연결하고 있어 새 Matrix 기능을 같은 방식으로 추가하면 실행기가 다시 복제됩니다. 특히 `services/queue/runtime.ts`가 Auth store를 직접 읽어 Queue 서비스가 Presentation 상태에 종속돼 있었습니다.

## 결정

다음 의존 방향을 목표 구조로 채택합니다.

```text
Presentation -> Application -> Domain
Adapters -----> Application ports / Domain
Composition Root -> 모든 구체 구현
```

현재 코드를 한 번에 이동하지 않고 다음 규칙으로 점진 전환합니다.

1. 신규 Application 포트는 `src/application/**`에 둡니다.
2. Store와 서비스의 연결은 `src/composition-root/**`에서만 조립합니다.
3. 기존 경계 위반은 `.dependency-cruiser-known-violations.json`에 고정하고, 새 위반만 CI에서 실패시킵니다.
4. 기준선 파일은 부채가 해소될 때 항목을 삭제하며, 새 위반을 숨기기 위해 전체 재생성하지 않습니다.
5. Presentation의 Tauri 직접 import는 `.dependency-cruiser-presentation-tauri-baseline.json`의 파일·패키지 쌍으로 동결합니다. 신규 UI 파일은 platform adapter 없이 Tauri를 import할 수 없고, 기존 항목을 이전하면 같은 변경에서 baseline을 줄입니다.

첫 적용으로 Queue Runtime은 `QueueTokenProvider` 포트만 의존하고, Composition Root가 Auth store의 활성 토큰을 실행 슬롯으로 투영합니다. 토큰은 여전히 Job·로그·진단에 저장되지 않습니다.

## 결과

- Queue 서비스의 Zustand 직접 import가 제거됩니다.
- 런타임 의존성을 테스트 대역으로 교체할 수 있습니다.
- 현재 부채를 즉시 대규모 이동하지 않아 기능 회귀 위험을 제한합니다.
- 기존 위반 42건은 후속 리팩터링 대상이며, 기준선 유지 비용이 발생합니다.

## 검증

- `npm run test:architecture`
- `npm run test:dependencies`
- `npm run test:queue`
- `npm run build`
