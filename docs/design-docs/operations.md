---
title: 서버 운영 — 설치와 외부 시스템 연결
kind: guide
status: active
last_verified: 2026-11-12
covers:
  - apps/server/src/adapters/config.ts
  - apps/server/src/adapters/identity-config.ts
  - apps/server/src/http/identity.ts
  - apps/server/src/http/viewer.ts
  - apps/server/src/main.ts
covers_hash: 1a1eaa19042e97e1
verification_log:
  - "2026-11-11: main.ts의 시작 실패 보고를 console.error에서 process.stderr.write로 바꿨다(ADR-0148). 본문 서술과 어긋난 곳 없음"
  - "2026-11-11: step 가 (ADR-0174): identity and policy; statements checked against the code"
  - "2026-11-11: self-declared admin: token, else loopback socket address only; proxy mode unchanged"
  - "2026-11-11: step 나 (ADR-0174): visibility scopes; statements checked against runtime/permissions.ts, gate.ts, scoping.ts and the stores"
  - "2026-11-12: step 나 review fixes (ADR-0179): default model is a model made for everyone, one scope route for five kinds; statements checked against the code"
---
# 서버 운영

## 한 문장으로

**설정 파일 하나(`TERRARIUM_CONFIG`)에 외부 시스템의 주소를 적으면, 가짜 대신 진짜가 붙는다.** 코드는 바꾸지 않는다.
설정이 없어도 서버는 뜬다 — 내장 기준 에이전트와 가상의 샘플 그래프만으로 실험 전체를 해 볼 수 있다.

## 띄우기

```
pnpm install
pnpm build                    # 웹 화면을 apps/web/dist로 빌드
TERRARIUM_CONFIG=/etc/terrarium/terrarium.json pnpm start
```

- 데이터는 `dataDir`(기본: 설정 파일 옆 `data/`)의 `terrarium.db` 한 파일이다. 백업은 이 파일 복사.
- 멈출 때(SIGTERM) 돌던 실행은 "서버가 멈춰 실행이 중단됐다"로 남고, 대기하던 실행은 다음 시작 때 이어서 돈다. **운영 실행은 예외다**: 멈출 때 `running`으로 두고 입력 기록을 마저 써 두었다가, 다음 시작 때 기록을 다시 넣어 멈춘 자리에서 이어 간다([운영 모드](operation-mode.md#서버-재시작-뒤-재개-결정-8-adr-0112)). 이어 갈 수 없을 때(세계 버전이 바뀜 등)만 이유를 붙여 중단된다.
- 세션은 워커 스레드에서 돈다. 개수는 `workers`(기본: CPU 수 − 1). 스레드 하나가 세션 32개(`cluster.sessionsPerThread`)를 들고 있으므로,
  동시 실행 상한의 기본값은 `스레드 수 × 32`다(`limits`를 정하면 그 값이 위쪽 한도). CPU를 늘리면 상한도 는다.
- 한 대로 모자라면 워커 노드를 더 붙인다: [규모 키우기](scaling.md).

## 설정 파일 예

비밀 값은 파일에 쓰지 않는다. **환경 변수 이름**만 적는다(`…Env`). 화면에서 연결할 때 직접 입력한 토큰·비밀번호는 서버가 암호화해 보관한다(아래 "비밀 값과 열쇠").

```json
{
  "port": 8787,
  "publicUrl": "https://terrarium.dc.internal",
  "identity": {
    "header": "x-forwarded-user", "proxySecretEnv": "TERRARIUM_PROXY_SECRET",
    "nameHeader": "x-forwarded-name", "groupsHeader": "x-forwarded-groups",
    "admins": ["haneul.kim"], "adminGroup": "terrarium-admins"
  },
  "limits": { "maxRunning": 200, "perUser": 50, "perHarness": 100 },
  "harnesses": [
    {
      "kind": "http", "id": "symphony", "name": "Symphony 하네스",
      "url": "https://symphony.internal/terrarium", "tokenEnv": "SYMPHONY_TOKEN", "telemetry": "clickstack"
    },
    {
      "kind": "a2a", "id": "triage-agent", "name": "분류 에이전트(A2A)",
      "url": "https://agents.internal/triage", "tokenEnv": "TRIAGE_TOKEN"
    }
  ],
  "connections": { "retentionDays": 30, "warnDays": 7, "allowedHosts": ["*.internal"] },
  "sources": [
    { "kind": "falkordb", "id": "kg", "name": "운영 KG", "url": "falkor://kg.internal:6379", "graph": "cloud_topology", "passwordEnv": "KG_PASSWORD" }
  ],
  "telemetry": { "kind": "clickstack", "url": "http://clickhouse.internal:8123", "database": "otel", "user": "terrarium_ro", "passwordEnv": "CLICKHOUSE_PASSWORD" }
}
```

| 항목 | 무엇 | 없으면 |
|---|---|---|
| `publicUrl` | 사람과 하네스가 이 서버에 닿는 주소. 공유 링크와 실행별 MCP 주소가 이것으로 만들어진다 | 요청의 Host 헤더(로컬 개발용) |
| `identity.header` | SSO 프록시가 넣는 로그인 ID 헤더. 있으면 **프록시 모드**: 프록시의 비밀 값이 맞는 요청만 믿는다([ADR-0174](adr/0174-permissions-proxy-identity-three-scopes-audit.md)) | 웹에서 이름을 한 번 입력(혼자 개발할 때만) |
| `identity.proxySecretEnv` | 프록시가 모든 요청에 실어 보내는 비밀 값이 든 **환경 변수 이름**. 프록시 모드에서는 꼭 있어야 한다 | 프록시 모드면 서버가 안 뜬다 |
| `identity.secretHeader` | 그 비밀 값을 싣는 헤더 | `x-terrarium-proxy-secret` |
| `identity.nameHeader` / `groupsHeader` | 보여 줄 이름 / SSO 그룹(쉼표로 구분) 헤더. 이름이 없으면 로그인 ID를 보여 준다. 그룹이 없으면 그룹 없음 | 없음 |
| `identity.admins` / `adminGroup` | 프록시 모드의 관리자: 로그인 ID 목록, 또는 이 SSO 그룹에 든 사람 | 관리자 없음 |
| `identity.adminTokenEnv` / `adminTokenHeader` | **이름을 직접 적는 방식**의 관리자 토큰이 든 환경 변수 이름 / 토큰을 싣는 헤더. 이 방식에서는 토큰을 보낸 요청만 관리자다. 적지 않으면 이 기계의 루프백 주소에서 온 요청만 관리자다([ADR-0152](adr/0152-reality-worlds-admin-fork-excel-spl.md)) | 토큰 없음: 루프백에서 온 요청만 관리자 / `x-terrarium-admin-token` |
| `harnesses` | 파일로 붙일 하네스·에이전트(연결 방식은 [ADR-0042](adr/0042-connectors.md)). `builtin`(내장 기준 에이전트)은 항상 있다. 사람은 화면에서도 연결할 수 있다 | 내장만 |
| `connections.allowedHosts` | 화면에서 연결할 수 있는 호스트(`*.internal`처럼). 클라우드 메타데이터 주소는 항상 막는다 | 메타데이터 주소만 막음 |
| `connections.retentionDays` | 화면에서 만든 연결이 실험에 안 쓰이면 지우는 날 수. 0이면 지우지 않는다 | 30 |
| `connections.warnDays` | 지우기 며칠 전부터 만든 사람에게 알리는가 | 7 |
| `sources` | 세계를 가져올 현실. FalkorDB는 `GRAPH.RO_QUERY`로만 읽는다(REQ-011) | 샘플 그래프만 |
| `telemetry` | 하네스가 남긴 trace·log를 읽을 ClickStack의 **기본값**. 읽기 전용 계정을 쓴다. 연결이 "서버 기본값"을 고르면 이것을 읽는다 | 토큰·모델 시간 칸이 비고 나머지 분석은 그대로 |
| 하네스의 `traces` | 그 하네스의 트레이스가 쌓이는 곳: `{"kind": "none"}`, `{"kind": "default"}`, `{"kind": "clickstack", "url": …}`, `{"kind": "langfuse", "host": …, "publicKey": …, "secretKeyEnv": …}`. 화면에서는 연결 폼의 "이 하네스의 트레이스는 어디에 쌓이나요?"로 고른다 | 옛 규칙: 하네스가 `telemetry: "clickstack"`이면 서버 기본값 |

## 비밀 값과 열쇠

- 화면에서 입력한 토큰·비밀번호·비밀 헤더는 AES-256-GCM으로 봉인해 `terrarium.db`에 둔다. 열쇠는 환경 변수 `TERRARIUM_SECRET_KEY`에서 만들고, 없으면 `dataDir/secret.key`(만든 서버만 읽는 권한)를 처음에 만들어 쓴다.
- 서버를 여러 곳에 옮길 때는 **열쇠도 같이 옮긴다.** 열쇠가 바뀌면 봉인된 값은 열 수 없어, 그 연결은 "닿을 수 없음 — 비밀 값을 다시 입력한다"가 된다(다른 연결은 영향 없음).
- 백업은 `terrarium.db`와 `secret.key`(또는 `TERRARIUM_SECRET_KEY`)를 함께, 서로 다른 곳에 둔다.
- 화면에서 만든 연결이 30일 동안 실험에 쓰이지 않으면 서버가 지운다. 서버가 뜰 때와 6시간마다 살펴보고, 지우기 7일 전부터 만든 사람에게 화면 위 배너로 알린다.

## 사용자 식별 자리

두 방식이 있고, 시작할 때 하나로 정해진다. SSO를 서버가 직접 확인해야 하게 되면 식별 방식 하나(`Authenticator`)를 더하면 된다 — [ADR-0044](adr/0044-identity-slot.md). 실제 SSO(OIDC·SAML)는 만들지 않았다. 자세한 규칙은 [권한](permissions.md).

**공개 범위와 예전 기록 (ADR-0174 나 단계).** SQLite 스키마는 3판이다. 열 때 2판 이하 파일에 `scope`·`grp` 열(세계·시나리오는 `owner`도, 저장된 기록의 `owner`에서 채운다)을 더하고 `PRAGMA user_version`을 올린다. 범위가 없는 예전 기록은 세계·시나리오·실험·연결·모델 등록 모두 **`everyone`으로 읽는다**(새 연결·모델 등록의 처음 값이 "나만"이어도 예전 것을 갑자기 숨기지 않는다). "모두"인 새 기록도 범위를 적지 않아 예전 기록과 바이트까지 같다. 소유자가 없는 예전 기록은 범위가 없으면 로그인한 누구나 본다.

**프록시 모드 (`identity.header`가 있을 때. 여럿이 쓰는 배포는 이것이다)**

- 사용자 → 프록시(SSO 로그인을 맡음) → 테라리움. 프록시가 로그인 ID·이름·그룹을 헤더로 넘기고, 프록시만 아는 **비밀 값**(`secretHeader`)을 모든 요청에 싣는다.
- 비밀 값이 없거나 틀렸거나(일정한 시간으로 견준다) 로그인 헤더가 없으면 공개가 아닌 모든 길과 두 실시간 스트림이 **401**이다. "anonymous"로 통과시키지 않는다. 헤더에 무엇을 더 적어도 같다.
- 비밀 값은 설정 파일에도 로그에도 응답에도 나오지 않는다. 파일에는 환경 변수 **이름**(`proxySecretEnv`)만 적는다.
- **그 환경 변수가 없거나 비어 있으면 서버가 시작하지 않는다.** 아무 열린 것도 없이 `problem:`(무엇이 빠졌나)과 `fix:`(무엇을 하면 되나)를 적고 끝난다. `proxySecretEnv`를 적지 않은 경우도 같다.
- 로그인 ID는 바뀌지 않는 값이라 소유를 여기에 적는다. 이름은 보여 주기용이다. ID·이름·그룹은 한 가지 유니코드 꼴(NFC)로 맞춰, 키보드마다 다르게 들어오는 한글이 같은 사람으로 센다. **"anonymous"는 어느 대소문자로도 로그인 ID로 못 쓴다.**
- 관리자는 `admins`(로그인 ID 목록)이나 `adminGroup`(SSO 그룹)에서 온다. 나머지 로그인한 사람은 사용자다.
- 프록시를 거치지 않고 서버에 닿는 길을 막는 것은 배포(망)의 일이다. 비밀 값은 거기에 한 겹을 더할 뿐이다.
- `/mcp/runs/…`(에이전트의 도구 주소)와 `/r/…`(공유 링크)는 주소 안의 토큰이 지키므로 로그인 밖이다.

**이름을 직접 적는 방식 (`identity.header`가 없을 때. 혼자 쓰는 개발용)**

- 웹이 묻는 이름을 헤더(`x-terrarium-user`)로 보낸다. **누구나 남의 이름을 적을 수 있으니 보호가 아니다.** `GET /api/meta`의 `identity.mode`가 `self-declared`라고 말해, 화면이 그렇게 알릴 수 있다. 이름이 없는 요청은 하나의 "anonymous" 사용자로 지나간다(예전과 같다). 이 말을 이름으로 적으면 이름이 없는 것으로 친다.
- 관리자는 **관리자 토큰**이 있어야 한다: `adminTokenEnv`가 가리키는 환경 변수의 값을 `adminTokenHeader`에 실은 요청만 관리자다. 토큰을 정하지 않으면 **이 기계 자신(127.0.0.1·::1)에서 온 요청만** 관리자다. 주소는 소켓에서 읽고 `X-Forwarded-For` 같은 헤더는 보지 않는다(`trustProxy`는 꺼져 있다). 다른 주소에서 온 요청은 관리자가 못 된다. 그래서 `pnpm dev`(웹 :5173이 서버로 넘겨 줌)로 혼자 쓰면 화면에서 기본 모델 정하기와 세계 가져오기가 된다. 같은 기계의 역방향 프록시 뒤에서는 모든 요청이 루프백으로 보이니 프록시 모드나 토큰을 쓴다. 토큰을 정했으면 루프백만으로는 관리자가 아니다. 토큰 환경 변수를 적었는데 비어 있으면 서버가 시작하지 않는다. `admins`와 `adminGroup`은 이 방식에서 쓰이지 않는다(이름으로는 누구인지 증명할 수 없으므로).

## 외부 시스템을 붙일 때 확인할 것

1. **하네스**: 화면의 "연결"에서 하네스(또는 에이전트)를 연결한다. 방식마다 필요한 칸과 도구가 가는 길이 화면에 안내된다. 우리 프로토콜로 붙인다면 [하네스 프로토콜](harness-protocol.md)의 엔드포인트 넷을 하네스 앞에 둔다. 어느 쪽이든 하네스가 `publicUrl`의 `/mcp/runs/…`에 닿아야 한다.
   하네스의 OpenTelemetry 루트 스팬 부모로 받은 `traceparent`를 쓰면 ClickStack 분석이 자동으로 붙는다.
   - GoClaw와 Hermes는 전용 연결이 있다([ADR-0055](adr/0055-goclaw-hermes-slot.md)). GoClaw는 실행마다 우리 도구 주소를 자기 MCP 서버로 등록했다가 거두므로, GoClaw가 사설망 주소를 막고 있으면 허용 호스트에 `publicUrl`의 호스트를 넣는다. Hermes는 도구를 설정 파일에서만 읽으므로, 연결 카드가 보여 주는 **고정 도구 주소**를 Hermes `config.yaml`의 `mcp_servers`에 한 번 적는다(주소의 끝은 서버 열쇠에서 나오므로 열쇠를 옮기면 같은 주소가 유지된다). 한 연결의 실험은 차례로 돈다.
   - 두 연결은 소스와 문서를 읽고 만들어 가짜 서버로 시험했고, 실제 GoClaw·Hermes로 끝까지 돌려 본 적은 없다.
2. **FalkorDB**: 실험 화면의 "현실에서 가져오기"에서 소스를 고르고 가져올 서버룸을 좁힌다. 매핑하지 못한 라벨과 가정은 가져오기 보고서와
   모델링 브리프에 나온다.
3. **트레이스(ClickStack, Langfuse)**: 연결마다 어댑터로 붙는다([ADR-0085](adr/0085-telemetry-adapters.md)). 연결 검사가 도구가 답하는지 보고, "말 걸어 보기"가 한 턴의 트레이스가 이어졌는지 보여 준다. Langfuse는 공개 키와 비밀 키(환경 변수 이름이나 직접 입력)만 있으면 되고, 하네스는 `run_id`를 세션 ID로 남겨야 한다. ClickStack: OpenTelemetry ClickHouse exporter 기본 스키마(`otel_traces`, `otel_logs`)를 가정한다. 테이블 이름이 다르면
   `telemetry.tables`에 적는다.

어느 것이든 닿지 않으면 화면은 "…에 닿을 수 없다"와 이유를 보여 주고, 나머지 기능은 그대로 쓴다.
