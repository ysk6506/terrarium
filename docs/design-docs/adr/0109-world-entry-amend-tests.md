---
title: ADR-0109 세계 만들기 입구를 구현하면서 글 잣대 시험의 화면 목록 둘을 고친다
kind: decision
status: active
last_verified: 2026-11-06
enforced_by:
  - apps/web/src/logic/world-words.test.ts
  - apps/web/src/logic/world-shape/world-shape.test.ts
  - packages/core/src/world/workload.test.ts
  - packages/core/src/sources/worldgen/shaped.test.ts
  - apps/server/src/runtime/world-templates.test.ts
  - apps/web/src/logic/builder/server-card.test.ts
touches_protected:
  - docs/design-docs/adr/0107-world-entry-two-doors-ha-ladders.md
  - docs/design-docs/adr/0108-world-entry-iap-and-chip-cards.md
amends_tests:
  - apps/web/src/logic/world-words.test.ts::=SCREENS
  - apps/web/src/logic/world-words.test.ts::=SOURCES
test_change_reason: 오른쪽 패널(Inspector.tsx)을 지우고 3D 위의 카드로 바꾸고, 새 세계 대화상자를 입구와 서비스부터 세 화면으로 바꿨다. 글 잣대 시험은 화면 파일 목록을 읽는데, 그 파일들이 없어지거나 새로 생겨서 목록 둘을 새 화면으로 고친다. 검사하는 규칙(해요체, 장애 금지, 숫자와 단위)은 그대로다.
decision_hash: ff671dcdba136d99
---
# ADR-0109 세계 만들기 입구를 구현하면서 글 잣대 시험의 화면 목록 둘을 고친다

## 맥락
[ADR-0107](0107-world-entry-two-doors-ha-ladders.md)과 [ADR-0108](0108-world-entry-iap-and-chip-cards.md)을 구현했다(REQ-094, 클로즈 베타 2d). 구현하면서 정한 것을 적고, 그 때문에 바뀌는 잠긴 시험 둘의 이유를 남긴다. 동작과 규칙은 [세계 만들기 입구](../world-entry.md)에 있다.

## 결정
1. **시험 둘의 목록만 고친다.** `world-words.test.ts`의 `SCREENS`와 `SOURCES`는 글 잣대를 거는 화면 파일의 목록이다. `ui/builder/Inspector.tsx`는 `DetailCard.tsx`가 되었고, 새 화면 열세 개(입구, 서비스부터 세 화면과 일감 화면, 칩 카드, 직접 짓기의 카드들)가 더해졌다. 규칙은 그대로고, 화면이 늘어난 만큼 규칙이 더 넓게 걸린다.
2. **선택지는 마흔넷이다.** ADR-0107 결정 3의 목록을 층마다 세면 여섯·여섯·여섯·일곱·여섯·넷·넷·다섯으로 44개다(ADR-0108 결정 4의 "45개"는 한 개 더 센 것). 목록 그대로 만들었고, 시험이 44를 못 박는다.
3. **템플릿은 세계 기록의 한 종류다.** 서버의 세계 기록에 출처 `template`을 더하고, 서비스부터의 구성(`ShapeSpec`)을 `provenance.shape`에 둔다. 세계 목록(`listWorlds`)은 템플릿을 빼고, `listWorldTemplates`가 따로 낸다. 그대로 만들기는 저장된 구성으로 같은 세계를 다시 짓는다(같은 구성·같은 번호면 같은 세계).
4. **서비스와 일감은 서비스 개체에 산다.** 서비스는 코어의 `service` 개체이고, 일감(종류·분당 요청·하루 패턴·자원 비중)은 그 속성이다. 시뮬레이션은 둘만 읽는다: 서비스 건강의 정상 조건(가장 많이 쓰는 자원이 더 일찍 느려진다)과 시나리오가 시작될 시각의 가중치(`hourWeights`). 더 깊은 반영은 운영 모드의 몫이다.
5. **"알아서"는 규칙이다.** 서비스의 크기와 멈출 때의 피해, 앞서 고른 층에서 한 층씩 정하고 이유를 한 줄로 말한다. 실험 설정의 "내 도메인"(ADR-0098)이 아직 없어서, 운영하는 층은 이 브라우저에 저장하는 임시 선택으로 두었다. 도메인이 구현되면 그 값으로 바꾼다.
6. **점선 선택지는 가까운 칸 모양으로 짓는다.** 코어에 모델이 없는 선택지(ADR-0107 결정 5)는 같은 층의 가장 가까운 모델 있는 칸으로 세계를 짓고, 그 층의 고장과 시나리오는 만들지 않는다.

## 결과
- 잠긴 시험 둘의 본문만 바뀐다(`lock --amend`). 새 시험은 `[REQ-094]`로 잠근다.
- ADR-0107, ADR-0108의 `enforced_by`를 실제 시험으로 바꾼다.
