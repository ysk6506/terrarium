---
title: ADR-0050 UX는 토스의 원칙으로 한다 — 한 화면에 한 가지, 해요체, 눈에 보이는 디테일마다 기준과 측정
kind: decision
status: active
last_verified: 2026-11-03
enforced_by:
  - harness/src/ux/score.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - harness/src/ux/score.test.ts
  - harness/src/test-support/ux-measurements.ts
amends_tests:
  - apps/web/src/logic/activity.test.ts::who is working in a world, folded from the activity events [REQ-050] > what a run is doing is said in words; a failed call says so; quiet runs are told apart
  - "apps/web/src/logic/agent-versions.test.ts::a version history reads in words [REQ-053] > the next experiment: the first version, a new one with its changes, no change, or unknown"
  - apps/web/src/logic/agent-versions.test.ts::what a person fills in to add or annotate a version [REQ-053] > rows with a name that cannot be used or no value are pointed at by their row
  - apps/web/src/logic/builder/builder.test.ts::a rack's front [REQ-006] > devices go where they fit, and say why when they do not
  - apps/web/src/logic/builder/builder.test.ts::building a world by hand [REQ-006] [REQ-005] > containments wrap the racks under them
  - apps/web/src/logic/builder/builder.test.ts::building a world by hand [REQ-006] [REQ-005] > move, turn, rename, re-model and remove — with everything inside and every cable
  - apps/web/src/logic/builder/builder.test.ts::building a world by hand [REQ-006] [REQ-005] > things cannot overlap, leave their space, or be turned into a wall
  - apps/web/src/logic/builder/builder.test.ts::cables [REQ-006] [REQ-005] > what a thing can plug into, nearest first, and why some links are not allowed
  - apps/web/src/logic/builder/builder.test.ts::totals and warnings, tycoon style [REQ-006] > cost, heat against cooling, and what is not connected
  - apps/web/src/logic/builder/gesture.test.ts::pointing and dragging in the builder [REQ-035] > a building over another one is refused with the reason, and nothing changes
  - apps/web/src/logic/builder/gesture.test.ts::pointing and dragging in the builder [REQ-035] > dragging something built moves it by the drag, snapped, or says why not
  - apps/web/src/logic/builder/gesture.test.ts::pointing and dragging in the builder [REQ-035] > the hint line says what pointing would do
  - apps/web/src/logic/connections.test.ts::a connection that is not used is removed, and the screen says so ahead of time [REQ-051] > only connections made on the screen expire, and the last week is a warning
  - apps/web/src/logic/connections.test.ts::the form says what is missing before anything is sent [REQ-051] [REQ-052] > a new form lacks a name and the required fields; a kept secret counts as given
  - apps/web/src/logic/connections.test.ts::the form says what is missing before anything is sent [REQ-051] [REQ-052] > a number, JSON, a header value and a metadata name are checked
  - apps/web/src/logic/editors.test.ts::the experiment form and forks [REQ-030] [REQ-040] > a draft says what is missing step by step, and becomes a request
  - apps/web/src/logic/editors.test.ts::the scenario canvas [REQ-034] > blocks are added, wired, rewired, edited and removed — unusable ones say why
  - apps/web/src/logic/editors.test.ts::the scenario canvas [REQ-034] > every block's summary reads as a sentence
  - apps/web/src/logic/editors.test.ts::the scoring sheet [REQ-034] > add, change and remove items; the total aims at 100
  - apps/web/src/logic/logic.test.ts::the API client speaks the contract [REQ-030] > errors carry the server's Korean message and point at fields
  - apps/web/src/logic/logic.test.ts::the name people give [REQ-033] > kept in the browser, checked, forgotten on request
  - apps/web/src/logic/narrow.test.ts::a long pick list shows the first few and a way to search [REQ-034] > says nothing was found, rather than showing an empty list with no explanation
  - apps/web/src/logic/narrow.test.ts::a long pick list shows the first few and a way to search [REQ-034] > tells the person when the list is cut short, and what to do
  - apps/web/src/logic/screen-text.test.ts::what the pointer says when a rack will not fit [REQ-035] > it says the spot is outside the room, in the pointer's own words
  - harness/src/test-support/ux-measurements.ts::=perfect
  - apps/server/src/adapters/adapters.test.ts::harness telemetry from ClickStack [REQ-037] > odd trace ids are not queried; a failing ClickStack is an error with its words
  - apps/server/src/adapters/adapters.test.ts::server configuration [REQ-031] [REQ-037] > adapters are built from the config; the sample graph is always there
  - apps/server/src/adapters/adapters.test.ts::server configuration [REQ-031] [REQ-037] > mistakes are named in Korean, with where they are
  - apps/server/src/adapters/adapters.test.ts::the SQLite store keeps its data [REQ-030] > data survives a restart; a newer data file is refused
  - apps/server/src/adapters/connectors/a2a.test.ts::=v03
  - apps/server/src/adapters/connectors/a2a.test.ts::=v1
  - "apps/server/src/adapters/connectors/a2a.test.ts::an A2A agent: the card says who it is, a run is a task [REQ-051] > 0.3: the old method names, a kind on every part, lowercase states"
  - "apps/server/src/adapters/connectors/a2a.test.ts::an A2A agent: the card says who it is, a run is a task [REQ-051] > a card that is missing, or whose interfaces cannot be spoken to, is said so"
  - "apps/server/src/adapters/connectors/a2a.test.ts::an A2A agent: the card says who it is, a run is a task [REQ-051] > a task without an id, an unreachable agent and unreadable statuses are errors with reasons"
  - "apps/server/src/adapters/connectors/a2a.test.ts::an A2A agent: the card says who it is, a run is a task [REQ-051] > an agent that answers with a message, not a task, is done at once"
  - "apps/server/src/adapters/connectors/a2a.test.ts::an A2A agent: the card says who it is, a run is a task [REQ-051] > how a task ends: failed, rejected, canceled, or stuck waiting for a person"
  - "apps/server/src/adapters/connectors/a2a.test.ts::an A2A agent: the card says who it is, a run is a task [REQ-051] > the card gives the agent its name, its description and what the card knows of its version"
  - apps/server/src/adapters/connectors/command.test.ts::an agent that is a program the server runs [REQ-051] > a program that cannot start is an error with a reason
  - apps/server/src/adapters/connectors/command.test.ts::an agent that is a program the server runs [REQ-051] > a program that fails says how, with the end of what it printed
  - apps/server/src/adapters/connectors/command.test.ts::an agent that is a program the server runs [REQ-051] > it is for the config file only, and the program must be findable
  - "apps/server/src/adapters/connectors/http-template.test.ts::any HTTP API as an agent: the request is written in the form [REQ-051] > refusals, an unreachable API, unreadable statuses and a body that needs tools the run lacks are errors with reasons"
  - "apps/server/src/adapters/connectors/http-template.test.ts::any HTTP API as an agent: the request is written in the form [REQ-051] > the one agent is what the form says, and a health path must answer"
  - "apps/server/src/adapters/connectors/http-template.test.ts::any HTTP API as an agent: the request is written in the form [REQ-051] > what the form can say is checked: unknown variables, JSON that is not, a status address that is missing"
  - "apps/server/src/adapters/connectors/langgraph.test.ts::a LangGraph Agent Server: its assistants are the agents [REQ-051] > a server that cannot be reached, or whose status cannot be read, is an error with a reason"
  - "apps/server/src/adapters/connectors/langgraph.test.ts::a LangGraph Agent Server: its assistants are the agents [REQ-051] > an assistant without a name shows its graph; a server that refuses is said to"
  - "apps/server/src/adapters/connectors/langgraph.test.ts::a LangGraph Agent Server: its assistants are the agents [REQ-051] > how a run can end: errors, timeouts and a graph waiting for a person are told apart"
  - apps/server/src/adapters/connectors/mcp-agent.test.ts::=mcpServer
  - apps/server/src/adapters/connectors/mcp-agent.test.ts::an agent that a server offers as an MCP tool [REQ-051] > a tool that reports an error, and a server that cannot be reached, end the run with a reason
  - apps/server/src/adapters/connectors/mcp-agent.test.ts::an agent that a server offers as an MCP tool [REQ-051] > every tool the server lists is an agent, with its title and description
  - apps/server/src/adapters/connectors/mcp-agent.test.ts::an agent that a server offers as an MCP tool [REQ-051] > naming the tool makes it the only agent; naming one the server lacks says what it has
  - "apps/server/src/adapters/connectors/openclaw.test.ts::an OpenClaw gateway: its agents are the targets of the chat endpoint [REQ-051] > a gateway that refuses, answers with nothing or is out of turns ends the run with a reason"
  - "apps/server/src/adapters/connectors/openclaw.test.ts::an OpenClaw gateway: its agents are the targets of the chat endpoint [REQ-051] > the agent asks for tools, Terrarium runs them, and the answer goes back until the diagnosis is in"
  - "apps/server/src/adapters/connectors/openclaw.test.ts::an OpenClaw gateway: its agents are the targets of the chat endpoint [REQ-051] > tool results that are errors, bad arguments and huge results are all handed back in words"
  - "apps/server/src/adapters/connectors/opencode.test.ts::an OpenCode server: its agents are the agents [REQ-051] > agents that only other agents call are left out, and the mode is kept as a fact"
  - "apps/server/src/adapters/connectors/opencode.test.ts::an OpenCode server: its agents are the agents [REQ-051] > an agent that stopped on an error says why"
  - "apps/server/src/adapters/connectors/opencode.test.ts::an OpenCode server: its agents are the agents [REQ-051] > no tools address, an unreachable server and unreadable statuses are errors with reasons"
  - apps/server/src/adapters/harness.test.ts::a remote harness over the Terrarium harness protocol [REQ-031] > refusals, unreachable harnesses and missing MCP endpoints are errors with reasons
  - apps/server/src/adapters/harness.test.ts::built-in reference agents use only the tools [REQ-008] [REQ-031] > guess is repeatable for a seed; idle never answers; unknown agents are an error
  - apps/server/src/adapters/secret-box.test.ts::tokens and passwords typed on the screen are kept sealed [REQ-051] > the server's key comes from its environment, else from a file only it can read
  - apps/server/src/cluster/cluster.test.ts::a worker node runs the same session as a local host [REQ-042] [REQ-001] > a node that goes away fails the session in words an operator can act on
  - apps/server/src/cluster/cluster.test.ts::the control plane places sessions on nodes [REQ-042] > least busy first, spill over when full, capacity follows the nodes
  - apps/server/src/http/app.test.ts::an experiment over HTTP [REQ-030] [REQ-038] > bad input is answered field by field, in Korean, with one error shape
  - apps/server/src/http/app.test.ts::the web app is served from the same place [REQ-006] > files, and every other page is the app (it routes in the browser)
  - apps/server/src/http/identity.test.ts::=sso
  - apps/server/src/http/identity.test.ts::who is asking is one slot an SSO can fill [REQ-054] > a method that refuses strangers answers 401 on routes and on live streams, but not on shared links
  - apps/server/src/http/static.test.ts::serving the web app [REQ-041] > a file built after the server started is served, and a missing file is a 404 rather than the app
  - apps/server/src/main.test.ts::starting and stopping the server [REQ-030] > a broken config stops the start with the reason
  - apps/server/src/mcp/gateway.test.ts::each run's tools over MCP [REQ-008] [REQ-031] > tool results read as JSON text; failures are marked as errors
  - apps/server/src/runtime/agent-versions.test.ts::people add, change and delete versions [REQ-053] > the first version may be a person's, then it is the agent as it is now
  - apps/server/src/runtime/connection-secrets.test.ts::a connection nobody uses for a month is removed, after a warning [REQ-051] > an experiment made on it counts as use; the config file's connections never expire
  - apps/server/src/runtime/connection-secrets.test.ts::a token typed on the screen is used, kept sealed and never shown again [REQ-051] > typing it and naming a server variable for it is one too many
  - apps/server/src/runtime/connection-secrets.test.ts::changing a connection keeps its secrets unless told otherwise [REQ-051] > only its owner may change it or try a change; a change that does not build changes nothing
  - apps/server/src/runtime/connection-secrets.test.ts::custom headers go with every request [REQ-051] > a header without the value it needs is said by position
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > a cloud's credentials address is refused; a server can allow only some hosts
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > a harness that answers badly, or finds nothing, is told apart from a wrong form
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > a secret is only ever the name of a variable the server has
  - "apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > addresses are judged on their own: shape, scheme, host rules"
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > an id comes from the name, a taken one gets a number, a chosen one that is taken is refused
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > connecting a harness finds its agents, and they can be chosen in an experiment
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > one that never answers is given up on, and shows as unreachable
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > only whoever connected it can remove it, and not while runs are on it
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > the command connector is for the config file only
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > what is wrong with the form is said by field
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > what people connected is still there after a restart; one that no longer builds is shown, not lost
  - apps/server/src/runtime/executor.test.ts::how a run ends [REQ-030] [REQ-031] > a run whose harness or world version has gone fails with the reason
  - apps/server/src/runtime/executor.test.ts::how a run ends [REQ-030] [REQ-031] > an error before the first tool call is infrastructure (failed); after it, the agent's (scored)
  - apps/server/src/runtime/hosts.test.ts::session hosts run the same session the same way [REQ-001] [REQ-032] > a worker that dies takes its sessions with it, and is replaced
  - apps/server/src/runtime/hosts.test.ts::session hosts run the same session the same way [REQ-001] [REQ-032] > sessions spread over workers; errors come back as the same kind of error
  - apps/server/src/runtime/platform.test.ts::an experiment from creation to result [REQ-030] [REQ-037] > a recipe is checked against what really exists before anything is queued
  - apps/server/src/runtime/platform.test.ts::cancelling and the queue [REQ-030] [REQ-032] > a restarted server fails what was mid-flight and runs what was waiting
  - apps/server/src/runtime/platform.test.ts::cancelling and the queue [REQ-030] [REQ-032] > stopping the server ends running runs as failed, with the reason
  - apps/server/src/runtime/platform.test.ts::forks, more runs and lineage [REQ-040] > more runs continue the seeds; repeating a seed or someone else's experiment is refused
  - apps/server/src/runtime/platform.test.ts::worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034] > saves check the blueprint, refuse stale versions and let only the owner change things
  - apps/server/src/runtime/platform.test.ts::worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034] > worlds come from presets and from reality, with what was assumed
  - apps/server/src/runtime/results.test.ts::sharing results [REQ-038] > reports in three formats, and links that open without the app until taken back or expired
  - apps/server/src/runtime/worker-sessions.test.ts::what a session worker answers [REQ-032] > open, call, finish, dispose — and every failure becomes a message
  - apps/server/src/scale-out.test.ts::=until
  - apps/server/src/scale-out.test.ts::cluster settings fail early and say what to add [REQ-042] > each role names what it needs
  - packages/core/src/analysis/analysis.test.ts::a fork against its parent [REQ-040] > the change is listed and the score difference is judged against the spread
  - packages/core/src/analysis/analysis.test.ts::a fork against its parent [REQ-040] > with too few runs a difference is not called clear, and with no scores only the change is told
  - packages/core/src/analysis/analysis.test.ts::an experiment across its runs [REQ-037] > an experiment whose runs all failed has one finding, and no made-up numbers
  - packages/core/src/analysis/analysis.test.ts::an experiment across its runs [REQ-037] > criteria most runs missed and endings other than a diagnosis are called out
  - packages/core/src/analysis/analysis.test.ts::an experiment across its runs [REQ-037] > pass rate, accuracy and spread over completed runs; failures counted apart
  - packages/core/src/analysis/analysis.test.ts::one run, analysed [REQ-037] > findings tell a half-right answer from a wrong one, and point at the evidence
  - packages/core/src/analysis/analysis.test.ts::one run, analysed [REQ-037] > runs that never finished say why
  - packages/core/src/analysis/fork-findings.test.ts::a fork that does worse than its parent [REQ-040] > both differences carry their sign, so a loss never reads as a gain
  - packages/core/src/analysis/share.test.ts::diagnosis records and the modelling brief [REQ-015] > an empty record set still gives a readable brief; easy faults are flagged too
  - packages/core/src/analysis/share.test.ts::diagnosis records and the modelling brief [REQ-015] > the brief hands the simulator developer where the world is thin
  - packages/core/src/contract/contract.test.ts::Korean messages for every kind of problem [REQ-041] > the error map can also be used directly
  - packages/core/src/contract/contract.test.ts::Korean messages for every kind of problem [REQ-041] > types, sizes, choices, formats
  - packages/core/src/contract/contract.test.ts::error replies [REQ-030] > core errors keep their status and message; anything else hides the internals
  - "packages/core/src/contract/contract.test.ts::experiments: create, fork, add runs [REQ-030] [REQ-040] > a fork changes only what it names; adding runs says how many or which seeds"
  - "packages/core/src/contract/contract.test.ts::experiments: create, fork, add runs [REQ-030] [REQ-040] > a recipe takes seeds or a run count, not both; seeds are unique"
  - "packages/core/src/contract/contract.test.ts::experiments: create, fork, add runs [REQ-030] [REQ-040] > query strings: numbers are read from text and blanks mean 'not given'"
  - packages/core/src/contract/contract.test.ts::the route table [REQ-030] > paths are filled in and encoded; a missing parameter is an error, not a broken link
  - packages/core/src/contract/contract.test.ts::worlds cross the wire intact [REQ-001] [REQ-009] > broken blueprints are pointed at field by field, in Korean
  - packages/core/src/contract/contract.test.ts::worlds cross the wire intact [REQ-001] [REQ-009] > imports name a source and stay within limits; saves need the version they started from
  - packages/core/src/contract/contract.test.ts::worlds cross the wire intact [REQ-001] [REQ-009] > worldgen specs are checked by worldgen's own rules
  - packages/core/src/contract/saves.test.ts::saving scenarios and the smaller requests [REQ-034] [REQ-038] [REQ-039] > a dry run defaults to seed 1; leaderboards and twin exports take optional filters
  - packages/core/src/contract/saves.test.ts::saving scenarios and the smaller requests [REQ-034] [REQ-038] [REQ-039] > a scenario save needs its starting version and something to change
  - packages/core/src/experiments/experiments.test.ts::forks and lineage [REQ-040] > a fork that changes nothing is refused; a new scenario version counts as a change
  - packages/core/src/experiments/experiments.test.ts::recipes [REQ-030] [REQ-031] > a sound recipe has no problems; every problem is named in Korean
  - "packages/core/src/oracle/oracle.test.ts::oracle: diagnosis [REQ-007] [REQ-037] > no diagnosis: zero, and the answer is shown"
  - "packages/core/src/oracle/oracle.test.ts::oracle: state, actions and efficiency [REQ-007] [REQ-037] > required and forbidden actions are judged by effect, whichever tool caused them"
  - "packages/core/src/oracle/oracle.test.ts::oracle: state, actions and efficiency [REQ-007] [REQ-037] > time and tool budget count only when a diagnosis was submitted"
  - packages/core/src/scenario/actions.test.ts::agent actions [REQ-007] [REQ-039] > conditions can ask what the agent did, whatever tool it used
  - packages/core/src/scenario/runner.test.ts::built-in scenarios [REQ-033] > templates say why they cannot be built for a world that lacks their equipment
  - packages/core/src/scenario/scenario.test.ts::condition sentences [REQ-034] [REQ-037] > conditions read as Korean sentences with units
  - packages/core/src/scenario/scenario.test.ts::scenario palette [REQ-034] > blocks the simulator does not support yet are shown disabled, with the reason
  - packages/core/src/scenario/scenario.test.ts::scenario palette [REQ-034] > blocks with nothing to act on in this world are disabled, naming what is missing
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > conditions must name real fields, comparable values and known tools
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > edges must use real outputs and may not form loops
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > exactly one start and one agent task
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > expectations are checked, and missing or inconsistent scoring is pointed out
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > faults must fit their target, and their settings their ranges
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > parameters are checked against the block and the world
  - packages/core/src/scenario/scenario.test.ts::scenario validation edge cases [REQ-034] > more condition sentences
  - packages/core/src/scenario/scenario.test.ts::scenario validation edge cases [REQ-034] > values of the wrong shape are named, not crashed on
  - packages/core/src/session/session.test.ts::session lifecycle [REQ-007] [REQ-030] > an invalid scenario is refused before anything runs, with the reasons in Korean
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > an import that is too big asks for a narrower scope
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > power and missing cooling are assumed, sized, marked and reported; real cooling is kept
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > undersized real cooling is reported, not enlarged
  - packages/core/src/sources/realimport/room-scope.test.ts::a room filter that matches nothing is an error that names the choices [REQ-010] > the message says what was asked and which rooms exist
  - packages/core/src/sources/worldgen/campus.test.ts::generateCampus builds a valid campus [REQ-047] > limits are enforced with a reason in Korean
  - packages/core/src/sources/worldgen/worldgen.test.ts::worldgen limits [REQ-009] > a spec outside the limits is refused with every reason in Korean
  - packages/core/src/sources/worldgen/worldgen.test.ts::worldgen limits [REQ-009] > worlds are capped in size
  - apps/web/src/logic/agent-versions.test.ts::a version history reads in words [REQ-053] > a field that was added or removed says so instead of showing nothing
test_change_reason: 화면의 글을 해요체로 옮기면서 안내 문장의 끝만 바뀌었다(예를 들어 "실패했다"는 "실패했어요", "적는다"는 "적어 주세요"). 웹 화면의 글에 더해 코어와 서버가 사람에게 돌려주는 오류와 안내 문장도 같은 말투로 옮겼다. 각 시험이 확인하는 내용, 곧 어떤 상황에서 어떤 안내가 나오는가는 그대로이고 기대하는 문장의 말투만 바뀐다. 측정 고정값 perfect()에는 새 측정 항목 일곱 개가 더해졌다.
decision_hash: f163d358be26bc64
---
# ADR-0050 UX는 토스의 원칙으로 한다

## 맥락
사용자가 요구사항을 하나 더했다(REQ-058).
- "나 UX를 굉장히 중요시 하고, Toss의 UX 철학과 디자인을 좋아해."
- "모든 디테일한 요소까지 UX 고려해야해."

지금까지 UX는 Honeycomb 7면(ADR-0031)으로 재고 있었다. 이 측정은 "쓸 수 있는가, 접근할 수 있는가, 믿을 수 있는가"는 잘 잡지만 **어떤 말로 말하는가, 한 화면이 몇 가지를 시키는가, 버튼이 왜 꺼졌는지 말하는가** 같은 결은 재지 못했다. 그래서 화면의 글은 한다체("~한다")와 해요체가 섞여 있고(웹 화면 글만 해도 한다체 문장이 150여 줄), 시작 버튼이 화면에 두 개 있는 곳이 있고, "취소"처럼 무엇을 취소하는지 말하지 않는 버튼이 있다.

토스의 원칙은 토스 공개 자료(아래 출처)에서 읽었다. 제품 원칙 10가지는 앱인토스 소비자 UX 가이드에 있고, 말투는 UX 라이팅 인터뷰, "단순함"은 토스 피드의 글에 있다.

## 결정

### 1. 토스 원칙 10가지를 테라리움의 규칙과 측정으로 옮긴다
| 토스 원칙 | 테라리움에서의 규칙 | 기계로 재는 것 |
|---|---|---|
| Casual Concept (쉬운 말) | 전문 용어는 쉬운 말로 풀거나 한 줄로 뜻을 붙인다. 화면 글에 "엔티티", "페이로드" 같은 말을 쓰지 않는다. | 말투(`voice`)만 잰다. 쉬운 말은 사람이 확인한다. |
| Simple Policy (단순한 규칙) | 고르게 하기 전에 기본값을 정해 둔다. 규칙이 설명 한 줄을 넘으면 다시 생각한다. | 손 수 예산(`actions`) |
| Value First (얻는 것 먼저) | 결과·목록의 맨 위에 사람이 얻는 것(합격률, 몇 회 결과인지)이 있다. | `decision` |
| Clear Action (다음이 한눈에) | 화면마다 주된 버튼은 하나이고 이름이 할 일을 말한다. | `one-thing`, `buttons` |
| Context Based (끊기지 않는 흐름) | 하나를 끝내면 다음 할 일 버튼이 바로 있다. 여정은 홈에서 끝까지 이어진다. | 여정 완수, 손 수 |
| Easy to Answer (답하기 쉬움) | 묻기보다 추천값을 채워 두고, 사람이 기억 못 하는 것(세계 크기, 서버룸 이름)은 대신 채운다. | 손 수, `invalid` |
| Explain Why (이유를 말함) | 막힌 것, 꺼진 버튼, 빈 화면, 오류는 이유와 다음 길을 말한다. 무엇을 입력받는지의 이유도 곁에 적는다. | `disabled-why`, `failures`, `empties` |
| One Thing (한 화면 한 가지) | 한 화면의 주된 행동은 하나다. 나머지는 조용한 버튼이다. | `one-thing` |
| No More Loading (기다림 없애기) | 오래 걸리는 일은 진행을 보여 주고, 첫 화면은 예산 안에서 뜬다. 긴 목록은 찾아서 고른다(ADR-0049). | `progress`, `load-size`, `load-time` |
| Minimum Features (꼭 필요한 기능만) | 기능을 더하려면 ADR에 "없으면 무엇이 안 되는지"를 적는다. | 사람이 확인한다. |

### 2. 말투는 해요체 하나다
- 문장은 "-요"로 끝낸다. 한다체("~한다", "~된다")와 합니다체("~합니다")를 섞지 않는다.
- 제목·라벨·표 머리말은 명사형이어도 된다("세계 만들기", "실험"). 문장이 되면 해요체다.
- 능동·긍정으로 쓴다. "~할 수 없어요"보다 "~하면 할 수 있어요". 오류는 사람 탓으로 말하지 않는다("잘못 입력했어요" 대신 "숫자만 넣을 수 있어요").
- 한 문장은 한 가지를 말하고 두 줄 안에 끝낸다. 숫자에는 단위를 붙이고 날짜는 "10월 29일", 시간은 "3분 전"처럼 말한다.
- 존댓말을 붙이되 호들갑스럽지 않게 쓴다. 이모지와 느낌표를 쓰지 않는다.

### 3. 버튼은 할 일을 말한다
- 일을 하는 버튼은 "~하기"(세계 만들기, 실험 시작하기)이거나 동사 하나(저장, 복사)다. 확인은 "확인", 이어가기는 "다음", 아무것도 하지 않고 나가기는 "닫기"다.
- **"취소"를 쓰지 않는다.** 무엇을 취소하는지 말하지 않기 때문이다. 하던 일을 멈추면 "멈추기", 나가면 "닫기", 지우면 "지우기"다.
- 주된 버튼(`btn-primary`)은 화면에 하나만 있다. 두 번째로 중요한 일은 조용한 버튼(`btn-quiet`)이다.
- 되돌릴 수 없는 일(지우기)은 먼저 이유와 함께 확인하거나, 한 번 눌러 지우고 곧바로 되돌릴 수 있게 한다.

### 4. 눈에 보이는 디테일에 기준을 두고, 잴 수 있는 것은 잰다
| 디테일 | 기준 | 어떻게 확인하나 |
|---|---|---|
| 글 한 줄 | 해요체, 능동, 긍정 | `voice` (화면 전체의 글을 읽어 한다체·합니다체 문장 비율) |
| 버튼 이름 | 할 일을 말함, "취소" 없음 | `buttons` |
| 주된 버튼 | 화면에 하나 | `one-thing` |
| 꺼진 버튼 | 왜 꺼졌는지 말한다(`title`이나 `aria-describedby`) | `disabled-why` |
| 누르는 크기 | 높이 32 px 이상, 너비 24 px 이상(문장 속 링크는 예외) | `targets` |
| 포인터 반응 | 올리면 모양이 바뀐다 | `hover` |
| 키보드 초점 | 눈에 보이는 표시 | `focus`, `keyboard` (기존) |
| 빈 화면 | 이유와 할 일 | `empties` (기존) |
| 오류 | 원인과 다음 길, 다시 해 보기 | `failures` (기존) |
| 불러오는 중 | 뼈대 또는 진행, 5초 넘으면 단계 | `progress` (기존) |
| 숫자 | 단위나 이름이 곁에 있다 | `units`, `provenance` |
| 움직임 | 줄이기를 켜면 멈춘다 | `motion` (기존) |
| 색 | 디자인 토큰으로만 | `tokens` (기존) |
| 지우기 | 확인 또는 되돌리기 | **사람이 확인한다** |
| 문장 길이, 날짜·시간 형식, 쉬운 말 | 위 말투 규칙 | **사람이 확인한다** |

측정 하한은 다른 면과 같이 98점이다. 사람이 확인하는 줄은 PR이나 작업을 끝낼 때 이 표로 훑는다. 기계가 못 재는 것을 잰다고 말하지 않는다.

### 5. 시각 디자인은 안을 보여 주고 고른 것만 적용한다
토스처럼 보이게 바꾸는 일(큰 글자, 넓은 여백, 한 가지 파랑, 카드 대신 목록, 둥근 모서리, 하단 고정 큰 버튼)은 **화면 모습을 바꾸는 일**이라 ADR-0037에 따라 안을 만들어 보여 주고 사용자가 고른 것만 적용한다. 토스의 이름, 로고, 글꼴(Toss Product Sans)은 쓰지 않는다. 열린 글꼴(Pretendard 계열)과 우리 색 토큰으로 "결"만 따른다.
말투, 버튼 이름, 주된 버튼 수, 꺼진 이유처럼 **모습이 아닌 것**은 승인 없이 지금 바꾼다.

### 6. 옮기는 순서
1. 웹 화면의 글(`apps/web/src/ui`, `apps/web/src/logic`)을 해요체로 옮기고, 주된 버튼이 둘인 화면과 "취소" 버튼을 고친다.
2. 화면에 그대로 나오는 서버·core의 글(커넥터 설명, 시나리오 템플릿, 카탈로그 설명, 검증 문장)을 옮긴다.
3. 사람에게 돌아갈 수 있는 서버 오류(설정, 노드, 워커, 실행 실패)도 해요체로 옮긴다. 프로세스 로그, 에이전트에게 주는 지시문과 도구 응답은 한다체로 남긴다. 이것은 한계로 적는다.
4. 글을 비교하던 잠긴 시험은 이 ADR의 `amends_tests`에 적어 바꾼다. 확인하는 내용(어떤 말이 어디에 나오는가)은 그대로이고 문장만 해요체로 바뀐다.

## 이유
- 토스는 "쉬운 제품이 좋은 제품"이라는 한 가지 기준을 글, 버튼, 화면 하나하나의 규칙으로 내렸다. 규칙이 구체적이어서 기계가 따라 읽을 수 있다.
- 말투와 버튼 이름은 사람이 한 번 고치면 다음에 다시 섞이기 쉽다. 점수에 넣어야 떨어지지 않는다(REQ-041).
- "모든 디테일"은 한 번에 끝나지 않는다. 그래서 목록으로 두고, 잴 수 있는 것부터 재고, 못 재는 것은 못 잰다고 적는다.

## 버린 대안
- 화면 전체를 토스 모양으로 한 번에 바꾸기: 모습을 바꾸는 일은 승인이 필요하고(ADR-0037), 말투·버튼처럼 승인이 필요 없는 개선이 먼저 효과가 크다.
- 말투를 린트로만 막기: 화면에 보이는 글만이 사용자에게 닿는다. 린트는 코드의 모든 문자열을 보지만 화면에 나오는 것과 나오지 않는 것을 가르지 못한다. 브라우저가 실제 화면을 읽는 쪽이 정확하다.
- 모든 문자열을 번역 파일로 빼기: 이번 일의 범위를 넘고, 말투 일관성은 파일 구조가 아니라 규칙과 측정으로 지킨다.

## 결과와 한계
- 기계 측정이 늘었다: `voice`, `one-thing`, `buttons`, `disabled-why`, `hover`(사용성), `targets`(접근성), `units`(신뢰).
- 한다체를 해요체로 옮기는 동안 이 측정은 하한(98점)을 밑돌 수 있다. 옮기기를 끝낸 뒤 하한을 맞춘다.
- 한계: 해요체 판정은 문장 끝 모양으로 하므로 어색한 해요체나 한다체 같은 명사 끝을 가려내지는 못한다.
- 한계: 쉬운 말, 문장 길이, 날짜 형식, 지울 때 확인은 사람이 확인하는 항목이다.
- 한계: 화면에 나오지 않는 서버·core의 글은 한다체로 남는다.

## 출처
- 토스 앱인토스 소비자 UX 가이드(제품 원칙 10가지): https://developers-apps-in-toss.toss.im/landing-page/landing-page-en/design/consumer-ux-guide
- 토스 피드, 제품 원칙: https://toss.im/tossfeed/article/tossproductprinciples
- 토스 피드, 단순함의 중요성: https://toss.im/tossfeed/article/importance-simplicity
- 토스 피드, UX 라이터 인터뷰: https://toss.im/tossfeed/article/uxwriter-interview
- Design Compass, 토스의 단순함: https://designcompass.org/en/2025/04/28/toss-simplicity/
