---
title: GPU 카탈로그 — H100부터 B300까지, 베라 루빈은 도입 예정
kind: spec
status: active
last_verified: 2026-11-07
covers:
  - packages/core/src/catalog/gpus.ts
  - packages/core/src/catalog/builtin/gpu-servers.ts
  - packages/core/src/facades/redfish-processors.ts
  - apps/web/src/ui/builder/ServerCards.tsx
verification_log:
  - "2026-11-04: 처음 쓴 문서를 gpus.ts, gpu-servers.ts, redfish-processors.ts, RackPanel.tsx와 대조"
  - "2026-11-06: REQ-094 세계 만들기 입구·서비스부터·패널 없는 직접 짓기(ADR-0107~0109)를 코드와 대조해 해당 절을 더하거나 고쳤다"
  - "2026-11-06: REQ-094: CSS와 키보드 도움말(Toolbox의 조작법을 ? 도움말로 합침), 카드들을 코드와 다시 대조해 맞음"
  - "2026-11-06: REQ-094 최종 확인: 카드·사다리·생성 규칙·CSS·키보드 도움말을 코드와 대조해 맞음"
  - "2026-11-07: REQ-102: 빌더 카드 묶음이 바뀌었지만 서버 넣기 카드의 GPU 줄은 그대로 맞다"
covers_hash: 0c4ed86d3f3273bc
---
# GPU 카탈로그 (REQ-066, ADR-0063)

## 한 줄로

서버가 "GPU 8장"이라고만 말하면 어떤 칩인지 알 수 없다. 이제 서버는 **어느 칩을 얹었는지**(`gpuModel`)를 말하고, 칩마다 메모리, 전력, NVLink를 적은 **사양표**가 있다.
식당에 비유하면 "주방 직원 8명"이 아니라 "수셰프 8명, 한 사람당 화구 하나"까지 아는 것과 같다.

## 사양표 (`catalog/gpus.ts`)

| 칩 | 도입 | 메모리 | 대역폭 | 장당 전력 | NVLink | NIC |
|---|---|---|---|---|---|---|
| H100 SXM5 80GB | 2023 | 80GB HBM3 | 3.35 TB/s | 700 W | 900 GB/s | ConnectX-7 400G |
| H200 SXM 141GB | 2024 | 141GB HBM3e | 4.8 TB/s | 700 W | 900 GB/s | ConnectX-7 400G |
| B200 180GB | 2025 | 180GB HBM3e | 8 TB/s | 1,000 W | 1,800 GB/s | ConnectX-7 400G |
| B300 288GB | 2025 | 288GB HBM3e | 8 TB/s | 1,100 W | 1,800 GB/s | ConnectX-8 800G |
| Vera Rubin | 2027 (예정) | 288GB HBM4 | 13 TB/s (보도) | 1,800 W (보도) | 3,600 GB/s (보도) | ConnectX-9 1.6T |

각 칩에는 `firm`이 있다. 사양 페이지로 확인했으면 참이고, 보도나 외삽이면 거짓이다. 지금은 **베라 루빈만 거짓**이다.
`status`가 `planned`인 칩은 "나왔다고 발표했지만 아직 랙에 없는" 칩이다. 베라 루빈은 사양표에 이름만 올라 있고 어느 서버도 얹지 않는다.

## 서버 5종 (`catalog/builtin/gpu-servers.ts`)

제조사는 가상의 Aerion AI다. 칩, 장수, 전력, 값만 현실을 따른다. 모두 GPU 8장, CPU 2소켓, 메모리 2 TiB다.

| 모델 | 크기 | 냉각 | 최대 전력 | 값(백만 원) | 값의 근거 |
|---|---|---|---|---|---|
| `ax-8u-h100-air` | 8U | 공랭 | 10.2 kW | 400 | 추정 (H200 서버보다 낮게. 현재 판매 값을 못 찾았다) |
| `ax-8u-h200-air` | 8U | 공랭 | 10.2 kW | 535 | 확인: Supermicro 31.9만, Lenovo 39.8만, DGX 46.7만 달러 (2026-09) 중 가운데 |
| `ax-10u-b200-air` | 10U | 공랭 | 14.3 kW | 635 | 확인: Supermicro 38.4~39.4만, Lenovo 55.0만, DGX 56.2만 달러 중 가운데쯤 |
| `ax-8u-b300-air` | 8U | 공랭 | 14 kW | 880 | 확인: Supermicro 53.7~66.3만, DGX 64.7만, Lenovo 78.6만 달러. 가운데쯤 |
| `ax-4u-b300-dlc` | 4U | 직접 수랭(열의 85%) | 14.5 kW | 940 | 추정: 공랭 B300에 콜드플레이트와 매니폴드 값을 더했다 |

- 수랭 서버는 수랭 랙에만 달린다. 공랭 랙에 달려고 하면 기존 규칙(`W030`)이 "수랭 서버라 수랭 랙에만 둘 수 있어요"라고 막는다.
- 한 장당 값은 B300이 약 1.1억 원(8.2만 달러)이다. REQ-059의 "한 장당 30~80백만 원" 검사는 이 때문에 130백만 원으로 올렸다([ADR-0063](adr/0063-gpu-catalog.md)).
- 예전의 GPU 서버(`srv-4u-gpu`, AX-8 등)는 칩이 없다. 그 서버의 BMC는 "GPU가 8개 있다"까지만 말한다.

## BMC가 말하는 것 (`facades/redfish-processors.ts`)

`/redfish/v1/Systems/<시스템>/Processors`에 CPU와 GPU가 나온다. 진짜 HGX나 Dell BMC에서 에이전트가 읽는 자리와 같다.

- `CPU0, CPU1…`: 소켓마다 하나. `TotalCores`가 있다. CPU 제조사와 모델은 모델이 말하지 않으므로 비운다.
- `GPU0…GPU7`: 칩이 정해진 서버는 `Manufacturer: NVIDIA`, `Model`, `TDPWatts`, `MemorySummary.TotalMemorySizeMiB`, `ProcessorMemory`(HBM 종류), `SerialNumber`를 말한다. 일련번호는 GPU마다 다르다.
- 칩이 정해지지 않은 GPU 서버의 GPU는 `ProcessorType: GPU`와 일련번호만 있다.
- 서버의 건강 상태와 전원을 따른다. 칩 하나만 고장 나는 일은 없다.
- 없는 프로세서는 404다. 모든 응답은 DMTF 스키마(`Processor.v1_24_0`)로 기계가 대조한다.

## 빌더에서 보이는 것 (`ui/builder/ServerCards.tsx`)

랙의 빈 U를 눌러 뜨는 "서버 넣기" 카드에서 서버를 고르면 칩이 정해진 서버는 "칩 이름 8장 · 메모리 · 장당 전력"과 "도입 예정: 베라 루빈 (2027년)" 한 줄이 붙는다. 베라 루빈은 고를 수 없다.

## 하지 않은 것

- 칩 하나의 온도, 전력, 사용률, ECC·XID 오류. nvidia-smi와 DCGM은 없다. GPU 고장은 서버 단위다.
- NVLink 구성(NVSwitch, NVL72 랙)과 GPU 네트워크(InfiniBand·RoCE, rail-optimized). 다음에 다룬다.
- B300의 장당 전력은 자료마다 1,100W와 1,400W로 갈린다. HGX 서버 기준으로 1,100W를 썼다.
- H200·B200의 대역폭·전력, DGX급 서버 전력은 기억과 판매처 글에 기댔다. NVIDIA 규격표를 직접 읽지는 못했다.
- 월드 생성기의 사다리("서비스부터")는 이 서버를 쓴다: 가속기 층 칩이 GPU 서버를 짓는다. 규칙은 [가속기 층](gpu-layer.md). 캠퍼스 생성기의 GPU 랙은 예전 모델이다.

## 확인

- `tests/spec/gpu-catalog.test.ts` — 칩 사양, 서버와 칩의 짝, 전력과 값의 범위, 수랭 서버의 랙 규칙, Redfish `Processors`와 스키마 대조.
