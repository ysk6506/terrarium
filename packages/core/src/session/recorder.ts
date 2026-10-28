/**
 * Time series of what monitoring would see (REQ-007, REQ-037): sensor readings (ADR-0017), effective
 * CPU, power, temperatures. Samples land on a fixed simulated-time grid and live in fixed-size ring
 * buffers, so memory per run is bounded: entities × metrics × (retention / interval) × 4 bytes.
 */
import { effectiveUtil } from "@terrarium/core/physics";
import type { MetricSource } from "@terrarium/core/tools";
import { type EntityKind, reportedInletC, type World } from "@terrarium/core/world";

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

type Reader = (world: World, id: string) => number;

const special: Readonly<Record<string, Reader>> = {
  "server.inletC": (w, id) => reportedInletC(w, id),
  "server.cpuUtil": (w, id) => {
    const s = w.stateAs(id, "server");
    return s.powered && s.adminOn ? effectiveUtil(w, w.index.entity(id)) : 0;
  },
};

function readerFor(kind: EntityKind, metric: string): Reader {
  return (
    special[`${kind}.${metric}`] ??
    ((w, id) => Number((w.stateOf(id) as unknown as Record<string, unknown>)[metric]))
  );
}

interface Series {
  readonly id: string;
  readonly metric: string;
  readonly read: Reader;
  readonly values: Float32Array;
}

export class MetricRecorder implements MetricSource {
  private readonly all: Series[] = [];
  private readonly byKey = new Map<string, Series>();
  private readonly times: Float64Array;
  private count = 0;
  private nextAt: number;

  constructor(
    private readonly world: World,
    readonly options: RecorderOptions = DEFAULT_RECORDER,
  ) {
    const capacity = Math.ceil(options.retentionSeconds / options.sampleSeconds) + 1;
    this.times = new Float64Array(capacity);
    for (const entity of world.index.all()) {
      for (const metric of RECORDED_METRICS[entity.kind] ?? []) {
        const s = {
          id: entity.id,
          metric,
          read: readerFor(entity.kind, metric),
          values: new Float32Array(capacity),
        };
        this.all.push(s);
        this.byKey.set(`${entity.id}|${metric}`, s);
      }
    }
    this.nextAt = Math.ceil(world.time() / options.sampleSeconds) * options.sampleSeconds;
  }

  /** Take every sample that is due at the world's current time (call after each physics step). */
  sampleIfDue(): void {
    const now = this.world.time();
    if (now < this.nextAt) return;
    const slot = this.count % this.times.length;
    this.times[slot] = now;
    for (const s of this.all) s.values[slot] = s.read(this.world, s.id);
    this.count++;
    this.nextAt = (Math.floor(now / this.options.sampleSeconds) + 1) * this.options.sampleSeconds;
  }

  /** Samples [t, value] of `metric` on `entityId` at or after simulated time `sinceT`. */
  series(entityId: string, metric: string, sinceT: number): Array<[number, number]> {
    const s = this.byKey.get(`${entityId}|${metric}`);
    if (!s) return [];
    const kept = Math.min(this.count, this.times.length);
    const out: Array<[number, number]> = [];
    for (let i = this.count - kept; i < this.count; i++) {
      const slot = i % this.times.length;
      const t = this.times[slot] as number;
      if (t >= sinceT) out.push([t, s.values[slot] as number]);
    }
    return out;
  }

  /** The metrics recorded for an entity. */
  metricsOf(entityId: string): string[] {
    return this.all.filter((s) => s.id === entityId).map((s) => s.metric);
  }

  /** Approximate memory held by the buffers, for capacity planning (REQ-032). */
  get bytes(): number {
    return this.times.byteLength + this.all.reduce((sum, s) => sum + s.values.byteLength, 0);
  }

  get samples(): number {
    return this.count;
  }

  get seriesCount(): number {
    return this.all.length;
  }
}

export interface MetricSeries {
  readonly entityId: string;
  readonly metric: string;
  readonly points: ReadonlyArray<readonly [number, number]>;
}
