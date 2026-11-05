---
title: ADR-0077 공기 흐름 지도의 말도 용어집 점검에 넣고, 그 점검이 읽는 목록을 고친다
kind: decision
status: active
last_verified: 2026-11-05
enforced_by:
  - apps/web/src/logic/app-words.test.ts
  - apps/web/src/logic/world3d/airflow.test.ts
touches_protected: []
amends_tests:
  - apps/web/src/logic/app-words.test.ts::=collect
  - apps/web/src/logic/app-words.test.ts::<import:3c3e2cad>
test_change_reason: REQ-072는 서버룸에 온도와 공기 흐름 지도라는 새 화면을 더했고(ADR-0074), REQ-071은 화면의 모든 말이 용어집을 따르라고 한다. 그래서 화면 글을 모으는 점검의 목록에 지도의 글(보기 이름, 카드의 말, 가장 더운 곳 문장, 돌린 시간)을 더하고, 이를 위해 world3d를 가져온다. 점검이 확인하는 일은 그대로이고 모으는 글만 늘었다.
decision_hash: fa8731009b594450
---
# ADR-0077 공기 흐름 지도의 말도 용어집 점검에 넣고, 그 점검이 읽는 목록을 고친다

## 맥락
ADR-0074로 서버룸에 온도와 공기 흐름 지도가 생겼다. 이 화면은 새 말을 많이 쓴다: 보기 이름(흡기 온도, 배기 온도, 공기 흐름), 카드의 제목과 안내, 냉방기 상태, "가장 더운 곳" 문장, 돌린 시간.
화면의 말은 [용어집](../glossary.md)을 따라야 하고(REQ-071), 그 일은 `app-words.test.ts`가 지킨다. 이 시험은 화면 글을 한 목록(`collect`)에 모아 쓰지 않기로 한 말과 "~니다", "~다" 끝맺음이 없는지 본다. 지도의 글이 목록에 없으면 다음에 누가 "도구"나 "장애"를 지도에 써도 아무도 막지 못한다.

## 결정
1. `app-words.test.ts`의 `collect`에 지도의 글을 더한다. `AIR_WORDS` 전부, `AIR_NOTE`, 세 보기의 이름, 가장 더운 곳 문장(경고선 아래, 위, 심각선 위의 온도 네 개), 돌린 시간 문장(0, 30, 90, 600초). 가져오는 목록(import)에 `world3d`가 들어간다.
2. 시험이 확인하는 일은 바꾸지 않는다. 쓰지 않는 말과 끝맺음을 본다는 것도, 어느 문장을 통과시킨다는 것도 그대로이고, **읽는 글만 늘었다.**
3. 잠금 장부에서 바뀐 것은 두 항목뿐이다: 가져오기 목록과 `collect`. 새 시험 `airflow.test.ts`는 `pnpm lock-tests`로 새 항목으로 더한다.

## 버린 대안
- **지도의 글을 별도 시험에서 검사하기**: 말을 지키는 곳이 둘이 되고, 점검 목록과 어긋난다. 한 곳에 모은다.
- **지도의 글을 점검에 넣지 않기**: 새 화면이 용어집 밖에 남는다.

## 한계
- 말이 자연스러운지는 사람이 본다. 이 시험은 쓰지 않기로 한 말과 끝맺음만 막는다.
