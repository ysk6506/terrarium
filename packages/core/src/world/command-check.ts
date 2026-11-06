/**
 * Whether a world command makes sense before it is recorded: the target exists and is the right kind
 * of thing, and the values are in range. A refused command changes nothing and is not logged.
 */
import { ConflictError, InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import type { EntityKind } from "./blueprint";
import { isBulkRack } from "./bulk";
import { checkDbCommand, type DbCommand, isDbCommand } from "./db-act";
import { type Fault, faultSpec } from "./faults";
import { FIRMWARE_COMPONENTS, type FirmwareComponent } from "./firmware";
import { HOST_ACTIONS } from "./host-os";
import { checkK8sCommand, isK8sCommand, type K8sCommand } from "./k8s-act";
import { checkNetChange } from "./net-check";
import { outletCount } from "./outlets";
import { checkServiceCommand } from "./service-act";
import type { WorldCommand, WorldReader } from "./world";

/** What the world can answer about itself beyond its reader: whether a fault or a network link is there. */
export interface Lookups {
  hasFault(id: string): boolean;
  hasLink(id: string): boolean;
}

/** What an operator can switch off and on: IT equipment, the cooling unit, and the plant (chiller, CDU, generator). */
const POWERABLE: ReadonlySet<EntityKind> = new Set([
  "server",
  "switch",
  "storage",
  "cooling_unit",
  "chiller",
  "cdu",
  "generator",
  "vm",
]);

function checkFault(world: WorldReader, has: Lookups, fault: Omit<Fault, "since">): void {
  if (has.hasFault(fault.id)) throw new ConflictError(`fault '${fault.id}' is already active`);
  const spec = faultSpec(fault.type);
  if (!spec) throw new InvalidValueError(`unknown fault type '${fault.type}'`);
  const kind = has.hasLink(fault.target) ? "link" : world.stateOf(fault.target).kind;
  if (!spec.targets.includes(kind))
    throw new InvalidValueError(`fault '${fault.type}' cannot target a ${kind}`);
  for (const param of spec.params) {
    const value = fault.params[param.name];
    if (value !== undefined && (value < param.min || value > param.max)) {
      throw new InvalidValueError(`${param.name} must be between ${param.min} and ${param.max}`);
    }
  }
}

function checkLoad(world: WorldReader, target: string, value: number): void {
  const kind = world.stateOf(target).kind;
  const light = kind === "rack" && isBulkRack(world.index.entity(target));
  if (kind !== "server" && kind !== "vm" && !light)
    throw new InvalidValueError(`load can only be set on servers, VMs and light racks`);
  if (!(value >= 0 && value <= 1)) throw new InvalidValueError("load must be between 0 and 1");
}

function checkSetpoint(world: WorldReader, target: string, celsius: number): void {
  const entity = world.index.entity(target);
  const model = world.catalog.getOf(entity.modelId ?? "", "cooling_unit");
  if (!(celsius >= model.minSetpointC && celsius <= model.maxSetpointC)) {
    throw new InvalidValueError(
      `setpoint must be between ${model.minSetpointC} and ${model.maxSetpointC} °C`,
    );
  }
}

/** The range a place on Earth can reach in a data-centre scenario. */
export const OUTDOOR_RANGE_C = { min: -30, max: 50 } as const;

function checkOutdoor(celsius: number): void {
  if (!(celsius >= OUTDOOR_RANGE_C.min && celsius <= OUTDOOR_RANGE_C.max))
    throw new InvalidValueError(
      `outdoor temperature must be between ${OUTDOOR_RANGE_C.min} and ${OUTDOOR_RANGE_C.max} °C`,
    );
}

function checkBreaker(world: WorldReader, target: string): void {
  const kind = world.stateOf(target).kind;
  if (kind !== "pdu" && kind !== "power_panel")
    throw new InvalidValueError(`'${target}' has no breaker`);
}

function checkActive(has: Lookups, faultId: string): void {
  if (!has.hasFault(faultId)) throw new NotFoundError(`no active fault '${faultId}'`);
}

function checkPowerable(world: WorldReader, target: string): void {
  if (!POWERABLE.has(world.stateOf(target).kind))
    throw new InvalidValueError(`'${target}' cannot be powered on or off`);
}

function checkLink(has: Lookups, target: string): void {
  if (!has.hasLink(target)) throw new NotFoundError(`no network link '${target}'`);
}

function checkOutlet(world: WorldReader, target: string, outlet: number): void {
  const count = world.stateOf(target).kind === "pdu" ? outletCount(world, target) : 0;
  if (count === 0) throw new InvalidValueError(`'${target}' has no outlets`);
  if (!Number.isInteger(outlet) || outlet < 1 || outlet > count)
    throw new NotFoundError(`'${target}' has no outlet ${outlet} (1..${count})`);
}

function checkFirmware(
  world: WorldReader,
  target: string,
  component: FirmwareComponent,
  version: string,
): void {
  const server = world.stateAs(target, "server");
  if (!FIRMWARE_COMPONENTS.includes(component))
    throw new InvalidValueError(`'${component}' is not a firmware part (bmc or bios)`);
  if (!/^\d+(\.\d+){1,3}$/.test(version))
    throw new InvalidValueError(`firmware version '${version}' must look like 2.4.1`);
  if (server.fw)
    throw new ConflictError(`'${target}' is already updating its ${server.fw.component}`);
}

/** The firmware commands: an operator's `firmware.update`, and the physics' three steps of it. */
function checkFirmwareCommand(world: WorldReader, command: WorldCommand): void {
  if (command.type === "firmware.update")
    checkFirmware(world, command.target, command.component, command.version);
  else if (command.type.startsWith("firmware."))
    world.stateAs((command as { target: string }).target, "server");
}

function checkHostAct(world: WorldReader, target: string, action: string): void {
  const kind = world.stateOf(target).kind;
  if (kind !== "server" && kind !== "vm")
    throw new InvalidValueError(`'${target}' has no operating system`);
  if (!(HOST_ACTIONS as readonly string[]).includes(action))
    throw new InvalidValueError(`'${action}' is not a host action`);
}

/** The commands of the layers above the equipment: host and service actions (ADR-0091), then firmware (ADR-0101). */
function checkLayerCommand(world: WorldReader, command: WorldCommand): void {
  if (isDbCommand(command.type)) checkDbCommand(world, command as DbCommand);
  else if (isK8sCommand(command.type)) checkK8sCommand(world, command as K8sCommand);
  else if (command.type === "host.act") checkHostAct(world, command.target, command.action);
  else if (command.type === "vm.migrate" || command.type.startsWith("service."))
    checkServiceCommand(world, command as Parameters<typeof checkServiceCommand>[1]);
  else checkFirmwareCommand(world, command);
}

export function validateCommand(world: WorldReader, has: Lookups, command: WorldCommand): void {
  switch (command.type) {
    case "power.set":
      checkPowerable(world, command.target);
      return;
    case "fault.add":
      checkFault(world, has, command.fault);
      return;
    case "fault.remove":
      checkActive(has, command.faultId);
      return;
    case "load.set":
      checkLoad(world, command.target, command.value);
      return;
    case "setpoint.set":
      checkSetpoint(world, command.target, command.celsius);
      return;
    case "breaker.reset":
      checkBreaker(world, command.target);
      return;
    case "outdoor.set":
      checkOutdoor(command.celsius);
      return;
    case "thermal.shutdown":
      world.stateAs(command.target, "server");
      return;
    case "link.admin":
      checkLink(has, command.target);
      return;
    case "outlet.set":
      checkOutlet(world, command.target, command.outlet);
      return;
    case "net.set":
      checkNetChange(world, command.target, command.change);
      return;
    default:
      checkLayerCommand(world, command);
  }
}
