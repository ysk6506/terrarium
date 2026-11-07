---
title: ADR-0123 사다리 화면과 직접 짓기를 주인공 하나로 다시 그리고, 칩에 전제 규칙을 두고, 돌려 보기를 시운전으로 부른다
kind: decision
status: active
last_verified: 2026-11-07
enforced_by:
  - packages/core/src/world/ladder-rules.test.ts
  - apps/web/src/logic/world-shape/prerequisites.test.ts
  - apps/web/src/logic/builder/one-card.test.ts
  - apps/web/src/logic/world-words.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - "apps/web/src/logic/next-step.test.ts::the 다음 할 일 chip is a function of the world [REQ-077] > it walks one road: no land, no building, no server room, an empty one, not run, done"
  - apps/web/src/logic/world-shape/k8s-cards.test.ts::IAP 기본 카드는 컨테이너 오케스트레이션이다 [REQ-096] > 카드에 컨트롤 플레인 VM이 있는 서비스는 알아서도 컨테이너를 고른다
  - apps/web/src/logic/world-shape/per-service.test.ts::서비스마다 다른 모양을 화면이 읽는 법 [REQ-094] > 서비스 하나의 '알아서'는 그 서비스를 보고 네 층만 고른다
  - apps/web/src/logic/world-shape/world-shape.test.ts::알아서와 프리셋 [REQ-094] > 고른 층은 그대로 두고 나머지는 알아서 고르며 한 줄로 이유를 말한다
  - apps/web/src/logic/world-words.test.ts::=SCREENS
  - apps/web/src/logic/world-words.test.ts::=SOURCES
  - "apps/web/src/logic/world-words.test.ts::글 잣대: 해요체, 숫자와 단위, 시스템 말 금지, 버튼은 결과 [REQ-077] > a button says what it does: the big buttons and the main ones end in the result"
test_change_reason: 연수 님 피드백(2026-11-06)은 "주인공 하나, 나머지는 필요할 때만"이다. (1) "알아서"의 이유는 "알아서 X로 골랐어요 — …" 문장이 아니라 짧은 원인 한 줄이 되어(행의 회색 줄이 "알아서"를 이미 말한다) 이유 문장을 읽는 시험 셋이 같은 성질(알아서가 고른 층만 이유를 말한다, 서비스를 보고 고른다, 컨트롤 플레인 VM이 있으면 컨테이너를 고른다)을 새 문장 모양으로 읽는다. (2) 다음 할 일 칩과 버튼 말의 "돌려 보기"는 "시운전"이 되어 그 두 시험이 새 말을 읽는다. (3) 글 잣대 시험의 화면 목록은 없어진 화면(PickCard·Toolbox·DetailCard·RackFront)을 빼고 새 화면(OneCard·CardParts·PlaceSheet·ladder-rows)을 더한다. 어느 쪽도 시험이 지키는 성질은 그대로다.
decision_hash: d1fdd4f12e62a007
---
# ADR-0123 사다리 화면과 직접 짓기를 주인공 하나로 다시 그리고, 칩에 전제 규칙을 두고, 돌려 보기를 시운전으로 부른다

## 맥락
연수 님 피드백(2026-11-06): 사다리 화면은 층 여덟 × 칩 여섯~일곱이 고르지 않게 줄바꿈하고, 이유 줄·프리셋·노란 안내·칩 카드·요약이 한꺼번에 있다. 직접 짓기는 왼쪽 팔레트, 오른쪽 카드, 위 통계 줄, 떠 있는 U 카드, 여덟 줄 키 안내가 한꺼번에 있다. 원칙은 **주인공 하나, 나머지는 필요할 때만**이다. 승인한 목업은 `mockups/ux-round3-mockup.html`(화면 1~4)이다.

## 결정
1. **사다리 화면은 닫힌 채로 조용한 줄 여덟이다.** 층 이름 · 고른 칩 하나(검정 알약, "알아서"로 고른 것은 cobalt-soft) · 회색 한 줄("알아서 · 이유" 또는 "직접 골랐어요") · `›`. 오른쪽은 "이 모양이면"뿐이다. 소개 문단 둘과 노란 안내를 없애고 한 줄 안내와 프리셋 넷(알아서·싸게·보통·멈추지 않게)만 둔다.
2. **층을 누르면 그 층 하나만 펼친다.** 같은 너비·높이(`repeat(n,1fr)`, 최소 58px)의 칩 가로 줄, 왼쪽 "싸게 · 자주 멈춤"과 오른쪽 "비싸게 · 잘 안 멈춤", 고른 칩은 2px 먹색 테두리, 점선 칩은 오른쪽 끝에서 흐리게. 아래 한 줄 "이걸 고르면 …". 오른쪽은 그 칩의 구조 카드로 바뀌고(목록은 셋까지 + "외 n가지") 다시 누르거나 Esc로 "이 모양이면"로 돌아간다. 한 번에 한 층만 열리고, 서비스마다 따로 모드도 같은 컴포넌트를 쓴다.
3. **전제 규칙은 코어의 데이터다.** `ChipMech.requires`(다른 층이 어느 칩 "이상"이어야 하는가, 둘 중 하나로 채워지는 경우 `orElse`)와 `pointlessWith`(막지 않고 한 줄만 건네는 짝). "이상"은 사다리에서 그 칩이거나 오른쪽이다. 규칙표는 [세계 만들기 입구와 서비스부터](../world-entry.md)에 있다. 전제가 안 맞는 칩은 흐리게(점선은 "아직 흉내 낼 수 없음"에만) 보이고, 누르면 "클라우드 네이티브는 컴퓨트가 컨테이너 오케스트레이션이어야 골라져요"와 "컴퓨트도 바꾸기"(전제 층을 필요한 가장 왼쪽 칩으로 올린 뒤 고른다, 이미 더 높으면 건드리지 않는다) · "그만두기"를 묻는다. 쓸모없는 짝은 행 아래에 경고색 한 줄만 두고 막지 않는다.
4. **"알아서"와 프리셋은 전제를 어긴 짝을 만들지 않는다.** 사람이 고른 층은 건드리지 않고, 알아서 층이 어긋나면 알아서 층이 물러선다(필요한 층을 올리거나, 필요로 하는 칩을 왼쪽으로). 이유는 짧은 원인 한 줄이다("랙 사이를 오가는 길이 여럿이라서").
5. **직접 짓기 둘레는 놓기 · 카드 하나 · 아래 막대 하나다.** 왼쪽 팔레트와 위 통계 줄, 떠 있는 U 카드, 접히는 절 셋을 없앤다. "놓기" 버튼(고른 게 없을 때 주된 버튼, 있을 때 보조)이 그 단계에 맞는 것만 고르는 작은 시트를 연다. 카드는 고른 것이 있을 때만 하나 뜨고(이름 · 사실 한 줄 · U 띠 · 돌리기·자동 배선·서버 넣기·지우기), 지우기는 자리에서 "안에 든 23개와 케이블도 같이 지워져요 — 지우기 / 그만"을 묻는다. 아래 막대가 유일한 상태 줄이다(이동 경로 · 합계 · ? · 서버룸으로 · 다 지었어요). 처음 한 번의 키 안내는 네 줄이다.
6. **"돌려 보기"는 "시운전"이다.** 위 막대 "시운전 10분", 도는 중 "시운전 중 3/10분", 끝난 뒤 가운데 알약 "시운전 10분 · 알람 0건 · 가장 더운 곳 27°C · 전원 여유 579 kW"와 버튼 "다시 시운전". 시나리오 편집기의 "미리 돌려 보기"는 "미리 보기"다. 용어집에 시운전·미리 보기·전제를 올린다.

## 시험을 고친 이유
위 `test_change_reason`.
