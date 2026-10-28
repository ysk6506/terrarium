/**
 * Redfish resource bodies for one server's BMC, shaped after the DMTF schemas (REQ-002).
 * Readings are what the BMC would *report*: a sensor_drift fault offsets the inlet sensor while the
 * true temperature in the world stays correct.
 */
import { hashHex } from "@terrarium/core/kernel";
import { memberId, type RedfishProfile } from "@terrarium/core/profiles";
import {
  type Entity,
  reportedInletC,
  type ServerState,
  type WorldReader,
} from "@terrarium/core/world";
import { simTimeIso } from "./http";

export interface BmcContext {
  readonly world: WorldReader;
  readonly server: Entity;
  readonly profile: RedfishProfile;
  readonly base: string;
}

const HEALTH: Record<ServerState["health"], string> = {
  ok: "OK",
  warning: "Warning",
  critical: "Critical",
};

export const ids = (ctx: BmcContext) => ({
  system: memberId(ctx.profile, "System", ctx.server.id),
  chassis: memberId(ctx.profile, "Chassis", ctx.server.id),
  manager: memberId(ctx.profile, "Manager", ctx.server.id),
});

const state = (ctx: BmcContext): ServerState => ctx.world.stateAs(ctx.server.id, "server");
const model = (ctx: BmcContext) => ctx.world.catalog.getOf(ctx.server.modelId ?? "", "server");

function status(s: ServerState): { State: string; Health: string; HealthRollup: string } {
  const on = s.powered && s.adminOn;
  return {
    State: on ? "Enabled" : s.powered ? "StandbyOffline" : "Absent",
    Health: HEALTH[s.health],
    HealthRollup: HEALTH[s.health],
  };
}

/** The inlet reading the BMC reports (0.1 °C resolution), drift included. */
export const reportedInlet = (ctx: BmcContext): number =>
  Math.round(reportedInletC(ctx.world, ctx.server.id) * 10) / 10;

export function serviceRoot(ctx: BmcContext): Record<string, unknown> {
  return {
    "@odata.id": `${ctx.base}`,
    "@odata.type": "#ServiceRoot.v1_15_0.ServiceRoot",
    Id: "RootService",
    Name: "Root Service",
    RedfishVersion: ctx.profile.redfishVersion,
    UUID: uuidOf(ctx.server.id),
    Product: ctx.profile.product,
    Systems: { "@odata.id": `${ctx.base}/Systems` },
    Chassis: { "@odata.id": `${ctx.base}/Chassis` },
    Managers: { "@odata.id": `${ctx.base}/Managers` },
  };
}

export function collection(
  ctx: BmcContext,
  kind: "Systems" | "Chassis" | "Managers",
): Record<string, unknown> {
  const id =
    kind === "Systems" ? ids(ctx).system : kind === "Chassis" ? ids(ctx).chassis : ids(ctx).manager;
  const type =
    kind === "Systems"
      ? "ComputerSystemCollection"
      : kind === "Chassis"
        ? "ChassisCollection"
        : "ManagerCollection";
  return {
    "@odata.id": `${ctx.base}/${kind}`,
    "@odata.type": `#${type}.${type}`,
    Name: `${kind} Collection`,
    Members: [{ "@odata.id": `${ctx.base}/${kind}/${id}` }],
    "Members@odata.count": 1,
  };
}

function uuidOf(id: string): string {
  const h = (hashHex(`uuid1:${id}`) + hashHex(`uuid2:${id}`)).toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const serialOf = (id: string): string =>
  `TRM${hashHex(`serial:${id}`).slice(0, 7).toUpperCase()}`;

export function system(ctx: BmcContext): Record<string, unknown> {
  const s = state(ctx);
  const m = model(ctx);
  const { system: sid, chassis, manager } = ids(ctx);
  return {
    "@odata.id": `${ctx.base}/Systems/${sid}`,
    "@odata.type": "#ComputerSystem.v1_20_0.ComputerSystem",
    Id: sid,
    Name: ctx.server.name,
    HostName: ctx.server.name,
    SystemType: "Physical",
    Manufacturer: m.manufacturer,
    Model: m.name,
    SKU: m.id,
    SerialNumber: serialOf(ctx.server.id),
    UUID: uuidOf(ctx.server.id),
    PowerState: s.powered && s.adminOn ? "On" : "Off",
    Status: status(s),
    ProcessorSummary: {
      Count: m.cpuSockets,
      CoreCount: m.cpuSockets * m.coresPerSocket,
      Status: status(s),
    },
    MemorySummary: { TotalSystemMemoryGiB: m.memoryGiB, Status: status(s) },
    Actions: {
      "#ComputerSystem.Reset": {
        target: `${ctx.base}/Systems/${sid}/Actions/ComputerSystem.Reset`,
        "ResetType@Redfish.AllowableValues": [...ctx.profile.resetTypes],
      },
    },
    ...(ctx.profile.supportsEventLog
      ? { LogServices: { "@odata.id": `${ctx.base}/Systems/${sid}/LogServices` } }
      : {}),
    Links: {
      Chassis: [{ "@odata.id": `${ctx.base}/Chassis/${chassis}` }],
      ManagedBy: [{ "@odata.id": `${ctx.base}/Managers/${manager}` }],
    },
  };
}

export function chassis(ctx: BmcContext): Record<string, unknown> {
  const s = state(ctx);
  const { chassis: cid, system: sid } = ids(ctx);
  const rack = ctx.server.parentId ? ctx.world.index.find(ctx.server.parentId) : undefined;
  const u = ctx.server.placement?.type === "unit" ? ctx.server.placement.u : undefined;
  const legacy = ctx.profile.thermalSchema !== "subsystem";
  const modern = ctx.profile.thermalSchema !== "legacy";
  return {
    "@odata.id": `${ctx.base}/Chassis/${cid}`,
    "@odata.type": "#Chassis.v1_23_0.Chassis",
    Id: cid,
    Name: `${ctx.server.name} Chassis`,
    ChassisType: "RackMount",
    Manufacturer: model(ctx).manufacturer,
    Model: model(ctx).name,
    SerialNumber: serialOf(ctx.server.id),
    PowerState: s.powered && s.adminOn ? "On" : "Off",
    Status: status(s),
    Location: {
      PartLocation: {
        ServiceLabel: rack?.name ?? "",
        LocationOrdinalValue: u ?? 0,
        LocationType: "Slot",
        Orientation: "BottomToTop",
      },
    },
    ...(legacy
      ? {
          Thermal: { "@odata.id": `${ctx.base}/Chassis/${cid}/Thermal` },
          Power: { "@odata.id": `${ctx.base}/Chassis/${cid}/Power` },
        }
      : {}),
    ...(modern
      ? {
          ThermalSubsystem: { "@odata.id": `${ctx.base}/Chassis/${cid}/ThermalSubsystem` },
          PowerSubsystem: { "@odata.id": `${ctx.base}/Chassis/${cid}/PowerSubsystem` },
        }
      : {}),
    Links: { ComputerSystems: [{ "@odata.id": `${ctx.base}/Systems/${sid}` }] },
  };
}

function temperatureReadings(
  ctx: BmcContext,
): Array<{ id: string; name: string; reading: number; warn: number; crit: number }> {
  const s = state(ctx);
  const m = model(ctx);
  return [
    {
      id: "0",
      name: "System Board Inlet Temp",
      reading: reportedInlet(ctx),
      warn: 27,
      crit: m.maxInletC,
    },
    {
      id: "1",
      name: "CPU1 Temp",
      reading: Math.round(s.cpuC * 10) / 10,
      warn: m.cpuThrottleC,
      crit: m.cpuShutdownC,
    },
  ];
}

const sensorHealth = (value: number, warn: number, crit: number) =>
  value >= crit ? "Critical" : value >= warn ? "Warning" : "OK";

export function thermal(ctx: BmcContext): Record<string, unknown> {
  const s = state(ctx);
  const cid = ids(ctx).chassis;
  return {
    "@odata.id": `${ctx.base}/Chassis/${cid}/Thermal`,
    "@odata.type": "#Thermal.v1_7_0.Thermal",
    Id: "Thermal",
    Name: "Thermal",
    Temperatures: temperatureReadings(ctx).map((t) => ({
      "@odata.id": `${ctx.base}/Chassis/${cid}/Thermal#/Temperatures/${t.id}`,
      MemberId: t.id,
      Name: t.name,
      ReadingCelsius: t.reading,
      UpperThresholdNonCritical: t.warn,
      UpperThresholdCritical: t.crit,
      Status: { State: "Enabled", Health: sensorHealth(t.reading, t.warn, t.crit) },
    })),
    Fans: s.fanRpm.map((rpm, i) => ({
      "@odata.id": `${ctx.base}/Chassis/${cid}/Thermal#/Fans/${i}`,
      MemberId: String(i),
      Name: `System Fan ${i + 1}`,
      Reading: rpm,
      ReadingUnits: "RPM",
      Status: {
        State: s.powered ? "Enabled" : "Absent",
        Health: rpm === 0 && s.powered && s.adminOn ? "Critical" : "OK",
      },
    })),
  };
}

export function power(ctx: BmcContext): Record<string, unknown> {
  const s = state(ctx);
  const m = model(ctx);
  const cid = ids(ctx).chassis;
  return {
    "@odata.id": `${ctx.base}/Chassis/${cid}/Power`,
    "@odata.type": "#Power.v1_7_1.Power",
    Id: "Power",
    Name: "Power",
    PowerControl: [
      {
        MemberId: "0",
        Name: "System Power Control",
        PowerConsumedWatts: Math.round(s.powerW),
        PowerCapacityWatts: m.maxPowerW,
      },
    ],
    PowerSupplies: s.psuOk.map((ok, i) => ({
      MemberId: String(i),
      Name: `PS${i + 1}`,
      PowerCapacityWatts: Math.round(m.maxPowerW * 1.2),
      Status: { State: ok && s.powered ? "Enabled" : "Absent", Health: ok ? "OK" : "Critical" },
    })),
  };
}

export function thermalSubsystem(ctx: BmcContext): Record<string, unknown> {
  const cid = ids(ctx).chassis;
  const base = `${ctx.base}/Chassis/${cid}/ThermalSubsystem`;
  return {
    "@odata.id": base,
    "@odata.type": "#ThermalSubsystem.v1_3_0.ThermalSubsystem",
    Id: "ThermalSubsystem",
    Name: "Thermal Subsystem",
    Fans: { "@odata.id": `${base}/Fans` },
    ThermalMetrics: { "@odata.id": `${base}/ThermalMetrics` },
    Status: status(state(ctx)),
  };
}

export function thermalMetrics(ctx: BmcContext): Record<string, unknown> {
  const cid = ids(ctx).chassis;
  return {
    "@odata.id": `${ctx.base}/Chassis/${cid}/ThermalSubsystem/ThermalMetrics`,
    "@odata.type": "#ThermalMetrics.v1_2_0.ThermalMetrics",
    Id: "ThermalMetrics",
    Name: "Thermal Metrics",
    TemperatureReadingsCelsius: temperatureReadings(ctx).map((t) => ({
      DeviceName: t.name,
      Reading: t.reading,
    })),
  };
}

export function fanCollection(ctx: BmcContext): Record<string, unknown> {
  const base = `${ctx.base}/Chassis/${ids(ctx).chassis}/ThermalSubsystem/Fans`;
  const fans = state(ctx).fanRpm;
  return {
    "@odata.id": base,
    "@odata.type": "#FanCollection.FanCollection",
    Name: "Fans",
    Members: fans.map((_, i) => ({ "@odata.id": `${base}/${i}` })),
    "Members@odata.count": fans.length,
  };
}

export function fan(ctx: BmcContext, index: number): Record<string, unknown> | undefined {
  const s = state(ctx);
  const rpm = s.fanRpm[index];
  if (rpm === undefined) return undefined;
  return {
    "@odata.id": `${ctx.base}/Chassis/${ids(ctx).chassis}/ThermalSubsystem/Fans/${index}`,
    "@odata.type": "#Fan.v1_5_0.Fan",
    Id: String(index),
    Name: `System Fan ${index + 1}`,
    SpeedPercent: { Reading: Math.round((rpm / 18000) * 100), SpeedRPM: rpm },
    Status: {
      State: s.powered ? "Enabled" : "Absent",
      Health: rpm === 0 && s.powered && s.adminOn ? "Critical" : "OK",
    },
  };
}

export function powerSubsystem(ctx: BmcContext): Record<string, unknown> {
  const s = state(ctx);
  const m = model(ctx);
  const base = `${ctx.base}/Chassis/${ids(ctx).chassis}/PowerSubsystem`;
  return {
    "@odata.id": base,
    "@odata.type": "#PowerSubsystem.v1_1_0.PowerSubsystem",
    Id: "PowerSubsystem",
    Name: "Power Subsystem",
    CapacityWatts: m.maxPowerW,
    Allocation: { AllocatedWatts: Math.round(s.powerW) },
    PowerSupplies: { "@odata.id": `${base}/PowerSupplies` },
    Status: status(s),
  };
}

export function manager(ctx: BmcContext): Record<string, unknown> {
  const { manager: mid, system: sid } = ids(ctx);
  const s = state(ctx);
  return {
    "@odata.id": `${ctx.base}/Managers/${mid}`,
    "@odata.type": "#Manager.v1_19_0.Manager",
    Id: mid,
    Name: `${ctx.profile.product} BMC`,
    ManagerType: "BMC",
    FirmwareVersion: ctx.profile.version,
    Status: { State: s.powered ? "Enabled" : "Absent", Health: "OK" },
    Links: { ManagerForServers: [{ "@odata.id": `${ctx.base}/Systems/${sid}` }] },
  };
}

const SEVERITY: Record<string, string> = { warning: "Warning", critical: "Critical" };

/** Event log entries: alarms raised or cleared on this server, from the world's event log. */
export function eventLog(ctx: BmcContext): Record<string, unknown> {
  const sid = ids(ctx).system;
  const base = `${ctx.base}/Systems/${sid}/LogServices/EventLog/Entries`;
  const entries = ctx.world
    .events()
    .filter(
      (e) =>
        (e.type === "alarm.raise" && e.alarm.entityId === ctx.server.id) ||
        (e.type === "thermal.shutdown" && e.target === ctx.server.id),
    )
    .map((e) => ({
      "@odata.id": `${base}/${e.seq}`,
      "@odata.type": "#LogEntry.v1_15_0.LogEntry",
      Id: String(e.seq),
      Created: simTimeIso(e.t),
      EntryType: "Event",
      Severity: e.type === "alarm.raise" ? (SEVERITY[e.alarm.severity] ?? "OK") : "Critical",
      Message:
        e.type === "alarm.raise"
          ? e.alarm.message
          : `${ctx.server.name} thermal protection shutdown`,
      MessageId:
        e.type === "alarm.raise"
          ? `Terrarium.1.0.${e.alarm.code}`
          : "Terrarium.1.0.thermal_shutdown",
    }));
  return {
    "@odata.id": base,
    "@odata.type": "#LogEntryCollection.LogEntryCollection",
    Name: "Log Service Collection",
    Members: entries,
    "Members@odata.count": entries.length,
  };
}
