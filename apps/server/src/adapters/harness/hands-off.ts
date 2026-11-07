/**
 * The rule every built-in agent keeps before it changes anything (REQ-108, ADR-0131): when the cluster is already
 * recovering by itself, do not touch it. A hot site that switches over after ninety seconds, a database that promotes a
 * replica, a scheduler that restarts a failed job: an agent that moves the same service meanwhile is not helping, it
 * only risks making things worse, and scoring (REQ-095, REQ-097) does not count what the cluster did as the agent's work.
 *
 * It is detected from what the agent can see, nothing more:
 *   1  the status tools that name a countdown ("promotesInSeconds", "autoRestartInSeconds", ...) or a move in progress
 *      (`site_status`: a plan that moves by itself while a site is gone, or a phase of failing over)
 *   2  `events_since`: an `auto_recovery` event, which the session shows for everything the world did on its own
 * and it waits (`wait`, a minute at a time, up to ten times) until neither is there. Afterwards the caller looks
 * again at what is still broken, and a service that came back needs no change at all.
 */
import type { ToolEndpoint } from "@terrarium/core/experiments";

export interface AlarmRow {
  readonly entityId: string;
  readonly code: string;
  readonly severity: "warning" | "critical";
}

/** "link_down.l-7" → "link_down". */
export const codeOf = (a: Pick<AlarmRow, "code">): string => a.code.split(".")[0] as string;

export const has = (tools: ToolEndpoint, name: string): boolean =>
  tools.specs.some((s) => s.name === name);

export async function data<T>(
  tools: ToolEndpoint,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T | undefined> {
  if (!has(tools, name)) return undefined;
  const r = await tools.call(name, args);
  return r.ok ? (r.data as T) : undefined;
}

export const alarmsOf = async (tools: ToolEndpoint): Promise<AlarmRow[]> =>
  (await data<AlarmRow[]>(tools, "list_alarms")) ?? [];

/** Seconds of world time one wait lasts, and how many waits the agent gives an automatic recovery before it stops. */
export const HOLD_STEP_S = 60;
export const SETTLE_S = 60;
export const MAX_HOLDS = 10;

/** The keys of the status tools that count down to something the system does by itself. */
const COUNTDOWNS = new Set([
  "promotesInSeconds",
  "halfOpenInSeconds",
  "autoRemoveInSeconds",
  "autoRestartInSeconds",
  "autoExtendInSeconds",
]);

function countdownIn(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || typeof value !== "object" || value === null) return undefined;
  for (const [key, inner] of Object.entries(value)) {
    if (COUNTDOWNS.has(key) && typeof inner === "number" && inner > 0) return key;
    const found = countdownIn(inner, depth + 1);
    if (found) return found;
  }
  return undefined;
}

interface SiteStatus {
  readonly sites: ReadonlyArray<{ id: string; status: string }>;
  readonly plans: ReadonlyArray<{
    mode: string;
    servingSite: string;
    phase: string;
    movesByItself: boolean;
    drainedSites?: readonly string[];
  }>;
}

/**
 * A move between sites that is going on, or one a plan that moves by itself has yet to start: the site that serves is
 * gone (hot), or a site that is gone has not been taken out of the rotation yet (active-active).
 */
export function siteMovesByItself(s: SiteStatus): boolean {
  const spare = s.sites.some((x) => x.status !== "down");
  return s.plans.some(
    (p) =>
      p.phase === "failing_over" ||
      p.phase === "failing_back" ||
      (p.movesByItself &&
        spare &&
        p.phase === "idle" &&
        s.sites.some(
          (x) =>
            x.status === "down" &&
            (p.mode === "active" ? !(p.drainedSites ?? []).includes(x.id) : x.id === p.servingSite),
        )),
  );
}

const SITE_CODES = new Set([
  "site_down",
  "site_degraded",
  "wan_down",
  "dr_moving",
  "replication_broken",
  "volume_unavailable",
]);

/** The countdown or move that says the system is recovering by itself, if the alarms point at a layer that does. */
export async function underway(
  tools: ToolEndpoint,
  alarms: readonly AlarmRow[],
): Promise<string | undefined> {
  const codes = new Set(alarms.map(codeOf));
  if ([...codes].some((c) => SITE_CODES.has(c))) {
    const site = await data<SiteStatus>(tools, "site_status");
    if (site && siteMovesByItself(site)) return "사이트가 스스로 넘어가는 중이에요";
  }
  if ([...codes].some((c) => c.startsWith("job_") || c.startsWith("gpu_"))) {
    const jobs = await data<unknown>(tools, "job_status");
    if (countdownIn(jobs)) return "스케줄러가 스스로 잡을 다시 올리는 중이에요";
  }
  if ([...codes].some((c) => c.startsWith("db_"))) {
    for (const a of alarms.filter((x) => codeOf(x).startsWith("db_")).slice(0, 2)) {
      const db = await data<unknown>(tools, "db_status", { cluster: a.entityId });
      if (countdownIn(db)) return "데이터베이스가 스스로 승격하는 중이에요";
    }
  }
  return undefined;
}

/** What waiting looked like, for the answer the agent gives. */
export interface Held {
  /** Whether the agent had to wait for the system. */
  readonly waited: boolean;
  /** How many times it waited. */
  readonly rounds: number;
}

/**
 * Wait while the system recovers by itself. One `Watch` per run keeps the cursor of `events_since`, so an automatic
 * recovery is waited out once and a later look only reacts to what is new.
 */
export class Watch {
  private cursor = 0;

  constructor(
    private readonly tools: ToolEndpoint,
    private readonly signal: AbortSignal,
  ) {}

  /** New `auto_recovery` events since the last look. */
  private async autoEvents(): Promise<number> {
    const news = await data<{ cursor: number; events: Array<{ type: string }> }>(
      this.tools,
      "events_since",
      { cursor: this.cursor },
    );
    this.cursor = news?.cursor ?? this.cursor;
    return news?.events.filter((e) => e.type === "auto_recovery").length ?? 0;
  }

  /** Wait until nothing is recovering by itself; `alarms` tell which layers to ask. */
  async holdOff(alarms: readonly AlarmRow[]): Promise<Held> {
    let rounds = 0;
    while (rounds < MAX_HOLDS && !this.signal.aborted && has(this.tools, "wait")) {
      const going = await underway(this.tools, alarms);
      if (going) {
        await this.tools.call("wait", { seconds: HOLD_STEP_S });
        rounds++;
        continue;
      }
      if ((await this.autoEvents()) === 0) break;
      await this.tools.call("wait", { seconds: SETTLE_S });
      rounds++;
    }
    return { waited: rounds > 0, rounds };
  }
}
