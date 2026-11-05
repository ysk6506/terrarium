/**
 * BACnet/IP on building and plant equipment (REQ-002, ADR-0057): cooling units, chillers, CDUs, generators,
 * power panels and UPSes appear as BACnet devices whose points come from the world. Four services are
 * answered as a client sees them: Who-Is / I-Am, ReadProperty, ReadPropertyMultiple and WriteProperty
 * (with the 16-level priority array). A request is one service primitive handed over as a tool call;
 * errors are the standard's error class and code.
 */
import { manufacturerOf } from "@terrarium/core/catalog";
import { InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import type { Entity, WorldPort } from "@terrarium/core/world";
import {
  type AppValue,
  type BacnetError,
  type BacnetObject,
  bacnetError,
  bool,
  ERROR_CLASS,
  ERROR_CODE,
  enumerated,
  OBJECT_TYPE_ID,
  type ObjectType,
  objectId,
  objectTypeOf,
  PROPERTY_ID,
  type PropertyName,
  propertyOf,
  text,
  UNITS,
  unsigned,
} from "./bacnet-core";
import { answers, pointsOf } from "./bacnet-points";
import { noService, speaks } from "./protocols";

export type BacnetService =
  | "who-is"
  | "read-property"
  | "read-property-multiple"
  | "write-property";

export interface BacnetRequest {
  readonly service: BacnetService;
  readonly objectType?: string | number;
  readonly instance?: number;
  readonly property?: string | number;
  readonly arrayIndex?: number;
  /** ReadPropertyMultiple: what to read from which objects. */
  readonly requests?: ReadonlyArray<{
    objectType: string | number;
    instance: number;
    properties: ReadonlyArray<string | number>;
  }>;
  /** write-property: the value; `null` takes the command back at that priority. */
  readonly value?: unknown;
  readonly priority?: number;
  /** Who-Is: only devices with an instance number in this range answer. */
  readonly low?: number;
  readonly high?: number;
}

type Reply = Readonly<Record<string, unknown>>;

const MAX_APDU = 1476;
/** ASHRAE's own vendor id: the catalog's makers are invented and have none. */
const VENDOR_ID = 0;
const FIRST_DEVICE_INSTANCE = 1001;

const EVENT_STATE = { normal: 0, offnormal: 2 } as const;

const failure = (e: BacnetError): Reply => ({
  service: "error",
  errorClass: e.errorClass,
  errorClassId: ERROR_CLASS[e.errorClass],
  errorCode: e.errorCode,
  errorCodeId: ERROR_CODE[e.errorCode],
  message: e.message,
});

type Props = Partial<Record<PropertyName, AppValue>>;

const array = (items: readonly AppValue[]): AppValue => ({ type: "array", value: items });

function commonProperties(o: BacnetObject): Props {
  const alarm = o.inAlarm === true;
  return {
    "object-identifier": objectId(o.type, o.instance),
    "object-name": text(o.name),
    "object-type": enumerated(OBJECT_TYPE_ID[o.type], o.type),
    description: text(o.description),
    "status-flags": {
      type: "bit-string",
      value: { "in-alarm": alarm, fault: false, overridden: false, "out-of-service": false },
    },
    "event-state": enumerated(
      alarm ? EVENT_STATE.offnormal : EVENT_STATE.normal,
      alarm ? "offnormal" : "normal",
    ),
    reliability: enumerated(0, "no-fault-detected"),
    "out-of-service": bool(false),
    "present-value": o.present,
  };
}

function slotValue(o: BacnetObject, n: number | null): AppValue {
  if (n === null) return { type: "null" };
  return o.present.type === "real"
    ? { type: "real", value: n }
    : enumerated(n, n === 1 ? "active" : "inactive");
}

/** Every property a point has, for ReadProperty, ReadPropertyMultiple and `object-list`. */
function pointProperties(o: BacnetObject, slots: readonly (number | null)[] | undefined): Props {
  const p: Props = commonProperties(o);
  if (o.units) p.units = enumerated(UNITS[o.units], o.units);
  if (o.type === "binary-input" || o.type === "binary-output") {
    p.polarity = enumerated(0, "normal");
    if (o.activeText) p["active-text"] = text(o.activeText);
    if (o.inactiveText) p["inactive-text"] = text(o.inactiveText);
  }
  if (o.stateText) {
    p["number-of-states"] = unsigned(o.stateText.length);
    p["state-text"] = array(o.stateText.map(text));
  }
  if (o.commandable) {
    p["priority-array"] = array((slots ?? Array(16).fill(null)).map((n) => slotValue(o, n)));
    p["relinquish-default"] = o.commandable.relinquishDefault;
  }
  return p;
}

function deviceProperties(
  entity: Entity,
  instance: number,
  points: readonly BacnetObject[],
  world: WorldPort,
): Props {
  const model = world.catalog.get(entity.modelId ?? "");
  const location = [...world.index.ancestors(entity.id)]
    .reverse()
    .map((e) => e.name)
    .join(" > ");
  return {
    "object-identifier": objectId("device", instance),
    "object-name": text(entity.name),
    "object-type": enumerated(OBJECT_TYPE_ID.device, "device"),
    description: text(model.name),
    "system-status": enumerated(0, "operational"),
    "vendor-name": text(manufacturerOf(model)),
    "vendor-identifier": unsigned(VENDOR_ID),
    "model-name": text(model.name),
    "firmware-revision": text("Terrarium 1.0"),
    "application-software-version": text("1.0"),
    location: text(location),
    "protocol-version": unsigned(1),
    "protocol-revision": unsigned(14),
    "max-apdu-length-accepted": unsigned(MAX_APDU),
    "segmentation-supported": enumerated(3, "no-segmentation"),
    "database-revision": unsigned(1),
    "object-list": array([
      objectId("device", instance),
      ...points.map((p) => objectId(p.type, p.instance)),
    ]),
  };
}

/** A property value, or the error a client gets for it, honouring `arrayIndex` as ReadProperty does. */
function read(
  props: Props,
  name: PropertyName | undefined,
  index: number | undefined,
): AppValue | BacnetError {
  const value = name ? props[name] : undefined;
  if (!name || !value)
    return bacnetError("property", "unknown-property", "the object has no such property");
  if (index === undefined) return value;
  if (value.type !== "array")
    return bacnetError("property", "property-is-not-an-array", `${name} is not an array`);
  if (index === 0) return unsigned(value.value.length);
  return (
    value.value[index - 1] ??
    bacnetError("property", "invalid-array-index", `${name} has ${value.value.length} elements`)
  );
}

const isError = (v: object): v is BacnetError => "errorClass" in v;

export class BacnetFacade {
  private readonly priorities = new Map<string, (number | null)[]>();
  private instances: Map<string, number> | undefined;

  constructor(private readonly world: WorldPort) {}

  handle(deviceId: string | undefined, request: BacnetRequest): Reply {
    if (request.service === "who-is") return this.whoIs(deviceId, request);
    const entity = deviceId ? this.world.index.find(deviceId) : undefined;
    if (!entity || !speaks(entity.kind, "bacnet"))
      throw new NotFoundError(noService(entity, deviceId ?? "(no device given)", "bacnet"));
    if (!answers(this.world, entity))
      return {
        timeout: true,
        device: entity.id,
        message: `no response from ${entity.id}: its controller has no power`,
      };
    switch (request.service) {
      case "read-property":
        return this.readProperty(entity, request);
      case "read-property-multiple":
        return this.readMultiple(entity, request);
      case "write-property":
        return this.writeProperty(entity, request);
      default:
        throw new InvalidValueError(
          `service must be who-is, read-property, read-property-multiple or write-property (got '${String(request.service)}')`,
        );
    }
  }

  /** Device instance numbers: 1001 upwards, in the order of the blueprint, so they do not change during a run. */
  private instanceOf(entity: Entity): number {
    if (!this.instances) {
      this.instances = new Map();
      for (const e of this.world.index.all())
        if (speaks(e.kind, "bacnet"))
          this.instances.set(e.id, FIRST_DEVICE_INSTANCE + this.instances.size);
    }
    return this.instances.get(entity.id) ?? 0;
  }

  private whoIs(deviceId: string | undefined, request: BacnetRequest): Reply {
    const candidates = deviceId
      ? [this.world.index.find(deviceId)].filter((e): e is Entity => e !== undefined)
      : this.world.index.all().filter((e) => speaks(e.kind, "bacnet"));
    if (deviceId && candidates[0] && !speaks(candidates[0].kind, "bacnet"))
      throw new NotFoundError(noService(candidates[0], deviceId, "bacnet"));
    if (deviceId && candidates.length === 0) throw new NotFoundError(`no equipment '${deviceId}'`);
    const devices = candidates
      .filter((e) => answers(this.world, e))
      .map((e) => ({ entity: e, instance: this.instanceOf(e) }))
      .filter((d) => d.instance >= (request.low ?? 0) && d.instance <= (request.high ?? 4_194_302))
      .map(({ entity, instance }) => ({
        deviceIdentifier: { objectType: "device", instance },
        entityId: entity.id,
        name: entity.name,
        kind: entity.kind,
        vendorName: manufacturerOf(this.world.catalog.get(entity.modelId ?? "")),
        vendorId: VENDOR_ID,
        maxApduLengthAccepted: MAX_APDU,
        segmentationSupported: "no-segmentation",
      }));
    return { service: "i-am", devices };
  }

  private objectProps(entity: Entity, type: ObjectType, instance: number): Props | BacnetError {
    const points = pointsOf(this.world, entity);
    const device = this.instanceOf(entity);
    if (type === "device")
      return instance === device
        ? deviceProperties(entity, device, points, this.world)
        : bacnetError("object", "unknown-object", `device instance ${instance} is not this device`);
    const point = points.find((p) => p.type === type && p.instance === instance);
    return point
      ? pointProperties(point, this.priorities.get(`${entity.id}|${type}|${instance}`))
      : bacnetError(
          "object",
          "unknown-object",
          `${type},${instance} does not exist on ${entity.id}`,
        );
  }

  private objectOf(request: {
    objectType?: string | number;
    instance?: number;
  }): ObjectType | BacnetError {
    const type = request.objectType === undefined ? undefined : objectTypeOf(request.objectType);
    if (
      !type ||
      request.instance === undefined ||
      !Number.isInteger(request.instance) ||
      request.instance < 0
    )
      return bacnetError(
        "object",
        "unknown-object",
        "give objectType and instance, e.g. analog-input and 1",
      );
    return type;
  }

  private readProperty(entity: Entity, request: BacnetRequest): Reply {
    const type = this.objectOf(request);
    if (typeof type !== "string") return failure(type);
    const props = this.objectProps(entity, type, request.instance as number);
    if (isError(props)) return failure(props);
    const name = request.property === undefined ? undefined : propertyOf(request.property);
    const value = read(props, name, request.arrayIndex);
    if (isError(value)) return failure(value);
    return {
      service: "read-property-ack",
      objectIdentifier: { objectType: type, instance: request.instance },
      property: name,
      propertyId: name ? PROPERTY_ID[name] : undefined,
      ...(request.arrayIndex === undefined ? {} : { arrayIndex: request.arrayIndex }),
      value,
    };
  }

  private readMultiple(entity: Entity, request: BacnetRequest): Reply {
    if (!request.requests || request.requests.length === 0)
      throw new InvalidValueError(
        "read-property-multiple needs requests: [{objectType, instance, properties}]",
      );
    const results = request.requests.map((spec) => {
      const type = this.objectOf(spec);
      if (typeof type !== "string") return { objectIdentifier: spec, error: failure(type) };
      const props = this.objectProps(entity, type, spec.instance);
      if (isError(props)) return { objectIdentifier: spec, error: failure(props) };
      const names = spec.properties.flatMap((p) =>
        p === "all" || p === "required" || p === "optional"
          ? (Object.keys(props) as PropertyName[])
          : [propertyOf(p)],
      );
      return {
        objectIdentifier: { objectType: type, instance: spec.instance },
        results: names.map((name, i) => {
          const value = read(props, name, undefined);
          const label = name ?? String(spec.properties[i]);
          return isError(value)
            ? { property: label, error: failure(value) }
            : { property: label, propertyId: name ? PROPERTY_ID[name] : undefined, value };
        }),
      };
    });
    return { service: "read-property-multiple-ack", results };
  }

  /** Why `property` of the object cannot be written, or undefined when it is the present value of a commandable point. */
  private unwritable(
    entity: Entity,
    type: ObjectType,
    instance: number,
    name: PropertyName | undefined,
  ): { point: BacnetObject } | BacnetError {
    const point = pointsOf(this.world, entity).find(
      (p) => p.type === type && p.instance === instance,
    );
    const isDevice = type === "device" && instance === this.instanceOf(entity);
    if (!point && !isDevice)
      return bacnetError(
        "object",
        "unknown-object",
        `${type},${instance} does not exist on ${entity.id}`,
      );
    if (!name)
      return bacnetError("property", "unknown-property", "the object has no such property");
    if (name !== "present-value" || !point?.commandable)
      return bacnetError(
        "property",
        "write-access-denied",
        `${name} of ${type},${instance} cannot be written`,
      );
    return { point };
  }

  private writeProperty(entity: Entity, request: BacnetRequest): Reply {
    const type = this.objectOf(request);
    if (typeof type !== "string") return failure(type);
    const name = request.property === undefined ? undefined : propertyOf(request.property);
    const target = this.unwritable(entity, type, request.instance as number, name);
    if (isError(target)) return failure(target);
    if (request.value === undefined)
      throw new InvalidValueError(
        "write-property needs value, or relinquish: true to take a command back",
      );
    const priority = request.priority ?? 16;
    if (!Number.isInteger(priority) || priority < 1 || priority > 16)
      return failure(
        bacnetError(
          "services",
          "parameter-out-of-range",
          "priority must be 1 (highest) to 16 (lowest)",
        ),
      );
    return this.command(entity, target.point, priority, request.value);
  }

  /** Put (or, with null, take back) a value at one priority, then apply whatever now wins to the equipment. */
  private command(entity: Entity, point: BacnetObject, priority: number, value: unknown): Reply {
    const command = point.commandable as NonNullable<BacnetObject["commandable"]>;
    const key = `${entity.id}|${point.type}|${point.instance}`;
    const slots = [...(this.priorities.get(key) ?? Array(16).fill(null))] as (number | null)[];
    if (value === null) slots[priority - 1] = null;
    else {
      const accepted = command.accept(value);
      if (typeof accepted !== "number") return failure(accepted);
      slots[priority - 1] = accepted;
    }
    const winner = slots.find((n) => n !== null);
    const fallback = command.relinquishDefault;
    command.apply(
      winner ?? (fallback.type === "null" || !("value" in fallback) ? 0 : Number(fallback.value)),
    );
    this.priorities.set(key, slots);
    return { service: "simple-ack" };
  }
}
