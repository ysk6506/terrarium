---
title: 서버 운영 — 설치와 사내 시스템 연결
kind: guide
status: active
last_verified: 2026-10-29
covers:
  - apps/server/src/adapters/config.ts
  - apps/server/src/main.ts
covers_hash: b3f1072863070b99
verification_log:
  - "2026-10-29: first version, checked against ConfigSchema and main.ts"
  - "2026-10-29: main.ts now exports run(); behaviour and doc unchanged"
  - "2026-10-29: cluster 설정 블록과 main.ts의 역할 분기, 기본 상한(스레드 수 x 32)을 코드와 대조했다"
  - "2026-10-29: main.ts 정리(배치 계산을 함수로 분리, 노드 합류 시 스케줄러를 깨우는 훅 수정) 뒤 역할 분기와 기본 상한 설명을 다시 대조했다"
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

비밀 값은 파일에 쓰지 않는다. **환경 변수 이름**만 적는다(`…Env`).

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
      "kind": "openai", "id": "litellm", "name": "LiteLLM 모델 직결",
      "baseUrl": "https://litellm.internal/v1", "apiKeyEnv": "LITELLM_KEY",
      "models": [{ "id": "gauss-32b", "model": "gauss-2-32b", "temperature": 0 }]
    }
  ],
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
| `harnesses` | 붙일 하네스. `builtin`(내장 기준 에이전트)은 항상 있다 | 내장만 |
| `sources` | 세계를 가져올 현실. FalkorDB는 `GRAPH.RO_QUERY`로만 읽는다(REQ-011) | 샘플 그래프만 |
| `telemetry` | 하네스가 남긴 trace·log를 읽을 ClickStack. 읽기 전용 계정을 쓴다 | 토큰·모델 시간 칸이 비고 나머지 분석은 그대로 |

## 사내 시스템을 붙일 때 확인할 것

1. **하네스**: [하네스 프로토콜](harness-protocol.md)의 엔드포인트 넷을 하네스 앞에 둔다. 하네스가 `publicUrl`의 `/mcp/runs/…`에 닿아야 한다.
   하네스의 OpenTelemetry 루트 스팬 부모로 받은 `traceparent`를 쓰면 ClickStack 분석이 자동으로 붙는다.
2. **FalkorDB**: 실험 화면의 "현실에서 가져오기"에서 소스를 고르고 가져올 서버룸을 좁힌다. 매핑하지 못한 라벨과 가정은 가져오기 보고서와
   모델링 브리프에 나온다.
3. **ClickStack**: OpenTelemetry ClickHouse exporter 기본 스키마(`otel_traces`, `otel_logs`)를 가정한다. 테이블 이름이 다르면
   `telemetry.tables`에 적는다.

어느 것이든 닿지 않으면 화면은 "…에 닿을 수 없다"와 이유를 보여 주고, 나머지 기능은 그대로 쓴다.
