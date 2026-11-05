/**
 * The BACnet points of each kind of equipment (REQ-002, ADR-0057): what a building management system
 * would see on the device. Analog inputs are readings (°C, kW, %), binary inputs are states, the cooling
 * unit's setpoint and enable are commandable (priority array), and everything comes from the world's state.
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import type { Entity, WorldPort } from "@terrarium/core/world";
import {
  type AppValue,
  type BacnetError,
  type BacnetObject,
  bacnetError,
  enumerated,
  type ObjectType,
  real,
  type UnitName,
  unsigned,
} from "./bacnet-core";

type Extra = Partial<Omit<BacnetObject, "type" | "instance" | "name" | "description" | "present">>;

const point = (
  type: ObjectType,
  instance: number,
  name: string,
  description: string,
  present: AppValue,
  extra: Extra = {},
): BacnetObject => ({ type, instance, name, description, present, ...extra });

const ai = (
  n: number,
  name: string,
  description: string,
  value: number,
  units: UnitName,
  inAlarm: boolean,
) => point("analog-input", n, name, description, real(value), { units, inAlarm });

const bi = (n: number, name: string, description: string, active: boolean, inAlarm = false) =>
  point(
    "binary-input",
    n,
    name,
    description,
    enumerated(active ? 1 : 0, active ? "active" : "inactive"),
    {
      activeText: "Yes",
      inactiveText: "No",
      inAlarm,
    },
  );

/** The outdoor air the unit's plant works against, as a building system's weather input reads it. */
const outdoorAir = (world: WorldPort, n: number, inAlarm: boolean) =>
  ai(
    n,
    "Outdoor-Air-Temperature",
    "Outdoor air temperature",
    world.outdoorC(),
    "degrees-celsius",
    inAlarm,
  );

const percent = (value: number, of: number): number => (of > 0 ? (value / of) * 100 : 0);

/** Writes at this level or a number: what a client may send for an analog or binary value. */
function binaryOf(value: unknown): number | undefined {
  if (value === true || value === 1 || value === "active" || value === 1.0) return 1;
  if (value === false || value === 0 || value === "inactive") return 0;
  return undefined;
}

/**
 * The run command of a unit a building system can start and stop: active runs it, inactive stops it (the
 * operator's off switch, not a fault). It becomes the world's `power.set`, which the plant and the cooling
 * unit follow the same way.
 */
function enable(
  world: WorldPort,
  e: Entity,
  adminOn: boolean,
  inAlarm: boolean,
  description: string,
): BacnetObject {
  return point(
    "binary-output",
    1,
    "Unit-Enable",
    description,
    enumerated(adminOn ? 1 : 0, adminOn ? "active" : "inactive"),
    {
      activeText: "Run",
      inactiveText: "Stop",
      inAlarm,
      commandable: {
        relinquishDefault: enumerated(1, "active"),
        accept: (value): BacnetError | number => {
          const v = binaryOf(value);
          return (
            v ?? bacnetError("property", "invalid-data-type", "use active (1) or inactive (0)")
          );
        },
        apply: (value) => {
          world.apply({ type: "power.set", target: e.id, on: value === 1 }, `bacnet:${e.id}`);
        },
      },
    },
  );
}

function coolingUnit(world: WorldPort, e: Entity, inAlarm: boolean): BacnetObject[] {
  const s = world.stateAs(e.id, "cooling_unit");
  const model = world.catalog.getOf(e.modelId ?? "", "cooling_unit");
  const defaultSetpoint = typeof e.props.setpointC === "number" ? e.props.setpointC : 20;
  const setpointRange = `${model.minSetpointC} to ${model.maxSetpointC} °C`;
  return [
    ai(1, "Supply-Air-Temp", "Air leaving the unit", s.supplyC, "degrees-celsius", inAlarm),
    ai(2, "Return-Air-Temp", "Air entering the unit", s.returnC, "degrees-celsius", inAlarm),
    ai(3, "Cooling-Load", "Heat the unit is removing", s.loadKw, "kilowatts", inAlarm),
    ai(
      4,
      "Load-Percent",
      "Load against capacity",
      percent(s.loadKw, s.capacityKw),
      "percent",
      inAlarm,
    ),
    outdoorAir(world, 5, inAlarm),
    point(
      "analog-value",
      1,
      "Supply-Air-Setpoint",
      `Supply air setpoint, ${setpointRange}`,
      real(s.setpointC),
      {
        units: "degrees-celsius",
        inAlarm,
        commandable: {
          relinquishDefault: real(defaultSetpoint),
          accept: (value): BacnetError | number => {
            if (typeof value !== "number")
              return bacnetError("property", "invalid-data-type", "the setpoint is a real number");
            if (value < model.minSetpointC || value > model.maxSetpointC)
              return bacnetError(
                "property",
                "value-out-of-range",
                `setpoint must be ${setpointRange}`,
              );
            return value;
          },
          apply: (value) => {
            world.apply({ type: "setpoint.set", target: e.id, celsius: value }, `bacnet:${e.id}`);
          },
        },
      },
    ),
    bi(1, "Running", "The unit is running", s.running, inAlarm && !s.running),
    bi(
      2,
      "Unit-Fault",
      "The unit reports a fault",
      s.health === "critical",
      s.health === "critical",
    ),
    enable(world, e, s.adminOn, inAlarm, "Run command: active runs the unit, inactive stops it"),
  ];
}

function chiller(world: WorldPort, e: Entity, inAlarm: boolean): BacnetObject[] {
  const s = world.stateAs(e.id, "chiller");
  return [
    ai(
      1,
      "Chilled-Water-Supply-Temp",
      "Water sent to the plant loop",
      s.supplyC,
      "degrees-celsius",
      inAlarm,
    ),
    ai(2, "Chilled-Water-Return-Temp", "Water coming back", s.returnC, "degrees-celsius", inAlarm),
    ai(3, "Cooling-Load", "Heat the chiller is removing", s.loadKw, "kilowatts", inAlarm),
    ai(4, "Electrical-Power", "Electrical power drawn", s.powerW / 1000, "kilowatts", inAlarm),
    ai(
      5,
      "Load-Percent",
      "Load against capacity",
      percent(s.loadKw, s.capacityKw),
      "percent",
      inAlarm,
    ),
    outdoorAir(world, 6, inAlarm),
    bi(1, "Running", "The chiller is running", s.running, inAlarm && !s.running),
    enable(
      world,
      e,
      s.adminOn,
      inAlarm,
      "Run command: active lets the chiller run, inactive stops it",
    ),
  ];
}

function cdu(world: WorldPort, e: Entity, inAlarm: boolean): BacnetObject[] {
  const s = world.stateAs(e.id, "cdu");
  return [
    ai(1, "Supply-Temp", "Coolant sent to the racks", s.supplyC, "degrees-celsius", inAlarm),
    ai(2, "Return-Temp", "Coolant coming back", s.returnC, "degrees-celsius", inAlarm),
    ai(3, "Heat-Load", "Heat the CDU is carrying", s.loadKw, "kilowatts", inAlarm),
    ai(
      4,
      "Load-Percent",
      "Load against capacity",
      percent(s.loadKw, s.capacityKw),
      "percent",
      inAlarm,
    ),
    point(
      "analog-value",
      1,
      "Supply-Setpoint",
      "Supply temperature the CDU holds",
      real(s.setpointC),
      {
        units: "degrees-celsius",
        inAlarm,
      },
    ),
    bi(1, "Running", "The CDU is running", s.running, inAlarm && !s.running),
    enable(world, e, s.adminOn, inAlarm, "Run command: active lets the CDU run, inactive stops it"),
    ...s.pumpsOk.map((ok, i) => bi(i + 2, `Pump-${i + 1}-OK`, `Pump ${i + 1} is healthy`, ok, !ok)),
  ];
}

function generator(world: WorldPort, e: Entity, inAlarm: boolean): BacnetObject[] {
  const s = world.stateAs(e.id, "generator");
  const phases = ["standby", "starting", "running", "failed"] as const;
  return [
    ai(1, "Fuel-Level", "Fuel left in the tank", s.fuelPct, "percent", inAlarm),
    ai(2, "Output-Power", "Power the generator is carrying", s.loadKw, "kilowatts", inAlarm),
    point(
      "multi-state-input",
      1,
      "Engine-State",
      "Where the engine is in its start sequence",
      unsigned(phases.indexOf(s.phase) + 1),
      {
        stateText: phases,
        inAlarm: s.phase === "failed",
      },
    ),
    bi(1, "Running", "The generator is carrying load", s.phase === "running"),
    bi(
      2,
      "Start-Failure",
      "The generator could not start",
      s.phase === "failed",
      s.phase === "failed",
    ),
    enable(
      world,
      e,
      s.adminOn,
      inAlarm,
      "Mode switch: active is AUTO (starts when the utility fails), inactive is OFF",
    ),
  ];
}

function panel(world: WorldPort, e: Entity, inAlarm: boolean): BacnetObject[] {
  const s = world.stateAs(e.id, "power_panel");
  return [
    ai(1, "Load-Power", "Power flowing through the panel", s.loadW / 1000, "kilowatts", inAlarm),
    ai(2, "Load-Current", "Current flowing through the panel", s.loadA, "amperes", inAlarm),
    bi(1, "Energized", "The panel has power", s.powered),
    bi(2, "Breaker-Tripped", "The main breaker has tripped", s.tripped, s.tripped),
  ];
}

function ups(world: WorldPort, e: Entity, inAlarm: boolean): BacnetObject[] {
  const s = world.stateAs(e.id, "ups");
  const m = world.catalog.getOf(e.modelId ?? "", "ups");
  const out = s.inputOk || s.batteryPct > 0 ? (s.loadW * m.efficiency) / 1000 : 0;
  return [
    ai(1, "Battery-Charge", "Battery charge left", s.batteryPct, "percent", inAlarm),
    ai(2, "Output-Power", "Power delivered to the load", out, "kilowatts", inAlarm),
    ai(3, "Load-Percent", "Load against rating", percent(out, m.capacityKw), "percent", inAlarm),
    bi(1, "On-Battery", "The UPS is running on its battery", s.onBattery, s.onBattery),
    bi(2, "Input-OK", "Input power is present", s.inputOk),
  ];
}

const BUILD: Readonly<
  Record<string, (w: WorldPort, e: Entity, inAlarm: boolean) => BacnetObject[]>
> = {
  cooling_unit: coolingUnit,
  chiller,
  cdu,
  generator,
  power_panel: panel,
  ups,
};

/** The points of `entity`; throws for equipment with no BACnet interface. */
export function pointsOf(world: WorldPort, entity: Entity): BacnetObject[] {
  const build = BUILD[entity.kind];
  if (!build) throw new InvalidValueError(`${entity.kind} has no BACnet points`);
  const inAlarm = world.alarms().some((a) => a.entityId === entity.id);
  return build(world, entity, inAlarm);
}

/** Whether the device's controller is up. A cooling unit, chiller or CDU without power is silent. */
export function answers(world: WorldPort, entity: Entity): boolean {
  const s = world.stateOf(entity.id);
  switch (s.kind) {
    case "cooling_unit":
    case "cdu":
      return s.powered;
    case "chiller":
      return s.powered;
    case "power_panel":
      return s.powered || s.tripped;
    case "ups":
      return s.inputOk || s.batteryPct > 0;
    default:
      return true;
  }
}
