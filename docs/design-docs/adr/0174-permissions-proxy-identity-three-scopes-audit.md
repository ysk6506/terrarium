---
title: ADR-0174 권한은 프록시가 넘겨준 신원, 역할 둘, 공개 범위 셋, 감사 기록으로 한다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - packages/core/src/contract/policies.test.ts
  - apps/server/src/runtime/permissions.test.ts
  - apps/server/src/http/identity-proxy.test.ts
  - apps/server/src/main-identity.test.ts
  - apps/server/src/http/permissions-api.test.ts
  - apps/server/src/http/scoring-unchanged.test.ts
amends_tests:
  - "apps/server/src/main.test.ts::starting and stopping the server [REQ-030] > a config file is all it takes; data lives next to it and survives a restart"
  - "apps/server/src/http/activity-stream.test.ts::<import:436dd109>"
  - "apps/server/src/http/activity-stream.test.ts::the live view of a world as server-sent events [REQ-050] > runs already working come first, then what they do as it happens; a world that is not there is a 404"
  - "apps/server/src/http/app.test.ts::<import:05f9b251>"
  - "apps/server/src/http/app.test.ts::<import:d7b9cf00>"
  - "apps/server/src/http/app.test.ts::live progress as server-sent events [REQ-030] > a summary first, then runs and tool calls as they happen"
  - "apps/server/src/http/app.test.ts::who is asking [REQ-033] > the SSO proxy's header wins and cannot be faked; otherwise the name people typed"
  - "apps/server/src/http/connection-try-api.test.ts::말 걸어 보기 and the tools for traces over HTTP [REQ-079] > over HTTP: the route runs the turn, and the tools for traces are listed"
  - "apps/server/src/http/connections-api.test.ts::<import:436dd109>"
  - "apps/server/src/http/connections-api.test.ts::connecting a harness from the screen, over HTTP [REQ-051] > try, save, change, keep, re-check and remove; strangers may not change it"
  - "apps/server/src/http/connections-api.test.ts::what was typed on the screen is still there after a restart [REQ-051] > the SQLite store keeps the sealed secrets, headers, metadata and agent versions"
  - "apps/server/src/http/identity.test.ts::<import:436dd109>"
  - "apps/server/src/http/identity.test.ts::<import:ead56c57>"
  - "apps/server/src/http/identity.test.ts::=sso"
  - "apps/server/src/http/identity.test.ts::who is asking is one slot an SSO can fill [REQ-054] > a sign-in the server checks itself decides the viewer, and a typed name cannot pretend otherwise"
  - "apps/server/src/http/identity.test.ts::who is asking is one slot an SSO can fill [REQ-054] > without an SSO the settings give the proxy header, else a typed name"
  - "apps/server/src/http/models-api.test.ts::<import:436dd109>"
  - "apps/server/src/http/models-api.test.ts::=setup"
  - "apps/server/src/http/models-api.test.ts::registering model APIs: add, list, change, delete [REQ-099] > only one is the default; deleting the default hands it to the one registered first"
  - "apps/server/src/http/models-api.test.ts::registering model APIs: add, list, change, delete [REQ-099] > only whoever registered it changes or deletes it; anyone else can still check and choose the default"
  - "apps/server/src/http/models-api.test.ts::registrations survive a restart, sealed [REQ-099] > the SQLite file keeps them, the key is not readable in it, and the same secret box opens it again"
  - "apps/server/src/http/presets-api.test.ts::<import:436dd109>"
  - "apps/server/src/http/presets-api.test.ts::saved instructions, tool sets and runbooks over HTTP [REQ-090] [REQ-080] [REQ-082] > a deleted one is kept for seven days and then forgotten"
  - "apps/server/src/http/process-api.test.ts::지금 하는 방식 표 [REQ-112] > [REQ-112] 비거나 틀린 표는 받지 않고, 처음 적은 사람만 고친다"
  - "apps/server/src/http/world-community-api.test.ts::칭호 [REQ-101] > [REQ-101] 변별력 점검: 점검하면 기록이 남고, 고칠 곳이 없던 시나리오 5개가 꼼꼼한 출제자다"
  - "apps/server/src/runtime/agent-versions.test.ts::<import:11dddb1f>"
  - "apps/server/src/runtime/agent-versions.test.ts::an agent that changed gets a new version when an experiment is made [REQ-053] > the same agent keeps its version; a changed one gets the next, with the date and what differs"
  - "apps/server/src/runtime/agent-versions.test.ts::people add, change and delete versions [REQ-053] > only whoever connected it may change its versions; the config file's connection is open to everyone"
  - "apps/server/src/runtime/agent-versions.test.ts::people add, change and delete versions [REQ-053] > the versions go away with the connection; a different agent's stay"
  - "apps/server/src/runtime/connection-secrets.test.ts::a connection nobody uses for a month is removed, after a warning [REQ-051] > its owner is told a week before, and keeping it starts the month again"
  - "apps/server/src/runtime/connection-traces.test.ts::strangers may talk but not choose [REQ-079] > anyone can talk to a connection; only its owner changes where its traces go"
  - "apps/server/src/runtime/connection-traces.test.ts::where a connection's traces pile up is chosen per connection [REQ-079] > changing a connection keeps the key unless a new one is typed; leaving traces out keeps the choice"
  - "apps/server/src/runtime/connection-traces.test.ts::where a connection's traces pile up is chosen per connection [REQ-079] > the choice is saved with its key sealed, shown without it, and used to read"
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > a connection that cannot talk says so instead of failing"
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > a connection with no place for traces has nothing to check"
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > a refusal is told with its status and what to do, not as a bare failure"
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > the answer, how long it took, no tool calls, and traces that arrived"
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > traces that do not come say so, and what to look at"
  - "apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > asking again sees a harness's new agents without waiting for the cache"
  - "apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > what people connected is still there after a restart; one that no longer builds is shown, not lost"
  - "apps/server/src/runtime/models-sealed.test.ts::a registered model whose sealed key cannot be opened says so instead of failing [REQ-099] > the check answers not ok with a reason in words, and keeps that on the record"
  - "apps/server/src/runtime/platform.test.ts::<import:1e94ff58>"
  - "apps/server/src/runtime/platform.test.ts::what the server says about itself [REQ-031] [REQ-033] > who is asking, the harnesses with their agents, sources and limits"
  - "apps/server/src/runtime/platform.test.ts::worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034] > worlds come from presets and from reality, with what was assumed"
  - "apps/server/src/runtime/results.test.ts::<import:68f3a5c2>"
  - "apps/server/src/runtime/results.test.ts::benchmarks and the digital twin [REQ-039] [REQ-015] > diagnosis records export as JSON Lines; the brief names what imported worlds lack"
  - "apps/server/src/runtime/results.test.ts::sharing results [REQ-038] > reports in three formats, and links that open without the app until taken back or expired"
  - "apps/server/src/runtime/test-support/platform.ts::=JIMIN"
  - "apps/server/src/runtime/test-support/platform.ts::=YEONSU"
test_change_reason: "가 단계(신원 굳히기, 판정 한 곳, 열려 있던 길 막기)로 요구가 바뀌었다. 남의 연결·모델 확인과 기본 모델 정하기, 설정 파일 연결의 버전, 현재 업무 표, 공유 링크, 소스에서 가져오기가 누구에게나 열려 있다는 옛 기대와, 보는 사람이 이름 하나라는 모양을 바꾼다."
decision_hash: 1184204dc2af12c6
---
# ADR-0174 권한은 프록시가 넘겨준 신원, 역할 둘, 공개 범위 셋, 감사 기록으로 한다

## 맥락
클로즈 베타는 초대한 사내 사용자가 쓴다. 사용자가 둘 이상이면 누구의 세계와 실험인지가 먼저 서야 한다(차수 계획). 제품 책임자의 조건: 사내에 SSO가 여럿 있고 그중에 Keycloak과 GitHub가 있다.

현황 조사에서 드러난 것: 신원은 이름 문자열 하나다. 프록시 헤더가 어디서 왔는지 확인하지 않고, 헤더가 없으면 "anonymous"로 통과한다. 직접 적는 이름으로는 남의 것을 바꾸고 지울 수 있다. 남이 만든 연결의 봉인된 자격 증명을 누구나 대화와 실험에 빌려 쓴다. 누구나 기본 모델을 바꿔 모든 사용자의 도우미 질문을 다른 곳으로 보낼 수 있다. 공유 링크는 누구나 남의 실험에 만들고 만료가 없다. 관리자, 그룹, 감사 기록은 없다. 읽기는 거의 전부 열려 있다.

점수를 믿으려면 순위표의 "누가 돌렸나"와 좋아요·칭호의 "한 사람에 하나"도 믿을 수 있어야 한다. 권한은 편의가 아니라 첫째 기둥(채점이 맞고 같다)의 일부다.

## 결정
1. **신원은 SSO를 맡은 프록시가 넘겨준다.** 테라리움은 SSO와 직접 로그인 절차를 주고받지 않는다. 프록시가 표준(OIDC)으로 Keycloak에 붙고, 다른 SSO로 바꾸는 것은 프록시의 설정이다.
2. **프록시만 믿는다.** 프록시만 아는 비밀 값이 맞는 요청만 받는다. 없거나 틀리면 401이다. 헤더가 없을 때 "anonymous"로 통과시키지 않는다.
3. **보는 사람은 로그인 ID, 보이는 이름, 그룹, 역할을 가진다.** 소유는 로그인 ID에 적는다.
4. **역할은 둘이다**: 사용자와 관리자. 관리자는 서버 설정의 목록이나 SSO의 관리자 그룹에서 온다.
5. **공개 범위는 셋이다**: 나만, 우리 파트, 모두. 세계·시나리오·실험은 처음에 모두, 연결과 모델 등록은 처음에 나만이다. 그룹은 SSO가 알려 주는 대로 쓰고 테라리움에서 관리하지 않는다.
6. **딸린 것은 범위를 물려받고, 쓰려면 볼 수 있어야 한다.** 남의 "나만"인 연결의 자격 증명을 빌려 쓸 수 없다.
7. **바꾸는 일은 만든 사람과 관리자만 한다.** 판정은 한 곳에서 하고, 계약의 모든 길에 걸린다. 판정이 없는 길이 생기면 시험이 실패한다.
8. **공유 링크는 만든 사람과 관리자가 만들고, 처음 만료는 30일이고, 목록에서 끊는다.**
9. **감사 기록을 둔다.** 덧붙이기만 하고, 바꾸는 일과 막힌 시도와 관리자의 열람을 적는다. 비밀 값과 데이터의 내용은 적지 않는다.
10. **직접 적는 이름 방식은 혼자 쓰는 개발용으로만 남는다.**
11. **클로즈 베타는 새 데이터로 시작한다.** 칭호와 좋아요는 옮기지 않는다.
12. 만드는 순서와 화면, 시험은 `docs/design-docs/permissions.md`에 있다. ADR-0028(모두 보고 만든 사람만 바꾼다)과 ADR-0044(신원의 자리 하나)를 넓힌다. ADR-0152의 관리자가 이 역할이다.

## 이유
- 사내 SSO가 여럿이면 테라리움이 그중 하나에 묶이지 않는 쪽이 싸다. 로그인 절차와 토큰·세션을 직접 다루지 않으니 보안의 표면도 작다.
- 범위를 셋으로 두면 화면의 물음이 하나("누가 볼 수 있나요")로 끝난다. 사람 이름을 적는 접근 목록은 관리할 것이 늘고 클로즈 베타에 과하다.
- 세계·시나리오·실험을 처음에 모두로 두는 것은 서로 견주는 것이 이 제품의 쓸모이기 때문이다. 자격 증명이 딸린 것만 닫아 둔다.

## 버린 길
- **테라리움이 OIDC를 직접 구현**: Keycloak에는 붙지만 GitHub 같은 다른 SSO마다 코드가 늘고, 로그인 코드의 보안을 우리가 진다.
- **읽기는 지금처럼 다 열어 두고 바꾸기만 막기**: 연결의 자격 증명을 빌려 쓰는 길과 현실 데이터(REQ-115)가 들어올 때의 노출이 남는다.
- **사람마다의 접근 목록**: 위와 같다.

## 못 하는 것 (정직하게)
- 사내 Keycloak에 테라리움을 등록하는 일(클라이언트 발급, 돌아올 주소)은 배포하는 쪽이 한다. 테라리움은 프록시 설정의 예와 절차서를 낸다.
- 프록시를 거치지 않고 테라리움에 닿는 길을 망에서 막는 것도 배포의 일이다. 테라리움은 비밀 값으로 한 겹을 더할 뿐이다.

## 결과
`docs/design-docs/permissions.md`를 새로 썼다.
