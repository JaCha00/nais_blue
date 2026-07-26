# NAIS blue v1 completion criteria

기준일: 2026-07-26 (Asia/Seoul)

이 문서는 역사적인 모든 실험·Phase를 끝내는 것을 v1 완료 조건으로 삼지 않는다. 현재 사용자가 직접 쓰는
desktop/Android 제품 범위를 안정적으로 배포하고 복구할 수 있는지를 v1 판정 기준으로 사용한다. 현재 runtime,
freshly passing tests와 사용자 방향이 과거 계획 문서보다 우선한다.

## v1 지원 범위

- Windows desktop과 Android 앱의 설치, 실행, updater 및 same-signer update.
- Main/Scene/Style Lab의 이미지 생성 workflow, durable queue, OutputWriter와 metadata 보존.
- Organizer, 대량 이미지 metadata 판독, backup/export/restore와 local AI Agent Workspace.
- Data Hub의 한 desktop↔한 Android session-only LAN pairing과 sanitized `prompt.preset` upsert.
- NAI token, Authorization, absolute path, signed URL, image/Base64와 unknown field를 전송하지 않는 sync boundary.
- desktop installers, updater signatures와 signed universal Android APK의 공개 release.

## 완료 gate

1. `npm audit` high/critical 0, Dependabot open high 0.
2. TypeScript, lint, production build, full Vitest와 responsive route matrix PASS.
3. release/version, Android source/signing/port와 removed-runtime contracts PASS.
4. Windows QA executable cold launch와 version 확인 PASS.
5. Hiby M500_MIKU same-signer update, cold launch와 crash-buffer 확인 PASS.
6. trusted Private LAN에서 USB tunnel 없이 desktop↔Hiby pair/preset push PASS.
7. 기존 사용자 데이터를 삭제하지 않는 backup/export→restore smoke와 v2.11.0→v2.11.1 update PASS.
8. `origin/main`, annotated release tag와 public release target SHA 일치; CI desktop/Android publication PASS.

## v1 이후의 명시적 비목표

- image/blob byte sync, directory mirroring, delete propagation과 multi-peer fan-out.
- automatic discovery/port forwarding, WAN relay와 unattended background sync.
- restart-persistent device identity와 pairing; 현재는 app restart 뒤 재페어링한다.
- Android background R2 worker의 live production cutover, iOS/web LAN transport.
- Composition legacy compatibility 삭제와 historical Phase 전체의 동시 retirement.

이 비목표는 현재 UI가 지원한다고 표시해서는 안 되며 v1.1 이후 별도 capability/release gate로 관리한다.
지원 범위 안의 gate 1~8이 모두 통과하면 NAIS blue v1을 완료로 선언한다.

## 2.11.1 release candidate 판정

- Gate 1~5와 7: PASS. High/critical 0, 전체 1,094 tests/반응형 62 scenarios, Windows cold launch,
  Hiby same-signer update와 실제 backup export→restore→mobile reload를 확인했다.
- Gate 6: MANUAL PENDING. Private LAN 설정은 완료됐지만 세 번의 자동화가 120초 invitation 만료로 끝났다.
  Fresh QR을 Hiby에서 즉시 scan→connect하는 수동 1회가 필요하다.
- Gate 8: TAG WORKFLOW PENDING. 이 release candidate commit을 push/tag한 뒤 desktop/Android publication과
  main/tag/release target SHA 및 assets를 확인한다.

Gate 6과 8의 증거가 모두 생기기 전에는 다른 기능이 안정적이어도 “v1 전체 완료”로 표현하지 않는다.
