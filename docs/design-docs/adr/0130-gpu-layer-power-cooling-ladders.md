---
title: ADR-0130 GPU 가속기 층을 사다리에 올리고, 전원·냉방 사다리를 끝까지 실선으로 늘리며, 파워 캐핑을 모델로 옮긴다
kind: decision
status: active
last_verified: 2026-11-07
enforced_by:
  - tests/spec/gpu-layer.test.ts
  - tests/spec/power-cooling-ladders.test.ts
  - tests/spec/power-capping.test.ts
  - tests/spec/layer-scenarios.test.ts
  - tests/spec/physics-golden.test.ts
  - tests/spec/gpu-worldgen.test.ts
  - tests/spec/gpu-topology.test.ts
  - apps/web/src/logic/world-shape/gpu-cards.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - harness/config/test-lock.json
amends_tests:
  - "apps/web/src/logic/world-shape/world-shape.test.ts::HA 사다리: 선택지와 카드 [REQ-094] > 층은 여덟이고, 카드는 코어의 선택지와 같은 순서로 하나씩 있다"
  - apps/web/src/logic/world-shape/world-shape.test.ts::알아서와 프리셋 [REQ-094] > 고른 층은 그대로 두고 나머지는 알아서 고르며 한 줄로 이유를 말한다
  - apps/web/src/logic/world-shape/world-shape.test.ts::알아서와 프리셋 [REQ-094] > 도메인을 안 고른 사람은 여덟 층 모두 알아서다
  - apps/web/src/logic/world-shape/world-shape.test.ts::알아서와 프리셋 [REQ-094] > 싸게·보통·멈추지 않게는 여덟 층을 모두 채우고 실제 선택지만 가리킨다
  - packages/core/src/topology/fold.test.ts::what is the same is folded, what differs stands alone [REQ-078] > a healthy campus is a handful of group tiles however many racks it has
  - "packages/core/src/world/workload.test.ts::일감과 사다리 [REQ-094] > 사다리: 여덟 층에 선택지가 마흔네 개이고 층마다 아이디가 겹치지 않는다"
  - "packages/core/src/world/workload.test.ts::일감과 사다리 [REQ-094] > 사다리: 여덟 층에 선택지가 마흔여섯 개이고 층마다 아이디가 겹치지 않는다"
  - "apps/web/src/logic/world-shape/world-shape.test.ts::HA 사다리: 선택지와 카드 [REQ-094] > 점선은 하나도 없다: 마흔여섯 칸이 모두 실선이다 [REQ-106]"
  - tests/spec/topology-scale.test.ts::the board of the whole of Hwaseong is small, complete and quick [REQ-078] > a healthy world is a few tiles in every layer, and the first board comes within 3 seconds
  - apps/web/src/logic/tool-picker.test.ts::the tool cards [REQ-080] > a search narrows the cards to the tools that answer it, by name, title, card or tag
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
  - packages/core/src/scenario/scenario.test.ts::scenario blocks [REQ-034] > every condition field exists in the simulated state with the declared type
  - packages/core/src/scenario/scenario.test.ts::scenario palette [REQ-034] > in the sample hall every supported fault can be used, each as its own block
  - "packages/core/src/world/campus.test.ts::campus: land, buildings on it, plants and yards [REQ-043] > the campus sample uses every kind of thing and has no problems at all"
  - packages/core/src/world/world-edges.test.ts::lookups and labels at the edges [REQ-001] > only the four virtual kinds are virtual
  - tests/spec/calibration.test.ts::=WORLDS
  - tests/spec/controllability.test.ts::the list of what can be controlled is made of real things [REQ-069] > every world command is either on the list or named as no operator's
  - tests/spec/controllability.test.ts::=DRIVES
  - tests/spec/physics-golden.test.ts::=worlds
  - tests/spec/service-tools.test.ts::every tool is described in the standard order and tagged with how real it is [REQ-080] [REQ-086] > a summary, when to use and not, an example, access and cost; realism on all of them
test_change_reason: 가속기 층(REQ-107)은 사다리에 아홉 번째 층과 칩 열 개(가속기 다섯, 전원 셋, 냉방 둘)를 더하고 세계에 개체 열두 종류, 고장 열다섯, 툴 열여섯, 시나리오 열한 개를 더한다. 잠긴 시험 가운데 층의 수(여덟에서 아홉)와 칩의 수(마흔넷에서 쉰넷), "알아서"가 채우는 층의 수, 툴의 수(66에서 82), 제어 가능 요소 목록, 도구 찾기·행동 이름·개체 종류·가상 종류·고장 팔레트의 목록(새 종류와 고장은 캠퍼스 샘플에 없고 모양 잡은 세계에만 있다), 위상 보드가 모든 층에서 비어 있지 않다는 확인(가속기 층은 GPU가 없는 캠퍼스에서 비어 있다)을 목록이 늘어난 만큼 고쳤다. 변별력 점검의 세계 목록, 제어 가능 요소 시험의 Drive, 물리 골든의 세계 목록은 새 세계를 더하는 방향으로만 늘렸고 기존 값(골든 해시 포함)은 하나도 바꾸지 않았다. 새 고장 가운데 기존 세계에도 대상이 있는 것(UPS 모듈 고장)은 기존 세계의 골든에 새 키 둘을 더했을 뿐이다.
decision_hash: 7c15cae475dc747b
---
# ADR-0130 GPU 가속기 층을 사다리에 올리고, 전원·냉방 사다리를 끝까지 실선으로 늘리며, 파워 캐핑을 모델로 옮긴다

## 맥락
제품 책임자 피드백(2026-11-07): "특히 GPU는 없잖아 지금? 네트워크는 AI 패브릭 있으면서. 그리고 전원, 냉방 선택지도 더 늘리고. 점선인 거 없이 현실세계와 모순되지 않게 전부 설계해서 구현해줘."
사다리(ADR-0107)에는 GPU 층이 없었다. 네트워크 사다리에 `net-ai-fabric`이 있는데 그 위에 올릴 것이 없었다. 전원은 2N·발전기까지, 냉방은 DLC까지였고, 랙 하나가 40~100 kW인 GPU 포드를 받칠 칩이 없었다. 파워 캐핑은 ADR-0096에 결정만 있고 구현이 없었다.

## 결정
1. **가속기 층**을 컴퓨트와 스토리지 사이에 아홉 번째 층으로 넣는다. 칩 다섯: `gpu-none` · `gpu-per-server` · `gpu-serving-pool` · `gpu-training-cluster` · `gpu-liquid-pod`. 모두 실선이다. IAP 템플릿과 서비스 카드 대부분은 `gpu-none`이고, 내장 카드 "AI 추론 서빙"은 추론 풀, "학습 파이프라인"은 학습 클러스터를 기본으로 단다.
2. **선행 조건**: 학습 클러스터 이상은 네트워크가 `net-leaf-spine` 이상이어야 하고, 액냉 포드는 냉방이 `cool-liquid` 이상, 전원이 `pwr-ab` 이상이어야 한다. 학습 클러스터를 `cool-n`과 짝지으면 "쓸모없는 조합"이라고 알린다. `net-ai-fabric`을 고르면 패브릭이 InfiniBand 대신 RoCE로 지어진다.
3. **새 개체 일곱**(`gpu`, `nvlink_domain`, `ib_fabric`, `ib_link`, `job_scheduler`, `training_job`, `inference_pool`)과 **고장 여덟**(`gpu_xid_error`, `nvlink_down`, `ib_link_flap`, `gpu_thermal_throttle`, `gpu_memory_leak_inference`, `job_stuck_checkpoint`, `scheduler_down`, `mig_misconfig`). 시스템이 스스로 하는 일(원인 `cluster`): 스케줄러의 노드 drain, 풀의 나쁜 복제본 제거, 체크포인트부터의 잡 재시작. 툴 일곱(`gpu_status`, `gpu_reset`, `ib_status`, `job_status`, `job_resume`, `node_drain`, `pool_scale`)과 셸 명령 넷(`nvidia-smi`, `nvidia-smi -q -d TEMPERATURE,POWER`, `ibstat`, `dcgmi diag -r 1`).
4. **전원 사다리**를 단일 피드 → A+B → N+1 UPS → 2N+발전기 → 2N+자동 전환+연료 48시간 → 랙 배터리(BBU)·48V DC → 자체 변전소로 늘린다. 새 개체 `bbu`, `dc_bus`, `substation`, 새 고장 `bbu_cell_fault`, `dc_bus_sag`, `utility_feed_loss`, `transformer_overtemp`, `ups_module_fail`, 툴 `power_status`·`bbu_status`·`substation_status`·`transfer_feed`.
5. **냉방 사다리**를 N → N+1 → 2N+컨테인먼트 → 리어도어 열교환 → DLC → 침지로 늘린다. 새 개체 `rdhx`, `immersion_tank`(CDU는 이미 있었다), 새 고장 `rdhx_valve_stuck`, `fluid_level_low`, 툴 `cooling_status`·`cdu_status`·`cdu_pump_switch`. 기존 고장(`cdu_pump_failure`, `coolant_leak`, `immersion_circulation_failure`)은 그대로 쓴다. 누설은 센서가 감지하면 랙 전원을 끄는 정책(`leakPolicy`)을 가진다. 침지는 어떤 컴퓨트와도 짓되 비용을 알린다.
6. **파워 캐핑은 모델만** 한다. `set_power_cap(server, watts)` → 서버 `perf` → GPU 클럭·전력·발열. 랙 단위 배분 도우미 `distributeCap`(균등·부하 비례), 랙의 `powerLimitW`와 측정(`overS`·`overCount`·`lossS`·`hotAt`·`stopAt`), 시나리오 둘(랙 전력 한도 안에서 배분 · 냉방 부족 때 캡으로 버티기). 팬 속도로 공조 저하를 흉내 내는 것을 실험 설정(`fanSpeedPct`)으로 둔다. 실제 BMC·RAPL·NVML을 건드리는 일, 전기요금 모델, 세 번째 시나리오는 ADR-0096에 남긴다. **ADR-0096은 이 ADR로 일부 구현됐다.**
7. **시험 쪽**: 변별력 점검(아무것도 안 함·찍기 ≤ 10, 정답만 앎과 30점 이상 차이)을 새 시나리오 열한 개 모두 통과시킨다. 물리 골든에는 세계 셋(GPU 학습 랩, 전원 사다리 랩, 냉방 사다리 랩)을 더한다. 기존 값은 바꾸지 않는다.
8. **화면**: 사다리 화면에 가속기 층(`LAYER_INFO`)과 칩 카드(그림 · 문단 · 잃어도 되는 것 · 고장 목록 셋 이하), "이 모양이면"에 GPU 수와 kW, 세계 입구의 숫자에 GPU·CDU·kW와 UPS 구성, 위상 보드에 "가속기" 층(GPU → 노드 → 패브릭 → 잡·풀)을 더한다.

## 이유
- 사다리가 현실의 선택지를 따라가지 못하면 "이 모양이면"이 거짓말이 된다. 칩이 있는 만큼 고장도 있어야 한다.
- GPU 층의 고장은 서비스 건강에 닿아야 에이전트가 풀 이유가 생긴다. 그래서 학습 서비스는 잡·스케줄러·패브릭에, 추론 서비스는 풀에 기댄다.
- 파워 캐핑을 따로 개체로 만들지 않고 서버의 `perf` 하나로 둔 것은, 모델이 근거를 가진 범위(작은 서버 수와 워크로드)를 넘어 정밀한 척하지 않기 위해서다.
- 포드의 CDU만 예비 펌프를 사람이 올리게 한 것은 펌프 고장 뒤 운영자 개입이라는 시나리오를 만들기 위한 선택이고, 한계에 적는다.

## 대안과 버린 이유
- GPU를 컴퓨트 층의 칩으로 두기: 컴퓨트는 서비스가 무엇 위에서 도는가이고 GPU는 그 위에 얹는 선택이라 선행 조건과 고장이 층마다 달라진다. 층을 따로 둔다.
- 칩을 점선으로 먼저 두기: 제품 책임자 요청에 어긋나고, 사다리가 점선 다섯 개로 줄어든 흐름(ADR-0121)과도 어긋난다.
- 캡을 랙 단위 개체로 두기: 서버별 `set_power_cap`이 실제 장비의 모양(결정은 랙 단위, 캡은 서버별)과 같다. 랙 단위는 배분 도우미가 맡는다.

## 결과
REQ-107. [가속기 층](../gpu-layer.md), [전원·냉방 사다리](../power-cooling-ladders.md).
