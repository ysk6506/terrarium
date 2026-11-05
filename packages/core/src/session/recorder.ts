/**
 * Time series of what monitoring would see (REQ-007, REQ-037): sensor readings (ADR-0017), effective
 * CPU, power, temperatures. Samples land on a fixed simulated-time grid and live in fixed-size ring
 * buffers, so memory per run is bounded: entities × metrics × (retention / interval) × 4 bytes.
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import { effectiveUtilAt, faultParam, passOf } from "@terrarium/core/physics";
import type { MetricSource } from "@terrarium/core/tools";
import type {
  BlueprintIndex,
  EntityKind,
  EntityState,
  Fault,
  StateOf,
  World,
} from "@terrarium/core/world";

/** Metrics recorded per entity kind. Servers' cpuUtil is the effective utilisation, not the base load. */
export const RECORDED_METRICS: Readonly<Partial<Record<EntityKind, readonly string[]>>> = {
  server: ["inletC", "cpuC", "cpuUtil", "powerW"],
  rack: ["inletC", "outletC", "powerW"],
  room: ["ambientC"],
  cooling_unit: ["supplyC", "returnC", "loadKw"],
  pdu: ["loadW"],
  power_panel: ["loadW", "loadA"],
  ups: ["batteryPct", "loadW"],
  storage: ["usedPct"],
  vm: ["cpuUsage"],
};

export interface RecorderOptions {
  readonly sampleSeconds: number;
  readonly retentionSeconds: number;
}

export const DEFAULT_RECORDER: RecorderOptions = { sampleSeconds: 30, retentionSeconds: 4 * 3600 };

/**
 * The samples taken so far, trimmed to what was written (warm start, REQ-032). One row per sample time,
 * one value per series in the recorder's fixed order. Rows are never changed once written.
 */
export interface RecorderCapture {
  readonly count: number;
  readonly nextAt: number;
  readonly times: Float64Array;
  readonly rows: readonly Float32Array[];
}

/** Where a series' value comes from: a plain property of the state, or a figure monitoring works out. */
const PLAIN = 0;
const SENSED_INLET = 1;
const EFFECTIVE_UTIL = 2;

/**
 * The series a blueprint has, in order: which entity, which metric. The same for every recorder over
 * the blueprint, so it is worked out once and shared (a run holds only its numbers).
 */
interface Layout {
  readonly ids: readonly string[];
  readonly metrics: readonly string[];
  readonly at: Int32Array;
  readonly how: Uint8Array;
  readonly byKey: ReadonlyMap<string, number>;
}

const layouts = new WeakMap<BlueprintIndex, Layout>();

function howOf(kind: EntityKind, metric: string): number {
  if (kind === "server" && metric === "inletC") return SENSED_INLET;
  if (kind === "server" && metric === "cpuUtil") return EFFECTIVE_UTIL;
  return PLAIN;
}

function layoutOf(index: BlueprintIndex): Layout {
  const known = layouts.get(index);
  if (known) return known;
  const ids: string[] = [];
  const metrics: string[] = [];
  const at: number[] = [];
  const how: number[] = [];
  const byKey = new Map<string, number>();
  index.all().forEach((entity, i) => {
    for (const metric of RECORDED_METRICS[entity.kind] ?? []) {
      byKey.set(`${entity.id}|${metric}`, ids.length);
      ids.push(entity.id);
      metrics.push(metric);
      at.push(i);
      how.push(howOf(entity.kind, metric));
    }
  });
  const layout = { ids, metrics, at: Int32Array.from(at), how: Uint8Array.from(how), byKey };
  layouts.set(index, layout);
  return layout;
}

export class MetricRecorder implements MetricSource {
  private readonly layout: Layout;
  private readonly times: Float64Array;
  /** One row per sample time, made when the sample is taken: a run that is short holds a short history. */
  private readonly rows: Array<Float32Array | undefined>;
  /** Rows that a warm-start capture also holds; they are replaced, not written into. */
  private readonly shared: Uint8Array;
  private count = 0;
  private nextAt: number;

  constructor(
    private readonly world: World,
    readonly options: RecorderOptions = DEFAULT_RECORDER,
  ) {
    const capacity = Math.ceil(options.retentionSeconds / options.sampleSeconds) + 1;
    this.layout = layoutOf(world.index);
    this.times = new Float64Array(capacity);
    this.rows = new Array<Float32Array | undefined>(capacity);
    this.shared = new Uint8Array(capacity);
    this.nextAt = Math.ceil(world.time() / options.sampleSeconds) * options.sampleSeconds;
  }

  /** Take every sample that is due at the world's current time (call after each physics step). */
  sampleIfDue(): void {
    const now = this.world.time();
    if (now < this.nextAt) return;
    const slot = this.count % this.times.length;
    this.times[slot] = now;
    let row = this.rows[slot];
    if (!row || this.shared[slot] === 1) {
      row = new Float32Array(this.layout.ids.length);
      this.rows[slot] = row;
      this.shared[slot] = 0;
    }
    this.read(row);
    this.count++;
    this.nextAt = (Math.floor(now / this.options.sampleSeconds) + 1) * this.options.sampleSeconds;
  }

  private read(row: Float32Array): void {
    const pass = passOf(this.world);
    const { metrics, at, how } = this.layout;
    for (let k = 0; k < row.length; k++) {
      const i = at[k] as number;
      const state = pass.states[i] as EntityState;
      const mode = how[k];
      if (mode === SENSED_INLET) {
        const drift = faultParam(pass.faults[i] as readonly Fault[], "sensor_drift", "deltaC");
        row[k] = (state as StateOf<"server">).inletC + (drift ?? 0);
      } else if (mode === EFFECTIVE_UTIL) {
        const s = state as StateOf<"server">;
        row[k] = s.powered && s.adminOn ? effectiveUtilAt(pass, i) : 0;
      } else row[k] = Number((state as unknown as Record<string, unknown>)[metrics[k] as string]);
    }
  }

  /** The samples so far, or nothing once the ring has wrapped (then they are not a simple prefix). */
  capture(): RecorderCapture | undefined {
    if (this.count > this.times.length) return undefined;
    // From now on these rows belong to the capture too, so a ring that wraps later must not write into them.
    this.shared.fill(1, 0, this.count);
    return {
      count: this.count,
      nextAt: this.nextAt,
      times: this.times.slice(0, this.count),
      rows: this.rows.slice(0, this.count) as Float32Array[],
    };
  }

  /** Continue from a capture taken on a recorder over the same blueprint and options. */
  adopt(capture: RecorderCapture): void {
    const width = capture.rows[0]?.length ?? this.layout.ids.length;
    if (width !== this.layout.ids.length || capture.count > this.times.length)
      throw new InvalidValueError("the recorder capture does not fit this recorder");
    this.times.set(capture.times);
    capture.rows.forEach((row, i) => {
      this.rows[i] = row;
      this.shared[i] = 1;
    });
    this.count = capture.count;
    this.nextAt = capture.nextAt;
  }

  /** Samples [t, value] of `metric` on `entityId` at or after simulated time `sinceT`. */
  series(entityId: string, metric: string, sinceT: number): Array<[number, number]> {
    const k = this.layout.byKey.get(`${entityId}|${metric}`);
    if (k === undefined) return [];
    const kept = Math.min(this.count, this.times.length);
    const out: Array<[number, number]> = [];
    for (let i = this.count - kept; i < this.count; i++) {
      const slot = i % this.times.length;
      const t = this.times[slot] as number;
      if (t >= sinceT) out.push([t, (this.rows[slot] as Float32Array)[k] as number]);
    }
    return out;
  }

  /** The metrics recorded for an entity. */
  metricsOf(entityId: string): string[] {
    return this.layout.metrics.filter((_, k) => this.layout.ids[k] === entityId);
  }

  /** Approximate memory held by the samples, for capacity planning (REQ-032). */
  get bytes(): number {
    const rows = Math.min(this.count, this.times.length);
    return this.times.byteLength + rows * this.layout.ids.length * Float32Array.BYTES_PER_ELEMENT;
  }

  get samples(): number {
    return this.count;
  }

  get seriesCount(): number {
    return this.layout.ids.length;
  }
}

export interface MetricSeries {
  readonly entityId: string;
  readonly metric: string;
  readonly points: ReadonlyArray<readonly [number, number]>;
}
