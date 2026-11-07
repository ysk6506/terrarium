/**
 * Alarms derived from state, like a monitoring system would raise them. Ids are `code:entity`, so
 * the same condition is one alarm for as long as it lasts. Messages are shown to people (Korean).
 */
import type { ServerModel } from "@terrarium/core/catalog";
import type {
  Alarm,
  BulkLoad,
  CoolingState,
  Entity,
  EntityState,
  Fault,
  Link,
  PanelState,
  PduState,
  RackState,
  ServerState,
  StateOf,
  UpsState,
  World,
} from "@terrarium/core/world";
import { type Draft, type Hit, NO_HITS, pushHits, type Scan } from "./alarm-scan";
import { appAlarms } from "./app-alarms";
import { dbAlarms } from "./db-alarms";
import { k8sAlarms } from "./k8s-alarms";
import { netAlarms } from "./net-alarms";
import { osAlarms } from "./os-alarms";
import { plantAlarms } from "./plant-alarms";
import { effectiveUtilAt, type Pass, passOf } from "./power";
import { faultParam, hasFault } from "./power-supply";
import { sdnAlarms } from "./sdn-alarms";
import { serviceAlarms } from "./services";

export const INLET_WARNING_C = 27;
export const RACK_CRITICAL_C = 32;
export const ROOM_WARNING_C = 30;
export const ROOM_CRITICAL_C = 35;
/** CPU utilisation (0..1) at which monitoring warns, for hosts and VMs. */
export const CPU_HIGH = 0.9;

type Rule<S> = (
  s: S,
  name: string,
) => [code: string, severity: Alarm["severity"], message: string] | undefined;

function inletRule(maxInletC: number): Rule<ServerState> {
  return (s, name) => {
    if (s.inletC > maxInletC)
      return [
        "inlet_high",
        "critical",
        `${name} 흡기 온도 ${s.inletC.toFixed(1)}°C (한계 ${maxInletC}°C 초과)`,
      ];
    return s.inletC > INLET_WARNING_C
      ? ["inlet_high", "warning", `${name} 흡기 온도 ${s.inletC.toFixed(1)}°C`]
      : undefined;
  };
}

const SERVER_RULES: ReadonlyArray<Rule<ServerState>> = [
  (s, name) =>
    s.adminOn && !s.powered ? ["server_power_lost", "critical", `${name} 전원 상실`] : undefined,
  (s, name) => (s.throttled ? ["cpu_throttled", "warning", `${name} CPU 열 스로틀링`] : undefined),
  (s, name) => {
    const failed = s.psuOk.filter((ok) => !ok).length;
    return failed > 0
      ? [
          "psu_failed",
          s.psuOk.some(Boolean) ? "warning" : "critical",
          `${name} PSU 이상 (${failed}개)`,
        ]
      : undefined;
  },
  (s, name) =>
    s.powered && s.adminOn && s.fanRpm.some((rpm) => rpm === 0)
      ? ["fan_failed", "warning", `${name} 팬 정지`]
      : undefined,
  (s, name) =>
    !s.adminOn && s.health === "critical"
      ? ["thermal_shutdown", "critical", `${name} 과열 보호 차단`]
      : undefined,
  (s, name) =>
    s.fwFailed
      ? ["firmware_update_failed", "warning", `${name} 펌웨어 올리기 실패 (${s.fwFailed})`]
      : undefined,
];

/** A server that is fed, on, cool (as its sensor says), with every PSU and fan running has nothing to report but load. */
function plainlyHealthy(s: ServerState, sensedInletC: number): boolean {
  if (!s.powered || !s.adminOn || s.throttled || sensedInletC > INLET_WARNING_C) return false;
  if (s.fwFailed) return false;
  for (const ok of s.psuOk) if (!ok) return false;
  for (const rpm of s.fanRpm) if (!(rpm > 0)) return false;
  return true;
}

function serverAlarms(scan: Scan, i: number, entity: Entity, out: Draft[]): void {
  const s = scan.states[i] as ServerState;
  const drift = faultParam(scan.faults[i] as readonly Fault[], "sensor_drift", "deltaC") ?? 0;
  const sensedInletC = s.inletC + drift;
  if (plainlyHealthy(s, sensedInletC) && effectiveUtilAt(scan, i) < CPU_HIGH) return;
  const model = scan.plan.models[i] as ServerModel;
  // Monitoring sees the sensor reading, so a drifting sensor raises (false) inlet alarms.
  const sensed: ServerState = { ...s, inletC: sensedInletC };
  const util = effectiveUtilAt(scan, i);
  const busy: Hit | undefined =
    s.powered && s.adminOn && util >= CPU_HIGH
      ? ["cpu_high", "warning", `${entity.name} CPU 사용률 ${Math.round(util * 100)}%`]
      : undefined;
  const hits = [
    ...SERVER_RULES.map((rule) => rule(s, entity.name)),
    inletRule(model.maxInletC)(sensed, entity.name),
    busy,
  ].filter((hit) => hit !== undefined);
  pushHits(out, entity, hits);
}

function coolingHits(s: CoolingState, name: string): readonly Hit[] {
  if (s.adminOn && !s.running) return [["cooling_stopped", "critical", `${name} 정지`]];
  return s.running && s.supplyC > s.setpointC + 2
    ? [
        [
          "cooling_overload",
          "warning",
          `${name} 공급 온도 ${s.supplyC.toFixed(1)}°C (설정 ${s.setpointC}°C)`,
        ],
      ]
    : NO_HITS;
}

function breakerHits(capacity: number, s: PduState | PanelState, name: string): readonly Hit[] {
  if (s.tripped) return [["breaker_tripped", "critical", `${name} 차단기 트립`]];
  return s.loadW > 0.8 * capacity
    ? [["load_high", "warning", `${name} 부하 ${Math.round((100 * s.loadW) / capacity)}%`]]
    : NO_HITS;
}

function upsHits(s: UpsState, name: string): readonly Hit[] {
  if (!s.onBattery && !(s.batteryPct < 20)) return NO_HITS;
  const out: Hit[] = [];
  if (s.onBattery)
    out.push([
      "ups_on_battery",
      "critical",
      `${name} 배터리 운전 중 (${s.batteryPct.toFixed(0)}%)`,
    ]);
  if (s.batteryPct < 20)
    out.push(["ups_battery_low", "critical", `${name} 배터리 부족 ${s.batteryPct.toFixed(0)}%`]);
  return out;
}

function temperatureHits(
  code: string,
  value: number,
  warnAt: number,
  criticalAt: number,
  label: string,
): Hit[] {
  if (value > criticalAt) return [[code, "critical", `${label} ${value.toFixed(1)}°C`]];
  return value > warnAt ? [[code, "warning", `${label} ${value.toFixed(1)}°C`]] : [];
}

function rackHits(entity: Entity, s: RackState, light: BulkLoad | undefined): readonly Hit[] {
  const lost = light !== undefined && light.servers > 0 && !s.powered;
  if (!lost && !(s.inletC > INLET_WARNING_C)) return NO_HITS;
  const hits = temperatureHits(
    "rack_inlet_high",
    s.inletC,
    INLET_WARNING_C,
    RACK_CRITICAL_C,
    `${entity.name} 흡기`,
  );
  // A light rack has no servers of its own to report that they lost power, so the rack does.
  if (lost)
    hits.push([
      "rack_power_lost",
      "critical",
      `${entity.name} 전원 상실 (서버 ${light.servers}대)`,
    ]);
  return hits;
}

function facilityAlarms(scan: Scan, i: number, entity: Entity, out: Draft[]): void {
  const s = scan.states[i] as EntityState;
  let hits: readonly Hit[] = NO_HITS;
  if (s.kind === "cooling_unit") hits = coolingHits(s, entity.name);
  else if (s.kind === "pdu" || s.kind === "power_panel")
    hits = breakerHits(scan.plan.capacity[i] as number, s, entity.name);
  else if (s.kind === "ups") hits = upsHits(s, entity.name);
  else if (s.kind === "rack") hits = rackHits(entity, s, scan.plan.light[i]);
  else if (s.kind === "room" && s.ambientC > ROOM_WARNING_C)
    hits = temperatureHits(
      "room_temp_high",
      s.ambientC,
      ROOM_WARNING_C,
      ROOM_CRITICAL_C,
      `${entity.name} 실내`,
    );
  pushHits(out, entity, hits);
}

function itAlarms(scan: Scan, i: number, entity: Entity, out: Draft[]): void {
  const s = scan.states[i] as EntityState;
  if (s.kind === "switch") {
    const down =
      s.adminOn && (!s.powered || hasFault(scan.faults[i] as readonly Fault[], "switch_failure"));
    if (down) pushHits(out, entity, [["switch_down", "critical", `${entity.name} 응답 없음`]]);
  } else if (s.kind === "storage") {
    if (s.failedDisks > 0)
      pushHits(out, entity, [
        ["disk_failed", "warning", `${entity.name} 디스크 ${s.failedDisks}개 고장`],
      ]);
  } else if (s.kind === "vm") {
    if (s.adminOn && !s.running)
      pushHits(out, entity, [["vm_down", "warning", `${entity.name} 중지됨 (호스트 이상)`]]);
    else if (s.running && s.cpuUsage >= CPU_HIGH)
      pushHits(out, entity, [
        ["vm_cpu_high", "warning", `${entity.name} CPU 사용률 ${Math.round(s.cpuUsage * 100)}%`],
      ]);
  }
}

/** The network links and the switches they end on, laid out once per blueprint. */
interface Network {
  readonly links: readonly Link[];
  readonly to: Int32Array;
  readonly switches: Int32Array;
}

const networks = new WeakMap<Pass["plan"], Network>();

function networkOf(scan: Scan): Network {
  const known = networks.get(scan.plan);
  if (known) return known;
  const { index } = scan.world;
  const links = index.allLinks().filter((l) => l.kind === "network");
  const net: Network = {
    links,
    to: Int32Array.from(links, (l) => index.positionOf(l.to) ?? -1),
    switches: Int32Array.from(scan.plan.ents.flatMap((e, i) => (e.kind === "switch" ? [i] : []))),
  };
  networks.set(scan.plan, net);
  return net;
}

/** Whether some switch is without power or failed (then links to it are down). */
function aSwitchIsDown(scan: Scan, net: Network): boolean {
  for (const i of net.switches) {
    if (!(scan.states[i] as StateOf<"switch">).powered) return true;
    if (hasFault(scan.faults[i] as readonly Fault[], "switch_failure")) return true;
  }
  return false;
}

function linkAlarms(scan: Scan, out: Draft[]): void {
  const net = networkOf(scan);
  // Almost always every link is up and every switch fine; then there is nothing to look at link by link.
  if (!scan.world.anyLinkDown() && !aSwitchIsDown(scan, net)) return;
  net.links.forEach((link, k) => {
    const to = net.to[k] as number;
    const switchDown =
      hasFault(scan.faults[to] as readonly Fault[], "switch_failure") ||
      !(scan.states[to] as StateOf<"switch">).powered;
    if (!scan.world.linkUp(link.id) || switchDown) {
      const name = scan.world.index.entity(link.from).name;
      out.push({
        entityId: link.from,
        code: `link_down.${link.id}`,
        severity: "warning",
        message: `${name} 네트워크 링크 다운 (${String(link.props.fromPort ?? "")})`,
      });
    }
  });
}

/** Every alarm the current state implies. */
export function desiredAlarms(world: World): Draft[] {
  const scan: Scan = { world, ...passOf(world) };
  const out: Draft[] = [];
  const ents = scan.plan.ents;
  for (let i = 0; i < ents.length; i++) {
    const entity = ents[i] as Entity;
    if (entity.kind === "server") serverAlarms(scan, i, entity, out);
    else {
      facilityAlarms(scan, i, entity, out);
      itAlarms(scan, i, entity, out);
      plantAlarms(scan, i, entity, out);
    }
  }
  linkAlarms(scan, out);
  netAlarms(world, out);
  osAlarms(world, out);
  dbAlarms(world, out);
  k8sAlarms(world, out);
  appAlarms(world, out);
  sdnAlarms(world, out);
  serviceAlarms(world, out);
  return out;
}
