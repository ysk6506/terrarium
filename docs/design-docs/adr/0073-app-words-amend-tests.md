---
title: ADR-0073 편집기 밖의 화면 글도 용어집에 맞추고, 그 말을 지키던 시험 열여섯 개의 기대값을 고친다
kind: decision
status: active
enforced_by:
  - apps/web/src/logic/app-words.test.ts
  - apps/server/src/adapters/connectors/connector-words.test.ts
  - tests/spec/alarm-words.test.ts
  - apps/web/src/logic/pass-text.test.ts
  - apps/web/src/logic/scenario/group.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - "apps/server/src/adapters/connectors/a2a.test.ts::an A2A agent: the card says who it is, a run is a task [REQ-051] > a task without an id, an unreachable agent and unreadable statuses are errors with reasons"
  - "apps/server/src/adapters/connectors/goclaw.test.ts::a GoClaw gateway: tools go in as an MCP server granted to the agent [REQ-051] > a refused tool server (private address) is told as it is, and nothing is left behind"
  - "apps/server/src/adapters/connectors/goclaw.test.ts::a GoClaw gateway: tools go in as an MCP server granted to the agent [REQ-051] > an agent the gateway does not have, or a run without a tool address, fails before anything is registered"
  - "apps/server/src/adapters/connectors/http-template.test.ts::any HTTP API as an agent: the request is written in the form [REQ-051] > refusals, an unreachable API, unreadable statuses and a body that needs tools the run lacks are errors with reasons"
  - "apps/server/src/adapters/connectors/langgraph.test.ts::a LangGraph Agent Server: its assistants are the agents [REQ-051] > a server that cannot be reached, or whose status cannot be read, is an error with a reason"
  - apps/server/src/adapters/connectors/mcp-agent.test.ts::an agent that a server offers as an MCP tool [REQ-051] > a tool that reports an error, and a server that cannot be reached, end the run with a reason
  - "apps/server/src/adapters/connectors/opencode.test.ts::an OpenCode server: its agents are the agents [REQ-051] > no tools address, an unreachable server and unreadable statuses are errors with reasons"
  - apps/server/src/adapters/harness.test.ts::a remote harness over the Terrarium harness protocol [REQ-031] > refusals, unreachable harnesses and missing MCP endpoints are errors with reasons
  - apps/server/src/http/mcp-slots.test.ts::a fixed tool address is served by the app [REQ-051] > a harness with the right address gets the tools; a wrong token gets 404 with a reason
  - apps/server/src/runtime/connection-secrets.test.ts::a token typed on the screen is used, kept sealed and never shown again [REQ-051] > after a restart it still opens; with another key it says what happened
  - packages/core/src/analysis/analysis.test.ts::one run, analysed [REQ-037] > runs that never finished say why
  - "packages/core/src/contract/contract.test.ts::experiments: create, fork, add runs [REQ-030] [REQ-040] > a fork changes only what it names; adding runs says how many or which seeds"
  - "packages/core/src/oracle/oracle.test.ts::oracle: state, actions and efficiency [REQ-007] [REQ-037] > time and tool budget count only when a diagnosis was submitted"
  - "packages/core/src/oracle/oracle.test.ts::oracle: state, actions and efficiency [REQ-007] [REQ-037] > a sheet with nothing to earn has no total"
  - "tests/spec/gpu-fabric.test.ts::losing a rail slows a server down instead of cutting it off [REQ-067] > all eight rails lost is critical: the server cannot reach the cluster"
  - tests/spec/switch-l2l3-os.test.ts::routes that point at each other and routes that are gone [REQ-064] [REQ-002] > without the core's routes down to the racks, every server is named in an alarm that says no route
  - "apps/web/src/logic/scenario/group.test.ts::a big condition folds into one line [REQ-034] > the folded line says it in words: how many servers and what they all do"
  - apps/web/src/logic/scenario/group.test.ts::a big condition folds into one line [REQ-034] > a mixed group names its first condition and counts the rest; a short one reads in full
  - apps/web/src/logic/scenario/group.test.ts::=all
  - apps/web/src/logic/scenario/group.test.ts::<import:71932ad8>
test_change_reason: REQ-071은 화면의 말이 편집기 안팎 모두 용어집을 따르라고 한다(ADR-0071, 0073). 도구는 툴로, 닿다는 연결하다로, 취소됨은 멈춤으로, 습니다체는 해요체로 바뀌었고, 합격 문구와 채점표 요약도 바뀌어 열여섯 시험의 기대 문장이 달라졌다. 시험이 확인하는 일은 그대로이고 기대 문자열만 새 말로 바꿨다.
decision_hash: ee2cb37381ff4186
---
# ADR-0073 편집기 밖의 화면 글도 용어집에 맞추고, 그 말을 지키던 시험 열여섯 개의 기대값을 고친다

## 맥락
ADR-0072는 편집기의 말만 용어집에 맞췄다. 점검 표(strings.md)는 홈, 연결, 실험, 실행, 서버 오류 문장에서도 같은 것을 다르게 부르는 짝을 찾았다. 연결 양식은 "도구", 나머지는 "툴"이었고, 서버가 만드는 권한 오류는 "삭제·수정", 웹 버튼은 "지우기·고치기"였다. 서버에 닿지 못할 때는 "닿을 수 없어요"라고 했다.
더 급한 것은 사실이 어긋난 곳이다. 실행 화면과 실험 화면은 "70점 이상이면 합격"이라 하는데, 코어 `PASS_MARK`는 60이고 합격에는 진단을 맞히는 것도 들어 있다. 화면을 믿고 70점을 노린 사람은 잘못 안내받는다.
말투도 섞여 있었다. 알람 문장 아홉 개가 합니다체였고, 화면 두 곳이 한다체였다. 에이전트가 읽는 지시문은 해요체와 한다체가 한 문장에 섞여 있었다.
이 글들을 지키던 시험이 있다. 오류 문장과 라벨을 그대로 기대값으로 적어 두었으므로, 말을 바꾸면 그 시험들이 실패한다. 시험은 잠겨 있어서 요구사항이 바뀐 근거를 ADR로 남겨야 고칠 수 있다. 요구사항 REQ-071의 일곱째 항목이 그 근거다.

## 결정
1. 코드를 고쳤다. [용어집](../glossary.md)의 "글 점검" 절에 짝마다 어디를 고쳤는지 적었다. 타입 이름, 값(`cancelled`), 영어 툴 설명, 로그는 그대로다.
2. 합격 문구는 코어 상수를 읽는다. 웹은 `PASS_MARK`를 `@terrarium/core/oracle`에서 가져와 "진단을 맞히고 60점 이상이면 합격이에요"라고 말한다. 숫자를 글에 적어 두지 않는다.
3. 홈 시작 카드가 "세계"(가상의 데이터센터)와 "하네스"(모델을 움직이는 프로그램)를 한 번씩 풀어 말한다. 카드 글은 `home-copy.ts`의 `STARTS`로 옮겨 시험이 읽을 수 있게 했다.
4. 점수 카드의 조건이 커지면(서버 한 대에 하나씩 스물네 개) 접는다. 자식이 셋 이하인 묶음은 열려 있고, 그보다 많으면 "서버 24대가 모두 전원 공급"처럼 한 줄과 개수, "펼치기"만 보인다. 기준 칸이 예/아니요인 조건은 글칸 대신 "예 / 아니요" 선택이다.
5. 시험 열여섯 개의 **기대 문자열만** 새 말에 맞췄다. 무엇을 확인하는지는 바꾸지 않았다.
   - 연결 방식 시험 일곱 개와 하네스 시험 하나: "닿지 못했어요"는 "연결하지 못했어요", "도구 서버"는 "툴 서버", "고정 도구 주소"는 "고정 툴 주소".
   - 비밀 키 시험 하나: "서버의 열쇠"는 "서버의 암호 키".
   - 요청 검증 시험 하나: "추가할 실행 횟수"는 "더할 실행 횟수".
   - 채점 시험 둘: "툴 호출 3회 (한도 3회)"는 "(상한 3회)", "채점 기준 없음 · 취소됨"은 "채점표 없음 · 멈춤".
   - 분석 시험 하나: "실행이 취소됐어요"는 "실행이 멈췄어요".
   - 네트워크 알람 시험 둘: "통신할 수 없습니다"와 "경로가 없습니다"는 해요체.
6. 새 시험이 같은 일을 다시 막는다. `app-words.test.ts`는 홈 문구, 채점 라벨, 끝난 이유, 실행 상태, 고장, 합격 문구에, `alarm-words.test.ts`는 알람 문장의 소스에, `connector-words.test.ts`는 연결 양식에 쓰지 않는 말과 "~다" 끝맺음이 없는지 본다. `pass-text.test.ts`는 합격 문구가 코어 상수를 담는지, `group.test.ts`는 묶음을 접는 규칙을 본다.
7. 요구사항 REQ-071에 일곱째 항목을 더했다.

## 버린 대안
- **시험을 그대로 두고 옛 말을 남기기**: 사람이 읽는 말이 코드 속 시험 때문에 굳는다.
- **합격 문구만 70에서 60으로 고치기**: 숫자를 또 글에 적으면 다음에 상수가 바뀔 때 같은 사고가 난다. 상수를 읽게 했다.
- **큰 묶음을 처음부터 열어 두고 스크롤하게 하기**: 템플릿 하나에 폼이 마흔 개 가까이 펼쳐져 어디를 보는지 알 수 없다.
- **Hermes·GoClaw가 에이전트에게 주는 한국어 지시문까지 한다체로 바꾸기**: 이번에는 시나리오 템플릿의 지시문만 하나로 맞췄다. 연결 어댑터의 지시문은 에이전트 제품별로 따로 다듬어야 한다.

## 한계
- 말이 자연스러운지는 사람이 본다. 시험은 쓰지 않기로 한 말과 끝맺음만 막는다.
- 알람 문장 시험은 소스의 한국어 글자 묶음을 읽는다. 알람이 실제로 만들어 낸 문장을 읽는 것이 아니다.
- 장비가 켜져 있다는 뜻의 "가동 중"(조건 칸 이름 셋)은 운영에서 쓰는 말이라 남겼다. 시험의 쓰지 않는 말 목록은 이 글자들을 읽는 곳(편집기 블록 라벨)에 걸지 않았다.
