/**
 * The overlay and the cloud-native network move with time and with the faults on them (REQ-097, ADR-0107 item 6): a
 * standby controller takes over once it has seen the active one gone for the detection time (30 s), an EVPN session
 * comes back 90 s after what broke it is gone (the BGP timers), a leaf that loses one of its spine links moves its
 * tunnels to the other (ECMP), a restarted ingress controller is up after 20 s. Each of these is a world event with
 * the cause `cluster`, so scoring can tell a recovery the system made from one the agent made.
 *
 * Each step: controllers first (who is active), then VTEPs (the session, the configuration), then segments (which
 * VTEPs are cut off from the rest), then the functions, plug-ins and doors. Services read the result in the same
 * step (services.ts).
 */
import {
  deadUplinks,
  type Entity,
  EVPN_REESTABLISH_S,
  hostVerdict,
  liveCables,
  reachableFrom,
  SDN_REVISION,
  sdnControllerDef,
  sdnControllers,
  serviceDef,
  switchAlive,
  switchOfVtep,
  vtepsOfSegment,
  type World,
  type WorldEvent,
} from "@terrarium/core/world";
import { CLUSTER_CAUSE } from "./db";

/** A probe service with the default conditions, to ask how a host is doing without a particular service in mind. */
const PROBE = serviceDef({ id: "probe", kind: "service", name: "probe", props: {} });

/** The system fixing itself is told in the log with the cause `cluster`, so scoring can tell it from the agent's work. */
function healed(world: World, events: WorldEvent[], text: string): void {
  events.push(world.apply({ type: "note", text }, CLUSTER_CAUSE));
}

/** What takes a whole host away, as opposed to a trouble of its operating system that only some services feel. */
const GONE: ReadonlySet<string> = new Set([
  "power",
  "off",
  "reboot",
  "network",
  "os_down",
  "hardware",
]);

const hostDead = (world: World, id: string | undefined): boolean => {
  if (id === undefined) return false;
  const v = hostVerdict(world, id, PROBE);
  return v.state === "dead" && GONE.has(v.cause ?? "");
};

const hostOf = (world: World, id: string): string | undefined =>
  world.index.outgoing(id, "hosted_on")[0]?.to;

// ── controllers ────────────────────────────────────────────────────────────────────────────

function refreshController(world: World, id: string): void {
  const s = world.stateAs(id, "sdn_controller");
  const failed = world.faultsOn(id).some((f) => f.type === "sdn_controller_down");
  s.status = failed || hostDead(world, hostOf(world, id)) ? "down" : "ok";
  if (s.status === "down") s.why = failed ? "컨트롤러 프로세스가 죽었어요" : "올라간 곳이 멈췄어요";
  else delete s.why;
}

/** The standby that is up, if any. */
function readyStandby(world: World, list: readonly Entity[]): Entity | undefined {
  return list.find((c) => {
    const x = world.stateAs(c.id, "sdn_controller");
    return x.role === "standby" && x.status === "ok";
  });
}

/** The standby takes over once it has seen the active controller gone for the detection time. */
function takeoverStep(world: World, list: readonly Entity[], events: WorldEvent[]): void {
  const active = list.find((c) => world.stateAs(c.id, "sdn_controller").role === "active");
  const s = active ? world.stateAs(active.id, "sdn_controller") : undefined;
  if (!s) return;
  if (s.status === "ok") {
    delete s.downSince;
    return;
  }
  s.downSince ??= world.time();
  const next = readyStandby(world, list);
  if (!next || world.time() - s.downSince < sdnControllerDef(next).detectS) return;
  events.push(world.apply({ type: "sdn.failover", target: next.id }, CLUSTER_CAUSE));
  healed(world, events, `${next.name}가 액티브 컨트롤러를 이어받아 설정을 다시 밀었어요`);
}

function updateControllers(world: World, events: WorldEvent[]): void {
  const list = sdnControllers(world.index);
  for (const c of list) refreshController(world, c.id);
  takeoverStep(world, list, events);
  for (const c of list) {
    const x = world.stateAs(c.id, "sdn_controller");
    x.managed = x.role === "active" ? world.index.outgoing(c.id, "controls").length : 0;
  }
}

// ── VTEPs ──────────────────────────────────────────────────────────────────────────────────

/** Whether a flapping session is in its down half now. */
function flapDown(world: World, vtepId: string): boolean | undefined {
  const f = world.faultsOn(vtepId).find((x) => x.type === "evpn_session_flap");
  if (!f) return undefined;
  const period = f.params.periodS ?? 120;
  return (world.time() - f.since) % period >= period / 2;
}

function sessionStep(world: World, id: string, wanted: boolean, events: WorldEvent[]): void {
  const s = world.stateAs(id, "vtep");
  const name = world.index.entity(id).name;
  const flap = flapDown(world, id);
  if (flap !== undefined) {
    const up = wanted && !flap;
    if (s.evpn === "established" && !up) s.flaps += 1;
    s.evpn = up ? "established" : "down";
    delete s.evpnUpAt;
    return;
  }
  if (!wanted) {
    s.evpn = "down";
    delete s.evpnUpAt;
    delete s.byOperator;
    return;
  }
  if (s.evpn === "established") return;
  s.evpnUpAt ??= world.time() + EVPN_REESTABLISH_S;
  if (world.time() < s.evpnUpAt) return;
  s.evpn = "established";
  delete s.evpnUpAt;
  if (!s.byOperator) healed(world, events, `${name}: EVPN 세션이 다시 맺어졌어요`);
  delete s.byOperator;
}

/** A leaf that loses one of several spine links moves its tunnels to the others (ECMP); the system says so. */
function ecmpStep(world: World, id: string, events: WorldEvent[]): void {
  const s = world.stateAs(id, "vtep");
  const sw = switchOfVtep(world.index, id);
  if (!sw) return;
  const live = liveCables(world, sw);
  const before = s.uplinks;
  s.uplinks = live;
  if (before > 1 && live >= 1 && live < before)
    healed(
      world,
      events,
      `${world.index.entity(sw).name}: 스파인 ${before}개 중 ${live}개로 ECMP 경로를 다시 계산했어요`,
    );
}

function updateVtep(world: World, id: string, events: WorldEvent[]): void {
  const s = world.stateAs(id, "vtep");
  const sw = switchOfVtep(world.index, id);
  const alive = sw !== undefined && switchAlive(world, sw);
  ecmpStep(world, id, events);
  // a switch with no uplink in the design (a lone leaf) has nobody to lose; one with uplinks needs a live one
  const linked =
    sw !== undefined && (liveCables(world, sw) > 0 || deadUplinks(world, sw).length === 0);
  sessionStep(world, id, alive && linked, events);
  const stale = world.faultsOn(id).some((f) => f.type === "sdn_sync_failed");
  const ctl = sdnControllers(world.index)[0];
  const head = ctl ? world.stateAs(ctl.id, "sdn_controller").revision : SDN_REVISION;
  s.revision = stale ? head - 1 : head;
}

// ── segments ───────────────────────────────────────────────────────────────────────────────

const swName = (world: World, id: string): string => {
  const sw = switchOfVtep(world.index, id);
  return sw ? world.index.entity(sw).name : id;
};

/** What is wrong with the VTEP itself (not with the way to the others), or undefined. */
function ownProblem(world: World, id: string): string | undefined {
  const s = world.stateAs(id, "vtep");
  const sw = switchOfVtep(world.index, id);
  const name = swName(world, id);
  if (sw && !switchAlive(world, sw)) return `${name}에 전원이 없어요`;
  if (s.evpn === "down") return `${name}의 EVPN 세션이 내려가 있어요`;
  if (world.faultsOn(id).some((f) => f.type === "vxlan_tunnel_down"))
    return `${name}로 가는 VXLAN 터널이 끊겼어요(underlay 업링크가 막혔어요)`;
  if (s.revision < SDN_REVISION)
    return `${name}가 옛 설정(리비전 ${s.revision}, 컨트롤러는 ${SDN_REVISION})이라 세그먼트에 못 들어와요`;
  return undefined;
}

/**
 * Why a VTEP is cut off from its segment, or undefined: something wrong with itself, or an underlay that reaches none of the
 * other VTEPs of the segment that are fine themselves (a node with nobody left to talk to is alone, not cut).
 */
function cutOf(world: World, id: string, members: readonly string[]): string | undefined {
  const own = ownProblem(world, id);
  if (own) return own;
  const sw = switchOfVtep(world.index, id) as string;
  const peers = members.filter((m) => m !== id && ownProblem(world, m) === undefined);
  if (peers.length === 0) return undefined;
  const reach = reachableFrom(world, sw);
  const open = peers.some((m) => reach.has(switchOfVtep(world.index, m) as string));
  if (open) return undefined;
  return `${swName(world, id)}에서 ${swName(world, peers[0] as string)}로 가는 underlay 경로가 없어요`;
}

function updateSegment(world: World, id: string): void {
  const seg = world.stateAs(id, "overlay_segment");
  const members = vtepsOfSegment(world.index, id).map((v) => v.id);
  const cuts = new Map<string, string>();
  for (const m of members) {
    const why = cutOf(world, m, members);
    if (why) cuts.set(m, why);
  }
  for (const m of members) {
    const v = world.stateAs(m, "vtep");
    v.cut = cuts.has(m);
    if (v.cut) v.why = cuts.get(m);
    else delete v.why;
  }
  seg.cutVteps = members.filter((m) => cuts.has(m));
  delete seg.why;
  if (members.length === 0 || seg.cutVteps.length === 0) seg.status = "ok";
  else if (seg.cutVteps.length === members.length) {
    seg.status = "down";
    seg.why = "세그먼트의 모든 VTEP이 끊겨 흐름이 없어요";
  } else {
    seg.status = "degraded";
    seg.why = `VTEP ${members.length}개 중 ${seg.cutVteps.length}개가 끊겼어요`;
  }
}

// ── functions, plug-ins, doors ─────────────────────────────────────────────────────────────

function updateNfv(world: World, id: string): void {
  const s = world.stateAs(id, "nfv_function");
  const f = world.faultsOn(id).find((x) => x.type === "nfv_firewall_overload");
  const dead = hostDead(world, hostOf(world, id));
  s.loadPct = f ? (f.params.loadPct ?? 180) : 30;
  s.latencyMs = s.loadPct > 100 ? Math.round(1 + (s.loadPct - 100) * 0.9) : 1;
  delete s.why;
  if (dead) {
    s.status = "down";
    s.why = "올라간 VM이 멈췄어요";
  } else if (s.loadPct > 100) {
    s.status = "degraded";
    s.why = `부하 ${s.loadPct}%로 한계를 넘어 지연이 ${s.latencyMs}ms까지 늘었어요`;
  } else s.status = "ok";
}

function updateCni(world: World, id: string): void {
  const s = world.stateAs(id, "cni");
  const failed = world.faultsOn(id).some((f) => f.type === "cni_plugin_failure");
  s.status = failed ? "down" : "ok";
  if (failed) s.why = "CNI 플러그인이 죽어 이 노드의 파드가 통신하지 못해요";
  else delete s.why;
}

function updateIngress(world: World, id: string): void {
  const s = world.stateAs(id, "ingress");
  const failed = world.faultsOn(id).some((f) => f.type === "ingress_controller_down");
  delete s.why;
  if (failed || hostDead(world, hostOf(world, id))) {
    s.status = "down";
    s.why =
      "인그레스 컨트롤러가 죽어 밖에서 오는 요청이 닿지 않아요(클러스터 안의 호출은 그대로예요)";
  } else if (s.upAt !== undefined && world.time() < s.upAt) {
    s.status = "degraded";
    s.why = "인그레스 컨트롤러가 다시 뜨는 중이에요";
  } else {
    s.status = "ok";
    delete s.upAt;
  }
}

const sorted = (ids: readonly { id: string }[]): string[] => ids.map((e) => e.id).sort();

/** Step every controller, VTEP, segment, function, plug-in and ingress of the world. Events: takeovers, sessions back, ECMP. */
export function updateSdn(world: World): WorldEvent[] {
  const events: WorldEvent[] = [];
  const idx = world.index;
  if (
    idx.ofKind("sdn_controller").length === 0 &&
    idx.ofKind("vtep").length === 0 &&
    idx.ofKind("nfv_function").length === 0 &&
    idx.ofKind("cni").length === 0 &&
    idx.ofKind("ingress").length === 0
  )
    return events;
  updateControllers(world, events);
  for (const id of sorted(idx.ofKind("vtep"))) updateVtep(world, id, events);
  for (const id of sorted(idx.ofKind("overlay_segment"))) updateSegment(world, id);
  for (const id of sorted(idx.ofKind("nfv_function"))) updateNfv(world, id);
  for (const id of sorted(idx.ofKind("cni"))) updateCni(world, id);
  for (const id of sorted(idx.ofKind("ingress"))) updateIngress(world, id);
  return events;
}
