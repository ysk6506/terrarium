/**
 * How a service is doing, worked out from what it runs on (REQ-086, ADR-0091). Nothing here is simulated:
 * the same equipment state always gives the same answer, so a fix to the equipment (or a move to the standby)
 * brings the service back by itself.
 *
 * The rules, one host at a time (`hostVerdict`) and then for the service as a whole (`serviceHealth`), are
 * in docs/design-docs/service-os-layer.md. In short: a host that is off, cut off the network, rebooting or
 * out of its process is *dead*; a host that is hot, busy, short of memory or disk, or whose clock or name
 * lookup is wrong is *slow* for the services that feel it. How many dead hosts stop a service depends on its
 * kind: a stateful service stops with any one of its places, a request or batch service only when none is left.
 */
import type { Entity } from "./blueprint";
import { dependenciesOf } from "./db";
import { dependencyVerdict } from "./db-health";
import { cutOffHosts } from "./net-reach";
import { AUTH_SKEW_S, DISK_FULL_PCT, type HostOs } from "./os";
import { type ServiceDef, type ServiceKind, type ServiceStatus, serviceDef } from "./service";
import type { WorldReader } from "./world";

/** What made a place not ok, for tools that act on it (the shell says "connection refused" for a dead process, a timeout for a dead host). */
export type HostCause =
  | "power"
  | "off"
  | "reboot"
  | "network"
  | "os_down"
  | "process"
  | "zombie"
  | "fs"
  | "disk"
  | "ntp"
  | "dns"
  | "cert"
  | "memory"
  | "heat"
  | "cpu"
  | "storage"
  | "hardware";

export interface HostVerdict {
  readonly id: string;
  readonly state: "ok" | "slow" | "dead";
  /** One short sentence when not ok. */
  readonly why?: string;
  readonly cause?: HostCause;
}

export interface ServiceHealth {
  readonly status: ServiceStatus;
  readonly reasons: readonly string[];
  /** How many of the places it runs on are not dead, and how many it has. */
  readonly alive: number;
  readonly of: number;
}

const dead = (id: string, why: string, cause: HostCause): HostVerdict => ({
  id,
  state: "dead",
  why,
  cause,
});
const slow = (id: string, why: string, cause: HostCause): HostVerdict => ({
  id,
  state: "slow",
  why,
  cause,
});
const ok = (id: string): HostVerdict => ({ id, state: "ok" });

const name = (world: WorldReader, id: string): string => world.index.find(id)?.name ?? id;

/** Whether a switch carries traffic: it has power, nobody turned it off and no fault stopped it. */
export function switchAlive(world: WorldReader, id: string): boolean {
  const s = world.stateAs(id, "switch");
  return s.powered && s.adminOn && !world.faultsOn(id).some((f) => f.type === "switch_failure");
}

/** Whether a server can still be reached over its cables: some cable is up and ends on a switch that carries. */
function reachable(world: WorldReader, serverId: string): boolean {
  const cables = world.index.outgoing(serverId, "network");
  if (cables.length === 0) return true; // a world without a drawn network
  return cables.some((l) => world.linkUp(l.id) && switchAlive(world, l.to));
}

/** What the operating system of a host looks like to one service: the host, its state, and the service's settings. */
interface OsLook {
  readonly id: string;
  readonly os: HostOs;
  readonly def: ServiceDef;
}

type OsRule = (look: OsLook) => HostVerdict | undefined;

/** A trouble that stops a request service and only slows the others (or the other way round). */
const stopsRequest = (look: OsLook, why: string, cause: HostCause, slowWhy = why): HostVerdict =>
  look.def.kind === "request" ? dead(look.id, why, cause) : slow(look.id, slowWhy, cause);

const stopsOthers = (look: OsLook, why: string, cause: HostCause): HostVerdict =>
  look.def.kind === "request" ? slow(look.id, why, cause) : dead(look.id, why, cause);

/** What the operating system of a host does to a service, the first rule that fits wins. */
const OS_RULES: readonly OsRule[] = [
  ({ id, os }) => (os.up ? undefined : dead(id, "운영체제가 내려가 있어요(재부팅 중)", "os_down")),
  ({ id, os, def }) => {
    const p = os.processes.find((q) => q.name === def.process);
    if (!p || p.state === "running") return undefined;
    const why =
      p.state === "restarting"
        ? `${p.name} 프로세스가 죽고 다시 뜨기를 반복해요`
        : `${p.name} 프로세스가 멈춰 있어요`;
    return dead(id, why, "process");
  },
  ({ id, os }) =>
    os.zombies >= 3000
      ? dead(id, `좀비 프로세스가 ${os.zombies}개라 새 프로세스를 만들 수 없어요`, "zombie")
      : undefined,
  (look) =>
    look.os.fs === "ro"
      ? stopsOthers(
          look,
          look.def.kind === "request"
            ? "파일시스템이 읽기 전용이에요"
            : "파일시스템이 읽기 전용이라 쓸 수 없어요",
          "fs",
        )
      : undefined,
  (look) =>
    look.os.diskPct >= DISK_FULL_PCT
      ? stopsOthers(
          look,
          look.def.kind === "request" ? "디스크가 가득 찼어요" : "디스크가 가득 차서 쓸 수 없어요",
          "disk",
        )
      : undefined,
  (look) => {
    const off = Math.round(look.os.ntpOffsetS);
    if (Math.abs(look.os.ntpOffsetS) <= AUTH_SKEW_S) return undefined;
    return stopsRequest(
      look,
      `시계가 ${off}초 어긋나 인증이 실패해요`,
      "ntp",
      `시계가 ${off}초 어긋나 있어요`,
    );
  },
  (look) =>
    look.os.dnsOk
      ? undefined
      : stopsRequest(
          look,
          "이름을 IP로 바꾸지 못해 다른 서비스를 부를 수 없어요",
          "dns",
          "DNS가 실패해요",
        ),
  ({ id, os, def }) => {
    if (os.certOk || def.kind === "batch") return undefined;
    return def.kind === "request"
      ? dead(id, "인증서가 만료돼 연결이 거부돼요", "cert")
      : slow(id, "인증서가 만료됐어요", "cert");
  },
  ({ id, os, def }) =>
    os.memPct >= def.conditions.maxMemPct
      ? slow(id, `메모리 ${Math.round(os.memPct)}%`, "memory")
      : undefined,
  ({ id, os, def }) =>
    os.diskPct >= def.conditions.maxDiskPct
      ? slow(id, `디스크 ${Math.round(os.diskPct)}%`, "disk")
      : undefined,
  ({ id, os }) =>
    os.zombies >= 200 ? slow(id, `좀비 프로세스 ${os.zombies}개`, "zombie") : undefined,
];

function osVerdict(world: WorldReader, id: string, def: ServiceDef): HostVerdict | undefined {
  const state = world.stateOf(id);
  if (!("os" in state) || !state.os) return undefined; // nothing has gone wrong here
  const look: OsLook = { id, os: state.os, def };
  for (const rule of OS_RULES) {
    const verdict = rule(look);
    if (verdict) return verdict;
  }
  return undefined;
}

/** A server that cannot work at all: no power, off, rebooting, cut off, or (when asked) its system is down. */
function serverDead(world: WorldReader, id: string, look: "all" | "up"): HostVerdict | undefined {
  const s = world.stateAs(id, "server");
  const who = name(world, id);
  if (!s.powered) return dead(id, `${who} 전원이 없어요`, "power");
  if (!s.adminOn) return dead(id, `${who} 꺼져 있어요`, "off");
  if (world.faultsOn(id).some((f) => f.type === "memory_failure"))
    return dead(id, `${who} 메모리 불량으로 멈췄어요`, "hardware");
  if (s.rebooting) return dead(id, `${who} 재부팅 중이에요`, "reboot");
  if (!reachable(world, id)) return dead(id, `${who}에 네트워크로 닿지 않아요`, "network");
  if (cutOffHosts(world).some((c) => c.host.id === id))
    return dead(id, `${who}에 설정 때문에 닿지 않아요`, "network");
  if (look === "up" && s.os?.up === false)
    return dead(id, `${who} 운영체제가 내려가 있어요(재부팅 중)`, "os_down");
  return undefined;
}

/** `look: "up"` looks only at whether the system is up (a VM does not care about its hypervisor's disk). */
function serverVerdict(
  world: WorldReader,
  id: string,
  def: ServiceDef,
  look: "all" | "up" = "all",
): HostVerdict {
  const down = serverDead(world, id, look);
  if (down) return down;
  const s = world.stateAs(id, "server");
  const who = name(world, id);
  const os = look === "all" ? osVerdict(world, id, def) : undefined;
  if (os) return { ...os, why: `${who}: ${os.why}` };
  if (s.inletC >= def.conditions.maxInletC)
    return slow(id, `${who} 흡기 온도 ${s.inletC.toFixed(1)}°C`, "heat");
  if (s.throttled) return slow(id, `${who} CPU가 열 때문에 느려졌어요`, "heat");
  if (s.cpuUtil >= def.conditions.maxCpuUtil)
    return slow(id, `${who} CPU ${Math.round(s.cpuUtil * 100)}%`, "cpu");
  return ok(id);
}

/** The server a VM runs on now: where it was moved to, or where the blueprint put it. */
export function hostOfVm(world: WorldReader, vmId: string): string | undefined {
  return world.stateAs(vmId, "vm").hostId ?? world.index.outgoing(vmId, "runs_on")[0]?.to;
}

function vmVerdict(world: WorldReader, id: string, def: ServiceDef): HostVerdict {
  const s = world.stateAs(id, "vm");
  const who = name(world, id);
  if (!s.running) return dead(id, `${who} 꺼져 있어요`, "off");
  const hostId = hostOfVm(world, id);
  if (hostId) {
    const host = serverVerdict(world, hostId, def, "up");
    if (host.state === "dead")
      return dead(id, `${who}가 올라간 ${host.why}`, host.cause as HostCause);
    if (host.state === "slow")
      return slow(id, `${who}가 올라간 ${host.why}`, host.cause as HostCause);
  }
  const os = osVerdict(world, id, def);
  if (os) return { ...os, why: `${who}: ${os.why}` };
  if (s.cpuUsage >= def.conditions.maxCpuUtil)
    return slow(id, `${who} CPU ${Math.round(s.cpuUsage * 100)}%`, "cpu");
  return ok(id);
}

function storageVerdict(world: WorldReader, id: string, def: ServiceDef): HostVerdict {
  const s = world.stateAs(id, "storage");
  const who = name(world, id);
  if (!s.powered || !s.adminOn) return dead(id, `${who} 꺼져 있어요`, "off");
  if (!reachable(world, id)) return dead(id, `${who}에 네트워크로 닿지 않아요`, "network");
  if (s.failedDisks > 0) return slow(id, `${who} 디스크 ${s.failedDisks}개 고장`, "storage");
  if (s.usedPct >= Math.max(95, def.conditions.maxDiskPct))
    return slow(id, `${who} ${Math.round(s.usedPct)}% 찼어요`, "storage");
  return ok(id);
}

/** One place a service runs on, and how it is doing for this service. */
export function hostVerdict(world: WorldReader, id: string, def: ServiceDef): HostVerdict {
  const kind = world.index.find(id)?.kind;
  if (kind === "vm") return vmVerdict(world, id, def);
  if (kind === "server") return serverVerdict(world, id, def);
  if (kind === "storage") return storageVerdict(world, id, def);
  return ok(id);
}

const WORST: Readonly<Record<ServiceStatus, number>> = { healthy: 0, degraded: 1, down: 2 };

function worse(a: ServiceStatus, b: ServiceStatus): ServiceStatus {
  return WORST[a] >= WORST[b] ? a : b;
}

/** The status the places alone give. */
function fromHosts(kind: ServiceKind, verdicts: readonly HostVerdict[]): ServiceStatus {
  const dead = verdicts.filter((v) => v.state === "dead").length;
  const slowOnes = verdicts.filter((v) => v.state === "slow").length;
  if (verdicts.length === 0 || dead === verdicts.length) return "down";
  if (kind === "stateful" && dead > 0) return "down";
  return dead > 0 || slowOnes > 0 ? "degraded" : "healthy";
}

/** The status the switches on its path give: none left stops it, some left slows it. */
function fromPath(world: WorldReader, service: Entity): { status: ServiceStatus; reason?: string } {
  const via = world.index.outgoing(service.id, "service_via").map((l) => l.to);
  if (via.length === 0) return { status: "healthy" };
  const up = via.filter((id) => switchAlive(world, id));
  if (up.length === via.length) return { status: "healthy" };
  const lost = via.filter((id) => !up.includes(id)).map((id) => name(world, id));
  if (up.length === 0)
    return { status: "down", reason: `경로의 스위치가 모두 멈췄어요(${lost.join(", ")})` };
  return {
    status: "degraded",
    reason: `경로의 스위치 ${lost.join(", ")}가 멈춰 이중화로 버티는 중이에요`,
  };
}

/** The status the databases and pools it leans on give (`depends_on`): any one stopped stops it, any one slow slows it. */
function fromDeps(
  world: WorldReader,
  service: Entity,
  def: ServiceDef,
): { status: ServiceStatus; reasons: string[] } {
  let status: ServiceStatus = "healthy";
  const reasons: string[] = [];
  for (const dep of dependenciesOf(world.index, service.id)) {
    const v = dependencyVerdict(world, dep, def);
    if (v.state === "ok") continue;
    status = worse(status, v.state === "dead" ? "down" : "degraded");
    if (v.why) reasons.push(v.why);
  }
  return { status, reasons };
}

/** How a service is doing now. */
export function serviceHealth(world: WorldReader, serviceId: string): ServiceHealth {
  const entity = world.index.entity(serviceId);
  const def = serviceDef(entity);
  const state = world.stateAs(serviceId, "service");
  const verdicts = state.runsOn.map((id) => hostVerdict(world, id, def));
  const path = fromPath(world, entity);
  const deps = fromDeps(world, entity, def);
  const status = worse(worse(fromHosts(def.kind, verdicts), path.status), deps.status);
  const reasons = [
    ...verdicts.flatMap((v) => (v.why ? [v.why] : [])),
    ...(path.reason ? [path.reason] : []),
    ...deps.reasons,
  ];
  return {
    status,
    reasons: status === "healthy" ? [] : reasons.slice(0, 4),
    alive: verdicts.filter((v) => v.state !== "dead").length,
    of: verdicts.length,
  };
}
