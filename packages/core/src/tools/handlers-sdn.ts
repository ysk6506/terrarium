/**
 * The handlers of the SDN overlay and cloud-native network tools (REQ-097): they read the state the physics keeps and give a
 * command to the world. The overlay trace is the one that walks something: it follows the tunnel between two VTEPs over the
 * underlay and says where the first break is, in the words of the entity it is on.
 */
import { ConflictError, InvalidValueError, round } from "@terrarium/core/kernel";
import {
  activeController,
  deadUplinks,
  type Entity,
  EVPN_REESTABLISH_S,
  hostedOn,
  leafOfServer,
  policiesOf,
  reachableFrom,
  SDN_REVISION,
  sdnControllerDef,
  sdnControllers,
  segmentsOfVtep,
  serverUnder,
  servicesLeaningOn,
  switchOfVtep,
  type UnderlayPath,
  underlayPath,
  vtepFor,
  vtepOfSwitch,
  vtepsOfSegment,
  type WorldPort,
} from "@terrarium/core/world";
import type { Args, ToolContext } from "./handlers";

type Handler = (ctx: ToolContext, args: Args) => unknown;

const opt = (args: Args, key: string): string | undefined =>
  args[key] === undefined || args[key] === "" ? undefined : String(args[key]);
const need = (args: Args, key: string): string => String(args[key] ?? "");

function controllerRow(world: WorldPort, e: Entity) {
  const s = world.stateAs(e.id, "sdn_controller");
  const host = hostedOn(world.index, e.id);
  return {
    id: e.id,
    name: e.name,
    role: s.role,
    status: s.status,
    ...(s.why ? { why: s.why } : {}),
    managedSwitches: s.managed,
    revision: s.revision,
    ...(host ? { host } : {}),
  };
}

function vtepRow(world: WorldPort, v: Entity) {
  const s = world.stateAs(v.id, "vtep");
  const sw = switchOfVtep(world.index, v.id);
  return {
    id: v.id,
    switch: sw,
    evpn: s.evpn,
    revision: s.revision,
    stale: s.revision < SDN_REVISION,
    cutOff: s.cut,
    ...(s.why ? { why: s.why } : {}),
    segments: segmentsOfVtep(world.index, v.id).map((x) => x.id),
  };
}

const sdnStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const all = sdnControllers(world.index);
  const only = opt(args, "controller");
  if (only && !all.some((c) => c.id === only))
    throw new InvalidValueError(`'${only}'는 SDN 컨트롤러가 아니에요`);
  const list = only ? all.filter((c) => c.id === only) : all;
  const active = all.find((c) => world.stateAs(c.id, "sdn_controller").role === "active");
  const act = active ? world.stateAs(active.id, "sdn_controller") : undefined;
  const standby = all.find((c) => {
    const s = world.stateAs(c.id, "sdn_controller");
    return s.role === "standby" && s.status === "ok";
  });
  const headless = activeController(world) === undefined;
  return {
    controllers: list.map((c) => controllerRow(world, c)),
    headless,
    ...(headless
      ? {
          headlessNote: "활성 컨트롤러가 없어요. 이미 깔린 흐름은 그대로 돌고 새 설정만 못 밀어요.",
        }
      : {}),
    ...(headless && act?.downSince !== undefined && standby
      ? {
          autoFailover: {
            takesOverInSeconds: Math.max(
              0,
              Math.round(sdnControllerDef(standby).detectS - (world.time() - act.downSince)),
            ),
          },
        }
      : {}),
    ...(only
      ? {}
      : {
          vteps: world.index.ofKind("vtep").map((v) => vtepRow(world, v)),
          segments: world.index.ofKind("overlay_segment").map((g) => {
            const s = world.stateAs(g.id, "overlay_segment");
            return {
              id: g.id,
              name: g.name,
              vni: g.props.vni,
              status: s.status,
              ...(s.why ? { why: s.why } : {}),
              services: servicesLeaningOn(world.index, g.id).map((x) => x.id),
            };
          }),
          functions: world.index.ofKind("nfv_function").map((n) => {
            const s = world.stateAs(n.id, "nfv_function");
            return {
              id: n.id,
              name: n.name,
              status: s.status,
              loadPct: s.loadPct,
              latencyMs: s.latencyMs,
            };
          }),
        }),
  };
};

const sdnSync: Handler = (ctx, args) => {
  const target = need(args, "switch");
  const vtep = vtepFor(ctx.world, target);
  ctx.world.apply({ type: "sdn.sync", target }, "tool:sdn_sync");
  const s = ctx.world.stateAs(vtep, "vtep");
  return {
    switch: switchOfVtep(ctx.world.index, vtep),
    vtep,
    revision: s.revision,
    evpn: s.evpn,
    note:
      s.evpn === "down"
        ? "설정을 다시 밀었어요. EVPN 세션이 10초쯤 뒤에 올라와요. evpn_sessions로 확인하세요."
        : "설정을 다시 밀었어요. sdn_status로 확인하세요.",
  };
};

const sdnFailover: Handler = (ctx, args) => {
  const { world } = ctx;
  const named = opt(args, "controller");
  const next = sdnControllers(world.index).find((c) => {
    const s = world.stateAs(c.id, "sdn_controller");
    return (named === undefined || c.id === named) && s.role === "standby" && s.status === "ok";
  });
  if (!next) throw new ConflictError("넘겨받을 수 있는 스탠바이 컨트롤러가 없어요");
  const from = sdnControllers(world.index).find(
    (c) => world.stateAs(c.id, "sdn_controller").role === "active",
  );
  world.apply({ type: "sdn.failover", target: next.id }, "tool:sdn_failover");
  return {
    from: from?.id ?? null,
    to: next.id,
    note: "새 액티브 컨트롤러가 모든 스위치에 설정을 다시 밀었어요. sdn_status로 확인하세요.",
  };
};

// ── overlay trace ──────────────────────────────────────────────────────────────────────────

/** The server a host, VM or service id stands for (a service: the first place it runs). */
function endpointServer(ctx: ToolContext, id: string): string {
  const e = ctx.world.index.entity(id);
  if (e.kind === "service") {
    const place = ctx.world.stateAs(id, "service").runsOn[0];
    const server = place ? serverUnder(ctx.world.index, place) : undefined;
    if (!server) throw new InvalidValueError(`'${id}'가 도는 서버를 찾지 못했어요`);
    return server;
  }
  const server = serverUnder(ctx.world.index, id);
  if (!server || ctx.world.index.find(server)?.kind !== "server")
    throw new InvalidValueError(`'${id}'는 서버도 VM도 서비스도 아니에요`);
  return server;
}

interface Broken {
  readonly at: string;
  readonly kind: string;
  readonly why: string;
}

/** The first thing that stops traffic leaving or entering through a VTEP, or undefined. */
function vtepBreak(ctx: ToolContext, vtepId: string): Broken | undefined {
  const { world } = ctx;
  const s = world.stateAs(vtepId, "vtep");
  const sw = switchOfVtep(world.index, vtepId) as string;
  const name = world.index.entity(sw).name;
  const tunnel = world.faultsOn(vtepId).find((f) => f.type === "vxlan_tunnel_down");
  if (tunnel) {
    const up = world.index.outgoing(sw, "network")[0];
    return {
      at: sw,
      kind: "switch_port",
      why: `${name}의 업링크 포트${up ? `(케이블 ${up.id})` : ""}가 막혀 VTEP의 loopback 경로가 사라졌어요 — 터널이 모두 내려가요. 스위치 포트는 네트워크 팀이 살려요`,
    };
  }
  if (s.evpn === "down")
    return { at: vtepId, kind: "evpn", why: `${name}의 EVPN 세션이 내려가 있어요` };
  if (s.revision < SDN_REVISION)
    return {
      at: vtepId,
      kind: "config",
      why: `${name}가 옛 설정(리비전 ${s.revision}, 컨트롤러 ${SDN_REVISION})이에요 — sdn_sync로 다시 밀어요`,
    };
  return undefined;
}

function underlayBreak(ctx: ToolContext, a: string, b: string): Broken | undefined {
  const { world } = ctx;
  if (reachableFrom(world, a).has(b)) return undefined;
  const dead = deadUplinks(world, a)[0] ?? deadUplinks(world, b)[0];
  const nameOf = (id: string) => world.index.find(id)?.name ?? id;
  return dead
    ? {
        at: dead.linkId,
        kind: "cable",
        why: `${nameOf(a)}와 ${nameOf(b)} 사이 underlay가 끊겼어요 — 케이블 ${dead.linkId}(포트 ${dead.port}, ${nameOf(dead.peer)} 쪽)가 내려가 있거나 반대편에 전원이 없어요`,
      }
    : {
        at: a,
        kind: "underlay",
        why: `${nameOf(a)}에서 ${nameOf(b)}로 가는 underlay 경로가 없어요`,
      };
}

/** The VTEPs at the two ends of a trace, with the leaves they stand on. */
function endsOf(ctx: ToolContext, src: string, dst: string) {
  const { world } = ctx;
  const [a, b] = [endpointServer(ctx, src), endpointServer(ctx, dst)];
  const [la, lb] = [leafOfServer(world.index, a), leafOfServer(world.index, b)];
  return {
    la,
    lb,
    va: la ? vtepOfSwitch(world.index, la) : undefined,
    vb: lb ? vtepOfSwitch(world.index, lb) : undefined,
  };
}

/** The answer for two ends that are not both on the overlay: the underlay path and nothing else. */
function underlayOnly(
  world: WorldPort,
  ids: { src: string; dst: string },
  path: UnderlayPath | undefined,
  same: boolean,
) {
  return {
    ...ids,
    overlay: false,
    reachable: path !== undefined || same,
    underlay: hopsOf(world, path),
    note: "두 끝 중 하나가 오버레이(VTEP)에 들어 있지 않아 underlay 경로만 보여요.",
  };
}

const hopsOf = (world: WorldPort, path: UnderlayPath | undefined) =>
  (path?.switches ?? []).map((id, i) => ({
    switch: id,
    name: world.index.find(id)?.name ?? id,
    ...(i > 0 && path ? { cable: path.links[i - 1] } : {}),
  }));

const overlayTrace: Handler = (ctx, args) => {
  const { world } = ctx;
  const ids = { src: need(args, "src"), dst: need(args, "dst") };
  const { la, lb, va, vb } = endsOf(ctx, ids.src, ids.dst);
  const path = la && lb ? underlayPath(world, la, lb) : undefined;
  if (!va || !vb || !la || !lb) return underlayOnly(world, ids, path, la === lb);
  const shared = segmentsOfVtep(world.index, va.id).find((g) =>
    vtepsOfSegment(world.index, g.id).some((v) => v.id === vb.id),
  );
  const broken = traceBreak(ctx, { va: va.id, vb: vb.id, la, lb });
  return {
    ...ids,
    overlay: true,
    segment: shared?.id ?? null,
    ...(shared
      ? { vni: shared.props.vni }
      : { note: "두 끝이 같은 세그먼트에 있지 않아요(오버레이로는 서로 안 보여요)." }),
    tunnel: { from: va.id, to: vb.id, sameLeaf: la === lb },
    underlay: hopsOf(world, path),
    reachable: broken === undefined && (la === lb || path !== undefined),
    ...(broken ? { brokenAt: broken } : {}),
  };
};

/** The first break between two VTEPs: one end's own trouble, then the underlay between their leaves. */
function traceBreak(
  ctx: ToolContext,
  ends: { va: string; vb: string; la: string; lb: string },
): Broken | undefined {
  return (
    vtepBreak(ctx, ends.va) ??
    vtepBreak(ctx, ends.vb) ??
    (ends.la === ends.lb ? undefined : underlayBreak(ctx, ends.la, ends.lb))
  );
}

// ── EVPN ───────────────────────────────────────────────────────────────────────────────────

const evpnSessions: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "vtep");
  const wanted = only ? vtepFor(world, only) : undefined;
  const now = world.time();
  const list = world.index.ofKind("vtep").filter((v) => !wanted || v.id === wanted);
  return {
    sessions: list.map((v) => {
      const s = world.stateAs(v.id, "vtep");
      const sw = switchOfVtep(world.index, v.id) as string;
      const flapping = world.faultsOn(v.id).some((f) => f.type === "evpn_session_flap");
      return {
        vtep: v.id,
        switch: sw,
        state: s.evpn,
        revision: s.revision,
        uplinks: s.uplinks,
        flaps: s.flaps,
        flapping,
        ...(s.evpnUpAt !== undefined
          ? { reestablishInSeconds: Math.max(0, Math.round(s.evpnUpAt - now)) }
          : {}),
        ...(s.evpn === "down" && s.evpnUpAt === undefined && !flapping
          ? { why: "스파인으로 가는 길이 없거나 스위치에 전원이 없어요" }
          : {}),
        holdTimerSeconds: EVPN_REESTABLISH_S,
      };
    }),
  };
};

// ── policies and ingress ───────────────────────────────────────────────────────────────────

const policyList: Handler = (ctx, args) => {
  const { world } = ctx;
  const ns = opt(args, "ns");
  return {
    policies: world.index
      .ofKind("network_policy")
      .filter((p) => !ns || p.props.ns === ns)
      .map((p) => {
        const s = world.stateAs(p.id, "network_policy");
        const guards = world.index.outgoing(p.id, "applies_to").map((l) => l.to);
        return {
          id: p.id,
          name: p.name,
          ns: p.props.ns ?? "default",
          guards,
          ...(typeof p.props.from === "string" ? { from: p.props.from } : {}),
          rule: s.rule,
          previousRule: s.previous,
          changedSecondsAgo: Math.round(world.time() - s.changedAt),
          blocking: s.rule === "deny",
        };
      }),
  };
};

const policyRevert: Handler = (ctx, args) => {
  const id = need(args, "policy");
  const before = ctx.world.stateAs(id, "network_policy").rule;
  ctx.world.apply({ type: "policy.revert", target: id }, "tool:policy_revert");
  const after = ctx.world.stateAs(id, "network_policy").rule;
  return {
    policy: id,
    from: before,
    to: after,
    guards: policiesOf(ctx.world.index, id).length,
    note: "정책을 이전 규칙으로 되돌렸어요. service_status로 서비스가 돌아왔는지 보세요.",
  };
};

const ingressStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "ingress");
  return {
    ingresses: world.index
      .ofKind("ingress")
      .filter((e) => !only || e.id === only)
      .map((e) => {
        const s = world.stateAs(e.id, "ingress");
        const host = hostedOn(world.index, e.id);
        return {
          id: e.id,
          name: e.name,
          status: s.status,
          ...(s.why ? { why: s.why } : {}),
          ...(host ? { node: host } : {}),
          services: servicesLeaningOn(world.index, e.id).map((x) => x.id),
          ...(s.upAt !== undefined && world.time() < s.upAt
            ? { upInSeconds: Math.max(0, Math.round(s.upAt - world.time())) }
            : {}),
        };
      }),
  };
};

const ingressRestart: Handler = (ctx, args) => {
  const { world } = ctx;
  const named = opt(args, "ingress");
  const all = world.index.ofKind("ingress");
  const targets = named
    ? [world.index.entity(named)]
    : all.filter((e) => world.stateAs(e.id, "ingress").status === "down");
  if (targets.length === 0) throw new ConflictError("닫혀 있는 인그레스가 없어요");
  for (const t of targets)
    world.apply({ type: "ingress.restart", target: t.id }, "tool:ingress_restart");
  return {
    restarted: targets.map((t) => t.id),
    upInSeconds: round(20, 0),
    note: "다시 뜨는 동안 밖에서 오는 요청은 거부돼요. ingress_status로 확인하세요.",
  };
};

export const SDN_HANDLERS: Readonly<Record<string, Handler>> = {
  sdn_status: sdnStatus,
  sdn_sync: sdnSync,
  sdn_failover: sdnFailover,
  overlay_trace: overlayTrace,
  evpn_sessions: evpnSessions,
  policy_list: policyList,
  policy_revert: policyRevert,
  ingress_status: ingressStatus,
  ingress_restart: ingressRestart,
};
