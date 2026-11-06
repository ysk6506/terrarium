---
title: HTTP API 계약
kind: spec
status: active
last_verified: 2026-11-06
covers:
  - packages/core/src/contract/routes.ts
  - packages/core/src/contract/errors.ts
  - packages/core/src/contract/views.ts
covers_hash: bb99d9ef143ed6ed
verification_log:
  - "2026-11-03: 오류 문장이 해요체가 된 것을 오류 모양 절에 적었다 (ADR-0050)"
  - "2026-11-04: calibrate 경로를 contract/routes.ts와 대조해 표에 더했다"
  - "2026-11-04: 2026-11-04: ADR-0073. 서버 오류 문장과 라우트 요약의 말(툴, 더하기, 멈추기, 지우기)만 바뀌었다. 경로와 본문 모양은 그대로, 안내 문구만 도구에서 툴로 고쳤다"
  - "2026-11-05: routes.ts의 telemetry-adapters와 connections/:id/try 두 경로, 확인 응답의 census·hiddenAgents와 traces를 표와 연결 절에 대조해 더했다 (REQ-079)"
  - "2026-11-06: routes.ts의 runEvents, runWorld 두 경로를 표에 더했고 views.ts의 RunEventsView, RunWorldView와 대조했다"
---
# HTTP API 계약 (core.contract)

## 한 문장으로

**서버와 웹이 같은 경로 표(`ROUTES`)와 같은 검증 규칙(zod)을 읽는다.** 경로나 필드 이름을 바꾸면 사용자가 버튼을 누를 때가 아니라
타입 검사에서 먼저 깨진다.

## 원칙

- **서버만 아는 것만 API로 준다.** 카탈로그, 툴 목록, 블록 팔레트, worldgen 필드처럼 코드에 정해진 지식은 웹이 core에서 직접 가져온다.
  API는 저장된 기록, 하네스·에이전트, 대기열처럼 서버에만 있는 것을 준다.
- **검증은 두 겹.** 계약의 스키마가 모양(타입·범위·크기)을 보고, 소유 단위의 검증기가 의미(부모가 있나, 시나리오가 끝까지 가나)를 본다.
  worldgen 명세는 worldgen의 규칙을 계약 안에서 바로 적용한다.
- **오류는 한 모양.** `{ error: { code, message, issues? } }`. `message`는 사람이 읽고 바로 고칠 수 있는 한국어 해요체(ADR-0050),
  `issues`는 `{ path: "recipe.seeds.2", message }` 목록이라 폼이 해당 칸 옆에 띄울 수 있다. core의 오류는 자기 HTTP 상태를 가지고 있고,
  그 밖의 예외는 500으로 바꾸면서 내부 정보(파일 경로, DB 메시지)를 숨긴다.
- **저장은 낙관적 잠금.** 세계·시나리오 저장은 `baseDigest`(편집을 시작한 버전)를 함께 보낸다. 그사이 누가 바꿨으면 409와
  "새로고침한 뒤 다시 시도한다".
- **쿼리 문자열의 빈 값은 "안 줌"이다.** 숫자는 글자에서 읽는다.

## 경로

| 경로 | 하는 일 | |
|---|---|---|
| `GET /api/meta` | 누구인지, 하네스·소스·대기열 상태, 곧 지워질 내 연결(`expiring`) | |
| `GET /api/connectors` | 연결할 수 있는 방식(커넥터)과 입력 칸·툴 안내 | |
| `GET /api/connections` | 연결된 하네스·에이전트, 발견된 에이전트, 남은 날 | |
| `GET /api/telemetry-adapters` | 트레이스를 쌓아 두는 곳(ClickStack, Langfuse)과 입력 칸, 서버의 기본값 | |
| `POST /api/connections/check` | 저장하지 않고 연결해 보기 | |
| `POST /api/connections` | 하네스를 연결하거나 에이전트를 직접 등록 | |
| `PUT /api/connections/:id` | 연결 고치기 (만든 사람만. 비밀은 비워 두면 그대로) | |
| `POST /api/connections/:id/try` | 말 걸어 보기: 에이전트에게 한 문장을 보내 답을 받는다(한 턴, 툴 없음, 60초, 세계 영향 없음) | |
| `POST /api/connections/:id/keep` | 계속 쓰기: 자동 삭제 기간을 다시 센다 | |
| `POST /api/connections/:id/check` | 다시 확인해 에이전트 목록 새로 받기 | |
| `DELETE /api/connections/:id` | 연결 끊기 (만든 사람만) | |
| `GET /api/connections/:id/agents/:agentId/versions` | 에이전트 버전 목록, 지금 실험하면 달라질 점 | |
| `POST /api/connections/:id/agents/:agentId/versions` | 사람이 버전 더하기 | |
| `PUT /api/connections/:id/agents/:agentId/versions/:n` | 버전의 이름표·메모·속성 바꾸기 | |
| `DELETE /api/connections/:id/agents/:agentId/versions/:n` | 버전 지우기 | |
| `GET /api/worlds` | 세계 목록 | |
| `GET /api/worlds/:id` | 세계 하나 (blueprint 포함) | |
| `POST /api/worlds` | 빌더에서 지은 세계 저장 | |
| `POST /api/worlds/generate` | 사업장 프리셋으로 세계 생성 | |
| `POST /api/worlds/import` | 현실(KG 등)에서 읽기 전용으로 가져오기 | |
| `PUT /api/worlds/:id` | 세계 고쳐 저장 (버전 확인) | |
| `DELETE /api/worlds/:id` | 세계 숨기기 (실험이 쓴 버전은 남는다) | |
| `GET /api/scenarios` | 시나리오 목록 | |
| `GET /api/scenarios/:id` | 시나리오 하나 | |
| `POST /api/scenarios` | 새 시나리오 (빈 것, 템플릿, 문서) | |
| `PUT /api/scenarios/:id` | 시나리오 고쳐 저장 (버전 확인) | |
| `DELETE /api/scenarios/:id` | 시나리오 숨기기 | |
| `POST /api/scenarios/:id/dry-run` | 에이전트 없이 미리 돌려 보기 | |
| `POST /api/scenarios/:id/calibrate` | 시험지 점검: 아무것도 안 하는·찍는·정답만 아는 에이전트로 점수 재 보기 | |
| `GET /api/experiments` | 실험 목록 (최신순) | |
| `GET /api/experiments/:id` | 실험 하나: 실행, 분석, 계보 | |
| `POST /api/experiments` | 실험 만들고 대기열에 넣기 | |
| `POST /api/experiments/:id/cancel` | 남은 실행 취소 | |
| `POST /api/experiments/:id/fork` | 조건만 바꿔 다시 실행 | |
| `POST /api/experiments/:id/runs` | 같은 조건으로 실행 추가 | |
| `GET /api/experiments/:id/events` | 진행 상황 실시간 (SSE) | |
| `GET /api/worlds/:id/activity` | 이 세계에서 지금 일하는 에이전트들 (SSE) | |
| `GET /api/experiments/:id/report` | 보고서 (HTML·Markdown·텍스트) | |
| `GET /api/experiments/:id/diagnoses` | 진단 기록 (JSON Lines) | |
| `POST /api/experiments/:id/shares` | 공유 링크 만들기 | |
| `DELETE /api/shares/:token` | 공유 링크 끊기 | |
| `GET /api/runs/:id` | 실행 하나: 결과, 분석, 타임라인 | |
| `GET /api/runs/:id/events` | 실행의 불변 사건 기록(세계 시간·실제 시간). `from`·`to`(세계 초)로 구간만. 실행 중이면 지금까지, `live: true` | |
| `GET /api/runs/:id/world` | 실행이 돌았던 때의 세계(그 버전 그대로) | |
| `GET /api/runs/:id/telemetry` | 하네스 트레이스·로그·메트릭 (ClickStack) | |
| `GET /api/leaderboards` | 벤치마크 세트별 순위 | |
| `GET /api/twin/diagnoses` | 모든 진단 기록 (JSON Lines) | |
| `GET /api/twin/brief` | 시뮬레이터 모델링 브리프 (Markdown) | |
| `GET /r/:token` | 공유된 보고서 (앱 없이 열림) | 공개 |

### 연결 (REQ-051, REQ-053)

- **입력은 커넥터가 설명한다.** `GET /api/connectors`의 `fields`로 화면이 폼을 그린다. 칸 종류 `secret`은 토큰·비밀번호를 직접 입력하는 칸이고, `env`는 서버의 환경 변수 이름이다. `toolGuide`는 그 방식에서 테라리움의 도구가 에이전트에게 가는 길이다.
- **비밀은 돌아오지 않는다.** 응답의 `secrets`는 값이 있는 칸의 이름이고, `headers`의 비밀 헤더는 이름과 `secret: true`만 있다. 고칠 때(`PUT`) 비밀 칸을 비워 두면 그대로, 값을 쓰면 교체, `null`이면 지운다. 비밀 헤더도 값 없이 보내면 같은 이름의 것을 유지한다.
- **연결 확인**(`POST …/check`)은 저장하지 않는다. 본문에 `id`를 주면 그 연결을 고쳐 본다(만든 사람만, 비워 둔 비밀은 기존 값). 응답에는 걸린 시간과, 테라리움 주소가 localhost일 때의 안내 같은 `notes`가 있다.
- **숨긴 에이전트**(REQ-079): 확인 응답과 목록에는 `census`(`shown`, `total`, `hidden: [{reason, count}]`, `includesHidden`, `empty`, `notes`)와 `hiddenAgents`가 있다. 하네스가 목록에서 뺀 에이전트를 몇 개 왜 뺐는지 데이터로 말하고, 문장은 화면이 만든다.
- **말 걸어 보기**(`POST …/try`, 본문 `{agentId, text}`): 응답 `TryResult`는 `ok`, 답 `text`, 실패면 `error`(상태와 상대의 말), `ms`, `model`, `tokens`, `toolCalls`, `trace`(`name`, `linked`, `spans`, `note`)다. 누구나 걸 수 있다. 연결 방식이 못 하면 `ok:false`로 이유를 준다.
- **트레이스 쌓는 곳**: 만들기·고치기·확인 본문에 `traces: {kind, config}`(`none`·`default`·`clickstack`·`langfuse`)를 줄 수 있다. 비밀은 비워 두면 그대로, `null`이면 지운다. 응답의 `traces`에는 비밀 값 없이 이름과 설정만 있다.
- **자동 삭제**: 화면에서 만든 연결은 30일 안 쓰면 지워지고, `daysLeft`·`expiresAt`·`lastUsedAt`이 목록에 있다. `meta.expiring`은 7일 안에 지워질 내 연결이다. `keep`은 누구나 호출할 수 있다.
- **에이전트 버전**: 응답 `AgentHistoryView`는 `versions`(최신이 먼저. 번호, 날짜, `source`(auto/manual), 만든 사람, 이름표·메모·속성, 스냅샷, 앞 버전과 견준 `changes`, 이 버전으로 만든 실험 수)와, 지금 실험을 만들면 무엇이 쓰일지(`pending`: 첫 버전이거나 `changes`)를 준다. 하네스에 닿지 않으면 `pendingError`. 더하기·고치기·지우기는 연결을 만든 사람만(설정 파일의 연결은 누구나). 번호가 숫자가 아니면 404, 이름표가 빈 글자면 400이다.
- 에이전트 id에 `/`가 있으면 주소에서 `%2F`로 쓴다.

### 실시간 스트림 (SSE)

- `GET /api/experiments/:id/events`: 실험 하나. 먼저 `experiment`(요약), 이후 `run`(실행 상태)과 `call`(툴 호출 하나: 시각 `t`, `tool`, `ok`, 그리고 `effect`와 `targets`).
- `GET /api/worlds/:id/activity` (REQ-050): 이 세계에서 도는 **모든 실험의 실행**. 늦게 연 화면이 알도록 지금 일하는 실행마다 `start`(누구인지: 실험 이름, 소유자,
  하네스, 에이전트, 모델)를 먼저 보내고, 이후 `call`(`runId`, `t`, `tool`, `ok`, `effect`, `targets`)과 `end`를 보낸다. 세계가 없으면 404.
- `effect`는 호출이 하는 일이다: `observe`(보기), `act`(세계를 바꿈. Redfish·vCenter 요청은 GET이 아닐 때만), `wait`(시간을 보냄), `answer`(진단 제출).
  `targets`는 호출이 이름을 댄 장비 id들이다(`core.tools`의 `callTargets`가 툴마다 정해 둔 인자에서 뽑는다). 이름을 대지 않는 호출은 빈 배열이다.

하네스가 실행 중에 툴을 부르는 MCP 엔드포인트(실행마다 하나)는 사람용 API가 아니라서 이 표에 없다. 서버의 `server.mcp`가 맡는다.
