---
title: ADR-0099 가상 담당자는 거절하지 않고 코드로 결정론적으로 움직이며, 티켓 툴은 선택이고, 교체 작업은 3D에 보인다 (ADR-0098 보정)
kind: decision
status: active
last_verified: 2026-11-05
enforced_by:
  - packages/core/src/session/escalate.test.ts
  - packages/core/src/topology/partner.test.ts
  - apps/web/src/logic/world3d/crew-partner.test.ts
  - apps/web/src/logic/handoffs.test.ts
decision_hash: 5d33e4e3192a3726
---
# ADR-0099 가상 담당자 보정 (ADR-0098)

## 맥락
ADR-0098에 "거절 확률"을 넣었고, 요청 처리 방식과 티켓 툴의 기본값, 3D 표현이 빠져 있었다. 연수 님 지적.

## 결정 (ADR-0098의 2·3항을 이렇게 읽는다)
1. **거절 확률은 없다.** 가상 담당자는 항상 받아서 처리한다. 현실감은 리드타임과 되묻기로만 낸다.
2. **결정론.** `escalate(to, kind, target, details)`는 구조화된 요청이다: `to`는 도메인 팀 또는 벤더, `kind`는 `replace_part`·`restart`·`reconfigure`·`inspect` 같은 정해진 종류, `target`은 장비 ID. 처리는 LLM이 아니라 **코드 상태 기계**다: (요청 종류 × 상대) → 리드타임(시드 난수) → 되묻기 규칙(부품 교체는 시리얼·증상 로그 필요 등) → 완료 시 세계 반영. 같은 시드면 같은 시각에 같은 일이 일어난다. `details`(자유 글)는 기록만 하고 판단에 쓰지 않는다. 종류에 없는 요청은 "이 요청은 받을 수 없어요 — 가능한 종류: …"로 즉시 답한다(거절이 아니라 형식 오류).
3. **티켓 툴은 선택이고 기본은 꺼짐.** 하네스가 자체 할 일 관리를 할 수 있다. 툴 고르기에 "작업 티켓(선택)"과 도움말: "하네스에 할 일 관리가 없을 때 켜요. 켜면 넘긴 요청이 자동으로 '기다리는 중' 티켓이 돼요. 꺼도 상대의 진행·완료는 `events_since`로 들어와요." 잊지 않았나·동시 작업 측정은 티켓 유무와 무관하게 사건 기록으로 한다.
4. **교체 작업은 3D에 보인다.** 벤더 요청이 완료 단계에 들어가면 기사가 문으로 들어와 그 장비까지 걸어가 작업 자세를 취하고(ADR-0078 규칙 재사용), 장비에 "교체 중 · 벤더" 표시, 끝나면 나간다. 토폴로지 타일에도 같은 상태. 리플레이에 남는다.
