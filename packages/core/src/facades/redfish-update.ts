/**
 * The BMC's UpdateService (REQ-002, ADR-0101): FirmwareInventory lists the BMC and the BIOS with their versions,
 * and SimpleUpdate with an image name starts an update. The server stages the image, reboots a few minutes later
 * and then runs the new version; a Task says where the update stands. Nothing here keeps state of its own: the
 * versions and the running job are the server's state, and a task is read off the world's event log.
 */
import { InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import {
  FIRMWARE_LABELS,
  type FirmwareComponent,
  parseImage,
  SHIPPED_FIRMWARE,
  updateSeconds,
  type WorldEvent,
  type WorldPort,
  type WorldReader,
  willFail,
} from "@terrarium/core/world";
import { type FacadeResponse, json } from "./http";
import type { BmcContext } from "./redfish-resources";

const SERVICE = "UpdateService";

const COMPONENTS: readonly FirmwareComponent[] = ["bmc", "bios"];

/** The inventory id of a part, as BMCs spell it. */
const inventoryId = (c: FirmwareComponent): string => (c === "bmc" ? "BMC" : "BIOS");

function componentOf(id: string): FirmwareComponent {
  const found = COMPONENTS.find((c) => inventoryId(c).toLowerCase() === id.toLowerCase());
  if (!found) throw new NotFoundError(`no firmware '${id}' on this BMC`);
  return found;
}

/** The version a part shows: a BMC that was never updated shows its profile's own version. */
export function versionOf(ctx: BmcContext, component: FirmwareComponent): string {
  const s = ctx.world.stateAs(ctx.server.id, "server");
  const v = component === "bmc" ? s.bmcVersion : s.biosVersion;
  return v === SHIPPED_FIRMWARE[component] && component === "bmc" ? ctx.profile.version : v;
}

export function updateService(ctx: BmcContext): Record<string, unknown> {
  const base = `${ctx.base}/${SERVICE}`;
  return {
    "@odata.id": base,
    "@odata.type": "#UpdateService.v1_11_0.UpdateService",
    Id: SERVICE,
    Name: "Update Service",
    ServiceEnabled: true,
    Status: { State: "Enabled", Health: "OK" },
    FirmwareInventory: { "@odata.id": `${base}/FirmwareInventory` },
    Actions: {
      "#UpdateService.SimpleUpdate": {
        target: `${base}/Actions/UpdateService.SimpleUpdate`,
        "TransferProtocol@Redfish.AllowableValues": ["HTTP", "HTTPS"],
      },
    },
  };
}

export function inventory(ctx: BmcContext): Record<string, unknown> {
  const base = `${ctx.base}/${SERVICE}/FirmwareInventory`;
  return {
    "@odata.id": base,
    "@odata.type": "#SoftwareInventoryCollection.SoftwareInventoryCollection",
    Name: "Firmware Inventory",
    Members: COMPONENTS.map((c) => ({ "@odata.id": `${base}/${inventoryId(c)}` })),
    "Members@odata.count": COMPONENTS.length,
  };
}

export function inventoryItem(ctx: BmcContext, id: string): Record<string, unknown> {
  const component = componentOf(id);
  const s = ctx.world.stateAs(ctx.server.id, "server");
  return {
    "@odata.id": `${ctx.base}/${SERVICE}/FirmwareInventory/${inventoryId(component)}`,
    "@odata.type": "#SoftwareInventory.v1_9_0.SoftwareInventory",
    Id: inventoryId(component),
    Name: `${FIRMWARE_LABELS[component]} firmware`,
    Version: versionOf(ctx, component),
    Updateable: true,
    Status: { State: s.fw?.component === component ? "Updating" : "Enabled", Health: "OK" },
  };
}

// --- tasks: read off the event log ----------------------------------------------------------

type UpdateEvent = Extract<WorldEvent, { type: "firmware.update" }>;

const taskPath = (ctx: BmcContext, seq: number): string => `${ctx.base}/TaskService/Tasks/${seq}`;

/** The update events of this server, oldest first. */
function updatesOf(world: WorldReader, server: string): UpdateEvent[] {
  return world
    .events()
    .filter((e): e is UpdateEvent => e.type === "firmware.update" && e.target === server);
}

/** How a task stands: running, done, or failed, from the first end event after it began. */
function outcomeOf(world: WorldReader, update: UpdateEvent): "Running" | "Completed" | "Exception" {
  const end = world
    .events(update.seq)
    .find(
      (e) =>
        (e.type === "firmware.finish" || e.type === "firmware.fail") && e.target === update.target,
    );
  if (!end) return "Running";
  return end.type === "firmware.finish" ? "Completed" : "Exception";
}

export function taskService(ctx: BmcContext): Record<string, unknown> {
  return {
    "@odata.id": `${ctx.base}/TaskService`,
    "@odata.type": "#TaskService.v1_2_0.TaskService",
    Id: "TaskService",
    Name: "Task Service",
    ServiceEnabled: true,
    Status: { State: "Enabled", Health: "OK" },
    Tasks: { "@odata.id": `${ctx.base}/TaskService/Tasks` },
  };
}

export function taskCollection(ctx: BmcContext): Record<string, unknown> {
  const updates = updatesOf(ctx.world, ctx.server.id);
  return {
    "@odata.id": `${ctx.base}/TaskService/Tasks`,
    "@odata.type": "#TaskCollection.TaskCollection",
    Name: "Task Collection",
    Members: updates.map((u) => ({ "@odata.id": taskPath(ctx, u.seq) })),
    "Members@odata.count": updates.length,
  };
}

export function task(ctx: BmcContext, id: string): Record<string, unknown> {
  const update = updatesOf(ctx.world, ctx.server.id).find((u) => String(u.seq) === id);
  if (!update) throw new NotFoundError(`no task '${id}'`);
  const state = outcomeOf(ctx.world, update);
  const total = updateSeconds(update.component);
  const done = Math.min(total, Math.max(0, ctx.world.time() - update.t));
  const label = `${FIRMWARE_LABELS[update.component]} ${update.version}`;
  return {
    "@odata.id": taskPath(ctx, update.seq),
    "@odata.type": "#Task.v1_6_0.Task",
    Id: id,
    Name: `Firmware update ${label}`,
    TaskState: state,
    TaskStatus: state === "Exception" ? "Critical" : "OK",
    PercentComplete: state === "Running" ? Math.floor((done / total) * 99) : 100,
    Messages:
      state === "Exception"
        ? [{ Message: `${label} update failed; the previous version is still running` }]
        : [],
  };
}

// --- SimpleUpdate -----------------------------------------------------------------------------

export function simpleUpdate(world: WorldPort, ctx: BmcContext, body: unknown): FacadeResponse {
  const uri = (body as { ImageURI?: unknown } | undefined)?.ImageURI;
  if (typeof uri !== "string" || uri.length === 0)
    throw new InvalidValueError("ImageURI is required (for example http://repo/fw/bios-2.4.1.bin)");
  const image = parseImage(uri);
  if (!image)
    throw new InvalidValueError(
      `ImageURI '${uri}' is not a firmware image: the file name must start with bmc- or bios- and a version, such as bios-2.4.1.bin`,
    );
  const event = world.apply(
    {
      type: "firmware.update",
      target: ctx.server.id,
      component: image.component,
      version: image.version,
      fails: willFail(world, ctx.server.id),
    },
    `redfish:${ctx.server.id}:SimpleUpdate`,
  );
  return json(202, task(ctx, String(event.seq)), { Location: taskPath(ctx, event.seq) });
}
