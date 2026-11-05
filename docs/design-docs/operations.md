---
title: 서버 운영 — 설치와 사내 시스템 연결
kind: guide
status: active
last_verified: 2026-11-04
covers:
  - apps/server/src/adapters/config.ts
  - apps/server/src/main.ts
covers_hash: 97d8816a08c16532
verification_log:
  - "2026-10-29: main.ts 정리(배치 계산을 함수로 분리, 노드 합류 시 스케줄러를 깨우는 훅 수정) 뒤 역할 분기와 기본 상한 설명을 다시 대조했다"
  - "2026-10-30: 2026-10-30: config.ts의 connections 블록(allowedHosts, retentionDays, warnDays)과 secret-box.ts의 열쇠 위치(TERRARIUM_SECRET_KEY, dataDir/secret.key)를 대조해 설정 예와 항목 표, 비밀 값, 식별 자리 절을 고쳤다. openai 하네스 예를 a2a로 바꿨다"
  - "2026-11-03: 서버·core가 사람에게 돌려주는 안내 문장이 해요체로 바뀐 것만 확인했다. 동작과 본문은 그대로 (ADR-0050)"
  - "2026-11-04: GoClaw·Hermes 연결과 고정 도구 주소 설명을 하네스 항목에 추가하고, 나머지는 현재 코드와 맞는지 다시 읽었다"
  - "2026-11-04: main.ts에서 항상 참인 secretBox 확인(죽은 가지)만 지웠다. 고정 도구 주소가 서버 열쇠에서 나온다는 본문과 같다"
---
# 서버 운영

## 한 문장으로

**설정 파일 하나(`TERRARIUM_CONFIG`)에 사내 시스템의 주소를 적으면, 가짜 대신 진짜가 붙는다.** 코드는 바꾸지 않는다.
설정이 없어도 서버는 뜬다 — 내장 기준 에이전트와 가상의 샘플 그래프만으로 실험 전체를 해 볼 수 있다.

## 띄우기

```
pnpm install
pnpm build                    # 웹 화면을 apps/web/dist로 빌드
TERRARIUM_CONFIG=/etc/terrarium/terrarium.json pnpm start
```

- 데이터는 `dataDir`(기본: 설정 파일 옆 `data/`)의 `terrarium.db` 한 파일이다. 백업은 이 파일 복사.
- 멈출 때(SIGTERM) 돌던 실행은 "서버가 멈춰 실행이 중단됐다"로 남고, 대기하던 실행은 다음 시작 때 이어서 돈다.
- 세션은 워커 스레드에서 돈다. 개수는 `workers`(기본: CPU 수 − 1). 스레드 하나가 세션 32개(`cluster.sessionsPerThread`)를 들고 있으므로,
  동시 실행 상한의 기본값은 `스레드 수 × 32`다(`limits`를 정하면 그 값이 위쪽 한도). CPU를 늘리면 상한도 는다.
- 한 대로 모자라면 워커 노드를 더 붙인다: [규모 키우기](scaling.md).

## 설정 파일 예

비밀 값은 파일에 쓰지 않는다. **환경 변수 이름**만 적는다(`…Env`). 화면에서 연결할 때 직접 입력한 토큰·비밀번호는 서버가 암호화해 보관한다(아래 "비밀 값과 열쇠").

```json
{
  "port": 8787,
  "publicUrl": "https://terrarium.dc.internal",
  "identity": { "header": "x-forwarded-user" },
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
| `identity.header` | 사내 SSO 프록시가 넣는 사용자 헤더. 있으면 이것만 믿는다([ADR-0028](adr/0028-identity-and-sharing.md)) | 웹에서 이름을 한 번 입력 |
| `harnesses` | 파일로 붙일 하네스·에이전트(연결 방식은 [ADR-0042](adr/0042-connectors.md)). `builtin`(내장 기준 에이전트)은 항상 있다. 사람은 화면에서도 연결할 수 있다 | 내장만 |
| `connections.allowedHosts` | 화면에서 연결할 수 있는 호스트(`*.internal`처럼). 클라우드 메타데이터 주소는 항상 막는다 | 메타데이터 주소만 막음 |
| `connections.retentionDays` | 화면에서 만든 연결이 실험에 안 쓰이면 지우는 날 수. 0이면 지우지 않는다 | 30 |
| `connections.warnDays` | 지우기 며칠 전부터 만든 사람에게 알리는가 | 7 |
| `sources` | 세계를 가져올 현실. FalkorDB는 `GRAPH.RO_QUERY`로만 읽는다(REQ-011) | 샘플 그래프만 |
| `telemetry` | 하네스가 남긴 trace·log를 읽을 ClickStack. 읽기 전용 계정을 쓴다 | 토큰·모델 시간 칸이 비고 나머지 분석은 그대로 |

## 비밀 값과 열쇠

- 화면에서 입력한 토큰·비밀번호·비밀 헤더는 AES-256-GCM으로 봉인해 `terrarium.db`에 둔다. 열쇠는 환경 변수 `TERRARIUM_SECRET_KEY`에서 만들고, 없으면 `dataDir/secret.key`(만든 서버만 읽는 권한)를 처음에 만들어 쓴다.
- 서버를 여러 곳에 옮길 때는 **열쇠도 같이 옮긴다.** 열쇠가 바뀌면 봉인된 값은 열 수 없어, 그 연결은 "닿을 수 없음 — 비밀 값을 다시 입력한다"가 된다(다른 연결은 영향 없음).
- 백업은 `terrarium.db`와 `secret.key`(또는 `TERRARIUM_SECRET_KEY`)를 함께, 서로 다른 곳에 둔다.
- 화면에서 만든 연결이 30일 동안 실험에 쓰이지 않으면 서버가 지운다. 서버가 뜰 때와 6시간마다 살펴보고, 지우기 7일 전부터 만든 사람에게 화면 위 배너로 알린다.

## 사용자 식별 자리

`identity.header`가 있으면 그 헤더만 믿고, 없으면 웹이 묻는 이름을 쓴다. 사내 SSO를 서버가 직접 확인해야 하게 되면 식별 방식 하나(`Authenticator`)를 더하면 된다 — [ADR-0044](adr/0044-identity-slot.md). 지금은 헤더 방식과 이름 방식만 있고, 실제 SSO(OIDC·SAML)는 만들지 않았다.

## 사내 시스템을 붙일 때 확인할 것

1. **하네스**: 화면의 "연결"에서 하네스(또는 에이전트)를 연결한다. 방식마다 필요한 칸과 도구가 가는 길이 화면에 안내된다. 우리 프로토콜로 붙인다면 [하네스 프로토콜](harness-protocol.md)의 엔드포인트 넷을 하네스 앞에 둔다. 어느 쪽이든 하네스가 `publicUrl`의 `/mcp/runs/…`에 닿아야 한다.
   하네스의 OpenTelemetry 루트 스팬 부모로 받은 `traceparent`를 쓰면 ClickStack 분석이 자동으로 붙는다.
   - GoClaw와 Hermes는 전용 연결이 있다([ADR-0055](adr/0055-goclaw-hermes-slot.md)). GoClaw는 실행마다 우리 도구 주소를 자기 MCP 서버로 등록했다가 거두므로, GoClaw가 사설망 주소를 막고 있으면 허용 호스트에 `publicUrl`의 호스트를 넣는다. Hermes는 도구를 설정 파일에서만 읽으므로, 연결 카드가 보여 주는 **고정 도구 주소**를 Hermes `config.yaml`의 `mcp_servers`에 한 번 적는다(주소의 끝은 서버 열쇠에서 나오므로 열쇠를 옮기면 같은 주소가 유지된다). 한 연결의 실험은 차례로 돈다.
   - 두 연결은 소스와 문서를 읽고 만들어 가짜 서버로 시험했고, 실제 GoClaw·Hermes로 끝까지 돌려 본 적은 없다.
2. **FalkorDB**: 실험 화면의 "현실에서 가져오기"에서 소스를 고르고 가져올 서버룸을 좁힌다. 매핑하지 못한 라벨과 가정은 가져오기 보고서와
   모델링 브리프에 나온다.
3. **ClickStack**: OpenTelemetry ClickHouse exporter 기본 스키마(`otel_traces`, `otel_logs`)를 가정한다. 테이블 이름이 다르면
   `telemetry.tables`에 적는다.

어느 것이든 닿지 않으면 화면은 "…에 닿을 수 없다"와 이유를 보여 주고, 나머지 기능은 그대로 쓴다.
