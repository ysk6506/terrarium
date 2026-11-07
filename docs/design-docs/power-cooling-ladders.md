---
title: 전원·냉방 사다리 확장 — N+1 UPS·랙 배터리·자체 변전소, 리어도어·액냉·침지, 그리고 파워 캐핑(모델만)
kind: spec
status: active
last_verified: 2026-11-07
covers:
  - packages/core/src/world/ladder-power-cooling.ts
  - packages/core/src/world/faults-accel.ts
  - packages/core/src/physics/facility-ext.ts
  - packages/core/src/physics/power-cap.ts
  - packages/core/src/physics/liquid.ts
  - packages/core/src/physics/plant.ts
  - packages/core/src/sources/worldgen/power-plant.ts
  - packages/core/src/sources/worldgen/cool-plant.ts
  - packages/core/src/sources/worldgen/dense.ts
  - packages/core/src/scenario/library-power.ts
covers_hash: 7fd5932bef21f3e9
verification_log:
  - "2026-11-07: 새 문서. 코드와 대조해 전원·냉방 칩과 파워 캐핑 표, 측정한 숫자(시나리오 둘)를 맞춰 썼다"
---
# 전원·냉방 사다리 확장 (REQ-107, ADR-0130)

전원과 냉방 사다리에 칩을 더해 **끝까지 실선**으로 만들었다. GPU 층([가속기 층](gpu-layer.md))이 랙 하나를 40~100 kW로 올리기 때문에, 공기만으로는 못 식히고 UPS 한 줄로는 못 받치는 자리까지 사다리가 닿아야 했다.

## 전원 사다리

단일 피드 → A+B → **N+1 UPS** → 2N UPS+발전기 → 2N+자동 전환+연료 48시간 → **랙 배터리(BBU)·48V DC** → **자체 변전소**

| 칩 | 짓는 것 | 새 고장 |
|---|---|---|
| `pwr-n1-ups` | 계통마다 UPS 모듈 하나를 더 두고 모든 분전반이 그 계통의 모든 모듈에서 받음 | `ups_module_fail` |
| `pwr-2n-gen` | ATS와 발전기(연료 8시간) | 기존 `generator_start_failure`·`ats_stuck` |
| `pwr-2n-auto` | 연료 48시간 + 여분 발전기 한 대 | 같음 |
| `pwr-rack-bbu` | 서버가 있는 랙마다 배터리 팩(`bbu`)과 48V DC 버스(`dc_bus`) | `bbu_cell_fault`, `dc_bus_sag` |
| `pwr-substation` | 자체 변전소(`substation`): 수전 선로 둘, 변압기 둘, 앞단에 ATS | `utility_feed_loss`, `transformer_overtemp` |

- **변전소**: 수전 한 줄이 끊기면 10초 뒤 다른 줄로 자동 전환한다. 자동 전환이 안 먹는 고장(`manual`)이면 변전소가 멈추고 ATS가 발전기를 돌린다. 에이전트가 `transfer_feed(feed)`로 전압이 있는 줄로 옮긴다. 변압기는 부하에 따라 데워지고 105 °C에서 보호 차단, 80 °C 밑에서 돌아온다.
- **랙 배터리**: 랙의 PDU가 전원을 잃으면 배터리가 받친다. 남은 분은 충전량·셀·부하로 계산한다(셀이 고장 나면 용량이 25 %씩 준다). 다시 전기가 오면 30분에 가득 찬다.
- **48V DC 버스**: 부하에 따라 전압이 처지고, `dc_bus_sag`는 더 처지게 한다.
- **연료**: 발전기의 `fuelLitres`는 시간당 소모량 × 0.8 × 칩의 연료 시간이다.

## 냉방 사다리

N → N+1 → 2N+컨테인먼트 → **리어도어 열교환**(rdhx) → **DLC** → **침지**

| 칩 | 짓는 것 | 새 고장 |
|---|---|---|
| `cool-rdhx` | 고밀도 랙마다 리어도어(`rdhx`), 물은 냉각 플랜트에서 | `rdhx_valve_stuck` |
| `cool-liquid` | CDU(`cdu`)와 DLC 랙, CDU는 칠러(드라이쿨러)에 이어짐 | 기존 `cdu_pump_failure`·`coolant_leak` |
| `cool-immersion` | 침지 탱크(`immersion_tank`)와 침지용 서버. **어떤 컴퓨트 칩과도** 짓지만 서버를 침지용으로 바꾸는 비용이 크다고 안내한다 | `fluid_level_low`, 기존 `immersion_circulation_failure` |

- **리어도어 밸브가 끼면** 열교환기를 지나는 물이 `openPct`만큼으로 줄고, 나머지 열이 방으로 나온다.
- **침지 수위가 낮으면** 탱크의 열 전달이 수위의 제곱으로 줄어 유체 온도가 오른다.
- **누설 정책**: 액냉·침지 랙은 `leakPolicy: poweroff`다. 누설이 5초 감지되면 그 랙의 서버를 모두 끄고(`coolant_leak`), 물 공급은 설정한 시간(`shutoffSeconds`) 뒤 끊긴다.
- **포드의 CDU는 예비 펌프를 사람이 올린다**(`manualStandby`). 펌프가 둘 멈추면 예비는 놀고 있으므로 용량이 0이 되고 `cdu_pump_switch(cdu)`가 예비를 돌린다. `cool-liquid`의 일반 CDU는 자동 절체다.

## 선행 조건

| 칩 | 필요 | 안내 |
|---|---|---|
| `gpu-training-cluster` 이상 | 네트워크 ≥ `net-leaf-spine` | 막힘 |
| `gpu-liquid-pod` | 냉방 ≥ `cool-liquid`, 전원 ≥ `pwr-ab` | 막힘 |
| `gpu-training-cluster` + `cool-n` | | "쓸모없는 조합": 냉방 여유가 없어 GPU가 먼저 클럭을 깎아요 |
| `cool-immersion` | 컴퓨트 제한 없음 | 비용 안내 |

"멈추지 않게"는 선행 조건을 어기지 않는 가장 오른쪽 칩을 고르고 GPU는 `gpu-none`으로 둔다.

## 파워 캐핑 (모델만, ADR-0096 일부 구현)

[파워 캐핑 참고](power-capping-reference.md)가 적은, 연수 님 팀이 검증한 두 시나리오를 모델에 옮겼다. **실제 BMC·RAPL·NVML 캡을 다루지는 않고**, 모델 안에서 캡이 성능과 발열에 닿는 길만 만든다.

| 참고 문서 | 테라리움 |
|---|---|
| 서버별 소비전력 상한 | 툴 `set_power_cap(server, watts)` (비우면 해제). 유휴 전력 아래로는 못 내려가요 |
| 캡 → CPU/GPU 주파수 → 성능 → 발열 | 서버 상태 `perf` = (캡 − 유휴)/(최대 − 유휴)의 0.4제곱. GPU 클럭이 `perf` 위로 못 올라가고, 서버 전력이 캡 위로 못 올라가요 |
| 랙 단위로 배분 | `distributeCap(limitW, servers, mode)`: 부르는 쪽이 한도에서 랙 오버헤드(스위치·팬, 약 350 W)를 뺀 값을 넘기면 그 몫을 `균등`(남는 몫은 모자란 서버에게) 또는 `부하 비례`로 나눠요 |
| 랙 전력 한도 | 랙의 `powerLimitW`. GPU 랙은 서버 명판 합의 80 %가 기본이에요 |
| 측정 | 랙 상태 `overS`(초과 시간), `overCount`(횟수), `lossS`(캡으로 잃은 서버·초), `hotAt`(처음 뜨거워진 시각), `stopAt`(처음 꺼진 시각) |
| 공조 저하 흉내 | 서버 속성 `fanSpeedPct`(20~100)를 낮추면 CPU 온도가 오르는 **실험 설정**이에요. 실제 공조 고장(`cooling_unit_failure`)과 별개로 팀의 검증 조건을 재현해요 |

### 검증한 시나리오 둘

| 시나리오 | 설정 | 결과(훈련 랩 GPU 랙, 서버 5대, 한도 40.8 kW) |
|---|---|---|
| `power-cap-rack-limit` 랙이 할당 전력을 넘어요 | 서버 모두 CPU 폭주 | 캡 없음: 50.6 kW로 계속 초과. `균등`·`부하 비례`: 40.8 kW로 내려오고 성능은 0.90, 잃은 양 800 서버·초, 서버는 모두 켜 있어요 (서버 부하가 같아 두 방식의 결과가 같아요. 부하가 다르면 `distributeCap` 시험에서 갈라져요) |
| `power-cap-cooling-short` 공조가 모자라요 | 서버룸의 냉방기 모두 정지 | 캡 없음: 처음 뜨거워진 시각 890초, 1110초에 정지 시작, 끝에 0/5 켜짐. 캡 3000 W: 뜨거워짐이 470초 늦고 5/5가 한 시간을 버텨요(잃은 양 1500 서버·초). 캡 2000 W: 610초 늦고 5/5, 성능 0.69~0.87(잃은 양 4800 서버·초) |

캡이 세질수록 시간은 벌지만 성능을 잃는다. 이 맞바꿈을 채점이 본다. 두 시나리오는 필요한 조치로 `power_cap`을, 금지된 조치로 `power_off`를 둔다.

## 시나리오 넷

`utility-feed-loss`(수전 줄 옮기기) · `cdu-pump-fail`(예비 펌프 올리기) · `power-cap-rack-limit` · `power-cap-cooling-short`. 자체 변전소·포드·전력 한도가 있는 GPU 랙이 없는 세계에서는 이유를 말하고 꺼진다.

## 솔직한 한계

- 팀의 검증은 **제한된 서버 수와 워크로드**였고, 공조 부족은 실제 공조 대신 팬 속도로 흉내 냈다. 테라리움의 시나리오도 서버 다섯 대, 한 시간이다.
- 캡은 이상적인 상한이다. 실제 BMC 캡의 반응 지연과 오버슈트, GPU 캡(`nvidia-smi -pl`)과 CPU 캡(RAPL)의 차이, 캡이 서비스 지연에 미치는 영향은 `perf` 하나로 줄였다.
- 수전·변압기는 두 줄·두 대의 단순 모델이다. 보호 계전, 역률, 고조파는 없다.
- BBU는 랙 부하 전체를 받치는 것으로 계산한다(OCP의 부분 보호 구성은 없다).
- 포드의 CDU만 예비 펌프가 수동이다. 그 이유는 시나리오(펌프 고장 뒤 운영자의 개입)를 만들기 위함이며, 실제 CDU는 대개 자동 절체한다.
- `cdu-pump-fail` 시나리오는 CDU 하나가 멈춰도 다른 CDU가 받아 눈에 띄는 영향이 없어서, 같은 루프의 모든 CDU에서 펌프가 멈추는 것으로 만들었다.
