---
title: 진짜 하네스로 끝까지 — LangGraph, OpenCode, OpenClaw 실측과 재현 절차
kind: guide
status: active
covers:
  - apps/server/src/adapters/connectors/langgraph.ts
  - apps/server/src/adapters/connectors/opencode.ts
  - apps/server/src/adapters/connectors/openclaw.ts
  - tests/e2e/harness/*.ts
  - tests/e2e/harness/langgraph-app/*
---
# 진짜 하네스로 끝까지

커넥터([ADR-0042](adr/0042-connectors.md))는 지금까지 가짜 하네스로만 시험했다. 이 문서는 진짜 소프트웨어 세 가지를 설치해서
"냉방기 정지" 시나리오 실험을 끝까지 돌린 기록이고, 모델이 닿는 기계에서 같은 일을 되풀이하는 절차(런북)다.

## 무엇을 증명했고 무엇은 아닌가

| | 증명함 | 증명하지 않음 |
|---|---|---|
| 배관 | 커넥터가 진짜 하네스에 연결하고, 하네스가 테라리움 툴을 불러, 진단이 채점되고 순위표에 뜬다 | |
| 모델 | | 모델의 판단력. 이 환경에는 LLM 키가 없어서 **대본대로 툴을 부르는 가짜 모델**을 썼다. 점수 90.9는 대본의 점수다 |
| 하네스 행동 | 대본으로 낼 수 있는 한 흐름(툴 4번 호출) | 모델이 헤맬 때의 행동, 긴 실행, 취소, 시간 초과, 동시 실행 |

점수가 90.9인 것은 대본이 `spare-setpoint`(여분 냉방기 설정 온도 낮추기, 10점)를 안 해서다. 같은 대본을 진짜 모델로 바꾸면 이 숫자는 의미가 없어진다.
**진짜 모델로 한 번은 반드시 다시 돌려야 한다.** 아래 런북이 그 절차다.

## 실측 결과

세계 `e2e 홀`(천안, 랙 6개), 시나리오 "냉방기 정지", 시드 1, 시간 정책 lockstep, 툴 13개(`DEFAULT_TOOLSET`에서 프로토콜 툴을 뺀 것).
세 실험 모두 `completed`, 진단 60/60(원인 `ca-dc1-f1-a-crah1`, 종류 `cooling_unit_failure`), 총점 **90.9**, 툴 호출 3회 + 진단.
순위표(벤치마크 화면)에 세 줄이 떴다. 한 줄이 "시드 3개부터 순위에 올라요"라서 순위 숫자는 "순위 전"으로 나온다(서로 다른 시드가 3개 쌓여야 매긴다).

| 하네스 | 설치한 버전 | 테라리움이 붙는 곳 | 결과 | 토큰 |
|---|---|---|---|---|
| LangGraph | langgraph 1.2.19, langgraph-cli 0.4.40 (`langgraph dev`, langgraph-api 0.17.1), langchain-core 1.7.6, langchain-mcp-adapters 0.3.2, Python 3.13 | Agent Server REST (`/assistants/search`, `/threads`, `/threads/{id}/runs`) | 완주, 90.9 | 보고 없음(순위표에 `—`) |
| OpenCode | opencode-ai 1.19.5 | `opencode serve` HTTP (`/agent`, `/mcp`, `/session`, `prompt_async`, `/session/status`) | 완주, 90.9 | 600 |
| OpenClaw | openclaw 2026.10.10 (Node 24.22) | 게이트웨이 `/v1/models`, `/v1/chat/completions` | 완주, 90.9 | 480 |

### 어떻게 이어지나

- **LangGraph**: 테라리움이 `config.configurable.terrarium_mcp_url`에 실행 전용 MCP 주소를 넣어 준다. 그래프(`tests/e2e/harness/langgraph-app/graph.py`)가 그 주소를
  `langchain-mcp-adapters`로 붙여 툴 13개를 읽고, 가짜 채팅 모델이 `list_alarms`, `facility_status`, `restart_cooling_unit`, `submit_diagnosis`를 차례로 부른다.
  가짜 모델은 앞선 툴 결과에서 냉방기 id를 정규식으로 뽑는다(월드마다 id가 다르므로).
- **OpenCode**: 커넥터가 `POST /mcp`로 `terrarium-<실행id>` 원격 MCP 서버를 붙이고, 세션을 만들어 과제를 `prompt_async`로 보낸다. OpenCode는 OpenAI 호환 공급자(`@ai-sdk/openai-compatible`)로
  설정한 대본 서버(`tests/e2e/harness/stub-llm.ts`)에 채팅 요청을 보내고, 대본 서버가 툴 호출(`terrarium-<id>_list_alarms` 같은 접두사 붙은 이름)을 돌려준다.
- **OpenClaw**: 커넥터가 `/v1/chat/completions`에 함수 툴을 실어 보내고, 게이트웨이의 에이전트가 같은 대본 서버를 모델로 써서 `tool_calls`로 답한다. 테라리움이 툴을 실행해 결과를 `tool` 메시지로 돌려보내는 것을 되풀이한다.

## 찾은 막힘과 고친 것

| # | 하네스 | 막힘 | 처리 |
|---|---|---|---|
| 1 | OpenCode | `GET /agent`가 `hidden: true`인 내부 에이전트(`title`, `summary`, `compaction`)도 `mode: primary`로 준다. 화면의 에이전트 목록에 사람이 고를 수 없는 것이 섞였다 | **고침.** `opencode.ts`가 `hidden`을 거른다 |
| 2 | OpenCode | 실행이 끝나도 `terrarium-<실행id>` MCP 서버가 서버에 남아, **다음 실행의 에이전트에게 지난 실행의 죽은 툴이 같이 보인다.** 두 번째 실행은 툴이 24개가 아니라 37개였고, 첫 실행의 툴을 불러 18.2점을 받았다 | **고침.** 실행이 끝나면(성공·실패·취소 모두) `POST /mcp/<이름>/disconnect`로 끊는다. 고친 뒤 연속 실행이 모두 24개, 90.9점이다 |
| 3 | OpenClaw | 기본 설정에서 클라이언트 함수 툴이 `tool_search`/`dispatch_action` 뒤에 숨는다(`tools.toolSearch` 기본 켜짐). 모델이 테라리움 툴을 바로 못 본다 | 게이트웨이 설정 `tools.toolSearch: false`. 커넥터의 툴 안내(`toolGuide`)에 한 줄 더했다 |
| 4 | OpenClaw | 툴 스키마를 다 펴면 입력이 약 5만 토큰이라 컨텍스트 창 32k 모델은 `context_length_exceeded`로 실행이 실패한다 | 모델 창을 크게 쓴다. 안내에 한 줄 더했다 |
| 5 | OpenClaw | 에이전트에게 `exec`, `write`, `browser` 같은 **자체 툴 57개가 같이 보인다.** 테라리움 툴만 쓰게 하는 공정함(REQ-008)이 깨진다 | `tools.profile: "minimal"` + `tools.deny`(그룹 `runtime`, `fs`, `web`, `ui`, `automation`, `nodes`, `messaging`, `sessions`)로 줄이면 툴이 정확히 13개가 된다. 안내에 한 줄 더했다 |
| 6 | OpenClaw | 게이트웨이는 대화 기록을 한 개의 사용자 메시지로 펴서 모델에게 준다(`Tool:<id>: <결과>` 줄). `tool` 역할 메시지로 보지 못한다 | 커넥터는 영향 없음(툴 루프는 테라리움 쪽). 대본 서버가 이 모양도 읽도록 했다. 진짜 모델은 텍스트로 읽는다 |
| 7 | OpenClaw | 2026.10.10은 Node 24.16 이상이 필요하다(설치 단계에서 막힘). Node 22에서는 옛 2026.9.2가 깔린다 | Node 24를 `npm i node@24`로 받아 그 PATH로 설치·실행 |
| 8 | LangGraph | 이 컨테이너에서 2024번 포트가 이미 다른 것이 쓰고 있어 `langgraph dev`가 다른 포트로 옮겨 앉고, 2024로는 연결이 끊긴다 | 다른 포트(2124)를 지정 |
| 9 | LangGraph | `langgraph dev`의 파일 감시가 `.langgraph_api`·`__pycache__` 변화를 보고 계속 다시 뜬다 | `--no-reload` |
| 10 | LangGraph | 개발 서버가 외부(supabase) 텔레메트리에 붙으려다 거절당한다. 동작에는 영향 없음 | 무시 |

### 남은 한계 (고치지 않음)

- **OpenCode 동시 실행**: MCP 서버는 서버 전체의 설정이라, 한 서버에서 실행 둘이 겹치면 서로의 툴이 보인다. 연속 실행은 2번으로 고쳤지만 겹치는 실행은 직접 재현하지 않았다(같은 원리라는 추론이다). 실험용 OpenCode 서버를 따로 두고 시드를 하나씩 돌린다.
- **LangGraph 토큰**: 서버가 사용량을 주지 않아 순위표 토큰 칸이 비어 있다. 진짜 모델 실행에서 그래프가 사용량을 어디에 남길지 정해야 한다.
- **취소와 시간 초과**: 세 하네스 모두 이번에는 시험하지 않았다. OpenClaw는 실행을 멈추는 호출이 없어서 기다리기만 멈춘다(커넥터 설명대로).
- **시험 범위**: 시나리오 하나, 시드 하나, 대본 한 가지. 오류 경로(서버 다운, 인증 실패)는 가짜 하네스 시험이 맡고 있다.

## 런북: 모델이 닿는 기계에서 되풀이하기

공통: 테라리움 서버가 하네스 프로세스에서 닿아야 한다. 설정의 `publicUrl`을 하네스가 열 수 있는 주소로 둔다(`localhost`이면 안 된다, 하네스가 다른 기계일 때).
세계·시나리오는 `tests/e2e/harness/drive.ts`가 처음 한 번 만들어 준다. 화면에서 만들어도 된다.

```
# 터미널 1: 테라리움
pnpm tsx apps/server/src/main.ts          # 설정 파일은 TERRARIUM_CONFIG

# 실험 하나를 돌리고 결과를 찍는다 (아래 하네스마다 연결 JSON이 다르다)
pnpm tsx tests/e2e/harness/drive.ts <연결방식> "<연결 이름>" '<연결 JSON>' [에이전트 id]
```

모델 엔드포인트는 자체 운영하는 OpenAI 호환 서버나 LiteLLM이면 모두 같은 모양이다: **기본 주소(끝이 `/v1`), 키, 모델 이름** 세 가지.
아래에서 `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`은 그 세 가지를 담은 환경 변수다(이름은 임의).
함수 호출(툴 호출)을 지원하는 모델이어야 한다. LiteLLM 뒤라면 모델 이름은 LiteLLM에 등록한 이름이다.

### 1. LangGraph

```
python3 -m venv venv && ./venv/bin/pip install langgraph "langgraph-cli[inmem]" langchain-core langchain-mcp-adapters langchain-openai
cp -r tests/e2e/harness/langgraph-app /작업/lg-app && cd /작업/lg-app     # 저장소 안에서 돌리면 .langgraph_api가 생긴다
export LG_MODEL_BASE_URL=$LLM_BASE_URL LG_MODEL_NAME=$LLM_MODEL LG_MODEL_API_KEY=$LLM_API_KEY
/경로/venv/bin/langgraph dev --no-browser --no-reload --host 0.0.0.0 --port 2024
```

- `LG_MODEL_BASE_URL`을 비우면 대본 모델로 돈다(이번 실측). 채우면 `graph.py`가 `langchain-openai`의 `ChatOpenAI`를 쓴다.
- 연결: `drive.ts langgraph "LangGraph" '{"url":"http://<하네스 주소>:2024"}'`. 서버가 키를 요구하면 `apiKey`(또는 `apiKeyEnv`).
- 배포는 `langgraph build`로 컨테이너를 만들어 같은 그래프를 올리면 된다. 그래프가 `configurable.terrarium_mcp_url`을 읽기만 하면 된다.

### 2. OpenCode

`opencode.json`(작업 폴더에 두고 `OPENCODE_CONFIG`로 가리킨다):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "internal": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "내 모델",
      "options": { "baseURL": "http://litellm.example:4000/v1", "apiKey": "<키>" },
      "models": { "내-모델": { "name": "내 모델", "tool_call": true, "limit": { "context": 128000, "output": 8192 } } }
    }
  },
  "model": "internal/내-모델",
  "small_model": "internal/내-모델",
  "autoupdate": false,
  "permission": { "*": "allow" }
}
```

```
npm i opencode-ai@1.19.5          # 믿을 수 없는 폴더에 설치하고, 실행 스크립트는 밖에 둔다
OPENCODE_CONFIG=/작업/opencode.json opencode serve --hostname 0.0.0.0 --port 4096
```

- 이번 실측은 위와 같은 설정에서 `baseURL`만 대본 서버(`pnpm tsx tests/e2e/harness/stub-llm.ts 4300`)로 가리켰다. 실행 폴더·HOME·XDG 폴더는 임시 폴더로 격리했다.
- 연결: `drive.ts opencode "OpenCode" '{"url":"http://<하네스 주소>:4096","model":"internal/내-모델"}' build`.
  서버에 비밀번호를 걸면 `OPENCODE_SERVER_PASSWORD`로 걸고 연결에 `password`(또는 `passwordEnv`).
- `permission`을 막아 두면 MCP 툴을 못 부른다. 에이전트는 `build`를 쓴다(`plan`은 편집 툴을 막는 모드다).
- 설정 값에 환경 변수를 끼우는 문법(`{env:NAME}`)은 이번에 쓰지 않았다. 키를 파일에 두지 않으려면 OpenCode 설정 문서를 먼저 확인한다.

### 3. OpenClaw

```
# Node 24.16 이상 필요 (node --version). 없으면: npm i node@24 로 받아 그 bin을 PATH 앞에 둔다
npm i openclaw@2026.10.10
```

`openclaw.json`(JSON5 허용):

```json5
{
  gateway: {
    mode: "local", port: 18789, bind: "loopback",
    auth: { mode: "token", token: "<토큰>" },
    http: { endpoints: { chatCompletions: { enabled: true } } },   // 기본은 꺼짐
  },
  models: {
    mode: "merge",
    providers: {
      internal: {
        baseUrl: "http://litellm.example:4000/v1", apiKey: "${LLM_API_KEY}", api: "openai-completions",
        models: [{ id: "내-모델", name: "내 모델", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
      },
    },
  },
  tools: {
    toolSearch: false,    // 안 하면 테라리움 툴이 검색 뒤에 숨는다
    profile: "minimal",   // exec, write 같은 자체 툴을 빼서 테라리움 툴만 남긴다
    deny: ["group:runtime", "group:fs", "group:web", "group:ui", "group:automation", "group:nodes", "group:messaging", "group:sessions"],
  },
  agents: { defaults: { model: { primary: "internal/내-모델" }, workspace: "/작업/workspace" } },
}
```

```
export OPENCLAW_STATE_DIR=/작업/state OPENCLAW_CONFIG_PATH=/작업/openclaw.json OPENCLAW_GATEWAY_TOKEN=<토큰>
openclaw gateway run --port 18789 --bind loopback
```

- 연결: `drive.ts openclaw "OpenClaw" '{"url":"http://<게이트웨이 주소>:18789","token":"<토큰>"}' main`(`/v1/models`에 `default`, `main`이 나온다. 둘 다 같은 기본 에이전트로 가는 것으로 보인다).
- `contextWindow`는 6만 이상이어야 한다(막힘 4). 설정에서 모델의 `contextWindow`가 작으면 실행이 실패한다.
- 설정이 맞는지는 게이트웨이를 띄운 채 `curl -H "Authorization: Bearer <토큰>" <주소>/v1/models`로 본다.

### 합격 기준 (진짜 모델 실행)

1. 세 하네스 모두 실험이 `completed`로 끝나고, 순위표에 줄이 생긴다.
2. 실행 페이지의 툴 호출 목록에 테라리움 툴만 있다(OpenClaw는 자체 툴이 빠졌는지, OpenCode는 `terrarium-` 말고 편집·셸 툴을 안 쓰는지 본다).
3. 같은 조건을 서로 다른 시드 3개 이상으로 돌려 순위 숫자와 구간이 나오는지 본다. 같은 하네스·모델로 점수 편차가 크면 그 자체가 결과다.
4. 막힌 곳은 이 문서의 표에 더한다.

## 이번 실측을 되풀이하려면 (대본 모델)

`tests/e2e/harness/`에 있는 것은 셋이다. `stub-llm.ts`(대본 OpenAI 호환 서버, 포트 인수), `drive.ts`(실험을 돌리고 점수·툴 호출을 찍음),
`langgraph-app/`(그래프와 `langgraph.json`). 하네스 설치는 믿을 수 없는 내려받은 코드이므로 저장소 밖 폴더에 하고, 하네스 설정은 위 런북의 JSON에서
모델 주소만 `http://127.0.0.1:<대본 포트>/v1`로 바꾼다. 이 실측의 포트는 대본 서버 4300(OpenCode)·4301(OpenClaw), LangGraph 2124, OpenCode 4196, OpenClaw 18789였다.

## 관련 문서

- [연결 방식 ADR-0042](adr/0042-connectors.md), [GoClaw·Hermes 자리 ADR-0055](adr/0055-goclaw-hermes-slot.md)
- [하네스 프로토콜](harness-protocol.md) — `http` 연결 방식
