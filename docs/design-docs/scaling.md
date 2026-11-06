---
title: 규모 키우기 — 스케일 업과 스케일 아웃
kind: guide
status: active
last_verified: 2026-11-06
covers:
  - apps/server/src/cluster/protocol.ts
  - apps/server/src/cluster/control-routes.ts
  - apps/server/src/cluster/cluster-host.ts
covers_hash: e88493d289941b13
verification_log:
  - "2026-10-29: 역할, 지표 이름, 하트비트·비우기 동작을 protocol.ts, control-routes.ts, main.ts와 대조했다"
  - "2026-10-29: 용량 문서 링크 추가"
  - "2026-11-03: 서버·core가 사람에게 돌려주는 안내 문장이 해요체로 바뀐 것만 확인했다. 동작과 본문은 그대로 (ADR-0050)"
  - "2026-11-04: 2026-11-04: 자리 잡기와 재시도, 메모리 약속 설명을 cluster-host.ts, admission.ts와 대조했다 (ADR-0056)"
  - "2026-11-06: cluster/protocol.ts·node-server.ts·remote-host.ts에 사람 응답 경로(/sessions/:id/human)가 생긴 것을 4번 문장에 더했다. 나머지 구조는 그대로 (ADR-0087)"
---
# 규모 키우기 (REQ-042, [ADR-0032](adr/0032-scale-out-workers.md))

## 한 문장으로

**실행 하나는 대부분 에이전트를 기다린다. 그래서 한 프로세스가 수십~수백 개를 동시에 들고 있을 수 있고, 모자라면 세션을 들고 있는
"일꾼 노드"를 더 붙이면 된다.** 일꾼은 상태가 없다. 상태(저장소, 줄 서기, 화면)는 컨트롤 한 곳에 있다.
얼마나 들고 있을 수 있는지는 [용량](capacity.md)에 잰 값이 있다.

## 어떻게 늘리나

| 방법 | 하는 일 | 언제 |
|---|---|---|
| 스케일 업 | CPU를 늘리고 재시작한다. 자리는 `스레드 수 × 32`로 저절로 늘어난다. `workers`로 스레드 수를 정할 수도 있다. | 수십~수백 개까지. 가장 단순하다. |
| 스케일 아웃 | 워커 노드(VM, 컨테이너, 파드)를 더 띄운다. 노드는 컨트롤에 스스로 나타나고, 자리가 합쳐진다. | 한 대로 모자랄 때, 또는 자원을 쪼개고 싶을 때. |
| 둘 다 | 노드마다 큰 CPU를 주고 노드도 늘린다. | 수천 개. |

노드를 붙이고 빼는 데 설정 수정이나 컨트롤 재시작이 필요 없다.

## 역할

같은 프로그램이 `cluster.role`로 달라진다.

| 역할 | 하는 일 | 필요한 설정 |
|---|---|---|
| `all` (기본) | 전부 한다. 토큰이 있으면 워커도 받는다. | 없음 (워커를 받으려면 `tokenEnv`) |
| `control` | 화면, API, 스케줄러, 저장소. 세션은 워커가 돈다. | `tokenEnv` |
| `worker` | 세션만 돈다. | `tokenEnv`, `controlUrl` |

```json
{ "port": 8787, "cluster": { "role": "worker", "tokenEnv": "TERRARIUM_CLUSTER_TOKEN",
  "controlUrl": "http://terrarium-control:8787" } }
```

환경 변수로도 정한다(배포 시스템용, 파일보다 우선): `TERRARIUM_ROLE`, `TERRARIUM_CONTROL_URL`, `TERRARIUM_ADVERTISE_URL`
(컨트롤이 이 노드에 닿는 주소), `TERRARIUM_NODE_ID`, `TERRARIUM_CLUSTER_TOKEN_ENV`. 토큰 자체는 `tokenEnv`가 가리키는
환경 변수에 둔다. 컨트롤과 모든 워커가 같은 값을 쓴다.

스레드 하나가 쓸 메모리(MB)는 `TERRARIUM_WORKER_HEAP_MB`로 정한다. 정하지 않으면 기계(컨테이너) 메모리에서 메인 스레드 몫을 빼고 스레드 수로 나눈 값이다([용량](capacity.md)).

기타 설정(`cluster` 안): `sessionsPerThread`(32), `heartbeatSeconds`(5), `nodeTtlSeconds`(20, 하트비트의 두 배보다 커야 한다),
`drainSeconds`(10분), `idleSeconds`(1시간), `nodeSlots`(자동 확장 계산용 힌트).

## 한도는 자리를 따른다

동시 실행 상한(`maxRunning`)은 **컨트롤 자신의 자리 + 받는 노드들의 자리**다. 노드가 붙으면 기다리던 실행이 바로 시작한다.
`limits`에서 값을 정하면 그 값이 위쪽 한도로 남는다. 정하지 않은 사용자별·하네스별 한도는 자리의 1/4, 1/2다(최소 8, 16).

## 일이 흐르는 길

1. 사람이 실험을 만든다. 실행이 줄에 선다(컨트롤).
2. 스케줄러가 자리가 있고 공정한 차례인 실행을 고른다(ADR-0024).
3. `ClusterHost`가 가장 한가한 곳(자기 스레드 또는 노드)을 고르고, 열기를 시작하는 순간 그 자리를 잡는다(동시에 열리는 세션들이 한 노드로 몰리지 않게). 노드가 가득 찼거나 비우는 중이거나 응답이 없으면 다음 곳.
   컨트롤은 자리가 있다고 세는데 노드가 가득 찼다고 거절하면(노드가 방금 끝난 세션을 아직 모르는 잠깐) 30초까지 다시 시도하고, 그래도 없으면 "세션을 돌릴 자리가 없어요"로 알린다.
4. 세션은 그 노드에서 열린다(사람을 기다리는 `ask_human` 호출도 같은 길이다: 컨트롤이 노드의 세션에 "사람이 이렇게 답했어요"와 "사람이 이렇게 조치했어요"를 `POST /node/v1/sessions/:id/human`으로 보낸다. [ADR-0087](adr/0087-tool-scope-escalation-sop.md)). 한 스레드 안에서는 [메모리 약속](capacity.md)이 입장을 다시 한 번 거른다(모자라면 줄을 선다). 세계는 노드가 모를 때만 한 번 보낸다. 에이전트의 툴 호출은 컨트롤을 거쳐 그 노드의 세션으로 간다.
5. 끝나면 결과가 컨트롤로 돌아와 저장된다.

## 노드가 사라지면

- 조용히 사라진(전원, 네트워크) 노드: 하트비트가 끊긴 지 `nodeTtlSeconds` 뒤에 자리가 빠진다. 그 노드에서 돌던 실행은 "세션을 돌리던 노드 ○○가
  멈췄다"로 실패하고 채점하지 않는다(인프라 문제다, ADR-0027). 사람이 다시 돌리면 다른 노드에서 돈다.
- 정중하게 떠나는 노드(SIGTERM): 새 세션을 끊고, 돌던 세션을 `drainSeconds`까지 기다리고, 떠난다. 실행이 잘리지 않는다.
- 컨트롤이 죽으면: 돌던 실행은 실패로 남고 대기 중이던 실행은 다시 시작할 때 이어서 돈다. 노드는 몇 초 안에 스스로 다시 붙는다.

## 자동 확장

`GET /metrics`(Bearer 토큰)가 Prometheus 형식으로 낸다.

| 지표 | 뜻 |
|---|---|
| `terrarium_runs_running`, `terrarium_runs_queued` | 지금 도는 실행, 기다리는 실행 |
| `terrarium_session_capacity` | 받을 수 있는 세션 수(자리 합) |
| `terrarium_nodes`, `terrarium_nodes_draining` | 살아 있는 노드, 비우는 중인 노드 |
| `terrarium_session_utilization` | 도는 수 ÷ 자리 (0~1) |
| `terrarium_nodes_wanted` | **일을 다 담으려면 필요한 워커 수. 이 값으로 늘리고 줄인다.** |

CPU 사용률로 늘리지 마라. 실행이 기다리는 동안 CPU는 한가해서, 줄이 길어도 CPU는 낮다.
`deploy/k8s/autoscaling-keda.yaml`이 KEDA 예다. VM이면 같은 지표를 클라우드 오토스케일러에 연결한다.
`GET /cluster/v1/nodes`(Bearer)는 노드 목록과 같은 부하를 JSON으로 준다.

## 배포 예시 (`deploy/`)

- `Dockerfile`: 이미지 하나로 모든 역할. `docker build -f deploy/Dockerfile .`
- `k8s/terrarium.yaml`: 컨트롤 1개(저장소 볼륨, 교체 방식), 워커 N개(종료 유예 시간 포함).
- `k8s/autoscaling-keda.yaml`: `terrarium_nodes_wanted`로 워커 수를 정한다.
- `systemd/`: VM이나 물리 서버의 워커.

> 이 개발 환경에서는 도커와 쿠버네티스를 띄울 수 없어서 위 파일은 **실제 클러스터에서 실행해 보지 못했다**. 같은 동작은 컨트롤과 워커를
> 프로세스 둘로 띄워 HTTP로 이은 시험(`apps/server/src/scale-out.test.ts`)으로 확인한다. 처음 올릴 때는 노드 하나로 시작해
> `/cluster/v1/nodes`에 나타나는지부터 본다.

## 한계 (알고 쓴다)

- **컨트롤은 하나다.** 저장소가 SQLite 한 파일이라 컨트롤을 여러 대로 만들 수 없다. 죽으면 다시 뜰 때까지 화면과 새 실행이 멈춘다
  (돌던 노드의 세션은 정리된다). 이중화는 저장소 교체와 함께 정할 일이다.
- **여러 대로 늘렸을 때 몇 대까지 선형으로 는지는 재지 못했다.** 컨트롤 하나와 노드 둘을 같은 기계의 프로세스 셋으로 띄워 부하를 줬고(`tests/spec/cluster-load.ts`), 골고루 차고 실패가 없었다는 것까지다.
- **실행을 노드 사이로 옮기지 않는다.** 노드가 죽으면 그 노드의 실행은 실패하고 다시 돌려야 한다.
- 컨트롤과 노드 사이는 토큰 인증이지만 기본은 평문 HTTP다. 신뢰망 밖이면 https 주소와 TLS를 쓴다.
- 컨트롤이 모든 툴 호출의 길목이라 컨트롤의 CPU와 네트워크가 마지막 한계다. 한 컨트롤이 몇 개까지 감당하는지는 용량 측정(REQ-032)으로 잰다.
