/**
 * Alarms derived from state, like a monitoring system would raise them. Ids are `code:entity`, so
 * the same condition is one alarm for as long as it lasts. Messages are shown to people (Korean).
 */
import type {
  Alarm,
  CoolingState,
  Entity,
  PanelState,
  PduState,
  ServerState,
  UpsState,
  World,
} from "@terrarium/core/world";
import { capacityW } from "./power";

export const INLET_WARNING_C = 27;
export const RACK_CRITICAL_C = 32;
export const ROOM_WARNING_C = 30;
export const ROOM_CRITICAL_C = 35;

type Draft = Omit<Alarm, "id" | "since">;
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
];

function serverAlarms(world: World, entity: Entity): Draft[] {
  const s = world.stateAs(entity.id, "server");
  const model = world.catalog.getOf(entity.modelId ?? "", "server");
  return [...SERVER_RULES, inletRule(model.maxInletC)]
    .map((rule) => rule(s, entity.name))
    .filter((hit) => hit !== undefined)
    .map(([code, severity, message]) => ({ entityId: entity.id, code, severity, message }));
}

type Hit = [code: string, severity: Alarm["severity"], message: string];

function coolingHits(s: CoolingState, name: string): Hit[] {
  if (s.adminOn && !s.running) return [["cooling_stopped", "critical", `${name} 정지`]];
  return s.running && s.supplyC > s.setpointC + 2
    ? [
        [
          "cooling_overload",
          "warning",
          `${name} 공급 온도 ${s.supplyC.toFixed(1)}°C (설정 ${s.setpointC}°C)`,
        ],
      ]
    : [];
}

function breakerHits(world: World, id: string, s: PduState | PanelState, name: string): Hit[] {
  if (s.tripped) return [["breaker_tripped", "critical", `${name} 차단기 트립`]];
  const capacity = capacityW(world, id);
  return s.loadW > 0.8 * capacity
    ? [["load_high", "warning", `${name} 부하 ${Math.round((100 * s.loadW) / capacity)}%`]]
    : [];
}

function upsHits(s: UpsState, name: string): Hit[] {
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

function facilityAlarms(world: World, entity: Entity): Draft[] {
  const s = world.stateOf(entity.id);
  let hits: Hit[] = [];
  if (s.kind === "cooling_unit") hits = coolingHits(s, entity.name);
  else if (s.kind === "pdu" || s.kind === "power_panel")
    hits = breakerHits(world, entity.id, s, entity.name);
  else if (s.kind === "ups") hits = upsHits(s, entity.name);
  else if (s.kind === "rack")
    hits = temperatureHits(
      "rack_inlet_high",
      s.inletC,
      INLET_WARNING_C,
      RACK_CRITICAL_C,
      `${entity.name} 흡기`,
    );
  else if (s.kind === "room")
    hits = temperatureHits(
      "room_temp_high",
      s.ambientC,
      ROOM_WARNING_C,
      ROOM_CRITICAL_C,
      `${entity.name} 실내`,
    );
  return hits.map(([code, severity, message]) => ({
    entityId: entity.id,
    code,
    severity,
    message,
  }));
}

function itAlarms(world: World, entity: Entity): Draft[] {
  const s = world.stateOf(entity.id);
  const at = (code: string, severity: Alarm["severity"], message: string): Draft => ({
    entityId: entity.id,
    code,
    severity,
    message,
  });
  if (s.kind === "switch") {
    const down =
      s.adminOn &&
      (!s.powered || world.faultsOn(entity.id).some((f) => f.type === "switch_failure"));
    return down ? [at("switch_down", "critical", `${entity.name} 응답 없음`)] : [];
  }
  if (s.kind === "storage")
    return s.failedDisks > 0
      ? [at("disk_failed", "warning", `${entity.name} 디스크 ${s.failedDisks}개 고장`)]
      : [];
  if (s.kind === "vm")
    return s.adminOn && !s.running
      ? [at("vm_down", "warning", `${entity.name} 중지됨 (호스트 이상)`)]
      : [];
  return [];
}

function linkAlarms(world: World): Draft[] {
  const out: Draft[] = [];
  for (const link of world.index.allLinks().filter((l) => l.kind === "network")) {
    const switchDown =
      world.faultsOn(link.to).some((f) => f.type === "switch_failure") ||
      !world.stateAs(link.to, "switch").powered;
    if (!world.linkUp(link.id) || switchDown) {
      const name = world.index.entity(link.from).name;
      out.push({
        entityId: link.from,
        code: `link_down.${link.id}`,
        severity: "warning",
        message: `${name} 네트워크 링크 다운 (${String(link.props.fromPort ?? "")})`,
      });
    }
  }
  return out;
}

/** Every alarm the current state implies. */
export function desiredAlarms(world: World): Draft[] {
  const out: Draft[] = [];
  for (const entity of world.index.all()) {
    if (entity.kind === "server") out.push(...serverAlarms(world, entity));
    else out.push(...facilityAlarms(world, entity), ...itAlarms(world, entity));
  }
  return [...out, ...linkAlarms(world)];
}
