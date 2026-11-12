---
title: ADR-0188 내부 사실 서술을 요구의 말로 고친다 — ADR-0187에 따른 두 번째 걷어내기
kind: decision
status: active
enforced_by:
  - none
no_enforcement_reason: 어떤 문장이 내부 사실인지는 기계가 가릴 수 없다(ADR-0187과 같다). 정리 작업의 독립 감사와 사람의 검토로 본다.
updates_docs:
  - README.md
  - docs/design-docs/camera-and-backdrop.md
  - docs/design-docs/campus-layout.md
  - docs/design-docs/container-layer.md
  - docs/design-docs/gpu-catalog.md
  - docs/design-docs/harness-e2e.md
  - docs/design-docs/harness-protocol.md
  - docs/design-docs/lead-times.md
  - docs/design-docs/model-registration.md
  - docs/design-docs/model-standards.md
  - docs/design-docs/moss.md
  - docs/design-docs/operations.md
  - docs/design-docs/permissions.md
  - docs/design-docs/physics-laws.md
  - docs/design-docs/pipeline-versions-and-branches.md
  - docs/design-docs/product-design.md
  - docs/design-docs/ranking-and-titles.md
  - docs/design-docs/reality-data-and-ontology.md
  - docs/design-docs/reality-shape-samples.md
  - docs/design-docs/scenario-editor-review.md
  - docs/design-docs/site-dr-layer.md
  - docs/design-docs/source-management.md
  - docs/design-docs/web-ui-connections.md
  - docs/design-docs/web-ui-topology.md
  - docs/design-docs/web-ui.md
  - docs/design-docs/world-entry.md
  - docs/design-docs/world-sources.md
  - docs/exec-plans/active/beta-feedback.md
  - docs/exec-plans/active/beta-rounds.md
  - docs/exec-plans/active/build-plan.md
  - docs/index.md
  - docs/product-specs/requirements.md
touches_protected:
  - harness/src/common.test.ts
  - docs/product-specs/requirements.md
  - docs/design-docs/adr/**
  - harness/config/test-lock.json
amends_tests:
  - harness/src/common.test.ts::check entry points [REQ-024] > run-all runs every check and prints a verdict
  - packages/core/src/analysis/stopped-experiment.test.ts::=BEFORE
  - apps/server/src/adapters/adapters.test.ts::harness telemetry from ClickStack [REQ-037] > spans and logs of one trace, with numbers restored and the trace id as a parameter
  - apps/server/src/adapters/sqlite-community.test.ts::hearts, marks and awards on SQLite [REQ-101] > [REQ-101] a heart is one per person per world and survives asking twice
  - apps/server/src/adapters/sqlite-community.test.ts::hearts, marks and awards on SQLite [REQ-101] > [REQ-101] awards keep the first time; marks keep the latest per scenario version
  - apps/server/src/adapters/telemetry/telemetry.test.ts::=GENERATION
  - apps/server/src/adapters/telemetry/telemetry.test.ts::=spanRow
  - apps/server/src/adapters/telemetry/telemetry.test.ts::Langfuse as a connection's telemetry [REQ-079] > a session's observations become spans with the model, tokens, cost and the time it took
  - apps/server/src/http/activity-stream.test.ts::=WHO
  - apps/server/src/http/activity-stream.test.ts::the live view of a world as server-sent events [REQ-050] > runs already working come first, then what they do as it happens; a world that is not there is a 404
  - apps/server/src/http/agent-versions-api.test.ts::<import:f3449f0e>
  - apps/server/src/http/agent-versions-api.test.ts::the versions of an agent over HTTP [REQ-053] > list, add, edit and delete by address; an agent with a slash in its id works
  - apps/server/src/http/app.test.ts::=json
  - apps/server/src/http/app.test.ts::an experiment over HTTP [REQ-030] [REQ-038] > changing someone else's things is refused; a server fault hides its internals
  - apps/server/src/http/app.test.ts::an experiment over HTTP [REQ-030] [REQ-038] > world, scenario, experiment, result, report and a share link that opens without the app
  - apps/server/src/http/app.test.ts::live progress as server-sent events [REQ-030] > a summary first, then runs and tool calls as they happen
  - apps/server/src/http/app.test.ts::who is asking [REQ-033] > the SSO proxy's header wins and cannot be faked; otherwise the name people typed
  - apps/server/src/http/calibrate.test.ts::=headers
  - apps/server/src/http/connection-try-api.test.ts::=GENERATION
  - "apps/server/src/http/connection-try-api.test.ts::말 걸어 보기 and the tools for traces over HTTP [REQ-079] > over HTTP: the route runs the turn, and the tools for traces are listed"
  - apps/server/src/http/connections-api.test.ts::connecting a harness from the screen, over HTTP [REQ-051] > try, save, change, keep, re-check and remove; strangers may not change it
  - apps/server/src/http/connections-api.test.ts::what was typed on the screen is still there after a restart [REQ-051] > the SQLite store keeps the sealed secrets, headers, metadata and agent versions
  - apps/server/src/http/identity-loopback.test.ts::=typed
  - apps/server/src/http/identity-proxy.test.ts::=NFC
  - apps/server/src/http/identity-proxy.test.ts::=NFD
  - apps/server/src/http/identity-proxy.test.ts::behind the proxy, only the proxy is believed [REQ-054] > [REQ-054] UTF-8 sent raw by the proxy (read as Latin-1 by Node) is put back together
  - "apps/server/src/http/identity-proxy.test.ts::behind the proxy, only the proxy is believed [REQ-054] > [REQ-054] who the proxy says is who is asked: login id, display name, groups and roles"
  - apps/server/src/http/identity-proxy.test.ts::typed names are for one person on their own machine [REQ-054] > [REQ-054] meta says which mode is on, so the screen can say there is no protection
  - apps/server/src/http/identity-proxy.test.ts::typed names are for one person on their own machine [REQ-054] > [REQ-054] nobody is an admin without the token, and a name on the list does not make one
  - apps/server/src/http/identity-proxy.test.ts::typed names are for one person on their own machine [REQ-054] > [REQ-054] the admin token gates the admin routes in this mode
  - "apps/server/src/http/identity-proxy.test.ts::typed names are for one person on their own machine [REQ-054] > [REQ-054] the old behaviour for one developer stays: a typed name works, no name is the shared anonymous user"
  - apps/server/src/http/identity-proxy.test.ts::typed names are for one person on their own machine [REQ-054] > [REQ-054] with no token configured, a request from another address is no admin, whatever is sent
  - apps/server/src/http/identity.test.ts::who is asking is one slot an SSO can fill [REQ-054] > a method that refuses strangers answers 401 on routes and on live streams, but not on shared links
  - apps/server/src/http/identity.test.ts::who is asking is one slot an SSO can fill [REQ-054] > a sign-in the server checks itself decides the viewer, and a typed name cannot pretend otherwise
  - apps/server/src/http/identity.test.ts::who is asking is one slot an SSO can fill [REQ-054] > without an SSO the settings give the proxy header, else a typed name
  - apps/server/src/http/models-api.test.ts::=setup
  - "apps/server/src/http/models-api.test.ts::registering model APIs: add, list, change, delete [REQ-099] > an empty workspace lists nothing; the first one registered is the default; the key is only its last four letters"
  - "apps/server/src/http/models-api.test.ts::registering model APIs: add, list, change, delete [REQ-099] > only whoever registered it changes, deletes or checks it; only an admin chooses the default"
  - apps/server/src/http/models-api.test.ts::registrations survive a restart, sealed [REQ-099] > the SQLite file keeps them, the key is not readable in it, and the same secret box opens it again
  - apps/server/src/http/moss-api.test.ts::=setup
  - apps/server/src/http/physics-api.test.ts::<import:4eea0d07>
  - apps/server/src/http/physics-api.test.ts::=setup
  - apps/server/src/http/physics-api.test.ts::the physics slots and a world's physics profile over HTTP [REQ-113] > a profile that cannot be used is refused with every problem in Korean; a stale version and a stranger are refused too
  - apps/server/src/http/physics-api.test.ts::the physics slots and a world's physics profile over HTTP [REQ-113] > a world starts on the default physics, v1
  - apps/server/src/http/physics-api.test.ts::the physics slots and a world's physics profile over HTTP [REQ-113] > an experiment keeps the fingerprint of the physics it ran on, and the run result says it too
  - apps/server/src/http/physics-api.test.ts::the physics slots and a world's physics profile over HTTP [REQ-113] > saving a profile makes a new version of the world with another fingerprint; saving the default puts it back
  - apps/server/src/http/presets-api.test.ts::saved instructions, tool sets and runbooks over HTTP [REQ-090] [REQ-080] [REQ-082] > a deleted one is kept for seven days and then forgotten
  - apps/server/src/http/presets-api.test.ts::saved instructions, tool sets and runbooks over HTTP [REQ-090] [REQ-080] [REQ-082] > save, list, rename, delete and bring back; the same name changes the one it names
  - apps/server/src/http/presets-api.test.ts::saved instructions, tool sets and runbooks over HTTP [REQ-090] [REQ-080] [REQ-082] > they are the person's own; a body that does not fit its kind is refused
  - apps/server/src/http/presets-api.test.ts::saved instructions, tool sets and runbooks over HTTP [REQ-090] [REQ-080] [REQ-082] > what an older browser kept is taken once, skipping names already there
  - apps/server/src/http/process-api.test.ts::=setup
  - apps/server/src/http/process-api.test.ts::지금 하는 방식 표 [REQ-112] > [REQ-112] 안 적은 시나리오는 비어 있고, 적으면 단계·사람·시간이 더해져 돌아온다
  - apps/server/src/http/routes.test.ts::=headers
  - apps/server/src/http/scoring-unchanged.test.ts::scoring is unchanged with permissions on [REQ-054] [REQ-039] > [REQ-054] [REQ-039] an experiment run behind the proxy has the score breakdown it had before permissions
  - apps/server/src/http/service-cards-api.test.ts::<import:b8568d3b>
  - apps/server/src/http/service-cards-api.test.ts::=setup
  - apps/server/src/http/service-cards-api.test.ts::빠른 실험 [REQ-104] > [REQ-104] 다음 번에는 방금 쓴 에이전트를 고른다
  - apps/server/src/http/service-cards-api.test.ts::빠른 실험 [REQ-104] > [REQ-104] 한 번의 요청으로 시나리오 세트 운영 실험이 5번 만들어지고 내장 operator를 쓴다
  - apps/server/src/http/service-cards-api.test.ts::빠른 실험 [REQ-104] > [REQ-104] 화면이 고른 시나리오만 쓰고, 하나도 없으면 막는다
  - apps/server/src/http/service-cards-api.test.ts::서비스 카드 [REQ-104] > [REQ-104] 처음엔 잠김·공유 안 함이고, 남에게는 공유한 뒤에만 보인다
  - apps/server/src/http/service-cards-api.test.ts::서비스 카드 저장 [REQ-104] > [REQ-104] SQLite에 저장하고 다시 열어도 카드가 남고, 지우면 사라진다
  - apps/server/src/http/world-community-api.test.ts::<import:450f2251>
  - apps/server/src/http/world-community-api.test.ts::=setup
  - apps/server/src/http/world-community-api.test.ts::=world
  - apps/server/src/http/world-community-api.test.ts::세계 인기 순서와 근거 [REQ-101] > [REQ-101] 같은 점수는 만든 때로 가르고, 몇 번을 읽어도 같은 순서다
  - apps/server/src/http/world-community-api.test.ts::세계 인기 순서와 근거 [REQ-101] > [REQ-101] 인기는 최근 30일 실험 + 좋아요 + 남이 시작한 수이고, 카드가 근거를 싣고 온다
  - "apps/server/src/http/world-community-api.test.ts::세계 인기 순서와 근거 [REQ-101] > [REQ-101] 정렬은 넷: 인기·요즘 활발·새로 생김·내 세계, 비슷하면 나중에 생긴 것이 앞이다"
  - apps/server/src/http/world-community-api.test.ts::세계 인기 순서와 근거 [REQ-101] > [REQ-101] 템플릿이나 세계로 시작한 세계는 그 출처를 기록하고, 남이 시작한 것만 점수에 든다
  - apps/server/src/http/world-community-api.test.ts::좋아요 [REQ-101] > [REQ-101] 사람마다 세계마다 하나, 다시 눌러도 하나, 취소하면 줄고, 목록에 개수와 내 것이 실린다
  - apps/server/src/http/world-community-api.test.ts::좋아요 [REQ-101] > [REQ-101] 없는 세계는 404, 이름이 없는 사람은 403이고 아무것도 남지 않는다
  - apps/server/src/http/world-community-api.test.ts::칭호 [REQ-101] > [REQ-101] 남이 쓰는 세계와 남이 쓰는 시나리오는 다른 사람의 실험 10번부터, 내 실험은 세지 않는다
  - apps/server/src/http/world-community-api.test.ts::칭호 [REQ-101] > [REQ-101] 만든 사람의 칭호가 세계 카드와 실험 목록에 같이 온다
  - "apps/server/src/http/world-community-api.test.ts::칭호 [REQ-101] > [REQ-101] 변별력 점검: 점검하면 기록이 남고, 고칠 곳이 없던 시나리오 5개가 꼼꼼한 출제자다"
  - apps/server/src/http/world-community-api.test.ts::칭호 [REQ-101] > [REQ-101] 세계를 만들면 첫 세계, 아무것도 안 한 사람은 칭호가 없다
  - apps/server/src/http/world-community-api.test.ts::칭호 [REQ-101] > [REQ-101] 실험 100번·1,000번은 만든 실험 수이고, 얻은 때는 그 번째 실험을 만든 때다
  - apps/server/src/http/world-community-api.test.ts::칭호 [REQ-101] > [REQ-101] 좋아요 10은 다른 사람이 누른 것만 세고, 한 번 얻은 칭호는 세계를 지워도 남는다
  - apps/server/src/http/world-community-api.test.ts::칭호 [REQ-101] > [REQ-101] 첫 복구는 에이전트가 내 시나리오를 처음 통과했을 때, 떨어진 것은 안 센다
  - apps/server/src/http/world-community-api.test.ts::칭호 [REQ-101] > [REQ-101] 템플릿과 예시 세계는 첫 세계로 세지 않는다
  - apps/server/src/main.test.ts::starting and stopping the server [REQ-030] > a config file is all it takes; data lives next to it and survives a restart
  - apps/server/src/runtime/agent-versions.test.ts::<import:b0dd44bd>
  - apps/server/src/runtime/agent-versions.test.ts::=setup
  - apps/server/src/runtime/agent-versions.test.ts::an agent that changed gets a new version when an experiment is made [REQ-053] > a fork looks at the agent again; a fork that is refused changes nothing
  - apps/server/src/runtime/agent-versions.test.ts::an agent that changed gets a new version when an experiment is made [REQ-053] > the same agent keeps its version; a changed one gets the next, with the date and what differs
  - apps/server/src/runtime/agent-versions.test.ts::people add, change and delete versions [REQ-053] > a deleted version is gone and its number is not used again
  - apps/server/src/runtime/agent-versions.test.ts::people add, change and delete versions [REQ-053] > adding one, naming it, and the next look compares with what people said
  - apps/server/src/runtime/agent-versions.test.ts::people add, change and delete versions [REQ-053] > the first version may be a person's, then it is the agent as it is now
  - apps/server/src/runtime/agent-versions.test.ts::people add, change and delete versions [REQ-053] > the versions go away with the connection; a different agent's stay
  - apps/server/src/runtime/connection-secrets.test.ts::<import:11dddb1f>
  - apps/server/src/runtime/connection-secrets.test.ts::a connection nobody uses for a month is removed, after a warning [REQ-051] > an experiment made on it counts as use; the config file's connections never expire
  - apps/server/src/runtime/connection-secrets.test.ts::a connection nobody uses for a month is removed, after a warning [REQ-051] > its owner is told a week before, and keeping it starts the month again
  - apps/server/src/runtime/connection-secrets.test.ts::a connection nobody uses for a month is removed, after a warning [REQ-051] > runs still going keep a connection from being removed, and removal can be switched off
  - apps/server/src/runtime/connection-secrets.test.ts::a connection nobody uses for a month is removed, after a warning [REQ-051] > the sweep also runs when the server starts
  - apps/server/src/runtime/connection-secrets.test.ts::a harness that cannot reach Terrarium's tools is told so when it is tried [REQ-051] > only when Terrarium is on this very computer and the harness is on another
  - apps/server/src/runtime/connection-secrets.test.ts::a token typed on the screen is used, kept sealed and never shown again [REQ-051] > after a restart it still opens; with another key it says what happened
  - apps/server/src/runtime/connection-secrets.test.ts::a token typed on the screen is used, kept sealed and never shown again [REQ-051] > it is sent to the harness, but not found in the view, the meta, the store or any answer
  - apps/server/src/runtime/connection-secrets.test.ts::a token typed on the screen is used, kept sealed and never shown again [REQ-051] > typing it and naming a server variable for it is one too many
  - apps/server/src/runtime/connection-secrets.test.ts::changing a connection keeps its secrets unless told otherwise [REQ-051] > =made
  - apps/server/src/runtime/connection-secrets.test.ts::changing a connection keeps its secrets unless told otherwise [REQ-051] > leaving the headers out keeps them; naming a server variable replaces a typed token
  - apps/server/src/runtime/connection-secrets.test.ts::changing a connection keeps its secrets unless told otherwise [REQ-051] > only its owner may change it or try a change; a change that does not build changes nothing
  - apps/server/src/runtime/connection-secrets.test.ts::changing a connection keeps its secrets unless told otherwise [REQ-051] > what is left blank stays, what is typed replaces, null removes
  - apps/server/src/runtime/connection-secrets.test.ts::custom headers go with every request [REQ-051] > a header without the value it needs is said by position
  - apps/server/src/runtime/connection-secrets.test.ts::custom headers go with every request [REQ-051] > a plain one is shown, a secret one only by name, and both are sent
  - apps/server/src/runtime/connection-secrets.test.ts::custom headers go with every request [REQ-051] > what a person typed beats the connector's own default, and trying it uses them too
  - apps/server/src/runtime/connection-traces.test.ts::<import:68f3a5c2>
  - apps/server/src/runtime/connection-traces.test.ts::=GENERATION
  - apps/server/src/runtime/connection-traces.test.ts::a run carries what its connection's telemetry asks, and is read back from there [REQ-079] > with Langfuse chosen, the harness gets the run's name and the page reads Langfuse
  - apps/server/src/runtime/connection-traces.test.ts::a run carries what its connection's telemetry asks, and is read back from there [REQ-079] > with default chosen, the server's own telemetry is the tool
  - apps/server/src/runtime/connection-traces.test.ts::a run carries what its connection's telemetry asks, and is read back from there [REQ-079] > with none chosen, the server's default is not used even for a harness that says it emits traces
  - apps/server/src/runtime/connection-traces.test.ts::strangers may talk but not choose [REQ-079] > anyone can talk to a connection; only its owner changes where its traces go
  - apps/server/src/runtime/connection-traces.test.ts::where a connection's traces pile up is chosen per connection [REQ-079] > a wrong choice is refused at the field that is wrong
  - apps/server/src/runtime/connection-traces.test.ts::where a connection's traces pile up is chosen per connection [REQ-079] > changing a connection keeps the key unless a new one is typed; leaving traces out keeps the choice
  - apps/server/src/runtime/connection-traces.test.ts::where a connection's traces pile up is chosen per connection [REQ-079] > checking a connection also says when the tool for its traces does not answer
  - apps/server/src/runtime/connection-traces.test.ts::where a connection's traces pile up is chosen per connection [REQ-079] > the choice is saved with its key sealed, shown without it, and used to read
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > a connection that cannot talk says so instead of failing"
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > a connection with no place for traces has nothing to check"
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > a refusal is told with its status and what to do, not as a bare failure"
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > the answer, how long it took, no tool calls, and traces that arrived"
  - "apps/server/src/runtime/connection-traces.test.ts::말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079] > traces that do not come say so, and what to look at"
  - apps/server/src/runtime/connections.test.ts::<import:2d409afc>
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > a cloud's credentials address is refused; a server can allow only some hosts
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > a harness that answers badly, or finds nothing, is told apart from a wrong form
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > a harness that reads its tools from its own config shows the fixed tool address; others show none [REQ-051]
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > a secret is only ever the name of a variable the server has
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > an id comes from the name, a taken one gets a number, a chosen one that is taken is refused
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > asking again sees a harness's new agents without waiting for the cache
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > connecting a harness finds its agents, and they can be chosen in an experiment
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > one that never answers is given up on, and shows as unreachable
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > only whoever connected it can remove it, and not while runs are on it
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > the command connector is for the config file only
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > trying a connection reports the agents it found and the time it took, and saves nothing
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > what is wrong with the form is said by field
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > what people connected is still there after a restart; one that no longer builds is shown, not lost
  - apps/server/src/runtime/escalation.test.ts::<import:8e8150af>
  - apps/server/src/runtime/escalation.test.ts::=resultOf
  - apps/server/src/runtime/escalation.test.ts::=waiting
  - apps/server/src/runtime/escalation.test.ts::a draft runbook from the best run [REQ-082] > it is made from the calls of the run with the highest score, and says which run
  - apps/server/src/runtime/escalation.test.ts::a run that waits for a person [REQ-081] > a person acts first; the run waits on, then the work goes back as a summary
  - apps/server/src/runtime/escalation.test.ts::a run that waits for a person [REQ-081] > a person can end the run
  - apps/server/src/runtime/escalation.test.ts::a run that waits for a person [REQ-081] > handing over tools gives the agent more tools
  - apps/server/src/runtime/escalation.test.ts::a run that waits for a person [REQ-081] > only the one who ran the experiment answers
  - apps/server/src/runtime/escalation.test.ts::a run that waits for a person [REQ-081] > stopping the experiment while it waits ends the wait
  - apps/server/src/runtime/escalation.test.ts::a run that waits for a person [REQ-081] > the card shows the request and the last calls, and a reply goes back as the tool result
  - apps/server/src/runtime/escalation.test.ts::the settings of an experiment [REQ-080] [REQ-081] [REQ-082] > faults limited to the given tools refuse a scenario those tools cannot solve, naming the tool
  - apps/server/src/runtime/escalation.test.ts::the settings of an experiment [REQ-080] [REQ-081] [REQ-082] > finding the runbook is a tool the agent needs, so choosing it gives the tool
  - apps/server/src/runtime/escalation.test.ts::the settings of an experiment [REQ-080] [REQ-081] [REQ-082] > they are kept with the recipe, shown in a fork's changes and checked
  - apps/server/src/runtime/executor-activity.test.ts::<import:f7d767d7>
  - apps/server/src/runtime/executor-activity.test.ts::=play
  - apps/server/src/runtime/executor-activity.test.ts::who works where in a world [REQ-050] > a run announces itself, then each call with the equipment it names and what it does, then its end
  - apps/server/src/runtime/executor-activity.test.ts::who works where in a world [REQ-050] > someone who arrives while a run is working is told who is working, and nobody once it is over
  - apps/server/src/runtime/executor-activity.test.ts::who works where in a world [REQ-050] > the experiment's own stream carries the same equipment and effect
  - apps/server/src/runtime/executor.test.ts::<import:a6bcd901>
  - apps/server/src/runtime/executor.test.ts::=runWith
  - apps/server/src/runtime/executor.test.ts::how a run ends [REQ-030] [REQ-031] > a run whose harness or world version has gone fails with the reason
  - apps/server/src/runtime/meta-slot.test.ts::<import:88d2955a>
  - apps/server/src/runtime/meta-slot.test.ts::the new-experiment screen is told which harness has a fixed tool address [REQ-051] > the meta of a harness with a slot names it, and a plain harness has none
  - apps/server/src/runtime/metadata.test.ts::<import:1b1baf5b>
  - apps/server/src/runtime/metadata.test.ts::=setup
  - "apps/server/src/runtime/metadata.test.ts::metadata that tells results apart: kept, shown and searched [REQ-052] > a fork keeps its parent's metadata, or replaces it; who runs it is looked up again only when that changed"
  - "apps/server/src/runtime/metadata.test.ts::metadata that tells results apart: kept, shown and searched [REQ-052] > an agent with nothing to say about itself is still named, and a harness of the config file has no metadata"
  - "apps/server/src/runtime/metadata.test.ts::metadata that tells results apart: kept, shown and searched [REQ-052] > an experiment keeps what its maker attached and who ran it, as they were when it was made"
  - "apps/server/src/runtime/metadata.test.ts::metadata that tells results apart: kept, shown and searched [REQ-052] > experiments are found by their own metadata or by the connection's, with a value or without"
  - "apps/server/src/runtime/metadata.test.ts::metadata that tells results apart: kept, shown and searched [REQ-052] > the model that really answered, and the tokens, are kept with the run"
  - apps/server/src/runtime/models-sealed.test.ts::<import:88d2955a>
  - apps/server/src/runtime/models-sealed.test.ts::a registered model whose sealed key cannot be opened says so instead of failing [REQ-099] > the check answers not ok with a reason in words, and keeps that on the record
  - apps/server/src/runtime/operation-resume.test.ts::<import:a5114600>
  - apps/server/src/runtime/operation-resume.test.ts::=begin
  - apps/server/src/runtime/operation-resume.test.ts::=finished
  - apps/server/src/runtime/operation-resume.test.ts::an operation goes on after the server restarts [REQ-090] > the stopped run is built again from its journal, records the gap and ends with the hours used
  - apps/server/src/runtime/operation-run.test.ts::<import:a5114600>
  - apps/server/src/runtime/operation-run.test.ts::=finished
  - apps/server/src/runtime/operation-run.test.ts::=operate
  - apps/server/src/runtime/operation-run.test.ts::an operation experiment runs the resident operator for its hours [REQ-090] > an operation without events_since is refused, with the way out
  - apps/server/src/runtime/operation-run.test.ts::an operation experiment runs the resident operator for its hours [REQ-090] > waking on every alarm needs a harness that can take it; the built-in one can, others say why not
  - apps/server/src/runtime/operator-agent.test.ts::<import:e3c333fe>
  - apps/server/src/runtime/operator-agent.test.ts::=play
  - apps/server/src/runtime/partner-activity.test.ts::<import:ced811c2>
  - apps/server/src/runtime/partner-activity.test.ts::=play
  - apps/server/src/runtime/permissions.test.ts::<import:06cc7d3d>
  - apps/server/src/runtime/permissions.test.ts::=mine
  - apps/server/src/runtime/permissions.test.ts::the one place that decides who may do what [REQ-054] > [REQ-054] %s is for the maker and an admin, not another signed-in person
  - apps/server/src/runtime/permissions.test.ts::the one place that decides who may do what [REQ-054] > [REQ-054] a refusal reaches the caller as a 403 that names the thing
  - apps/server/src/runtime/permissions.test.ts::the one place that decides who may do what [REQ-054] > [REQ-054] a share link may be taken back by its maker, the experiment's maker or an admin
  - apps/server/src/runtime/permissions.test.ts::the one place that decides who may do what [REQ-054] > [REQ-054] a thing nobody made (the config file's) is changed by admins only
  - apps/server/src/runtime/permissions.test.ts::the one place that decides who may do what [REQ-054] > [REQ-054] administering is for admins; liking is for anyone who has said who they are
  - "apps/server/src/runtime/permissions.test.ts::the one place that decides who may do what [REQ-054] > [REQ-054] the same person under another display name is the same owner: ownership is the login id"
  - "apps/server/src/runtime/permissions.test.ts::the one place that decides who may do what [REQ-054] > [REQ-054] using a connection: anyone signed in for the config file's, the maker and admins for one made on the screen"
  - apps/server/src/runtime/platform.test.ts::<import:9b1d0a69>
  - apps/server/src/runtime/platform.test.ts::an experiment from creation to result [REQ-030] [REQ-037] > a recipe is checked against what really exists before anything is queued
  - apps/server/src/runtime/platform.test.ts::an experiment from creation to result [REQ-030] [REQ-037] > the built-in triage agent solves the cooling failure three times out of three
  - apps/server/src/runtime/platform.test.ts::cancelling and the queue [REQ-030] [REQ-032] > a restarted server fails what was mid-flight and runs what was waiting
  - apps/server/src/runtime/platform.test.ts::cancelling and the queue [REQ-030] [REQ-032] > queued runs wait their turn; cancelling stops the running one and drops the rest
  - apps/server/src/runtime/platform.test.ts::cancelling and the queue [REQ-030] [REQ-032] > stopping the server ends running runs as failed, with the reason
  - apps/server/src/runtime/platform.test.ts::forks, more runs and lineage [REQ-040] > a fork changes one condition, keeps the parent's versions and shows the difference
  - apps/server/src/runtime/platform.test.ts::forks, more runs and lineage [REQ-040] > more runs continue the seeds; repeating a seed or someone else's experiment is refused
  - apps/server/src/runtime/platform.test.ts::worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034] > a dry run shows what the scenario does to the world, with no agent
  - apps/server/src/runtime/platform.test.ts::worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034] > saves check the blueprint, refuse stale versions and let only the owner change things
  - "apps/server/src/runtime/platform.test.ts::worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034] > scenarios: drafts may have problems, templates must fit the world, saves are versioned"
  - apps/server/src/runtime/platform.test.ts::worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034] > worlds come from presets and from reality, with what was assumed
  - apps/server/src/runtime/repeats.test.ts::<import:b30b4a92>
  - apps/server/src/runtime/repeats.test.ts::repeats of a seed [REQ-118] > a built-in agent repeated on a seed does the same thing to the byte; the seed decides the world
  - apps/server/src/runtime/repeats.test.ts::repeats of a seed [REQ-118] > adding a repeat gives every seed one more run; adding seeds gives them the repeats it has now
  - apps/server/src/runtime/repeats.test.ts::repeats of a seed [REQ-118] > an experiment makes its runs a round at a time, and says how it was made
  - apps/server/src/runtime/repeats.test.ts::repeats of a seed [REQ-118] > the harness is told which run of the seed it is, and the seed stays the same
  - apps/server/src/runtime/repeats.test.ts::repeats of a seed [REQ-118] > the runs of an experiment, seeds times repeats, have a limit that is said before anything is queued
  - apps/server/src/runtime/results-world.test.ts::<import:d06fb2a2>
  - apps/server/src/runtime/results-world.test.ts::a run shows the world as it was when the experiment was made [REQ-037] > the world view carries the version the experiment recorded, with the name and digest, and a run that is not there is not found
  - apps/server/src/runtime/results.test.ts::<import:b2f7d3c1>
  - apps/server/src/runtime/results.test.ts::=trace
  - apps/server/src/runtime/results.test.ts::benchmarks and the digital twin [REQ-039] [REQ-015] > diagnosis records export as JSON Lines; the brief names what imported worlds lack
  - apps/server/src/runtime/results.test.ts::benchmarks and the digital twin [REQ-039] [REQ-015] > leaderboards rank configurations within one benchmark set
  - apps/server/src/runtime/results.test.ts::one run in depth, with the harness's telemetry [REQ-037] > a ClickStack that is down does not break the result page, only the raw trace
  - apps/server/src/runtime/results.test.ts::one run in depth, with the harness's telemetry [REQ-037] > the run view folds in tokens from ClickStack; the raw trace is there too
  - apps/server/src/runtime/results.test.ts::one run in depth, with the harness's telemetry [REQ-037] > without telemetry configured there is simply nothing extra
  - apps/server/src/runtime/results.test.ts::sharing results [REQ-038] > reports in three formats, and links that open without the app until taken back or expired
  - apps/server/src/runtime/run-events.test.ts::<import:1b1baf5b>
  - apps/server/src/runtime/run-events.test.ts::a run's record is served as events with two clocks [REQ-083] > a finished run gives its events, the wall clock on every one, and a window cuts them
  - apps/server/src/runtime/run-events.test.ts::a run's record is served as events with two clocks [REQ-083] > while the run goes, the live record has what happened so far; afterwards it is forgotten
  - apps/server/src/runtime/test-support/platform.ts::=YEONSU
  - apps/server/src/runtime/test-support/platform.ts::=seed
  - apps/server/src/runtime/world-templates.test.ts::<import:88d2955a>
  - apps/server/src/runtime/world-templates.test.ts::서비스부터 만든 세계와 템플릿 [REQ-094] > 모양으로 세계를 만들고, 서비스·일감이 세계에 저장된다
  - apps/server/src/runtime/world-templates.test.ts::서비스부터 만든 세계와 템플릿 [REQ-094] > 템플릿은 세계 목록에 끼지 않고 따로 나열되며, 구성을 그대로 담는다
  - "apps/server/src/scale-out.test.ts::scale out: a control plane with no sessions of its own, and workers that join it [REQ-042] > queued runs wait for capacity, start when a worker joins, and the worker leaves politely"
  - apps/web/src/logic/activity-group.test.ts::=worker
  - apps/web/src/logic/activity.test.ts::=who
  - apps/web/src/logic/agent-versions.test.ts::a version history reads in words [REQ-053] > versions are changed by the one who connected it, or by anyone when the server's file did
  - apps/web/src/logic/editors.test.ts::=parent
  - apps/web/src/logic/experiment-fork-counts.test.ts::=base
  - apps/web/src/logic/experiment-metadata.test.ts::=parent
  - apps/web/src/logic/human-talk.test.ts::=card
  - apps/web/src/logic/logic.test.ts::the API client speaks the contract [REQ-030] > paths, methods, the viewer's name, JSON bodies and document responses
  - apps/web/src/logic/logic.test.ts::the name people give [REQ-033] > kept in the browser, checked, forgotten on request
  - apps/web/src/logic/models.test.ts::=view
  - apps/web/src/logic/tool-picker.test.ts::=record
  - apps/web/src/logic/world3d/markers.test.ts::=worker
  - packages/core/src/analysis/analysis.test.ts::=trace
  - packages/core/src/analysis/analysis.test.ts::benchmark leaderboards [REQ-039] > configurations are pooled across people and ranked; small samples wait unranked
  - packages/core/src/analysis/analysis.test.ts::one run, analysed [REQ-037] > the harness's trace adds model calls and tokens; what the harness reported wins
  - packages/core/src/analysis/seed-statistics.test.ts::a seed that two experiments share counts once on the leaderboard [REQ-118] > =share
  - packages/core/src/analysis/seed-statistics.test.ts::a seed that two experiments share counts once on the leaderboard [REQ-118] > a configuration with runs on fewer than three different seeds waits unranked, however many runs it has
  - "packages/core/src/analysis/seed-statistics.test.ts::one run per seed, no shared seed: the numbers are the ones from before [REQ-118] > a leaderboard whose experiments share no seed pools runs as it did"
  - packages/core/src/analysis/test-support/runs.ts::=experimentOf
  - packages/core/src/contract/contract.test.ts::the route table [REQ-030] > paths are filled in and encoded; a missing parameter is an error, not a broken link
  - packages/core/src/experiments/agent-version.test.ts::a version is written only when the agent differs from the newest [REQ-053] > a changed agent gets the next number, the date and what changed
  - packages/core/src/experiments/agent-version.test.ts::a version is written only when the agent differs from the newest [REQ-053] > the first look writes version 1; the same agent again writes nothing
  - packages/core/src/experiments/agent-version.test.ts::people add, change and delete versions [REQ-053] > =start
  - packages/core/src/experiments/agent-version.test.ts::people add, change and delete versions [REQ-053] > the first version can be a person's, and its attributes are the person's alone
  - packages/core/src/experiments/community.test.ts::competitions [REQ-101] > [REQ-101] a person is ranked once, on their best agent
  - packages/core/src/experiments/community.test.ts::competitions [REQ-101] > [REQ-101] medals add up across competitions and give a tier
  - packages/core/src/experiments/community.test.ts::hearts, marks and awards in the memory store [REQ-101] > [REQ-101] awards are kept as first written
  - packages/core/src/experiments/community.test.ts::hearts, marks and awards in the memory store [REQ-101] > [REQ-101] one heart per person per world; taking it back removes it
  - packages/core/src/experiments/community.test.ts::world popularity [REQ-101] > =worlds
  - packages/core/src/experiments/community.test.ts::world popularity [REQ-101] > [REQ-101] a started-from that points nowhere counts for nothing
  - packages/core/src/experiments/community.test.ts::world popularity [REQ-101] > [REQ-101] score = experiments in 30 days + hearts + worlds others started from it
  - packages/core/src/experiments/community.test.ts::world popularity [REQ-101] > [REQ-101] sorts by score and breaks ties by the newer world, then id
  - packages/core/src/experiments/community.test.ts::world popularity [REQ-101] > [REQ-101] 새로 생김 is newest first; 내 세계 keeps only mine, last edited first
  - packages/core/src/experiments/experiments.test.ts::=experiment
  - packages/core/src/experiments/experiments.test.ts::memory store [REQ-030] [REQ-033] > =world
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > <suite>
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > =rectOf
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > =traced
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > every fab and data-centre place lies inside its site, and no two of them overlap
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > every place for a building has a size, and only the three mapped sites have fab places
  - "packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > sites without a map to read have no fixed places: their buildings are spread over the land"
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > the sites with a map have as many fabs as the blue roofs counted on it; the HPC centre is at Hwaseong's south tip
  - "packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > the traced outlines keep the proportions of the maps: Pyeongtaek twice the land of Hwaseong, Giheung the smallest of the three"
  - tests/spec/remote-harness.test.ts::=api
  - tests/spec/store.test.ts::=experiment
  - tests/spec/store.test.ts::=scenario
  - tests/spec/store.test.ts::=world
test_change_reason: 요구사항이 바뀐 것은 아니다. 시험이 쓰는 견본 사용자 이름과 견본 모델 이름, 시험 제목 한 곳을 지어낸 것으로 바꿔 저장소에 개인 이름과 내부에서 쓰는 이름이 남지 않게 한다. 단언하는 동작과 기대하는 값의 뜻은 같고, 이름 순서가 바뀌어 정렬 결과를 단정한 세 곳은 기대값의 순서만 따라갔다.
decision_hash: 8f87234c934d7bbb
---
# ADR-0188 내부 사실 서술을 요구의 말로 고친다 — ADR-0187에 따른 두 번째 걷어내기

## 맥락
ADR-0187은 공개 저장소에 내부에서 들은 사실을 두지 않기로 했고, 첫 걷어내기는 참고 문서 하나와 몇 문장만 다뤘다. 그 뒤 저장소 전체를 훑은 감사가 같은 종류의 서술이 더 남아 있다고 알렸다. 결정 기록의 "맥락" 절, 설계 문서, 요구사항, 차수 계획, 코드 주석, 시험 이름과 견본 값에서다. 제품 책임자는 이런 정보를 공개하면 안 된다고 확인했고, 사실인지 애매한 문장도 요구로 바꿔 쓰면 잃는 것이 없으니 모두 고치라고 했다. 이 기록은 고친 문장을 되풀이하지 않고 종류와 규모만 적는다.

## 결정
1. **ADR-0187의 기준을 그대로 적용한다.** 새 규칙은 없다. 저장소에는 공개된 자료에서 온 사실만 둔다. 내부에서 들은 사실은 "누가 무엇을 가졌다, 했다"가 아니라 "제품이 무엇을 해야 한다"로 쓰고, 누구의 말인지는 "제품 책임자의 요구·결정"까지만 적는다.
2. **고친 문장의 종류와 고침의 규칙.** 파일 수는 같은 파일이 두 종류에 들면 두 번 센다.

| 종류 | 고친 방식 | 파일 |
|---|---|---|
| 어느 조직이 가진 시스템·장비·제조사·규모를 사실처럼 쓴 맥락 문장 | 제품이 해야 할 일(요구)이나 목표 규모로 다시 씀. 제조사와 제품 이름은 "널리 쓰이는 …", "예: …"로 | 결정 기록 16, 설계 문서 2, 요구사항 1 |
| 조직 구성, 사람, 업무 방식에 대한 서술 | 사용자가 할 수 있어야 하는 일로 다시 씀. 다른 조직의 프로젝트를 말한 문장은 뺌 | 결정 기록 6, 설계 문서 1 |
| 배포 환경과 소유 조직을 가리키는 한정어("사내" 등), 내부 도구·프로젝트 이름 | 한정어를 빼거나 "조직 안에서", "닫힌 망에서" 같은 일반 말로. 내부 도구 이름은 중립 설명으로 | 결정 기록 19, 설계 문서와 색인 10, 최상위 문서 2, 차수 계획 1, 코드 주석 1 |
| 실제 사업장·건물에서 서버룸이 어디에 있는지, 지도와 배치도의 출처 | 건물마다 다르다는 요구와 "가정", "예시 값"으로. 출처는 공개 지도와 보도로만 | 결정 기록 5, 설계 문서 1, 코드 주석 2, 시험 제목 1 |
| 장비 제조사 분포에 기댄 선택의 이유 | 제조사가 공개한 규격이라는 이유와 "제품 책임자의 결정"까지만 | 결정 기록 1, 설계 문서 1 |
| 요구사항 머리글의 쓰임새 이름 | 일반 말로 바꿈. 제품 목표 문장은 고치지 않는다(제품 책임자가 정한 글이고, "사내"는 제품의 자리를 말하는 것이지 내부 사실이 아니다) | 요구사항 1 |
| 일정, 사용 한도, 개발 운영 | 우선순위만 남기고 날짜 열과 한도 문장을 뺌 | 차수 계획 3 |
| 기본값이 "실제 모양"이라거나 "들은 대로"라는 코드 주석, 화면 문구의 조직 용어 | 예시 값이라고만 적음. 화면 문구의 조직 용어는 "사용자"로 | 코드 4, 설계 문서 2, 목업 2 |
| 제품 책임자의 개인 이름 | 문서는 "제품 책임자"로(호칭과 조사를 맞춤). 시험·견본의 사용자 이름은 지어낸 이름으로 | 문서 68, 시험과 도우미 코드 65 |
| 실제일 수 있는 내부 모델 이름 | 지어낸 모델 이름으로 | 시험 6, 설계 문서 1 |

3. **견본 사용자 이름은 지어낸 하나로 맞춘다.** 저장소에 이미 쓰인 이름이 없어서 "김하늘"을 쓴다. 짧은 이름은 "하늘", 로그인 ID꼴은 "haneul", "haneul.kim"으로 하고 예전 이름이 가졌던 구분(짧은 이름과 긴 이름, 로그인 ID와 보이는 이름)은 그대로 둔다. `NOTICE`, `LICENSE`, 커밋 작성자 설정은 건드리지 않는다.
4. **글만 바꾼다. 데이터는 그대로다.** 숫자, 기본값, 상수, 좌표, 프리셋 이름, 만들어지는 세계, 코드의 식별자는 바꾸지 않았다. 값이 현실이라는 주장만 뺐다. 그 값을 어떻게 할지(예시 값으로 둘지, 지어낸 값으로 바꿀지)는 이어서 따로 정한다. 점수와 세계의 지문은 그대로여야 한다(`apps/server/src/http/scoring-unchanged.test.ts`와 `tests/spec/golden-*.test.ts`가 지킨다).
5. **결정의 뜻은 바뀌지 않는다.** 결정 기록 89개의 본문이나 제목을 고쳐 다시 봉인했다(ADR-0187 자신 포함). 사실 없이는 결정을 적을 수 없는 곳은 결정을 두고 사실만 뺐다. 제목이 바뀐 것은 결정 기록 둘과 설계 문서 하나다. 고친 보호 파일은 `touches_protected`에 있다. 결정 기록은 줄 수 제한(`DOC050`) 때문에 하나하나 적지 않고 보호 경로 글롭 `docs/design-docs/adr/**`로 적는다.
6. **잠긴 시험.** 견본 이름 문자열이 든 시험과 도우미의 지문이 바뀌고(제목이 바뀐 시험 하나는 옛 항목이 사라지고 새 항목이 생긴다) 모두 `amends_tests`에 있다(268개). 동작과 기대값의 뜻은 그대로이고, 이름 순서가 바뀌어 정렬 결과를 단정한 세 곳은 기대값의 순서만 따라갔다. `lock --amend`로 잠금을 갱신한다.
7. **하네스 시험 하나의 시간 한도를 올린다.** 검사 전체를 한 번 돌려 보는 시험(`harness/src/common.test.ts`의 "run-all runs every check and prints a verdict")이 이 변경처럼 문서를 많이 고친 변경에서 기본 한도 20초를 조금 넘는다(21초). 그 시험 하나의 한도를 120초로 한다. 단정하는 내용은 그대로다.

## 이유
- 공개 저장소의 글은 누구나 읽고 히스토리에 남는다. 지금의 파일에서라도 지우는 것이 할 수 있는 가장 싼 일이다.
- 제품에 필요한 것은 요구이지 출처가 된 내부 사정이 아니다. 요구로 바꿔 적어도 설계의 근거는 남는다. 애매한 문장을 모두 고치는 데 드는 비용은 작고, 하나라도 남겼을 때의 비용은 크다.
- 개인 이름은 "제품 책임자의 결정"이라는 역할 표기로 충분히 전달된다.
- 데이터를 이 변경에서 건드리지 않으면 글의 변경이 점수와 세계에 영향을 주지 않았다는 것을 지문으로 보일 수 있다.

## 버린 길
- **문장만 지우고 결정은 두기**: 결정의 이유가 비어 읽을 수 없게 된다. 사실을 요구로 바꿔 이유를 남겼다.
- **새 결정 기록으로 대신하기**: 옛 문장이 봉인된 기록에 남는다(ADR-0187).
- **데이터까지 함께 바꾸기**: 글의 변경과 값의 변경이 섞이면 지문이 바뀌어도 어느 쪽 때문인지 알 수 없다.

## 남은 일
- 코드의 기본 카드, 사업장 배치 상수, 견본 그래프의 건물 이름, 매핑의 속성 값처럼 현실을 닮은 값이 든 곳은 값을 어떻게 할지 따로 정한다.
- 히스토리: 지난 커밋과 풀 리퀘스트에는 예전 문장이 남아 있다. 히스토리를 다시 쓰는 일은 저장소 주인만 할 수 있다(ADR-0187).
- 정리 작업의 감사 단계가 이 기준을 계속 본다.

## 결과
결정 기록 89개, 설계·계획·요구사항 문서 35개(본문은 그대로이고 다시 확인만 한 것 포함), 시험 파일 64개, 그 밖의 코드 13개가 고쳐진다. 동작은 바뀌지 않는다.
