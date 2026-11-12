---
title: ADR-0131 내장 에이전트가 DR을 알고, 복구 채점의 시간 창이 세계의 모양을 따른다
kind: decision
status: active
last_verified: 2026-11-07
enforced_by:
  - tests/spec/baseline-agents.test.ts
  - tests/spec/expected-recovery.test.ts
  - tests/spec/recovery-scoring.test.ts
  - tests/spec/site-scenarios.test.ts
  - tests/spec/calibration.test.ts
  - apps/web/src/logic/expected-recovery.test.ts
  - apps/web/src/logic/world3d/life.test.ts
  - apps/server/src/http/service-cards-api.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - harness/config/test-lock.json
amends_tests:
  - apps/server/src/http/service-cards-api.test.ts::서비스 카드 [REQ-104] > [REQ-104] 처음엔 잠김·공유 안 함이고, 남에게는 공유한 뒤에만 보인다
  - apps/server/src/http/service-cards-api.test.ts::서비스 카드 저장 [REQ-104] > [REQ-104] SQLite에 저장하고 다시 열어도 카드가 남고, 지우면 사라진다
  - apps/server/src/http/service-cards-api.test.ts::서비스 카드 [REQ-104] > [REQ-104] 잠긴 카드는 만든 사람만 고치고 지운다. 잠금을 풀면 이름만 남도 고친다
test_change_reason: 서비스 카드에서 `locked` 칸을 없앴다. 카드는 늘 잠겨 있고 남의 카드는 복사해서 쓴다. 그래서 응답의 `locked` 기대값을 빼고(앞의 두 시험), 잠금을 풀면 누구나 고친다는 시험은 지우고 "늘 잠김 · `locked`는 400 · 복사" 시험 둘로 바꿨다. 나머지 잠긴 시험은 하나도 고치지 않았다. 채점 창은 시트에 `expectedRecoveryS`가 있을 때만 바뀌므로 ADR-0104의 채점 시험과 골든은 그대로다.
decision_hash: 8206a814d51a8b5f
---
# ADR-0131 내장 에이전트가 DR을 알고, 복구 채점의 시간 창이 세계의 모양을 따른다

## 맥락
제품 책임자(2026-11-07): "그 한계가 진짜 불가능해서 한계인 거야, 아니면 할 수 있는데 설계/구현을 안 한 거야?" 답은 "안 한 것"이었다. 사이트·DR 층(ADR-0129)의 한계 둘이 그렇다.
1. 내장 에이전트(`operator`·`triage`)는 사이트·GPU·전원 알람을 몰라서 이 층의 시나리오에서 0점이었다. 핫 사이트에서는 가만히 있으면 되는데 `failover_service` 같은 걸 눌러 "악화"가 찍히기도 했다.
2. 복구 시간의 창이 5분/20분으로 전체에 같아서(ADR-0104) 콜드 사이트(4시간)와 웜(15분)은 어느 길로 해도 시간 점수가 낮았다.

## 결정
1. **내장 에이전트가 층을 안다.** `operator`와 `triage`는 알람 코드로 사이트·DR(`site_down` · `wan_down` · `replication_broken` · `dr_failover_stuck` · `site_split_brain`), 합의 DB, GPU, 전원, 냉방 고장을 알아보고 층마다 "보고 한 번 한다"를 한다: 핫·액티브는 기다리고, 웜은 `dr_failover`, 콜드는 시설 도메인에 넘기고 `dr_failover`, 사이트가 돌아오면 `dr_failback`을 쓸 수 있다. `guess`는 그대로다.
2. **공통 규칙: 스스로 복구하는 중이면 손대지 않는다.** 세계 사건 가운데 원인이 `cluster`인 것(승격·자동 전환·VM 이동·알림 메모)을 `events_since`가 `auto_recovery`로 보여 주고, 상태 툴의 카운트다운(`promotesInSeconds` 등)과 `site_status`의 계획(`movesByItself`·`phase`)을 읽는다. 하나라도 있으면 60초씩 `wait`하고(최대 10번) 그 뒤에 서비스가 멀쩡하면 아무것도 누르지 않는다. 자동 복구 중에는 `failover_service`·`dr_failover`·`breaker_reset` 같은 변경 툴을 부르지 않는다.
3. **복구 시간 창은 시트가 정한다.** `ScenarioDoc.expectedRecoveryS`(30~172800초, 선택)가 있으면 만점 창은 그 값이고 영점은 4배다. 없으면 5분/20분 그대로다. 시나리오를 세계에 맞춰 만들 때(`library-site.ts`·`library-db.ts`) 모양이 허락하는 시간을 채운다: 사이트 계획의 RTO(콜드 14400, 웜 900; 핫·액티브는 기본이라 비운다), 관리형 스토리지 확장 600, 복원 1200. 5분 이하는 쓸모가 없어 비운다. 복구 순서 축(2분/10분)과 나머지 축은 그대로다.
4. **편집기와 결과.** 편집기의 "기대 복구 시간" 칸(분)에서 고친다. 결과의 복구 시간 칸 옆에 "기대 복구 15분 · 실제 11분"을 보이고 물을 수 있다. `Score.expectedRecoveryS`가 창을 실어 나르고(`RecoveryReport`는 그대로라서 사건 기록으로의 재채점 시험이 깨지지 않는다), 벤치마크 키(`scenarioDigest`)는 필드가 있을 때만 그 값을 넣는다. 변별력 점검도 같은 창을 쓴다. `ORACLE_VERSION`은 "3" 그대로다(필드가 없는 시트의 점수가 전과 같으므로).
5. **작은 수정 넷.**
   1. "세계를 다 지었어요" 카드의 템플릿 저장은 "템플릿으로 저장" 글 링크로 접히고 누르면 이름 칸이 펼쳐진다.
   2. 서비스 카드는 늘 잠겨 있다(`locked` 칸 없음, 보내면 400). 남의 카드는 `POST /api/service-cards/:id/copy`로 복사해서 내 카드로 쓴다(복사본은 복사한 사람의 것, 공유 안 됨).
   3. 사람은 주차장에 서지도, 주차장으로 걸어 들어가지도 않는다. 걷는 끝을 주차장 중심이 아니라 가장자리 바깥의 걸을 수 있는 땅으로 잡는다.
   4. ADR-0130의 숫자를 바로잡는다(아래 보정).

## 이유
- 한계를 숨기면 "내장 에이전트가 이 층을 못 푼다"가 "이 층이 못 풀 시나리오다"로 읽힌다. 기준 에이전트가 풀어야 시트를 점검할 수 있다.
- 콜드 사이트에서 4시간 걸리는 것은 에이전트의 잘못이 아니다. 창이 세계의 모양을 따르면 점수는 "모양이 허락한 시간 대비"를 말한다.
- `expectedRecoveryS`를 비워 두는 쪽을 기본으로 해서 일반 시나리오의 점수·골든·벤치마크 키는 한 칸도 움직이지 않는다.

## 대안과 버린 이유
- 모든 시트의 창을 늘리기: 일반 고장의 변별력이 사라진다.
- `RecoveryReport`에 창을 넣기: 잠긴 재채점 시험(`toEqual`)이 깨진다. 점수 쪽에 따로 둔다.
- 자동 복구 중에도 안전한 변경은 허용하기: "건드리지 않는다"가 가장 단순하고 `cluster`의 몫을 에이전트의 것으로 세지 않는다.

## 결과
REQ-108. [사이트·DR 층](../site-dr-layer.md), [측정](../measurement.md), [서비스 카탈로그](../service-catalog.md).

## 보정
ADR-0130은 봉인되어 고칠 수 없는데 본문의 숫자가 틀렸다. "칩 54개, 툴 82개"가 아니라 **칩 56개, 툴 96개**이고 고장은 97가지다. 이유는 두 묶음(사이트·DR의 REQ-106, 가속기의 REQ-107)이 따로 만들어져 합쳐지면서 서로의 숫자를 모르는 채 각자 센 값이 남았기 때문이다(REQ-106이 사이트 칩 둘을 더했다). 본문에 남은 옛 숫자는 `tool-scope-and-sop.md`(고장 82가지)와 `domains-and-counterparts.md`(고장 82가지)에서 고쳤다. `world-entry.md` · `gpu-layer.md` · `power-cooling-ladders.md`는 이미 56칩으로 맞아 있어 다시 대조만 했다.
