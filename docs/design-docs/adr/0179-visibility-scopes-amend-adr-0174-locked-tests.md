---
title: ADR-0179 공개 범위의 두 결정(기본 모델은 "모두"인 모델만, 범위 바꾸기는 한 길)과 ADR-0174의 바뀐 시험 목록
kind: decision
status: active
last_verified: 2026-11-12
enforced_by:
  - apps/server/src/http/scope-matrix.test.ts
  - apps/server/src/http/scope-use.test.ts
  - apps/server/src/http/scope-default-model.test.ts
  - apps/server/src/adapters/sqlite-scope.test.ts
  - apps/server/src/runtime/permissions-scope.test.ts
touches_protected:
  - docs/design-docs/adr/0174-permissions-proxy-identity-three-scopes-audit.md
updates_docs:
  - docs/design-docs/permissions.md
  - docs/design-docs/http-api.md
  - docs/design-docs/model-registration.md
amends:
  - adr: "0174"
    what: 기본 모델은 범위가 모두인 모델만, 범위 바꾸기는 한 길
amends_tests:
  - apps/server/src/http/activity-stream.test.ts::<import:886f13ce>
  - apps/server/src/http/activity-stream.test.ts::<import:88b11dba>
  - apps/server/src/http/activity-stream.test.ts::the live view of a world as server-sent events [REQ-050] > runs already working come first, then what they do as it happens; a world that is not there is a 404
  - apps/server/src/http/agent-versions-api.test.ts::the versions of an agent over HTTP [REQ-053] > list, add, edit and delete by address; an agent with a slash in its id works
  - "apps/server/src/http/connection-try-api.test.ts::말 걸어 보기 and the tools for traces over HTTP [REQ-079] > over HTTP: the route runs the turn, and the tools for traces are listed"
  - apps/server/src/http/connections-api.test.ts::<import:88b11dba>
  - apps/server/src/http/connections-api.test.ts::connecting a harness from the screen, over HTTP [REQ-051] > try, save, change, keep, re-check and remove; strangers may not change it
  - apps/server/src/http/connections-api.test.ts::what was typed on the screen is still there after a restart [REQ-051] > the SQLite store keeps the sealed secrets, headers, metadata and agent versions
  - "apps/server/src/http/models-api.test.ts::registering model APIs: add, list, change, delete [REQ-099] > only one is the default; deleting the default hands it to the one registered first"
  - "apps/server/src/http/models-api.test.ts::registering model APIs: add, list, change, delete [REQ-099] > only whoever registered it changes, deletes or checks it; only an admin chooses the default"
  - apps/server/src/http/models-api.test.ts::registrations survive a restart, sealed [REQ-099] > the SQLite file keeps them, the key is not readable in it, and the same secret box opens it again
  - apps/server/src/http/permissions-api.test.ts::what was open to every signed-in person is for its maker and admins [REQ-054] > [REQ-054] a config-file connection's agent versions are managed by admins; a screen-made one's by its maker
  - apps/server/src/http/permissions-api.test.ts::what was open to every signed-in person is for its maker and admins [REQ-054] > [REQ-054] an experiment on someone's screen-made connection, created or forked, is for that person and admins; the config file's is open
  - apps/server/src/http/permissions-api.test.ts::what was open to every signed-in person is for its maker and admins [REQ-054] > [REQ-054] checking a model opens its sealed key, so it is for whoever registered it; choosing the default is for admins
  - apps/server/src/http/permissions-api.test.ts::what was open to every signed-in person is for its maker and admins [REQ-054] > [REQ-054] talking through, keeping, re-checking a connection a person made on the screen is for that person
  - apps/server/src/runtime/agent-versions.test.ts::an agent that changed gets a new version when an experiment is made [REQ-053] > a fork looks at the agent again; a fork that is refused changes nothing
  - apps/server/src/runtime/agent-versions.test.ts::an agent that changed gets a new version when an experiment is made [REQ-053] > a harness that cannot be reached says so, and the versions are still there
  - apps/server/src/runtime/agent-versions.test.ts::an agent that changed gets a new version when an experiment is made [REQ-053] > experiments made at the same moment write one version, not two
  - apps/server/src/runtime/agent-versions.test.ts::an agent that changed gets a new version when an experiment is made [REQ-053] > the history says what the next experiment would add, without adding it
  - apps/server/src/runtime/agent-versions.test.ts::an agent that changed gets a new version when an experiment is made [REQ-053] > the same agent keeps its version; a changed one gets the next, with the date and what differs
  - apps/server/src/runtime/agent-versions.test.ts::people add, change and delete versions [REQ-053] > only whoever connected it may change its versions; the config file's connection is for admins
  - apps/server/src/runtime/agent-versions.test.ts::people add, change and delete versions [REQ-053] > the versions go away with the connection; a different agent's stay
  - apps/server/src/runtime/connection-secrets.test.ts::<import:2070e6e0>
  - apps/server/src/runtime/connection-secrets.test.ts::<import:e9fa8dc5>
  - apps/server/src/runtime/connection-secrets.test.ts::a connection nobody uses for a month is removed, after a warning [REQ-051] > an experiment made on it counts as use; the config file's connections never expire
  - apps/server/src/runtime/connection-secrets.test.ts::a token typed on the screen is used, kept sealed and never shown again [REQ-051] > after a restart it still opens; with another key it says what happened
  - apps/server/src/runtime/connection-secrets.test.ts::a token typed on the screen is used, kept sealed and never shown again [REQ-051] > it is sent to the harness, but not found in the view, the meta, the store or any answer
  - apps/server/src/runtime/connection-secrets.test.ts::changing a connection keeps its secrets unless told otherwise [REQ-051] > only its owner may change it or try a change; a change that does not build changes nothing
  - apps/server/src/runtime/connection-traces.test.ts::<import:e810df6f>
  - apps/server/src/runtime/connection-traces.test.ts::strangers may talk but not choose [REQ-079] > anyone can talk to a connection; only its owner changes where its traces go
  - apps/server/src/runtime/connection-traces.test.ts::where a connection's traces pile up is chosen per connection [REQ-079] > changing a connection keeps the key unless a new one is typed; leaving traces out keeps the choice
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > a connection that cannot talk says so instead of failing"
  - apps/server/src/runtime/connections.test.ts::<import:869ea03e>
  - apps/server/src/runtime/connections.test.ts::<import:e9fa8dc5>
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > a fresh server lists the built-in agent as a read-only connection
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > a harness from the config file keeps its settings for display, and ports of any kind are listed
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > asking again sees a harness's new agents without waiting for the cache
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > only whoever connected it can remove it, and not while runs are on it
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > trying a connection reports the agents it found and the time it took, and saves nothing
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > what people connected is still there after a restart; one that no longer builds is shown, not lost
  - apps/server/src/runtime/escalation.test.ts::<import:6b061108>
  - apps/server/src/runtime/escalation.test.ts::a draft runbook from the best run [REQ-082] > it is made from the calls of the run with the highest score, and says which run
  - apps/server/src/runtime/metadata.test.ts::<import:e5b6340c>
  - "apps/server/src/runtime/metadata.test.ts::metadata that tells results apart: kept, shown and searched [REQ-052] > experiments are found by their own metadata or by the connection's, with a value or without"
  - apps/server/src/runtime/platform.test.ts::an experiment from creation to result [REQ-030] [REQ-037] > the built-in triage agent solves the cooling failure three times out of three
  - apps/server/src/runtime/platform.test.ts::worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034] > saves check the blueprint, refuse stale versions and let only the owner change things
  - "apps/server/src/runtime/platform.test.ts::worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034] > scenarios: drafts may have problems, templates must fit the world, saves are versioned"
  - apps/server/src/runtime/results.test.ts::benchmarks and the digital twin [REQ-039] [REQ-015] > diagnosis records export as JSON Lines; the brief names what imported worlds lack
  - apps/server/src/runtime/results.test.ts::one run in depth, with the harness's telemetry [REQ-037] > the run view folds in tokens from ClickStack; the raw trace is there too
  - apps/server/src/runtime/results.test.ts::sharing results [REQ-038] > reports in three formats, and links that open without the app until taken back or expired
  - apps/server/src/runtime/world-templates.test.ts::<import:b95fbde8>
  - apps/server/src/runtime/world-templates.test.ts::서비스부터 만든 세계와 템플릿 [REQ-094] > 템플릿은 세계 목록에 끼지 않고 따로 나열되며, 구성을 그대로 담는다
  - apps/web/src/logic/models.test.ts::=view
  - packages/core/src/contract/policies.test.ts::every route says who may call it [REQ-054] > [REQ-054] what the survey found open before is now guarded by a named policy
test_change_reason: 나 단계(공개 범위)로 요구가 바뀐다. 남의 "나만"인 연결·모델은 이제 보이지 않으므로(없는 것처럼 404) 403을 기대하던 시험은 404를 기대한다. 처음 등록한 모델이 저절로 기본이 되어 모두가 쓰던 동작은 사라지므로(기본은 범위가 "모두"인 모델만) 기본 모델 시험은 "모두" 모델을 쓰고, 남의 "나만" 모델을 확인하면 404를 기대한다. 읽기 목록과 판정 함수가 보는 사람(Viewer)을 받으므로 그 호출 모양이 바뀌고, 존재하지 않는 실행의 활동 사건은 보이지 않으므로 활동 스트림 시험은 실제 실행을 쓴다.
decision_hash: e2a97fce4eee7dec
---
# ADR-0179 공개 범위의 두 결정(기본 모델은 "모두"인 모델만, 범위 바꾸기는 한 길)과 ADR-0174의 바뀐 시험 목록

## 맥락
[ADR-0174](0174-permissions-proxy-identity-three-scopes-audit.md)는 권한을 가·나·다·라·마 단계로 만든다고 정했고, 가 단계는 바뀐 잠긴 시험을 그 ADR의 머리말로 알렸다. 나 단계(공개 범위: 읽기 거르기, 물려받기, 쓰려면 볼 수 있어야, 공유 링크 목록)는 결정을 바꾸지 않고 0174가 이미 정한 대로 만든다. 다만 그 결과로 잠긴 시험 몇 가지의 기대가 바뀐다.

- 화면에서 만든 연결과 모델 등록은 처음 값이 "나만"이라 남에게는 보이지 않는다. 남이 확인·대화·지우기를 부르면 403이 아니라 없는 것처럼 404다. 403을 기대하던 시험이 404를 기대하게 된다.
- 처음 등록한 모델이 저절로 기본이 되던 동작은 "나만" 모델의 키를 남이 쓰게 하므로 바뀐다(결정 1). 기본은 "모두" 모델만 되고, 남이 "나만" 모델을 확인하면 404다.
- 읽기 목록과 판정이 보는 사람(`Viewer`)을 받으므로, 이를 부르던 시험의 호출 모양이 바뀐다.
- 활동 스트림은 사건마다 그 실행의 실험이 보이는지 본다. 존재하지 않는 실행의 사건을 흘리던 시험은 실제 실행을 쓴다.

## 결정
1. **모두의 기본 모델은 범위가 "모두"인 모델만 될 수 있다.** "나만"·"우리 파트" 모델은 기본으로 정할 수 없고(400, 쉬운 말의 이유), 기본 모델의 범위를 "모두"보다 좁히려 하면 거절한다("기본 모델은 모두가 써요. 먼저 다른 모델을 기본으로 정해 주세요"). 저절로 기본이 되는 것은 "모두" 모델이 처음 생길 때뿐이다. 기본을 지우면 가장 먼저 등록된 "모두" 모델로 넘어가고, 없으면 모두의 기본은 없다. 모두의 기본을 바꾸는 것은 관리자와 그 모델의 주인뿐이다(`POST /api/models/:id/default`의 정책은 `change`).
2. **한 사람에게 보이는 기본은 한 함수가 정한다**(`defaultFor`): 모두의 기본이 있으면 그것, 없으면 그 사람이 볼 수 있는 모델 중 가장 먼저 등록된 것. 이끼를 비롯해 기본 모델을 쓰는 모든 길이 이 함수를 거친다. 모델 하나를 혼자 쓰는 개발 모드는 그대로 돈다. 관리자라도 남의 "나만" 모델은 자기 기본으로 세지 않는다(남의 키를 조용히 쓰지 않는다).
3. **범위 바꾸기는 다섯 종류 모두 같은 길**이다: `PUT /api/<worlds|scenarios|experiments|connections|models>/:id/scope`, 본문은 `{ scope, group? }`뿐. 기존 고치기 길은 범위를 받지 않는다(연결의 범위만 바꾸려고 설정을 다시 보내지 않는다). 모두 `changeScope` 한 함수를 지난다.
4. **모델 이름은 만든 사람 안에서, 그리고 "모두"로 만든 등록 사이에서만 유일하다.** 전체에서 유일하면 남의 "나만" 모델과 같은 이름을 적을 때의 충돌(409)로 그 모델이 있다는 사실이 샌다. 이제 남의 "나만"·"우리 파트" 모델과는 이름을 견주지 않는다. 모델은 이름이 아니라 ID로 가리키므로(기본 모델, 이끼, 확인) 다른 곳을 고칠 일이 없다. "나만" 모델을 "모두"로 넓힐 때 같은 이름의 "모두" 모델이 있으면 409다.
5. 바뀐 잠긴 시험의 목록과 까닭은 이 ADR의 머리말(`amends_tests`, `test_change_reason`)에 적는다. 이 ADR은 그 파일을 고치는 일을 승인하는 것이고, 가드레일(검사 규칙, 보호 경로 목록, 시험 잠금 규칙)은 건드리지 않는다. 나 단계의 새 시험은 이 변경에서 잠근다.

## 이유
잠긴 시험을 몰래 바꾸지 않고 바뀐 시험마다 까닭을 남기는 길은 `amends_tests`뿐이다. 합쳐진 0174의 머리말을 다시 고치는 대신, 새 ADR이 목록을 갖는다(잠금은 이번 변경에 새로 더한 ADR만 받아들인다). 새 결정이 없으므로 본문은 짧게 둔다.

## 버린 길
- 잠긴 시험을 그대로 두고 코드를 맞추기: "나만"인 연결을 남이 볼 수 있게 되거나 403으로 존재를 알려 주게 되어 0174의 읽기 규칙과 어긋난다.
- 기본 모델을 범위와 상관없이 모두가 쓰게 두기(이 변경의 첫 모습): 처음 등록한 "나만" 모델이 저절로 기본이 되어 그 사람의 키가 남의 호출에 쓰인다.
- 0174 본문이나 머리말의 시험 목록을 고치기: 본문은 봉인되어 있고 결정은 그대로다. 0174에는 `amended_by`만 남는다.

## 결과
나 단계는 이 ADR의 머리말 목록으로 잠긴 시험의 변경을 알린다. 다 단계(감사 기록)와 라 단계(화면)가 또 바꿀 시험이 있으면 같은 길로 알린다.
