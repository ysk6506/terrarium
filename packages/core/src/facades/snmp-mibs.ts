/**
 * MIB building blocks: how an object type becomes instances, and the SNMPv2-MIB system group every
 * agent answers (RFC 3418). The equipment MIBs (UPS-MIB, IF-MIB) build on these (ADR-0057).
 */
import type { Entity, WorldReader } from "@terrarium/core/world";
import {
  compareOid,
  type ErrorStatus,
  type Mib,
  type MibObject,
  type MibVar,
  type Oid,
  parseOid,
  type SnmpType,
} from "./snmp-core";

/** Strings an agent lets a manager change (`sysName`, `upsIdentName`); they live beside the world, not in it. */
export type Overlay = Map<string, string>;

export function object(
  name: string,
  oid: string,
  type: SnmpType,
  access: MibObject["access"] = "read-only",
  labels?: Readonly<Record<number, string>>,
): MibObject {
  return { name, oid: parseOid(oid) as Oid, type, access, ...(labels ? { labels } : {}) };
}

/** Turns object types and the values the world gives them into the instances an agent serves. */
export class MibBuilder {
  private readonly byName: Map<string, MibObject>;
  private readonly vars: MibVar[] = [];

  constructor(private readonly objects: readonly MibObject[]) {
    this.byName = new Map(objects.map((o) => [o.name.split("::")[1] as string, o]));
  }

  /** A scalar (`.0`) or table cell (`index` after the column). Objects the device cannot report are simply not added. */
  add(name: string, index: readonly number[], value: string | number, set?: MibVar["set"]): this {
    const def = this.byName.get(name);
    if (!def) throw new Error(`MIB object ${name} is not defined`);
    const label = typeof value === "number" ? def.labels?.[value] : undefined;
    this.vars.push({
      oid: [...def.oid, ...index],
      name: `${def.name}.${index.join(".")}`,
      type: def.type,
      value,
      ...(label ? { label } : {}),
      ...(set ? { set } : {}),
    });
    return this;
  }

  scalar(name: string, value: string | number, set?: MibVar["set"]): this {
    return this.add(name, [0], value, set);
  }

  build(): Mib {
    return { objects: this.objects, vars: [...this.vars].sort((a, b) => compareOid(a.oid, b.oid)) };
  }
}

/** One MIB made of several. */
export function merge(...mibs: readonly Mib[]): Mib {
  return {
    objects: mibs.flatMap((m) => m.objects),
    vars: mibs.flatMap((m) => [...m.vars]).sort((a, b) => compareOid(a.oid, b.oid)),
  };
}

/** A string object a manager may write: stored in the overlay, size-checked as its DisplayString says. */
export function writableText(overlay: Overlay, key: string, maxLength: number): MibVar["set"] {
  return {
    check: (value): ErrorStatus =>
      typeof value === "string" && value.length <= maxLength ? "noError" : "wrongLength",
    apply: (value) => {
      overlay.set(key, String(value));
    },
  };
}

const SYSTEM = "SNMPv2-MIB";
const SYSTEM_OBJECTS: readonly MibObject[] = [
  object(`${SYSTEM}::sysDescr`, "1.3.6.1.2.1.1.1", "OCTET STRING"),
  object(`${SYSTEM}::sysObjectID`, "1.3.6.1.2.1.1.2", "OBJECT IDENTIFIER"),
  object(`${SYSTEM}::sysUpTime`, "1.3.6.1.2.1.1.3", "TimeTicks"),
  object(`${SYSTEM}::sysContact`, "1.3.6.1.2.1.1.4", "OCTET STRING", "read-write"),
  object(`${SYSTEM}::sysName`, "1.3.6.1.2.1.1.5", "OCTET STRING", "read-write"),
  object(`${SYSTEM}::sysLocation`, "1.3.6.1.2.1.1.6", "OCTET STRING", "read-write"),
  object(`${SYSTEM}::sysServices`, "1.3.6.1.2.1.1.7", "INTEGER"),
];

/** Documentation enterprise number (RFC 5612): the catalog's makers are invented, so none has a real one. */
export const ENTERPRISE_OID = "1.3.6.1.4.1.32473";

export interface SystemFacts {
  readonly description: string;
  /** Last arc(s) under the enterprise number that tell the kind of device apart. */
  readonly objectId: string;
  /** Bit sum of RFC 1213's layers: 72 = application and end-to-end, 6 = datalink and internet. */
  readonly services: number;
}

const wholeUptime = (t: number): number => Math.floor(t * 100) % 2 ** 32;

/** `ticks` since the agent started, which is when the world started. */
export const timeTicks = wholeUptime;

/** Where the device stands, from the site down to the room, the way a person fills `sysLocation`. */
export function locationText(world: WorldReader, entity: Entity): string {
  return [...world.index.ancestors(entity.id)]
    .reverse()
    .map((e) => e.name)
    .join(" > ");
}

export function systemMib(
  world: WorldReader,
  entity: Entity,
  facts: SystemFacts,
  overlay: Overlay,
): Mib {
  const text = (key: string, fallback: string): string => overlay.get(key) ?? fallback;
  return new MibBuilder(SYSTEM_OBJECTS)
    .scalar("sysDescr", facts.description)
    .scalar("sysObjectID", `${ENTERPRISE_OID}.${facts.objectId}`)
    .scalar("sysUpTime", wholeUptime(world.time()))
    .scalar("sysContact", text("sysContact", ""), writableText(overlay, "sysContact", 255))
    .scalar("sysName", text("sysName", entity.name), writableText(overlay, "sysName", 255))
    .scalar(
      "sysLocation",
      text("sysLocation", locationText(world, entity)),
      writableText(overlay, "sysLocation", 255),
    )
    .scalar("sysServices", facts.services)
    .build();
}
