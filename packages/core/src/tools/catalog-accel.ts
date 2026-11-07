/**
 * The tools of the accelerator layer and of the power and cooling ladders (REQ-107, ADR-0130): look at GPUs the way nvidia-smi
 * does, reset one, look at the fabric, the jobs and the pools, resume a job, drain a node, resize a pool; look at the power chain
 * (UPS, generator, rack batteries, substation) and the cooling chain (CRAH, CDU, rear doors, tanks), cap a server's power, move
 * the substation to the other feed, start a CDU's standby pump. They live in a file of their own and are added to the catalog at
 * its end. The GPU server tools belong to the server team; the jobs and pools to the service/OS team; power and cooling to
 * facilities (domains.ts). What a real team uses every day is `common`; the rest is `rare`.
 */
import type { JsonSchema, ToolSpec } from "./catalog";
import type { ToolDoc } from "./docs";

type AccelSpec = Omit<ToolSpec, "realism" | "description" | "area">;

const obj = (properties: JsonSchema["properties"], required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
});
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });

export const ACCEL_SPECS: readonly AccelSpec[] = [
  {
    name: "gpu_status",
    title: "GPU 상태(nvidia-smi)",
    category: "observe",
    mutating: false,
    inputSchema: obj({ server: str("Server id; leave out to see every GPU server") }),
  },
  {
    name: "gpu_reset",
    title: "GPU 리셋",
    category: "act",
    mutating: true,
    inputSchema: obj(
      {
        server: str("GPU server id"),
        gpu: str("GPU number on that server (0, 1, ...) or the GPU entity id"),
      },
      ["server", "gpu"],
    ),
  },
  {
    name: "ib_status",
    title: "패브릭 상태(ibstat)",
    category: "observe",
    mutating: false,
    inputSchema: obj({
      server: str("Only the link of this server; leave out for the whole fabric"),
    }),
  },
  {
    name: "job_status",
    title: "학습 잡·스케줄러 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({ job: str("Job id; leave out to see the scheduler and every job") }),
  },
  {
    name: "job_resume",
    title: "학습 잡 이어가기",
    category: "act",
    mutating: true,
    inputSchema: obj({ job: str("Training job id (paused or failed)") }, ["job"]),
  },
  {
    name: "node_drain",
    title: "노드를 스케줄에서 빼기",
    category: "act",
    mutating: true,
    inputSchema: obj(
      {
        node: str("GPU server id"),
        on: bool("true takes it out of scheduling (default), false puts it back"),
      },
      ["node"],
    ),
  },
  {
    name: "pool_scale",
    title: "추론 풀 복제본 수",
    category: "act",
    mutating: true,
    inputSchema: obj(
      {
        pool: str("Inference pool id; leave out when there is one"),
        replicas: num("Replicas to run"),
      },
      ["replicas"],
    ),
  },
  {
    name: "power_status",
    title: "전원 계통 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({
      id: str(
        "Only this UPS, generator, substation or rack battery; leave out for the whole chain",
      ),
    }),
  },
  {
    name: "bbu_status",
    title: "랙 배터리(BBU) 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({ rack: str("Only the battery pack of this rack; leave out for all") }),
  },
  {
    name: "substation_status",
    title: "자체 변전소 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({ substation: str("Substation id; leave out when there is one") }),
  },
  {
    name: "transfer_feed",
    title: "변전소 수전 줄 옮기기",
    category: "act",
    mutating: true,
    inputSchema: obj(
      {
        substation: str("Substation id; leave out when there is one"),
        feed: num("Utility feed to draw from: 1 or 2"),
      },
      ["feed"],
    ),
  },
  {
    name: "set_power_cap",
    title: "서버 전력 캡",
    category: "act",
    mutating: true,
    inputSchema: obj(
      {
        server: str("Server id"),
        watts: num("Power limit in watts; leave out to take the cap off"),
      },
      ["server"],
    ),
  },
  {
    name: "power_cap_status",
    title: "전력 캡 현황",
    category: "observe",
    mutating: false,
    inputSchema: obj({
      rack: str("Only the servers of this rack; leave out for racks that have a power limit"),
    }),
  },
  {
    name: "cooling_status",
    title: "냉방 계통 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({
      id: str("Only this CRAH, CDU, rear door or tank; leave out for the whole chain"),
    }),
  },
  {
    name: "cdu_status",
    title: "CDU 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({ cdu: str("Only this CDU; leave out for all") }),
  },
  {
    name: "cdu_pump_switch",
    title: "CDU 예비 펌프 돌리기",
    category: "act",
    mutating: true,
    inputSchema: obj({ cdu: str("CDU id") }, ["cdu"]),
  },
];

const d = (doc: ToolDoc): ToolDoc => doc;

export const ACCEL_DOCS: Readonly<Record<string, ToolDoc>> = {
  gpu_status: d({
    area: "server",
    realism: "common",
    summary:
      "The GPUs of a server (or of every GPU server) the way `nvidia-smi` shows them: temperature, power, utilisation, memory used, Xid error count, clocks and whether they are slowed (throttled).",
    use: "an alarm names a GPU, a job or a pool is slow or failed, or you want to know which GPU is the bad one.",
    notUse:
      "you want the server's own fans, CPU and power supplies (use redfish_request) or the fabric (use ib_status).",
    example: '{"server":"srv-gpu1"}',
    cost: "low",
    costWhy: "one read of the GPUs",
    details:
      "A GPU above 83 °C slows its clocks; the slowest GPU of a training node sets the speed of the whole job.",
  }),
  gpu_reset: d({
    area: "act",
    realism: "common",
    summary:
      "Reset one GPU (`nvidia-smi --gpu-reset`). A GPU that fell off the bus (Xid) or ran out of memory comes back. The processes on the node die: a training job on it fails.",
    use: "gpu_status shows a GPU with a Xid error or full memory and you can afford to lose what runs on that node.",
    notUse:
      "the GPU is healthy (it kills the job on that node for nothing) or it only runs hot (reset does not cool it).",
    example: '{"server":"srv-gpu1","gpu":"3"}',
    cost: "medium",
    costWhy: "kills the processes of the node",
  }),
  ib_status: d({
    area: "network",
    realism: "common",
    summary:
      "The InfiniBand/RoCE fabric the way `ibstat` shows it: each node's link state, how many times it went down and up, and the fabric as a whole.",
    use: "a training job is slow or times out, or an alarm names a fabric link.",
    notUse: "you want the Ethernet switches of the front-end network (use network_cli).",
    example: '{"server":"srv-gpu2"}',
    cost: "low",
    costWhy: "one read of the links",
  }),
  job_status: d({
    area: "observe",
    realism: "common",
    summary:
      "The job scheduler (up or down, queue, drained nodes) and each training job: phase, step, last checkpoint, steps lost to failures, restarts, and why it is not running.",
    use: "a training job is late, failed or stuck, or an alarm names the scheduler.",
    notUse: "you want the GPUs under it (use gpu_status).",
    example: '{"job":"job-train-1"}',
    cost: "low",
    costWhy: "one read of the scheduler",
    details:
      "A failed job is started again from its last checkpoint by the scheduler after about five minutes, if the scheduler is up and a good node is left.",
  }),
  job_resume: d({
    area: "act",
    realism: "common",
    summary:
      "Continue a paused or failed training job from its last checkpoint now, without waiting for the scheduler's own restart.",
    use: "job_status shows a job paused on a checkpoint write, or failed and waiting for its restart while the cause is already fixed.",
    notUse:
      "the job is running, the scheduler is down (restart it first), or the bad node is still in the job (drain it first).",
    example: '{"job":"job-train-1"}',
    cost: "low",
    costWhy: "one job restarts",
  }),
  node_drain: d({
    area: "act",
    realism: "common",
    summary:
      "Take a GPU node out of scheduling (`scontrol update state=drain`) or put it back. New jobs do not land on a drained node; a job that fails there moves to a spare node.",
    use: "a node has a flapping fabric link, a broken NVLink or a bad GPU and you want jobs off it.",
    notUse: "the node is healthy, or it is the only node left for a job.",
    example: '{"node":"srv-gpu2"}',
    cost: "low",
    costWhy: "one node moves",
  }),
  pool_scale: d({
    area: "act",
    realism: "common",
    summary:
      "Ask an inference pool to run this many replicas (`kubectl scale`). Resizing also repartitions the GPUs, which ends a wrong MIG split.",
    use: "job_status/gpu_status show the pool short of replicas or too slow for its traffic.",
    notUse: "the replicas are missing because their GPUs are broken (reset the GPU).",
    example: '{"replicas":4}',
    cost: "low",
    costWhy: "one pool resizes",
  }),
  power_status: d({
    area: "power",
    realism: "common",
    summary:
      "The power chain: UPS (input, battery, load), generators (phase, fuel), the substation (feeds, transformers) and the rack batteries, with what each carries.",
    use: "an alarm names a UPS, a feed or a battery, or servers lose power.",
    notUse: "you want a single PDU or breaker (use facility_status).",
    example: '{"id":"ups-a1"}',
    cost: "low",
    costWhy: "one read of the chain",
  }),
  bbu_status: d({
    area: "power",
    realism: "rare",
    summary:
      "The battery pack of each rack (BBU): charge, how many minutes it carries the rack, whether it is on battery, failed cells; and the 48 V bus voltage of the rack.",
    use: "a rack lost power while others did not, or an alarm names a battery or a bus.",
    notUse: "the world has no rack batteries (power ladder below 'rack battery').",
    example: '{"rack":"rack-a1"}',
    cost: "low",
    costWhy: "one read of the packs",
  }),
  substation_status: d({
    area: "power",
    realism: "rare",
    summary:
      "The own substation: the two utility feeds (which carries voltage, which one the transformers draw from), the two transformers (temperature, in service) and the load.",
    use: "the whole building is on one feed, lost power, or an alarm names the substation.",
    notUse: "the world has no own substation.",
    example: '{"substation":"sub-1"}',
    cost: "low",
    costWhy: "one read of the substation",
  }),
  transfer_feed: d({
    area: "act",
    realism: "rare",
    summary:
      "Move the substation to the other utility feed. Only a feed that carries voltage can be chosen; the automatic transfer does this by itself after ten seconds unless it is stuck.",
    use: "substation_status shows the active feed lost and the other one alive.",
    notUse: "both feeds are lost (nothing to move to) or the automatic transfer already did it.",
    example: '{"feed":2}',
    cost: "medium",
    costWhy: "a break in power while it moves, if load is high",
  }),
  set_power_cap: d({
    area: "server",
    realism: "rare",
    summary:
      "Cap one server's power draw in watts (Redfish PowerLimit). Power can not go below the server's idle draw. A lower cap lowers the clocks, so throughput and heat both fall. Leave `watts` out to take the cap off.",
    use: "a rack must stay under its power limit, a bus sags, or cooling is short and servers run hot: cap the servers that matter least, in a way the rack as a whole stays under its limit.",
    notUse:
      "the server is idle (a cap above its draw changes nothing) or a latency-critical service runs on it with no spare.",
    example: '{"server":"srv-a1","watts":900}',
    cost: "low",
    costWhy: "one server",
    details:
      "Throughput left is (power above idle that is kept)^0.4: the first watts cut cost little speed, the last ones a lot. Equal caps and caps in proportion to load are the two usual ways to share a rack limit.",
  }),
  power_cap_status: d({
    area: "server",
    realism: "rare",
    summary:
      "Per server: power, cap, idle and maximum draw, CPU temperature, throughput left (perf), and per rack with a power limit: the limit, power now, seconds over it and work lost to caps.",
    use: "before and after capping, to see what the caps cost and whether the rack is within its limit.",
    notUse: "you want the fans or the CPU of one server (use redfish_request).",
    example: '{"rack":"rack-a1"}',
    cost: "low",
    costWhy: "one read of the racks",
  }),
  cooling_status: d({
    area: "cooling",
    realism: "common",
    summary:
      "The cooling chain: CRAH units (supply and return air, load), CDUs (supply, pumps, flow), rear doors (valve, water temperatures), immersion tanks (fluid temperature, pump, level) and the plant.",
    use: "rack inlet or GPU temperatures rise, or an alarm names a cooling part.",
    notUse: "you want to change a setpoint (use set_cooling_setpoint).",
    example: '{"id":"crah-1"}',
    cost: "low",
    costWhy: "one read of the chain",
  }),
  cdu_status: d({
    area: "cooling",
    realism: "common",
    summary:
      "Each CDU: running, supply and return coolant temperature, load against capacity, pumps (duty and standby, which are ok), whether the standby is started by hand, and the leak sensor.",
    use: "a liquid-cooled rack heats up, or an alarm names a CDU or a leak.",
    notUse: "the world has no liquid cooling.",
    example: '{"cdu":"cdu-1"}',
    cost: "low",
    costWhy: "one read of the CDUs",
  }),
  cdu_pump_switch: d({
    area: "act",
    realism: "rare",
    summary:
      "Start the standby pump of a CDU by hand. A CDU with manual standby does not take over a failed pump by itself; the flow comes back once the standby runs.",
    use: "cdu_status shows a pump failed and the duty flow short, with the standby not started.",
    notUse: "no pump failed, or the standby already runs.",
    example: '{"cdu":"cdu-1"}',
    cost: "low",
    costWhy: "one CDU pump runs",
  }),
};
