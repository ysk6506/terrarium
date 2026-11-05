/**
 * Built-in scenarios about configuration (REQ-068): not a part that breaks but a change somebody made, on
 * purpose or by mistake. Each one picks its target from the network the world's cables design, makes the
 * change with a configuration block, and hands the agent only the symptom. Fixing it is the same command
 * that broke it, typed the other way, so the scoring can tell a fix (a configuration change on the right
 * switch, the alarm gone) from a guess (a power-off, a change somewhere else).
 */
import type { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError } from "@terrarium/core/kernel";
import {
  type BlueprintIndex,
  type HostPlan,
  type MistakeType,
  type NetPlan,
  planOf,
} from "@terrarium/core/world";
import { agent, doc, Flow, powered, type ScenarioTemplate, SUBMIT } from "./library-kit";
import type { ActionKind, Condition, ParamValue, ScenarioDoc } from "./model";
import { builtinCatalog, routeValue } from "./net-blocks";

/** The change a template makes, the symptom the agent hears, and what putting it right looks like. */
interface Mistake {
  readonly blocks: ReadonlyArray<{ type: string; params: Record<string, ParamValue> }>;
  readonly prompt: string;
  readonly description: string;
  readonly mistake: MistakeType;
  /** Entities (or cables) a diagnosis may name as the cause. */
  readonly roots: readonly string[];
  readonly fixes: ReadonlyArray<{ action: ActionKind; target: string }>;
  readonly cleared: Condition;
  readonly clearedLabel: string;
}

interface Context {
  readonly index: BlueprintIndex;
  readonly plan: NetPlan;
  readonly catalog: Catalog;
}

type Finder = (ctx: Context) => Mistake | string;

const byId = <T extends { id: string }>(a: T, b: T): number => a.id.localeCompare(b.id);
const alarmGone = (code: string, entity?: string): Condition => ({
  kind: "alarm",
  active: false,
  code,
  ...(entity ? { entity } : {}),
});

/** The servers a monitoring ping from the top of the network reaches, each on one cable to its switch. */
function monitoredServers({ index, plan }: Context): HostPlan[] {
  return [...plan.hosts.values()]
    .filter(
      (h) =>
        h.rail === undefined &&
        h.ports.length > 0 &&
        index.find(h.id)?.kind === "server" &&
        (plan.tops.get(h.leaf)?.length ?? 0) > 0,
    )
    .sort(byId);
}

const cablesBetween = (index: BlueprintIndex, a: string, b: string): string[] =>
  index
    .allLinks()
    .filter(
      (l) => l.kind === "network" && ((l.from === a && l.to === b) || (l.from === b && l.to === a)),
    )
    .map((l) => l.id);

const NO_SERVER = "이 세계에는 위쪽 스위치에 이어진 서버가 없어요 (설정 실수로 끊길 서버가 없어요)";

function wrongVlan(ctx: Context): Mistake | string {
  const host = monitoredServers(ctx)[0];
  if (!host) return NO_SERVER;
  const { switchId: leaf, port } = host.ports[0] as HostPlan["ports"][number];
  const used = ctx.plan.switches.get(leaf)?.design.vlans;
  let vlan = 999;
  while (used?.has(vlan)) vlan--;
  const name = ctx.index.entity(leaf).name;
  return {
    blocks: [{ type: "port_vlan", params: { target: leaf, peer: host.id, vlan } }],
    prompt: `${host.name}에 연결이 안 된다는 알람이 올라왔다. 모니터링에서 이 서버로 ping이 가지 않는다. ${SUBMIT}`,
    description: `${name}의 ${port}번 포트(${host.name})가 VLAN ${vlan}에 들어가 있어요.`,
    mistake: "port_vlan_mismatch",
    roots: [leaf],
    fixes: [{ action: "config_change", target: leaf }],
    cleared: alarmGone("host_unreachable", host.id),
    clearedLabel: `${host.name}에 다시 연결돼요`,
  };
}

function portShut(ctx: Context): Mistake | string {
  const host = monitoredServers(ctx)[0];
  if (!host) return NO_SERVER;
  const leaf = (host.ports[0] as HostPlan["ports"][number]).switchId;
  const name = ctx.index.entity(leaf).name;
  return {
    blocks: [{ type: "port_admin", params: { target: leaf, peer: host.id, down: true } }],
    prompt: `${host.name}의 네트워크 링크가 끊겼다는 알람이 올라왔다. 케이블 작업 이력은 없다. ${SUBMIT}`,
    description: `${name}에서 ${host.name}으로 가는 포트를 shutdown 했어요.`,
    mistake: "port_shutdown",
    roots: [leaf, ...cablesBetween(ctx.index, leaf, host.id)],
    fixes: [{ action: "port_enable", target: leaf }],
    cleared: alarmGone("link_down", host.id),
    clearedLabel: `${host.name}의 링크가 다시 올라와요`,
  };
}

/** The switches that answer for a rack's VLAN: the gateway pair of a legacy domain, or the leaf itself in a routed one. */
function sviHolders({ plan, index }: Context) {
  for (const domain of plan.domains) {
    for (const leaf of domain.leaves) {
      const host = [...plan.hosts.values()].find(
        (h) => h.leaf === leaf && h.rail === undefined && index.find(h.id)?.kind === "server",
      );
      if (!host) continue;
      const holders = (domain.fabric === "legacy" ? domain.gateways : [leaf]).filter((id) =>
        plan.switches.get(id)?.design.svis.has(host.vlan),
      );
      if (holders.length > 0) return { holders, vlan: host.vlan, leaf };
    }
  }
  return undefined;
}

function sviShut(ctx: Context): Mistake | string {
  const found = sviHolders(ctx);
  if (!found) return "이 세계에는 서버들의 게이트웨이 역할을 하는 VLAN 인터페이스가 없어요";
  const { holders, vlan, leaf } = found;
  const where = holders.map((id) => ctx.index.entity(id).name).join("·");
  return {
    blocks: holders.map((target) => ({
      type: "svi_admin",
      params: { target, vlan: String(vlan), down: true },
    })),
    prompt: `${ctx.index.entity(leaf).name} 쪽 서버 여러 대가 한꺼번에 통신 불가라는 알람이 올라왔다. 서버 자체는 켜져 있다. ${SUBMIT}`,
    description: `${where}의 VLAN ${vlan} 인터페이스를 shutdown 했어요.`,
    mistake: "svi_shutdown",
    roots: holders,
    fixes: holders.map((target) => ({ action: "config_change" as const, target })),
    cleared: alarmGone("host_unreachable"),
    clearedLabel: "통신 불가 알람이 모두 사라져요",
  };
}

function bgpShut(ctx: Context): Mistake | string {
  for (const [id, bgp] of [...ctx.plan.bgp].sort(([a], [b]) => a.localeCompare(b))) {
    const neighbor = bgp.neighbors[0];
    if (ctx.plan.switches.get(id)?.tier !== "leaf" || !neighbor) continue;
    const name = ctx.index.entity(id).name;
    return {
      blocks: [{ type: "bgp_admin", params: { target: id, peer: neighbor.peer, down: true } }],
      prompt: `네트워크 장비에 경고 알람이 올라왔다. 서버들은 아직 모두 응답하고 있다. ${SUBMIT}`,
      description: `${name}가 ${neighbor.peer}와 맺은 BGP 세션(${neighbor.ip})을 shutdown 했어요.`,
      mistake: "bgp_neighbor_shutdown",
      roots: [id],
      fixes: [{ action: "config_change", target: id }],
      cleared: alarmGone("bgp_session_down", id),
      clearedLabel: `${name}의 BGP 세션이 다시 서요`,
    };
  }
  return "이 세계에는 BGP를 쓰는 클라우드·GPU 패브릭이 없어요";
}

function routeDeleted({ plan, index }: Context): Mistake | string {
  for (const sw of [...plan.switches.values()].sort(byId)) {
    const statics = sw.design.routes.filter((r) => r.proto !== "bgp" && r.len > 0);
    const first = statics[0];
    if (sw.tier !== "router" || !first) continue;
    const same = statics.filter((r) => r.net === first.net && r.len === first.len);
    const name = index.entity(sw.id).name;
    return {
      blocks: same.map((r) => ({
        type: "route_del",
        params: { target: sw.id, route: routeValue(r) },
      })),
      prompt: `여러 랙의 서버가 한꺼번에 통신 불가라는 알람이 올라왔다. 서버 자체는 켜져 있다. ${SUBMIT}`,
      description: `${name}에서 ${first.net}/${first.len} 정적 경로를 지웠어요.`,
      mistake: "route_missing",
      roots: [sw.id],
      fixes: [{ action: "config_change", target: sw.id }],
      cleared: alarmGone("host_unreachable"),
      clearedLabel: "통신 불가 알람이 모두 사라져요",
    };
  }
  return "이 세계에는 서버 쪽으로 가는 정적 경로를 가진 라우터(코어)가 없어요";
}

function railShut({ plan, index }: Context): Mistake | string {
  const rails = [...plan.hosts.values()].filter((h) => h.rail !== undefined).sort(byId);
  const first = rails[0];
  if (!first)
    return "이 세계에는 GPU 서버의 레일(서버마다 여러 NIC를 여러 스위치에 꽂은 망)이 없어요";
  const mine = rails.filter((h) => h.id === first.id);
  const nic = mine.find((h) => h.rail === 3) ?? (mine.at(-1) as HostPlan);
  const name = index.entity(first.id).name;
  return {
    blocks: [{ type: "port_admin", params: { target: nic.leaf, peer: nic.id, down: true } }],
    prompt: `${name}의 GPU 학습 처리량이 떨어졌다는 신고가 있다. 서버는 켜져 있고 응답한다. ${SUBMIT}`,
    description: `${index.entity(nic.leaf).name}에서 ${name}의 레일 ${nic.rail}번 포트를 shutdown 했어요.`,
    mistake: "port_shutdown",
    roots: [nic.leaf, ...cablesBetween(index, nic.leaf, nic.id)],
    fixes: [{ action: "port_enable", target: nic.leaf }],
    cleared: alarmGone("gpu_rail_degraded", nic.id),
    clearedLabel: `${name}의 레일이 모두 돌아와요`,
  };
}

function outletOff({ index, catalog }: Context): Mistake | string {
  let fallback: Mistake | undefined;
  for (const pdu of [...index.ofKind("pdu")].sort(byId)) {
    if (catalog.getOf(pdu.modelId ?? "", "pdu").shelf) continue;
    for (const [i, link] of index.incoming(pdu.id, "power").entries()) {
      const server = index.find(link.from);
      if (server?.kind !== "server") continue;
      const found: Mistake = {
        blocks: [
          { type: "outlet_set", params: { target: pdu.id, outlet: String(i + 1), on: false } },
        ],
        prompt: `${server.name}이 갑자기 꺼졌다는 알람이 올라왔다. ${SUBMIT}`,
        description: `${pdu.name}의 ${i + 1}번 콘센트(${server.name})를 껐어요.`,
        mistake: "outlet_off",
        roots: [pdu.id],
        fixes: [{ action: "outlet_on", target: pdu.id }],
        cleared: powered(server.id),
        clearedLabel: `${server.name}에 전원이 돌아와요`,
      };
      if (index.outgoing(server.id, "power").length === 1) return found;
      fallback ??= found;
    }
  }
  return fallback ?? "이 세계에는 PDU 콘센트에 꽂힌 서버가 없어요";
}

function flowOf(m: Mistake): Flow {
  const flow = new Flow();
  let last = flow.add("start", "start", {});
  m.blocks.forEach((block, i) => {
    last = flow.add(`change${i + 1}`, block.type, block.params, last);
  });
  last = flow.add("wait", "wait", { seconds: 120 }, last);
  flow.add("agent", "agent_task", agent(m.prompt, 30, 1800), last);
  return flow;
}

function mistakeDoc(template: ScenarioTemplate, worldId: string, m: Mistake): ScenarioDoc {
  return doc(template, worldId, m.description, flowOf(m), [
    {
      id: "diagnosis",
      kind: "diagnosis",
      rootCause: m.roots,
      faultType: [m.mistake],
      weight: 45,
    },
    {
      id: "fixed",
      kind: "final_state",
      label: m.clearedLabel,
      condition: m.cleared,
      weight: 25,
    },
    ...m.fixes.map((fix, i) => ({
      id: `fix-${i + 1}`,
      kind: "required_action" as const,
      action: fix.action,
      target: fix.target,
      weight: 10 / m.fixes.length,
    })),
    {
      id: "no-poweroff",
      kind: "forbidden_action",
      label: "원인과 무관한 장비 전원 끄기",
      action: "power_off",
      penalty: 10,
    },
    { id: "time", kind: "time_limit", seconds: 1200, weight: 10 },
    { id: "budget", kind: "tool_budget", maxCalls: 30, weight: 10 },
  ]);
}

interface Meta {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly difficulty: ScenarioTemplate["difficulty"];
  readonly mistake: MistakeType;
}

function networkTemplate(meta: Meta, find: Finder): ScenarioTemplate {
  const resolve = (index: BlueprintIndex, catalog?: Catalog): Mistake | string => {
    const models = catalog ?? builtinCatalog();
    try {
      return find({ index, plan: planOf(index, models), catalog: models });
    } catch {
      return "이 세계의 장비 모델을 카탈로그에서 찾을 수 없어요";
    }
  };
  return {
    id: meta.id,
    name: meta.name,
    summary: meta.summary,
    difficulty: meta.difficulty,
    faultTypes: [],
    mistakeTypes: [meta.mistake],
    unavailable(index, catalog) {
      const found = resolve(index, catalog);
      return typeof found === "string" ? found : undefined;
    },
    build(index, worldId, catalog) {
      const found = resolve(index, catalog);
      if (typeof found === "string") throw new InvalidValueError(found);
      return mistakeDoc(this, worldId, found);
    },
  };
}

export const NETWORK_TEMPLATES: readonly ScenarioTemplate[] = [
  networkTemplate(
    {
      id: "wrong-vlan-port",
      name: "서버 포트가 엉뚱한 VLAN에 있어요",
      summary: "작업 중 서버가 꽂힌 스위치 포트의 VLAN이 바뀌어 그 서버만 연결이 끊겨요.",
      difficulty: "보통",
      mistake: "port_vlan_mismatch",
    },
    wrongVlan,
  ),
  networkTemplate(
    {
      id: "port-shut-by-mistake",
      name: "서버 포트를 실수로 껐어요",
      summary: "점검하던 사람이 서버로 가는 스위치 포트를 shutdown 해 링크가 내려가요.",
      difficulty: "쉬움",
      mistake: "port_shutdown",
    },
    portShut,
  ),
  networkTemplate(
    {
      id: "gateway-interface-shut",
      name: "게이트웨이 VLAN 인터페이스가 꺼졌어요",
      summary: "한 랙 서버들의 게이트웨이인 VLAN 인터페이스가 꺼져 그 랙이 통째로 밖과 끊겨요.",
      difficulty: "어려움",
      mistake: "svi_shutdown",
    },
    sviShut,
  ),
  networkTemplate(
    {
      id: "static-route-removed",
      name: "코어의 정적 경로가 지워졌어요",
      summary: "코어 라우터에서 랙들로 가는 정적 경로가 지워져 여러 랙의 서버가 한꺼번에 끊겨요.",
      difficulty: "어려움",
      mistake: "route_missing",
    },
    routeDeleted,
  ),
  networkTemplate(
    {
      id: "bgp-neighbor-shut",
      name: "BGP 이웃 하나가 꺼졌어요",
      summary: "leaf가 스파인과의 BGP 세션 하나를 꺼서, 서버는 멀쩡하지만 길 하나가 사라져요.",
      difficulty: "보통",
      mistake: "bgp_neighbor_shutdown",
    },
    bgpShut,
  ),
  networkTemplate(
    {
      id: "gpu-rail-port-shut",
      name: "GPU 서버의 레일 하나가 끊겼어요",
      summary:
        "GPU 서버 한 대의 NIC 하나로 가는 leaf 포트가 꺼져 서버는 살아 있는데 학습이 느려져요.",
      difficulty: "어려움",
      mistake: "port_shutdown",
    },
    railShut,
  ),
  networkTemplate(
    {
      id: "pdu-outlet-off",
      name: "PDU 콘센트가 꺼졌어요",
      summary: "작업자가 PDU 콘센트 하나를 꺼서 거기 꽂힌 서버의 전원이 나가요.",
      difficulty: "쉬움",
      mistake: "outlet_off",
    },
    outletOff,
  ),
];
