/**
 * The faults of the accelerator layer and of the power and cooling ladders (REQ-107, ADR-0130): eight on GPUs, the fabric, the
 * scheduler and the pools; five on batteries, buses, the substation and the UPS; two on rear doors and immersion tanks. Physics
 * moves the state along with them (physics/accel.ts, physics/facility-ext.ts), the services feel it (accel-health.ts), and the
 * tables in docs/design-docs/gpu-layer.md and power-cooling-ladders.md say how each one ends. The cooling ladder also uses the
 * faults that were there before it: `cdu_pump_failure` (the CDU pump), `coolant_leak`, `immersion_circulation_failure` (the tank pump).
 */
import type { FaultParamSpec, FaultSpec } from "./faults";

const p = (
  name: string,
  label: string,
  min: number,
  max: number,
  def: number,
  unit: string,
): FaultParamSpec => ({ name, label, min, max, default: def, unit });

export const ACCEL_FAULT_SPECS: readonly FaultSpec[] = [
  {
    type: "gpu_xid_error",
    label: "GPU Xid 오류",
    description:
      "GPU 한 장이 Xid 오류(예: 79, 'GPU가 버스에서 떨어졌어요')를 내고 떨어져 나가요. 그 GPU를 쓰던 학습 잡은 실패하고, 서빙 풀은 복제본 하나를 잃어요. GPU를 리셋하면 돌아오고, 같은 GPU가 되풀이하면 서버를 교체해야 해요",
    targets: ["gpu"],
    params: [p("code", "Xid 코드", 31, 95, 79, "")],
    status: "supported",
    domain: "server",
  },
  {
    type: "nvlink_down",
    label: "NVLink 끊김",
    description:
      "서버 안 NVLink 도메인이 끊겨 GPU끼리 빠르게 못 주고받아요. 학습 잡은 그 노드에서 느려지다 실패하고, 서빙은 GPU 한 장짜리 모델만 돌아요. 노드를 빼고 다시 올려야 해요",
    targets: ["nvlink_domain"],
    params: [],
    status: "supported",
    domain: "server",
  },
  {
    type: "ib_link_flap",
    label: "패브릭 링크 플래핑",
    description:
      "InfiniBand/RoCE 링크 하나가 끊겼다 붙기를 되풀이해요. 집단 통신이 멈칫하며 학습 스텝이 느려지고, 심하면 잡이 타임아웃으로 실패해요. 그 노드를 스케줄에서 빼면 나머지가 이어가요",
    targets: ["ib_link"],
    params: [p("periodS", "한 번 오르내리는 주기", 20, 600, 90, "초")],
    status: "supported",
    domain: "network",
  },
  {
    type: "gpu_thermal_throttle",
    label: "GPU 열 스로틀",
    description:
      "GPU 한 장의 냉각이 모자라 온도가 올라 클럭이 낮아져요. 서버 흡기가 높아도 같은 일이 일어나요. 그 GPU가 낀 학습은 모두 느려지고(가장 느린 GPU가 속도를 정해요) 서빙은 지연이 늘어요",
    targets: ["gpu"],
    params: [p("deltaC", "더해지는 온도", 5, 40, 20, "°C")],
    status: "supported",
    domain: "server",
  },
  {
    type: "gpu_memory_leak_inference",
    label: "추론 서버 GPU 메모리 누수",
    description:
      "추론 프로세스가 GPU 메모리를 조금씩 먹다 가득 차면 OOM으로 죽어요. 죽기 전까지는 지연이 늘어요. GPU를 리셋하거나 프로세스를 다시 띄우면 돌아와요",
    targets: ["gpu"],
    params: [p("giBPerMin", "분당 늘어나는 메모리", 0.5, 20, 4, "GiB")],
    status: "supported",
    domain: "os",
  },
  {
    type: "job_stuck_checkpoint",
    label: "체크포인트 쓰기에서 멈춤",
    description:
      "체크포인트 저장소가 느려져 학습 잡이 쓰기를 기다리며 멈춰요. 잡은 살아 있지만 스텝이 안 나가요. 기다리다 지치면 마지막 체크포인트가 깨질 수도 있어요. 잡을 이어가게(resume) 하면 돌아와요",
    targets: ["training_job"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "scheduler_down",
    label: "잡 스케줄러 다운",
    description:
      "잡 스케줄러(Slurm·Kubernetes 학습 오퍼레이터)가 멈춰요. 도는 잡은 그대로 가지만, 실패한 잡을 다시 올리지도 새 잡을 올리지도 못해요. 스케줄러를 다시 시작하면 돌아와요",
    targets: ["job_scheduler"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "mig_misconfig",
    label: "MIG 분할 잘못 설정",
    description:
      "GPU를 나누는 MIG 설정이 모델 크기와 안 맞아 큰 모델이 올라가지 못해요. 복제본이 뜨지 못해 풀 용량이 줄어요. 풀 크기를 바꾸고 설정을 되돌려야 해요",
    targets: ["inference_pool"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "bbu_cell_fault",
    label: "랙 배터리(BBU) 셀 고장",
    description:
      "랙 배터리의 셀이 고장 나 버틸 수 있는 시간이 줄어요. 피드가 끊기면 그 랙은 배터리가 모자라 서버가 먼저 꺼져요",
    targets: ["bbu"],
    params: [p("cells", "고장 셀 수", 1, 4, 1, "개")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "dc_bus_sag",
    label: "48V DC 버스 전압 강하",
    description:
      "48V DC 버스 전압이 떨어져 서버 전원부가 불안해요. 크게 떨어지면 그 랙의 서버가 꺼져요. 부하를 줄이면(파워 캐핑) 전압이 올라와요",
    targets: ["dc_bus"],
    params: [p("sagV", "떨어지는 전압", 1, 12, 5, "V")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "utility_feed_loss",
    label: "수전 한 줄 끊김",
    description:
      "자체 변전소에 들어오는 수전 두 줄 중 하나가 끊겨요. 자동 전환이 되면 잠깐 흔들리고 지나가요. 자동 전환이 안 되면 다른 줄로 직접 옮겨야 해요",
    targets: ["substation"],
    params: [
      p("feed", "끊기는 줄(1 또는 2)", 1, 2, 1, ""),
      p("manual", "자동 전환이 안 먹어요(1)", 0, 1, 0, ""),
    ],
    status: "supported",
    domain: "facility",
  },
  {
    type: "transformer_overtemp",
    label: "변압기 과열",
    description:
      "변압기 하나가 과열돼요. 그대로 두면 보호 장치가 내려요. 남은 하나가 전부 받아야 해서 부하가 크면 위험해요",
    targets: ["substation"],
    params: [p("transformer", "과열 변압기(1 또는 2)", 1, 2, 1, "")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "ups_module_fail",
    label: "UPS 모듈 고장",
    description:
      "병렬로 묶인 UPS 한 대가 모듈 고장으로 전력을 못 내요. N+1이면 나머지가 받고, 단일이면 그쪽 계통이 배터리 없이 멈춰요",
    targets: ["ups"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "rdhx_valve_stuck",
    label: "리어도어 밸브 고착",
    description:
      "리어도어 열교환기의 물 밸브가 일부만 열린 채 굳어요. 랙 배기열이 덜 빠져 방으로 돌아와요. 밸브를 수리할 때까지 부하를 줄여야 해요",
    targets: ["rdhx"],
    params: [p("openPct", "열린 정도", 0, 90, 20, "%")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "fluid_level_low",
    label: "액침 유체 수위 낮음",
    description:
      "액침 탱크의 유체가 새거나 증발해 수위가 낮아져요. 서버가 덜 잠기고 순환이 약해져 유체 온도가 올라요",
    targets: ["immersion_tank"],
    params: [p("levelPct", "남은 수위", 20, 90, 60, "%")],
    status: "supported",
    domain: "facility",
  },
];
