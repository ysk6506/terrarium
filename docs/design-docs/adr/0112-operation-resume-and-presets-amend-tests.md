---
title: ADR-0112 서버가 멈춰도 운영은 이어 가고, 저장해 둔 것은 서버에 두고, 서비스마다 모양을 고르고, 운영의 끝은 운영의 말로 쓴다
kind: decision
status: active
enforced_by:
  - packages/core/src/session/operation/journal.test.ts
  - apps/server/src/runtime/operation-resume.test.ts
  - apps/server/src/http/presets-api.test.ts
  - apps/web/src/logic/presets.test.ts
  - packages/core/src/sources/worldgen/shaped-per-service.test.ts
  - apps/web/src/logic/world-shape/per-service.test.ts
  - packages/core/src/oracle/end-label.test.ts
  - apps/web/src/logic/status-words.test.ts
amends_tests:
  - apps/web/src/logic/human-talk.test.ts::<import:54e8bc3d>
  - apps/web/src/logic/human-talk.test.ts::=days
  - apps/web/src/logic/human-talk.test.ts::=memory
  - apps/web/src/logic/human-talk.test.ts::=T0
  - apps/web/src/logic/human-talk.test.ts::saved sets [REQ-080] [REQ-082] > <suite>
  - apps/web/src/logic/human-talk.test.ts::saved sets [REQ-080] [REQ-082] > a browser that keeps nothing, or a broken store, leaves an empty list and no error
  - apps/web/src/logic/human-talk.test.ts::saved sets [REQ-080] [REQ-082] > a deleted set can be brought back for seven days, and is gone after that
  - "apps/web/src/logic/human-talk.test.ts::saved sets [REQ-080] [REQ-082] > a name on a set: save, load, and save again under the same name to change it"
  - apps/web/src/logic/human-talk.test.ts::saved sets [REQ-080] [REQ-082] > a set without a name is not saved
  - apps/web/src/logic/human-talk.test.ts::saved sets [REQ-080] [REQ-082] > tool sets and runbooks are kept apart, newest first
test_change_reason: 저장해 둔 툴 묶음과 절차서가 이 브라우저의 localStorage에서 서버로 옮겨 갔다(ADR-0092 결정 3). 잠긴 시험 다섯은 localStorage 위에서 저장·목록·지우기·되돌리기를 읽는 함수(listPresets, savePreset, removePreset, restorePreset)를 시험했는데 그 함수들이 없어졌다. 같은 성질(이름을 붙여 저장하고 같은 이름이면 바꾼다, 종류끼리 따로 둔다, 이름 없이는 저장하지 않는다, 지우면 7일 안에 되돌린다, 깨진 저장소에서도 에러 없이 빈 목록)은 서버 쪽 시험(presets-api.test.ts)과 옛 저장분을 옮기는 시험(presets.test.ts)이 읽는다. 함께 사라지는 도우미 값 셋(memory, T0, days)과 바뀐 import 줄의 잠금 항목도 같은 이유다.
decision_hash: 2c1a3cd5c3cb258c
---
# ADR-0112 서버가 멈춰도 운영은 이어 가고, 저장해 둔 것은 서버에 두고, 서비스마다 모양을 고르고, 운영의 끝은 운영의 말로 쓴다

## 맥락
클로즈 베타 2c·2d를 구현하며 [ADR-0094](0094-operation-mode.md) 결정 8(서버 재시작 뒤 재개), [ADR-0092](0092-service-first-world-and-templates.md) 결정 3(저장해 두기 패턴), [ADR-0108](0108-world-entry-iap-and-chip-cards.md) 결정 5(서비스마다 다른 모양)의 남은 부분을 마저 했고, 운영 결과의 상태 문구를 고쳤다. 결정을 바꾸지 않는 해석은 [운영 모드](../operation-mode.md), [세계 만들기 입구](../world-entry.md), [툴 범위와 절차서](../tool-scope-and-sop.md)에 적었다.

## 결정
1. **재개는 입력을 다시 넣어서 한다.** 세션은 시계를 읽지 않고 시드에서 시작하므로, 세션이 받은 입력(시계에 맞춘 시각·툴 호출·사람의 조치와 답)을 순서대로 다시 넣으면 같은 상태가 된다. 운영 실행은 이 입력을 실행 옆에 적어 두고(`ExperimentStore`의 재개 기록), 서버가 멈출 때 운영 실행을 `failed`로 끝내지 않고 둔다. 서버가 다시 켜지면 같은 실행 번호로 세션을 세워 거기서부터 이어 간다. 멈춰 있던 동안 세계 시간은 흐르지 않는다. 사건 기록에는 `link` 사건 `lost` 다음에 `resumed`(멈춘 실제 초)가 남고 결과에 "서버가 다시 시작돼 n분 뒤 이어 갔어요"가 뜬다. 이어 갈 수 없을 때(기록이 없다, 실험이 가리키는 세계 버전이 바뀌었다, 시뮬레이터 버전이 다르다)만 "서버가 멈춰 중단됐어요. …"로 이유와 함께 끝난다.
2. **저장해 둔 것은 서버에 둔다.** 지시문·툴 묶음·절차서를 한 종류(`PresetRecord`: 종류 instruction·toolset·runbook, 이름, 본문, 만든 때, 만든 사람)로 서버가 보관한다. 세계·시나리오와 무관하고 만든 사람의 것이다. 같은 이름으로 저장하면 바뀌고, 이름을 바꿀 수 있고, 지우면 7일 동안 남겨 되돌릴 수 있다. 이 브라우저에 있던 옛 저장분은 처음 열 때 서버로 한 번 옮기고 지운다(옮기지 못하면 그대로 두고 다음에 다시 한다).
3. **서비스는 컴퓨트·스토리지·데이터베이스·앱 네 층을 자기 모양으로 고를 수 있다.** 서비스가 둘 이상이면 ②가 서비스마다 한 번 나오고 기본은 첫 서비스와 같은 모양, "따로 고르기"로 그 서비스만의 사다리가 열린다. 네트워크·전원·냉방·사업장은 건물이 하나라 세계의 선택을 모두가 쓴다. 생성기와 계획(`planShape`)은 서비스마다 그 모양으로 호스트·예비·VM/서버째·공유 스토리지를 센다. 따로 고르지 않은 스펙은 전과 같은 세계를 만든다.
4. **운영의 끝은 운영의 말로 쓴다.** 운영은 제한 시간을 넘겨 끝나지 않는다. 시간이 다 되면 "운영 시간 끝(8시간)", 사람이 멈추면 "멈춤(사람)", 호출 상한이면 "호출 상한(5,000회)". 결과 첫 줄·목록·카드가 같은 말을 쓴다. 사건 하나를 푸는 시험의 말은 그대로다.

## 이유
- 주기적으로 세션 상태를 저장하는 길은 세계·물리·기록 전체를 직렬화해야 하고 버전이 바뀔 때마다 깨진다. 입력은 작고(하루치 시계 동기화도 수십만 개의 숫자), 같은 입력이 같은 상태를 만든다는 성질(REQ-001)은 이미 시험으로 지켜진다. 1만 건을 다시 넣는 데 0.3초 안팎이다.
- 저장해 둔 것이 한 브라우저에 있으면 다른 기기·다른 브라우저에서 사라지고 팀이 쓸 길도 없다. 지시문은 운영 실험의 조건이라 잃으면 같은 실험을 다시 못 만든다.
- 건물을 서비스마다 다르게 고를 수 있게 하면 한 세계에 전원이 둘이 되는 모순이 생긴다. 서비스가 정말 고르는 것은 자기가 어떻게 서 있느냐(컴퓨트·스토리지·데이터베이스·앱)다.
- "제한 시간 초과"는 실패처럼 읽힌다. 운영은 정해진 시간을 다 맡는 것이 성공이다.

## 버린 대안
- 세션 상태를 주기적으로 저장(체크포인트): 위 이유로 버렸다.
- 서버가 멈추면 운영을 실패로 끝내고 새로 시작: 몇 시간 돈 실험이 사라지고 사건 기록이 이어지지 않는다.
- 서비스마다 여덟 층을 모두 고르게 하기: 위 이유로 버렸다.
- 저장해 둔 것을 팀에 공개: 이름 충돌과 지우기 권한을 정해야 해서 이번에는 만든 사람만 본다.

## 결과
- 잠긴 시험 열 항목(위 `amends_tests`)이 바뀐다. 다섯 시험의 성질은 새 시험이 읽는다.
- 다른 클러스터 노드에서 도는 운영 세션은 입력을 넘기지 않아 재개할 수 없다(전과 같이 중단된다). 토큰·비용 상한은 여전히 남는다.
