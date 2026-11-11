---
title: 가속기(GPU) 층 — GPU·NVLink·IB 패브릭·스케줄러·학습 잡·추론 풀, 고장 여덟과 시스템이 스스로 하는 일
kind: spec
status: active
last_verified: 2026-11-10
covers:
  - packages/core/src/world/accel.ts
  - packages/core/src/world/accel-act.ts
  - packages/core/src/world/accel-health.ts
  - packages/core/src/world/faults-accel.ts
  - packages/core/src/world/ladder-accel.ts
  - packages/core/src/physics/accel.ts
  - packages/core/src/physics/accel-alarms.ts
  - packages/core/src/tools/catalog-accel.ts
  - packages/core/src/tools/handlers-accel.ts
  - packages/core/src/tools/shell-accel.ts
  - packages/core/src/scenario/library-accel.ts
  - packages/core/src/sources/worldgen/shaped-gpu.ts
  - packages/core/src/session/probes-accel.ts
covers_hash: 071ed82a2a7ba85f
verification_log:
  - "2026-11-07: 새 문서. 코드와 대조해 칩 표·고장 표·시스템이 하는 일의 시간(30·20·300초 등)·툴·셸 명령·시나리오를 맞춰 썼다"
  - "2026-11-07: REQ-108: 코드와 대조했고 필요한 서술(기대 복구 시간, 서비스 카드 복사, 숫자 보정)을 고쳤다. 나머지는 그대로 맞다"
  - "2026-11-07: ADR-0133에 맞춰 대조: 기대 복구 시간(+5분), 손대지 않는 것이 정답인 시트의 만점, 링크 흔들림 서술"
  - "2026-11-10: 물리 상수를 슬롯 표로 옮김(REQ-113). v1 동작은 physics-golden이 비트까지 같음을 확인, 문서 내용 변화 없음"
---
# 가속기(GPU) 층 (REQ-107, ADR-0130)

사다리의 **가속기** 층은 컴퓨트와 스토리지 사이에 있다. 칩 다섯이 모두 **실선**이다(점선 없음). GPU 자체는 [GPU 카탈로그](gpu-catalog.md)가, 서버 안 NVLink와 서버 밖 IB·RoCE 패브릭의 대역폭은 [GPU 패브릭](gpu-fabric.md)이 정한다. 이 문서는 그 위에서 **세계에 무엇이 서고, 무엇이 고장 나고, 누가 무엇을 하는지**를 적는다.

## 사다리

| 칩 | 짓는 것 | 선행 조건 |
|---|---|---|
| `gpu-none` (기본) | GPU 없음. 서비스 카드가 AI 카드가 아니면 "알아서"가 이걸 골라요 | 없음 |
| `gpu-per-server` | GPU 서버 2대, 서버마다 GPU 4장(2~8장), NVLink 도메인, 첫 서버가 작은 추론 풀 하나 | 없음 |
| `gpu-serving-pool` | GPU 서버 4대 + 추론 풀(복제본 16개, MIG 4분할) | 없음 |
| `gpu-training-cluster` | GPU 서버 8대(예비 2대 포함) + IB 패브릭(`net-ai-fabric`이면 RoCE) + 스케줄러(Slurm) + 학습 잡(노드 6, 체크포인트) | 네트워크 `net-leaf-spine` 이상. 냉방 `cool-n`이면 "쓸모없는 조합" 안내 |
| `gpu-liquid-pod` | 학습 클러스터 + 액냉(DLC) 랙 + CDU, 랙 40~100 kW | 냉방 `cool-liquid` 이상, 전원 `pwr-ab` 이상, 네트워크 `net-leaf-spine` |

내장 서비스 카드 "AI 추론 서빙"은 `gpu-serving-pool`, "학습 파이프라인"은 `gpu-training-cluster`를 기본으로 달고 온다. 이 둘이 아니면 "알아서"는 `gpu-none`이고 "싸게"·"보통"·"멈추지 않게"도 `gpu-none`이다(GPU는 멈춤을 줄이지 않는다).

## 개체와 상태

| 개체 | 뜻 | 상태에서 읽는 것 |
|---|---|---|
| `gpu` | GPU 한 장. 서버 안에 `member_of` | 온도, 전력, 사용률, Xid 수, 클럭, 메모리 사용, `status` ok·degraded·down |
| `nvlink_domain` | 서버 안 GPU 묶음 | `status` |
| `ib_fabric`, `ib_link` | 서버 밖 패브릭, 서버마다 링크 하나 | 링크 `status`·끊김 횟수, 패브릭 `status` |
| `job_scheduler` | Slurm(`slurmctld`), 호스트 서버 위 프로세스 | `status`, 빼 둔 노드(drain), 도는 잡·대기 잡 |
| `training_job` | 스케줄러 아래 학습 잡 | 단계(running·paused·failed·resumed), 스텝, 체크포인트 스텝, 잃은 스텝, 재시작 횟수 |
| `inference_pool` | 추론 풀(MIG면 서버당 복제본 4) | 답하는 복제본, 뺀 서버, p50·p99 |

서비스는 잡·풀·패브릭에 `depends_on`으로 기대고, 그 상태가 서비스 건강에 들어간다(`accel-health.ts`). GPU 서버의 전력은 GPU 부하(`gpuLoad`)를 따른다.

## 고장 여덟

| 고장 | 뜻 | 생기는 일 | 길 |
|---|---|---|---|
| `gpu_xid_error` | GPU가 버스에서 떨어짐 | 그 노드의 잡이 실패, 풀은 복제본을 뺌 | `gpu_reset` |
| `nvlink_down` | NVLink 끊김 | Xid와 같이 노드가 빠짐 | `node_drain` |
| `ib_link_flap` | 링크가 끊겼다 붙기를 되풀이 | 잡이 40 %로 느려지고 180초 넘게 가면 NCCL 타임아웃으로 실패 | `node_drain` (스케줄러에서 뺀 노드의 흔들리는 링크는 패브릭 건강에 세지 않는다) |
| `gpu_thermal_throttle` | GPU가 더 뜨거워짐(+5~40 °C) | 83 °C부터 1 °C당 클럭 4 %를 잃고, 잡은 가장 느린 GPU에 맞춤 | `set_power_cap` |
| `gpu_memory_leak_inference` | 서빙 프로세스가 GPU 메모리를 먹음 | 가득 차면 OOM으로 죽고 90초 뒤 다시 뜸을 되풀이 | `gpu_reset` |
| `job_stuck_checkpoint` | 체크포인트 저장소가 느림 | 잡이 멈추고, 30분을 넘으면 마지막 체크포인트가 깨짐 | `job_resume` |
| `scheduler_down` | 스케줄러가 멈춤 | 새 잡·재시작이 안 됨(돌던 잡은 그대로) | `run_command`로 `slurmctld` 재시작 |
| `mig_misconfig` | MIG 분할이 모델과 안 맞음 | 복제본이 절반만 뜸 | `pool_scale` |

선두 시간과 MTBF는 [선두 시간](lead-times.md)과 `session/operation/mtbf.ts`에 있다(GPU 교체 2시간~1일, 부품 1~7일 등).

## 시스템이 스스로 하는 일 (원인 `cluster`)

| 일 | 때 | 점수에서 |
|---|---|---|
| 스케줄러가 Xid가 난 노드를 drain | GPU가 떨어진 지 30초 | 에이전트의 조치로 세지 않음 |
| 풀이 나쁜 복제본을 뺌 | GPU가 떨어진 지 20초 | 같음 |
| 스케줄러가 실패한 잡을 마지막 체크포인트부터 예비 노드에 다시 올림 | 실패한 지 300초, 스케줄러가 살아 있어야 함 | 같음. 마지막 체크포인트 이후 스텝은 잃어요 |

에이전트가 먼저 하면(예: `job_resume`) 300초를 기다리지 않는다. 이때 잡은 나쁜 노드를 예비 노드로 바꾼 뒤에 올라간다.

## 툴

| 툴 | 하는 일 |
|---|---|
| `gpu_status` | `nvidia-smi`처럼 GPU 상태 |
| `gpu_reset` | GPU 리셋(그 노드의 학습 프로세스는 죽어요. 멀쩡한 GPU를 리셋하면 해가 돼요) |
| `ib_status` | 패브릭·링크 |
| `job_status` | 스케줄러와 잡 |
| `job_resume` | 멈춘·실패한 잡을 체크포인트부터 이어서 |
| `node_drain` | 노드를 스케줄에서 빼거나 되돌림 |
| `pool_scale` | 풀 복제본 수(MIG 설정도 풀림) |

셸(`run_command`): `nvidia-smi`, `nvidia-smi -q -d TEMPERATURE,POWER`, `ibstat`, `dcgmi diag -r 1`. 떨어진 GPU는 `ERR!`로 보인다.

## 시나리오 일곱과 변별력

`gpu-xid-error` · `nvlink-down` · `ib-link-flap` · `gpu-memory-leak` · `job-stuck-checkpoint` · `mig-misconfig` · `scheduler-down-job`(스케줄러가 멈춘 채 Xid가 남). 모두 [변별력 점검](measurement.md)에서 아무것도 안 함·찍기는 10점 이하이고, 정답만 아는 에이전트와는 30점 이상 벌어진다. 서비스를 옮겨서 살리는 길(`probes-accel.ts`)과 흔한 툴로 닿는 길이 있고, 셸로 보이는 징후(`nvidia-smi`의 `ERR!` · Xid)가 `shellReach`에 걸려 있다.

## 솔직한 한계

- GPU 성능은 클럭 비율 하나로 줄인다. 연산 종류·메모리 대역·NCCL 집합 통신 알고리즘은 흉내 내지 않는다.
- 체크포인트 저장소는 개체가 아니라 잡의 속성이다(느려짐은 `job_stuck_checkpoint`로만 만든다).
- 잡은 하나의 데이터 병렬 그룹처럼 움직인다(노드 하나가 빠지면 전체가 선다). 파이프라인 병렬·탄력 학습은 없다.
- 추론 풀의 요청 흐름은 부하 하나(`load`)와 복제본 수로 줄였다.
- Xid 코드는 값만 다르고 동작은 같다(79번처럼 버스에서 떨어짐).
