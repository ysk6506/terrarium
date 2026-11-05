/**
 * SNMPv2c on equipment that has an SNMP agent (REQ-002, ADR-0057): the UPS network card (UPS-MIB,
 * RFC 1628) and switches (IF-MIB). A request is one SNMP PDU, handed over as a tool call instead of a UDP
 * datagram; the answer carries what the PDU would: an error status and index, and one binding per
 * variable. Community strings work as on real agents: `public` reads, `private` also writes, and any
 * other string gets no answer at all.
 */
import { InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import type { Entity, WorldPort, WorldReader } from "@terrarium/core/world";
import { shutPort } from "./netos-model";
import { noService, speaks } from "./protocols";
import {
  type Assignment,
  type Mib,
  type Oid,
  parseOid,
  type SnmpReply,
  type SnmpType,
  snmpGet,
  snmpGetBulk,
  snmpGetNext,
  snmpSet,
  snmpWalk,
} from "./snmp-core";
import { ifMib } from "./snmp-if";
import type { Overlay } from "./snmp-mibs";
import { upsMib } from "./snmp-ups";

export const READ_COMMUNITY = "public";
export const WRITE_COMMUNITY = "private";

export type SnmpOperation = "get" | "getnext" | "getbulk" | "walk" | "set";

export interface SnmpRequest {
  readonly operation: SnmpOperation;
  readonly oids?: readonly string[];
  readonly community?: string;
  readonly nonRepeaters?: number;
  readonly maxRepetitions?: number;
  readonly values?: ReadonlyArray<{ oid: string; type: string; value: string | number }>;
}

export type SnmpResponse =
  | (SnmpReply & { readonly version: "2c"; readonly device: string })
  | { readonly timeout: true; readonly device: string; readonly message: string };

/** Subtrees people name instead of numbers. */
const ROOTS: Readonly<Record<string, string>> = {
  iso: "1.3",
  internet: "1.3.6.1",
  "mib-2": "1.3.6.1.2.1",
  system: "1.3.6.1.2.1.1",
  interfaces: "1.3.6.1.2.1.2",
  ifMIB: "1.3.6.1.2.1.31",
  upsMIB: "1.3.6.1.2.1.33",
  enterprises: "1.3.6.1.4.1",
};

/** `1.3.6.1.2.1.1.1.0`, or a name net-snmp would take: `sysDescr.0`, `UPS-MIB::upsBatteryStatus.0`, `system`. */
function resolve(mib: Mib, text: string): Oid {
  const numeric = parseOid(text);
  if (numeric) return numeric;
  const root = ROOTS[text.trim()];
  if (root) return parseOid(root) as Oid;
  const m = /^(?:[A-Za-z0-9-]+::)?([A-Za-z][A-Za-z0-9]*)((?:\.\d+)*)$/.exec(text.trim());
  const found = m && mib.objects.find((o) => o.name.endsWith(`::${m[1]}`));
  if (!m || !found)
    throw new InvalidValueError(`'${text}' is neither a dotted OID nor a known object name`);
  const index = m[2] ? m[2].slice(1).split(".").map(Number) : [];
  return [...found.oid, ...index];
}

const TYPE_NAMES: Readonly<Record<string, SnmpType>> = {
  i: "INTEGER",
  integer: "INTEGER",
  integer32: "INTEGER",
  s: "OCTET STRING",
  string: "OCTET STRING",
  "octet string": "OCTET STRING",
  o: "OBJECT IDENTIFIER",
  "object identifier": "OBJECT IDENTIFIER",
  u: "Gauge32",
  gauge32: "Gauge32",
  unsigned32: "Gauge32",
  c: "Counter32",
  counter32: "Counter32",
  t: "TimeTicks",
  timeticks: "TimeTicks",
};

function assignments(mib: Mib, request: SnmpRequest): Assignment[] {
  const values = request.values ?? [];
  if (values.length === 0) throw new InvalidValueError("set needs values: [{oid, type, value}]");
  return values.map((v) => {
    const type = TYPE_NAMES[String(v.type).toLowerCase()];
    if (!type) throw new InvalidValueError(`unknown SNMP type '${v.type}'`);
    const numeric = type !== "OCTET STRING" && type !== "OBJECT IDENTIFIER";
    if (numeric !== (typeof v.value === "number"))
      throw new InvalidValueError(
        `value of ${v.oid} must be ${numeric ? "a number" : "a string"} for ${type}`,
      );
    return { oid: resolve(mib, v.oid), type, value: v.value };
  });
}

function mibOf(world: WorldPort, entity: Entity, overlay: Overlay): Mib {
  if (entity.kind === "ups") return upsMib(world, entity, overlay);
  return ifMib(world, entity, overlay, (port, down) =>
    shutPort(world, entity.id, port, overlay, down),
  );
}

/** Whether the agent is up: a UPS card runs while the UPS has input or battery, a switch while it has power. */
function answers(world: WorldReader, entity: Entity): boolean {
  const s = world.stateOf(entity.id);
  if (s.kind === "ups") return s.inputOk || s.batteryPct > 0;
  return s.kind === "switch" ? s.powered && s.adminOn : true;
}

export class SnmpFacade {
  constructor(
    private readonly world: WorldPort,
    /** Settings a manager made, per device (shared with the device's command line). */
    private readonly overlays: Map<string, Overlay> = new Map(),
  ) {}

  handle(deviceId: string, request: SnmpRequest): SnmpResponse {
    const entity = this.world.index.find(deviceId);
    if (!entity || !speaks(entity.kind, "snmp"))
      throw new NotFoundError(noService(entity, deviceId, "snmp"));
    const community = request.community ?? READ_COMMUNITY;
    if (community !== READ_COMMUNITY && community !== WRITE_COMMUNITY)
      return this.silent(
        deviceId,
        `no response from ${deviceId}: the community string was not accepted`,
      );
    if (!answers(this.world, entity))
      return this.silent(
        deviceId,
        `no response from ${deviceId}: its management card has no power`,
      );
    const overlay = this.overlays.get(deviceId) ?? new Map<string, string>();
    this.overlays.set(deviceId, overlay);
    const mib = mibOf(this.world, entity, overlay);
    return { version: "2c", device: deviceId, ...this.run(mib, request, community) };
  }

  private silent(device: string, message: string): SnmpResponse {
    return { timeout: true, device, message };
  }

  private run(mib: Mib, request: SnmpRequest, community: string): SnmpReply {
    const oids = (request.oids ?? []).map((o) => resolve(mib, o));
    switch (request.operation) {
      case "get":
        return snmpGet(mib, this.needOids(oids));
      case "getnext":
        return snmpGetNext(mib, this.needOids(oids));
      case "getbulk":
        return snmpGetBulk(
          mib,
          this.needOids(oids),
          request.nonRepeaters ?? 0,
          request.maxRepetitions ?? 10,
        );
      case "walk":
        return snmpWalk(mib, oids[0] ?? (parseOid(ROOTS.internet as string) as Oid));
      case "set": {
        const list = assignments(mib, request);
        if (community !== WRITE_COMMUNITY)
          return { errorStatus: "noAccess", errorIndex: 1, varbinds: [] };
        return snmpSet(mib, list);
      }
      default:
        throw new InvalidValueError(
          `operation must be one of get, getnext, getbulk, walk, set (got '${String(request.operation)}')`,
        );
    }
  }

  private needOids(oids: readonly Oid[]): readonly Oid[] {
    if (oids.length === 0) throw new InvalidValueError("oids must list at least one OID");
    return oids;
  }
}
