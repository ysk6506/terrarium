/**
 * UPS-MIB (RFC 1628) for a UPS entity (REQ-002, ADR-0057). The standard groups a real network card fills:
 * identification, battery, input, output, alarms and the rated configuration. Every value is derived from
 * the world's UPS state, so a grid outage shows up as `upsOutputSource battery(5)`, a falling
 * `upsEstimatedChargeRemaining` and an `upsAlarmOnBattery` row. Objects the world has no number for
 * (voltages, currents, battery temperature) are defined but not populated: they answer `noSuchInstance`,
 * which RFC 1628 allows for the optional groups.
 */
import { manufacturerOf } from "@terrarium/core/catalog";
import type { Entity, UpsState, WorldReader } from "@terrarium/core/world";
import type { Mib, MibObject } from "./snmp-core";
import { MibBuilder, merge, type Overlay, object, systemMib, writableText } from "./snmp-mibs";

const M = "UPS-MIB";
const B = "1.3.6.1.2.1.33.1";

const BATTERY_STATUS = { 1: "unknown", 2: "batteryNormal", 3: "batteryLow", 4: "batteryDepleted" };
const OUTPUT_SOURCE = {
  1: "other",
  2: "none",
  3: "normal",
  4: "bypass",
  5: "battery",
  6: "booster",
  7: "reducer",
};

const OBJECTS: readonly MibObject[] = [
  object(`${M}::upsIdentManufacturer`, `${B}.1.1`, "OCTET STRING"),
  object(`${M}::upsIdentModel`, `${B}.1.2`, "OCTET STRING"),
  object(`${M}::upsIdentUPSSoftwareVersion`, `${B}.1.3`, "OCTET STRING"),
  object(`${M}::upsIdentAgentSoftwareVersion`, `${B}.1.4`, "OCTET STRING"),
  object(`${M}::upsIdentName`, `${B}.1.5`, "OCTET STRING", "read-write"),
  object(`${M}::upsIdentAttachedDevices`, `${B}.1.6`, "OCTET STRING", "read-write"),
  object(`${M}::upsBatteryStatus`, `${B}.2.1`, "INTEGER", "read-only", BATTERY_STATUS),
  object(`${M}::upsSecondsOnBattery`, `${B}.2.2`, "INTEGER"),
  object(`${M}::upsEstimatedMinutesRemaining`, `${B}.2.3`, "INTEGER"),
  object(`${M}::upsEstimatedChargeRemaining`, `${B}.2.4`, "INTEGER"),
  object(`${M}::upsBatteryVoltage`, `${B}.2.5`, "INTEGER"),
  object(`${M}::upsBatteryCurrent`, `${B}.2.6`, "INTEGER"),
  object(`${M}::upsBatteryTemperature`, `${B}.2.7`, "INTEGER"),
  object(`${M}::upsInputLineBads`, `${B}.3.1`, "Counter32"),
  object(`${M}::upsInputNumLines`, `${B}.3.2`, "INTEGER"),
  object(`${M}::upsInputFrequency`, `${B}.3.3.1.2`, "INTEGER"),
  object(`${M}::upsInputVoltage`, `${B}.3.3.1.3`, "INTEGER"),
  object(`${M}::upsInputCurrent`, `${B}.3.3.1.4`, "INTEGER"),
  object(`${M}::upsInputTruePower`, `${B}.3.3.1.5`, "INTEGER"),
  object(`${M}::upsOutputSource`, `${B}.4.1`, "INTEGER", "read-only", OUTPUT_SOURCE),
  object(`${M}::upsOutputFrequency`, `${B}.4.2`, "INTEGER"),
  object(`${M}::upsOutputNumLines`, `${B}.4.3`, "INTEGER"),
  object(`${M}::upsOutputVoltage`, `${B}.4.4.1.2`, "INTEGER"),
  object(`${M}::upsOutputCurrent`, `${B}.4.4.1.3`, "INTEGER"),
  object(`${M}::upsOutputPower`, `${B}.4.4.1.4`, "INTEGER"),
  object(`${M}::upsOutputPercentLoad`, `${B}.4.4.1.5`, "INTEGER"),
  object(`${M}::upsAlarmsPresent`, `${B}.6.1`, "Gauge32"),
  object(`${M}::upsAlarmDescr`, `${B}.6.2.1.2`, "OBJECT IDENTIFIER"),
  object(`${M}::upsAlarmTime`, `${B}.6.2.1.3`, "TimeTicks"),
  object(`${M}::upsShutdownType`, `${B}.8.1`, "INTEGER", "read-write"),
  object(`${M}::upsShutdownAfterDelay`, `${B}.8.2`, "INTEGER", "read-write"),
  object(`${M}::upsStartupAfterDelay`, `${B}.8.3`, "INTEGER", "read-write"),
  object(`${M}::upsConfigInputFreq`, `${B}.9.2`, "INTEGER", "read-write"),
  object(`${M}::upsConfigOutputFreq`, `${B}.9.4`, "INTEGER", "read-write"),
  object(`${M}::upsConfigOutputPower`, `${B}.9.6`, "INTEGER"),
];

/** The alarms RFC 1628 names (`upsWellKnownAlarms`, 1.3.6.1.2.1.33.1.6.3.n) that the world's UPS alarms map to. */
const WELL_KNOWN = `${B}.6.3`;
const ALARM_OF_CODE: Readonly<Record<string, number>> = { ups_on_battery: 2, ups_battery_low: 3 };
const GENERAL_FAULT = 18;

/** Hz × 10 on a Korean 60 Hz grid. */
const NOMINAL_FREQ = 600;
/** What a card reports for the time left when nothing draws power. */
const MAX_MINUTES = 9999;

const LOW_PERCENT = 20;

/** Seconds since the UPS went on battery: the age of its alarm (or of the event that raised one). */
function secondsOnBattery(world: WorldReader, entity: Entity, state: UpsState): number {
  if (!state.onBattery) return 0;
  const alarm = world.alarms().find((a) => a.entityId === entity.id && a.code === "ups_on_battery");
  return alarm ? Math.max(0, Math.floor(world.time() - alarm.since)) : 0;
}

/** Times the input failed: each time the UPS went on battery. */
function inputFailures(world: WorldReader, entity: Entity): number {
  return world
    .events()
    .filter(
      (e) =>
        e.type === "alarm.raise" &&
        e.alarm.entityId === entity.id &&
        e.alarm.code === "ups_on_battery",
    ).length;
}

function batteryStatus(state: UpsState): number {
  if (state.batteryPct <= 0) return 4;
  return state.batteryPct < LOW_PERCENT ? 3 : 2;
}

function minutesLeft(state: UpsState, batteryKwh: number): number {
  if (state.loadW <= 0) return MAX_MINUTES;
  const wh = batteryKwh * 1000 * (state.batteryPct / 100);
  return Math.min(MAX_MINUTES, Math.round((wh / state.loadW) * 60));
}

function source(state: UpsState): number {
  if (state.onBattery) return state.batteryPct > 0 ? 5 : 2;
  return state.inputOk ? 3 : 2;
}

export function upsMib(world: WorldReader, entity: Entity, overlay: Overlay): Mib {
  const state = world.stateAs(entity.id, "ups");
  const model = world.catalog.getOf(entity.modelId ?? "", "ups");
  const live = source(state) !== 2;
  const outputW = live ? Math.round(state.loadW * model.efficiency) : 0;
  const alarms = world
    .alarms()
    .filter((a) => a.entityId === entity.id)
    .sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
  const text = (key: string, fallback: string): string => overlay.get(key) ?? fallback;
  const b = new MibBuilder(OBJECTS)
    .scalar("upsIdentManufacturer", manufacturerOf(model))
    .scalar("upsIdentModel", model.name)
    .scalar("upsIdentAgentSoftwareVersion", "Terrarium SNMP agent 1.0")
    .scalar(
      "upsIdentName",
      text("upsIdentName", entity.name),
      writableText(overlay, "upsIdentName", 63),
    )
    .scalar(
      "upsIdentAttachedDevices",
      text("upsIdentAttachedDevices", ""),
      writableText(overlay, "upsIdentAttachedDevices", 63),
    )
    .scalar("upsBatteryStatus", batteryStatus(state))
    .scalar("upsSecondsOnBattery", secondsOnBattery(world, entity, state))
    .scalar("upsEstimatedMinutesRemaining", minutesLeft(state, model.batteryKwh))
    .scalar("upsEstimatedChargeRemaining", Math.round(state.batteryPct))
    .scalar("upsInputLineBads", inputFailures(world, entity))
    .scalar("upsInputNumLines", 1)
    .add("upsInputFrequency", [1], state.inputOk ? NOMINAL_FREQ : 0)
    .add("upsInputTruePower", [1], state.inputOk ? Math.round(state.loadW) : 0)
    .scalar("upsOutputSource", source(state))
    .scalar("upsOutputFrequency", live ? NOMINAL_FREQ : 0)
    .scalar("upsOutputNumLines", 1)
    .add("upsOutputPower", [1], outputW)
    .add("upsOutputPercentLoad", [1], Math.round((outputW / (model.capacityKw * 1000)) * 100))
    .scalar("upsAlarmsPresent", alarms.length)
    .scalar("upsConfigOutputPower", Math.round(model.capacityKw * 1000));
  for (const [i, alarm] of alarms.entries()) {
    const well = ALARM_OF_CODE[alarm.code] ?? GENERAL_FAULT;
    b.add("upsAlarmDescr", [i + 1], `${WELL_KNOWN}.${well}`);
    b.add("upsAlarmTime", [i + 1], Math.floor(alarm.since * 100));
  }
  return merge(
    systemMib(
      world,
      entity,
      { description: `${manufacturerOf(model)} ${model.name}`, objectId: "1.1", services: 72 },
      overlay,
    ),
    b.build(),
  );
}
