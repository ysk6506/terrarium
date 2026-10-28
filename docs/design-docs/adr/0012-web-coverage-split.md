---
title: ADR-0012 웹 커버리지는 로직은 단위 테스트, 화면은 e2e로
kind: decision
status: active
last_verified: 2026-10-28
enforced_by:
  - TCFG003
touches_protected: []
decision_hash: cb2ca990c589a453
---
# ADR-0012 웹 커버리지 분리

## 맥락
React 화면과 three.js 장면을 Node 단위 테스트로 커버하려면 DOM과 WebGL을 흉내 내야 하고, 그 테스트는 화면이 정말 동작하는지 증명하지 못한다.

## 결정
- 화면의 계산과 상태는 `apps/web/src/logic`에 두고 Vitest로 테스트한다. 커버리지 하한(≥90%)이 적용된다.
- `apps/web/src/ui`는 실제 브라우저에서 사용자 여정을 수행하는 e2e(Playwright)와 UX 측정으로 검증한다. Vitest 커버리지 대상에서 제외한다.
- 이 범위는 `harness/config/tests.yaml`의 `coverage_include`로 고정되고, 바꾸면 `TCFG003`으로 실패한다.

## 이유
화면 코드를 얇게 유지하고 판단은 logic으로 내리게 만드는 압력도 된다. 화면이 하는 일은 e2e가 실제로 클릭해서 확인한다.
