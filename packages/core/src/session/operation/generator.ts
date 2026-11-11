/**
 * The fault generator (REQ-090, ADR-0094 item 1): a plan of faults over the operation's hours, worked out once from
 * the seed, the world's equipment and the table, so the same seed gives the same shift. A plan entry becomes a
 * `fault.add` (cause `generator`) when the world's time reaches it.
 */
import { SeededRng } from "@terrarium/core/kernel";
import type { EntityKind, FaultType } from "@terrarium/core/world";
import { type FaultTemplate, type OperationConfig, PRESET_SCALE } from "./config";
import { DAY_PATTERN, dayWeight, MTBF_TABLE } from "./mtbf";

/** A piece of equipment the generator may break. */
export interface Candidate {
  readonly id: string;
  readonly kind: EntityKind;
  readonly parentId?: string;
}

export interface PlannedFault {
  /** World seconds since the operation began. */
  readonly at: number;
  readonly id: string;
  readonly type: FaultType;
  readonly target: string;
  readonly params?: Readonly<Record<string, number>>;
  readonly why: "random" | "cascade" | "simultaneous" | "set";
}

const HOUR = 3_600;
/** A follow-on fault comes this long after the first (seconds). */
const CASCADE_DELAY: readonly [number, number] = [120, 1_200];
const SIMULTANEOUS_DELAY: readonly [number, number] = [0, 30];

interface Source {
  readonly type: FaultType;
  readonly target: Candidate;
  /** Faults per world hour at "보통". */
  readonly rate: number;
}

/** Every (fault, equipment) pair the table allows in this world, with its rate. */
export function sourcesOf(
  candidates: readonly Candidate[],
  hazard?: Readonly<Record<string, number>>,
): Source[] {
  // the reliability slot (REQ-113): a world's profile may change the hours of a fault kind or scale them all
  const scale = hazard?.rateScale ?? 1;
  return MTBF_TABLE.flatMap((row) =>
    candidates
      .filter((c) => row.kinds.includes(c.kind))
      .map((target) => ({
        type: row.type,
        target,
        rate: scale / (hazard?.[`mtbf.${row.type}`] ?? row.hours),
      })),
  );
}

/** Expected faults per world hour for a world at a preset (the day pattern averages to 1). */
export function expectedPerHour(candidates: readonly Candidate[], scale: number): number {
  return sourcesOf(candidates).reduce((sum, s) => sum + s.rate, 0) * scale;
}

function pickWeighted(rng: SeededRng, sources: readonly Source[], total: number): Source {
  let x = rng.random() * total;
  for (const s of sources) {
    x -= s.rate;
    if (x <= 0) return s;
  }
  return sources[sources.length - 1] as Source;
}

/** The arrival times of a rate that changes with the hour of the day (thinning of a steady rate). */
function arrivals(rng: SeededRng, perHour: number, seconds: number): number[] {
  const peak = Math.max(...DAY_PATTERN);
  const ceiling = (perHour * peak) / HOUR;
  if (ceiling <= 0) return [];
  const times: number[] = [];
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rng.random()) / ceiling;
    if (t >= seconds) return times;
    if (rng.random() < dayWeight(t) / peak) times.push(t);
  }
}

/** A neighbour that could fail because this one did: the same rack or room, another piece of equipment. */
function neighbourOf(
  rng: SeededRng,
  first: Source,
  sources: readonly Source[],
): Source | undefined {
  const parent = first.target.parentId;
  const near = sources.filter(
    (s) => s.target.id !== first.target.id && parent !== undefined && s.target.parentId === parent,
  );
  const pool = near.length > 0 ? near : sources.filter((s) => s.target.id !== first.target.id);
  if (pool.length === 0) return undefined;
  return pickWeighted(
    rng,
    pool,
    pool.reduce((sum, s) => sum + s.rate, 0),
  );
}

function randomPlan(
  candidates: readonly Candidate[],
  c: OperationConfig,
  seed: number,
  hazard?: Readonly<Record<string, number>>,
) {
  const scale =
    (c.source.kind === "preset" ? PRESET_SCALE[c.source.preset] : 1) * (c.rateScale ?? 1);
  const sources = sourcesOf(candidates, hazard);
  const total = sources.reduce((sum, s) => sum + s.rate, 0);
  if (total === 0) return [];
  const rng = new SeededRng(seed).fork("operation-faults");
  const out: Omit<PlannedFault, "id">[] = [];
  for (const at of arrivals(rng, total * scale, c.hours * HOUR)) {
    const first = pickWeighted(rng, sources, total);
    out.push({ at, type: first.type, target: first.target.id, why: "random" });
    if (rng.random() < c.simultaneousChance) {
      const other = neighbourOf(rng, first, sources);
      if (other)
        out.push({
          at: at + rng.uniform(...SIMULTANEOUS_DELAY),
          type: other.type,
          target: other.target.id,
          why: "simultaneous",
        });
    }
    if (rng.random() < c.cascadeChance) {
      const next = neighbourOf(rng, first, sources);
      if (next)
        out.push({
          at: at + rng.uniform(...CASCADE_DELAY),
          type: next.type,
          target: next.target.id,
          why: "cascade",
        });
    }
  }
  return out;
}

/** A set of faults played once each, at random moments of the hours (the busy hours more likely), in random order. */
function setPlan(faults: readonly FaultTemplate[], hours: number, seed: number) {
  const rng = new SeededRng(seed).fork("operation-set");
  const peak = Math.max(...DAY_PATTERN);
  // leave the first and last tenth quiet so there is time to see the fault come and go
  const [from, to] = [hours * HOUR * 0.05, hours * HOUR * 0.85];
  const times = faults.map(() => {
    for (let tries = 0; tries < 50; tries++) {
      const t = rng.uniform(from, to);
      if (rng.random() < dayWeight(t) / peak) return t;
    }
    return rng.uniform(from, to);
  });
  const order = [...faults.keys()].sort(() => rng.random() - 0.5);
  const sorted = [...times].sort((a, b) => a - b);
  return order.map(
    (i, k): Omit<PlannedFault, "id"> => ({
      at: sorted[k] as number,
      type: (faults[i] as FaultTemplate).type,
      target: (faults[i] as FaultTemplate).target,
      ...((faults[i] as FaultTemplate).params
        ? { params: (faults[i] as FaultTemplate).params }
        : {}),
      why: "set",
    }),
  );
}

/** The whole plan of an operation, in time order, with ids `gen:1`, `gen:2` ... */
export function planFaults(
  candidates: readonly Candidate[],
  config: OperationConfig,
  seed: number,
  hazard?: Readonly<Record<string, number>>,
): PlannedFault[] {
  const raw =
    config.source.kind === "set"
      ? setPlan(config.source.faults, config.hours, seed)
      : randomPlan(candidates, config, seed, hazard);
  const end = config.hours * HOUR;
  return raw
    .filter((f) => f.at < end)
    .sort((a, b) => a.at - b.at)
    .map((f, i) => ({ ...f, id: `gen:${i + 1}` }));
}

/** The fault templates a scenario's inject blocks hold, for building a set. */
export function templatesOf(
  nodes: ReadonlyArray<{
    readonly type: string;
    readonly params: Readonly<Record<string, unknown>>;
  }>,
): FaultTemplate[] {
  return nodes
    .filter((n) => n.type === "inject_fault" && typeof n.params.faultType === "string")
    .map((n) => ({
      type: n.params.faultType as FaultType,
      target: String(n.params.target ?? ""),
      ...(n.params.faultParams ? { params: n.params.faultParams as Record<string, number> } : {}),
    }))
    .filter((t) => t.target !== "");
}
