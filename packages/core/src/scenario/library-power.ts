/**
 * Sheets of the power and cooling ladders (REQ-107, ADR-0130): four incidents the new choices make possible.
 *
 *   utility-feed-loss      수전 한 줄이 끊겼는데 자동 전환이 안 돼요          → 다른 수전 줄로 옮겨요 (transfer_feed)
 *   cdu-pump-fail          CDU 펌프가 멈췄는데 예비 펌프가 안 붙어요          → 예비 펌프를 돌려요 (cdu_pump_switch)
 *   power-cap-rack-limit   랙이 전력 한도를 넘어요                         → 서버별 캡으로 한도 안에 배분해요 (set_power_cap)
 *   power-cap-cooling-short 공조가 모자라 서버가 뜨거워져요                  → 캡으로 온도 상승을 늦추고 버텨요 (set_power_cap)
 *
 * The last two are the power capping pair (docs/design-docs/power-cooling-ladders.md): keep the rack inside
 * the power it is allotted with the least loss of work, and hold the servers up when the cooling falls short.
 */
import type { BlueprintIndex, Domain, Entity } from "@terrarium/core/world";
import { Accel } from "@terrarium/core/world";
import type { ScenarioTemplate } from "./library-kit";
import { atMost, type Case, dependents, is, layerTemplate, type Plan } from "./library-layer";
import type { Condition } from "./model";

const FACILITY: readonly Domain[] = ["facility", "server", "service_os"];
const HOUR = 3600;
const FORBID = [{ action: "power_off", penalty: 20 }] as const;

const NEED = {
  substation: "자체 변전소가 이 세계에 없어요 (전원 칩 '자체 변전소'가 필요해요)",
  cdu: "GPU를 식히는 CDU가 이 세계에 없어요 (가속기 칩 'GPU 액냉 포드'가 필요해요)",
  rack: "전력 한도가 있는 GPU 랙이 이 세계에 없어요 (가속기 칩 'GPU 서버' 이상이 필요해요)",
  cooling: "공조 장치가 이 세계에 없어요",
};

const neq = (entity: string, field: string, value: string): Condition => ({
  kind: "state",
  entity,
  field,
  op: "!=",
  value,
});

function feedCase(index: BlueprintIndex): Case | string {
  const sub = [...index.ofKind("substation")].sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!sub) return NEED.substation;
  return {
    target: sub,
    roots: [sub.id],
    services: [],
    where: sub.name,
    finals: [neq(sub.id, "status", "down")],
  };
}

function cduCase(index: BlueprintIndex): Case | string {
  for (const job of Accel.jobsOf(index)) {
    const racks = Accel.jobDef(job)
      .nodes.map((n) => index.find(n)?.parentId)
      .filter((id): id is string => id !== undefined);
    const cdus = [
      ...new Set(
        racks
          .flatMap((r) => index.outgoing(r, "cooling").map((l) => index.find(l.to)))
          .filter((e): e is Entity => e?.kind === "cdu")
          .map((e) => e.id),
      ),
    ].sort();
    const [first, ...rest] = cdus;
    if (first)
      return {
        target: index.entity(first),
        roots: cdus,
        services: dependents(index, job.id),
        where: `${index.entity(first).name}를 비롯한 CDU ${cdus.length}대`,
        // the pumps of every CDU on the loop stopped (one CDU alone is carried by the other and shows nothing)
        more: rest.map((id) => ({ fault: "cdu_pump_failure" as const, target: id })),
      };
  }
  return NEED.cdu;
}

/** The rack with a power limit and the most servers. */
function limitRack(index: BlueprintIndex) {
  const racks = index
    .ofKind("rack")
    .filter((r) => typeof r.props.powerLimitW === "number")
    .map((rack) => ({ rack, servers: index.childrenOf(rack.id, "server") }))
    .filter((r) => r.servers.length >= 2)
    .sort((a, b) => b.servers.length - a.servers.length || a.rack.id.localeCompare(b.rack.id));
  return racks[0];
}

function limitCase(index: BlueprintIndex): Case | string {
  const at = limitRack(index);
  if (!at) return NEED.rack;
  const limit = at.rack.props.powerLimitW as number;
  return {
    target: at.servers[0] as Entity,
    roots: [at.rack.id, ...at.servers.map((s) => s.id)],
    services: [],
    where: `${at.rack.name}`,
    more: at.servers.slice(1).map((s) => ({ fault: "cpu_runaway" as const, target: s.id })),
    finals: [
      atMost(at.rack.id, "powerW", limit),
      // the work lost to caps over the hour stays under a tenth of what the servers could do
      atMost(at.rack.id, "lossS", 0.1 * at.servers.length * HOUR),
      ...at.servers.map((s) => is(s.id, "adminOn", true)),
    ],
  };
}

function shortCase(index: BlueprintIndex): Case | string {
  const at = limitRack(index);
  const units = index.ofKind("cooling_unit");
  if (!at) return NEED.rack;
  const [first, ...rest] = [...units].sort((a, b) => a.id.localeCompare(b.id));
  if (!first) return NEED.cooling;
  return {
    target: first,
    roots: [first.id, ...rest.map((u) => u.id)],
    services: [],
    where: `${at.rack.name}가 선 서버룸`,
    more: rest.map((u) => ({ fault: "cooling_unit_failure" as const, target: u.id })),
    // alive at the end, and held there by a cap (a room that is not cooled stops its servers without one)
    finals: [
      ...at.servers.map((s) => is(s.id, "adminOn", true)),
      ...at.servers.map((s) => atMost(s.id, "perf", 0.99)),
    ],
  };
}

const plan = (
  p: Partial<Plan> & Pick<Plan, "id" | "name" | "summary" | "fault" | "find" | "report">,
): ScenarioTemplate =>
  layerTemplate({
    difficulty: "보통",
    waitS: 30,
    forbid: FORBID,
    timeLimitS: HOUR,
    budget: 40,
    own: FACILITY,
    cause: "facility",
    recovery: false,
    ...p,
  });

const feed = plan({
  id: "utility-feed-loss",
  name: "수전 한 줄이 끊겼는데 자동 전환이 안 돼요",
  summary:
    "자체 변전소로 들어오는 두 수전 줄 가운데 쓰던 줄이 끊겼어요. 이 변전소는 자동 전환이 꺼져 있어 손으로 다른 줄로 옮겨야 해요. 그동안 ATS가 발전기를 돌려 서비스는 버티지만 연료가 타고 있어요. 다른 줄로 옮기면 변전소가 돌아와요.",
  fault: "utility_feed_loss",
  faultParams: { feed: 1, manual: 1 },
  find: feedCase,
  report: () => "발전기가 돌기 시작했다는 알림이 왔다. 서비스는 아직 멀쩡하다.",
  own: ["facility"],
  wanted: [{ action: "feed_transfer", weight: 20 }],
});

const pump = plan({
  id: "cdu-pump-fail",
  name: "CDU 펌프가 멈췄는데 예비 펌프가 안 붙어요",
  summary:
    "GPU를 식히는 CDU들의 펌프 둘씩이 멈췄고 이 포드의 CDU는 예비 펌프를 운영자가 직접 올려야 해요. 냉각수가 모자라 물이 데워지고 GPU 클럭이 깎여 학습이 느려져요. 예비 펌프를 CDU마다 돌리면 용량이 돌아와요.",
  fault: "cdu_pump_failure",
  faultParams: { pumps: 2 },
  find: cduCase,
  report: (c) =>
    `${c.services[0]?.name ?? "학습"}이 느려졌다는 알림이 왔다. 냉각수 온도가 오르고 있다.`,
  waitS: 1500,
  recovery: true,
  wanted: [{ action: "pump_switch", weight: 20 }],
});

const limit = plan({
  id: "power-cap-rack-limit",
  name: "랙이 할당 전력을 넘어요",
  summary:
    "GPU 랙에 할당된 전력은 서버 명판 합의 80%인데 학습이 그보다 더 끌어 써요. 랙 한도를 계속 넘는 동안 차단기 여유가 줄어요. 서버별 부하와 전력을 보고 서버마다 캡을 걸어 한도 안으로 들어오되 성능은 되도록 덜 잃어야 해요. 균등 배분과 부하 비례 배분이 기준 에이전트예요.",
  fault: "cpu_runaway",
  faultParams: { util: 1 },
  find: limitCase,
  report: (c) =>
    `${c.where}의 전력이 할당 한도를 넘는다는 알림이 왔다. 서버를 끄지 않고 한도 안으로 맞춰야 한다.`,
  cause: "service_os",
  wanted: [{ action: "power_cap", weight: 25 }],
});

const short = plan({
  id: "power-cap-cooling-short",
  name: "공조가 모자라 서버가 뜨거워져요",
  summary:
    "서버룸의 공조 장치가 모두 멈춰 서버가 뜨거워져요. 그대로 두면 몇 분 안에 서버가 과열로 꺼져요. 서버별 온도를 보고 캡을 걸어 발열을 줄이면 온도 상승이 늦어지고 서버를 더 오래, 어쩌면 끝까지 켜 둘 수 있어요. 공조는 설비 팀이 살려요.",
  fault: "cooling_unit_failure",
  find: shortCase,
  report: (c) => `${c.where}의 온도가 오르고 있다는 알림이 왔다. 공조 복구에는 시간이 걸린다.`,
  wanted: [{ action: "power_cap", weight: 25 }],
});

export const POWER_TEMPLATES: readonly ScenarioTemplate[] = [feed, pump, limit, short];
