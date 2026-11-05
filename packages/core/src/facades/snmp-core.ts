/**
 * The SNMPv2c agent engine (RFC 3416 protocol operations over RFC 3418 / 2578 data), independent of any
 * equipment: it serves a sorted list of instances and answers Get, GetNext, GetBulk and Set the way a real
 * agent does: `noSuchObject` / `noSuchInstance` / `endOfMibView` exceptions per variable binding, and a
 * Set that changes nothing unless every binding is acceptable (ADR-0057).
 */

export type Oid = readonly number[];

export type SnmpType =
  | "INTEGER"
  | "OCTET STRING"
  | "OBJECT IDENTIFIER"
  | "Counter32"
  | "Gauge32"
  | "TimeTicks";

/** What an agent puts in a variable binding it cannot fill. */
export type SnmpException = "noSuchObject" | "noSuchInstance" | "endOfMibView";

/** RFC 3416 error-status names. */
export type ErrorStatus =
  | "noError"
  | "tooBig"
  | "genErr"
  | "noAccess"
  | "wrongType"
  | "wrongLength"
  | "wrongValue"
  | "noCreation"
  | "inconsistentValue"
  | "notWritable";

/** One thing the agent can answer for: an instance of an object (`upsBatteryStatus.0`). */
export interface MibVar {
  readonly oid: Oid;
  /** `UPS-MIB::upsBatteryStatus.0` */
  readonly name: string;
  readonly type: SnmpType;
  readonly value: string | number;
  /** The enumeration label of a numbered value (`batteryNormal` for 2). */
  readonly label?: string;
  /** Present when the instance can be set: `check` says whether the value is acceptable, `apply` stores it. */
  readonly set?: {
    check(value: string | number): ErrorStatus;
    apply(value: string | number): void;
  };
}

/** An object type of a MIB (a scalar or a table column), known whether or not it has instances. */
export interface MibObject {
  readonly name: string;
  readonly oid: Oid;
  readonly type: SnmpType;
  readonly access: "read-only" | "read-write";
  readonly labels?: Readonly<Record<number, string>>;
}

export interface Mib {
  readonly objects: readonly MibObject[];
  /** Sorted by OID. */
  readonly vars: readonly MibVar[];
}

export interface VarBind {
  readonly oid: string;
  readonly name?: string;
  readonly type?: SnmpType;
  readonly value?: string | number;
  readonly label?: string;
  readonly exception?: SnmpException;
}

export interface SnmpReply {
  readonly errorStatus: ErrorStatus;
  /** 1-based position of the binding that caused the error; 0 when there is none. */
  readonly errorIndex: number;
  readonly varbinds: readonly VarBind[];
}

export const MAX_VARBINDS = 64;

export const oidText = (oid: Oid): string => oid.join(".");

/** `1.3.6.1…` or `.1.3.6.1…` to numbers; undefined when it is not a dotted OID. */
export function parseOid(text: string): Oid | undefined {
  const trimmed = text.trim().replace(/^\./, "");
  if (!/^\d+(\.\d+)*$/.test(trimmed)) return undefined;
  const parts = trimmed.split(".").map(Number);
  return parts.length >= 2 && parts.every((n) => Number.isSafeInteger(n)) ? parts : undefined;
}

export function compareOid(a: Oid, b: Oid): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

export const startsWith = (oid: Oid, prefix: Oid): boolean =>
  oid.length >= prefix.length && prefix.every((n, i) => oid[i] === n);

const bind = (v: MibVar): VarBind => ({
  oid: oidText(v.oid),
  name: v.name,
  type: v.type,
  value: v.value,
  ...(v.label ? { label: v.label } : {}),
});

const exception = (oid: Oid, kind: SnmpException): VarBind => ({
  oid: oidText(oid),
  exception: kind,
});

/** Index of the first instance at or after `oid` (binary search over the sorted list). */
function lowerBound(mib: Mib, oid: Oid): number {
  let lo = 0;
  let hi = mib.vars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareOid((mib.vars[mid] as MibVar).oid, oid) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const find = (mib: Mib, oid: Oid): MibVar | undefined => {
  const v = mib.vars[lowerBound(mib, oid)];
  return v && compareOid(v.oid, oid) === 0 ? v : undefined;
};

/** The first instance after `oid`, or undefined at the end of the MIB. */
function after(mib: Mib, oid: Oid): MibVar | undefined {
  const i = lowerBound(mib, oid);
  const v = mib.vars[i];
  return v && compareOid(v.oid, oid) === 0 ? mib.vars[i + 1] : v;
}

/** Whether `oid` lies under an object type the MIB defines (then the object exists, only the instance does not). */
const underKnownObject = (mib: Mib, oid: Oid): boolean =>
  mib.objects.some((o) => startsWith(oid, o.oid));

export function snmpGet(mib: Mib, oids: readonly Oid[]): SnmpReply {
  if (oids.length > MAX_VARBINDS) return { errorStatus: "tooBig", errorIndex: 0, varbinds: [] };
  const varbinds = oids.map((oid) => {
    const v = find(mib, oid);
    if (v) return bind(v);
    return exception(oid, underKnownObject(mib, oid) ? "noSuchInstance" : "noSuchObject");
  });
  return { errorStatus: "noError", errorIndex: 0, varbinds };
}

function next(mib: Mib, oid: Oid): VarBind {
  const v = after(mib, oid);
  return v ? bind(v) : exception(oid, "endOfMibView");
}

export function snmpGetNext(mib: Mib, oids: readonly Oid[]): SnmpReply {
  if (oids.length > MAX_VARBINDS) return { errorStatus: "tooBig", errorIndex: 0, varbinds: [] };
  return { errorStatus: "noError", errorIndex: 0, varbinds: oids.map((oid) => next(mib, oid)) };
}

/** RFC 3416 §4.2.3: the first `nonRepeaters` bindings are GetNext, the rest repeat `maxRepetitions` times, row by row. */
export function snmpGetBulk(
  mib: Mib,
  oids: readonly Oid[],
  nonRepeaters: number,
  maxRepetitions: number,
): SnmpReply {
  const n = Math.max(0, Math.min(nonRepeaters, oids.length));
  const reps = Math.max(0, maxRepetitions);
  const varbinds: VarBind[] = oids.slice(0, n).map((oid) => next(mib, oid));
  let cursors = oids.slice(n);
  for (let r = 0; r < reps && cursors.length > 0; r++) {
    const row = cursors.map((oid) => next(mib, oid));
    if (varbinds.length + row.length > MAX_VARBINDS) {
      return { errorStatus: varbinds.length === 0 ? "tooBig" : "noError", errorIndex: 0, varbinds };
    }
    varbinds.push(...row);
    cursors = row.map((b, i) => (b.exception ? (cursors[i] as Oid) : (parseOid(b.oid) as Oid)));
    if (row.every((b) => b.exception === "endOfMibView")) break;
  }
  return { errorStatus: "noError", errorIndex: 0, varbinds };
}

export interface Assignment {
  readonly oid: Oid;
  readonly type: SnmpType;
  readonly value: string | number;
}

/** RFC 3416 §4.2.5: every binding is checked first; one error and nothing is changed. */
export function snmpSet(mib: Mib, assignments: readonly Assignment[]): SnmpReply {
  const echo = assignments.map((a) => ({ oid: oidText(a.oid), type: a.type, value: a.value }));
  const targets: MibVar[] = [];
  for (const [i, a] of assignments.entries()) {
    const fail = (errorStatus: ErrorStatus): SnmpReply => ({
      errorStatus,
      errorIndex: i + 1,
      varbinds: echo,
    });
    const v = find(mib, a.oid);
    if (!v) return fail(underKnownObject(mib, a.oid) ? "noCreation" : "notWritable");
    if (!v.set) return fail("notWritable");
    if (a.type !== v.type) return fail("wrongType");
    const status = v.set.check(a.value);
    if (status !== "noError") return fail(status);
    targets.push(v);
  }
  for (const [i, v] of targets.entries()) v.set?.apply((assignments[i] as Assignment).value);
  return { errorStatus: "noError", errorIndex: 0, varbinds: echo };
}

/** All instances under `root`, as repeated GetNext would return them (what `snmpwalk` prints). */
export function snmpWalk(mib: Mib, root: Oid): SnmpReply {
  const varbinds: VarBind[] = [];
  for (let v = mib.vars[lowerBound(mib, root)]; v; ) {
    if (!startsWith(v.oid, root)) break;
    if (varbinds.length >= 4 * MAX_VARBINDS)
      return { errorStatus: "tooBig", errorIndex: 0, varbinds };
    varbinds.push(bind(v));
    v = after(mib, v.oid);
  }
  return { errorStatus: "noError", errorIndex: 0, varbinds };
}
