/**
 * What is the matter in a room, for the people in it (REQ-074, ADR-0078): the alarms of the world and
 * the runs at work, narrowed to the racks and machines of one room. An alarm on a server counts for the
 * rack it stands in. Pure: the same inputs always give the same answer.
 */
import type { Alarm, BlueprintIndex } from "@terrarium/core/world";
import { isIdle, type PartnerWork, type Worker } from "../activity";
import type { Crew, CrewActivity, CrewAlarm, CrewPartner, CrewWorld } from "./crew";

/** The rack or machine of this room that an entity is, or stands in; undefined when it is not in this room. */
export function deviceIn(index: BlueprintIndex, crew: Crew, id: string): string | undefined {
  if (crew.devices.has(id)) return id;
  for (const up of index.ancestors(id)) {
    if (crew.devices.has(up.id)) return up.id;
    if (up.kind === "room") return undefined;
  }
  return undefined;
}

export interface TroubleInput {
  /** The alarms active at the moment shown. */
  readonly alarms: readonly Pick<Alarm, "entityId" | "severity" | "since">[];
  /** Simulated seconds at the moment shown. */
  readonly t: number;
  readonly workers: readonly Worker[];
  /** Other teams at work on machines (REQ-093). */
  readonly partners?: readonly PartnerWork[];
  /** The page's clock, ms, for telling a quiet run from a busy one. */
  readonly now: number;
}

/** The machine each run that is busy acted on last. */
function activityOf(index: BlueprintIndex, crew: Crew, input: TroubleInput): CrewActivity[] {
  return input.workers.flatMap((w): CrewActivity[] => {
    const busy = w.at && w.last?.effect === "act" && !isIdle(w, input.now);
    const device = busy && w.at ? deviceIn(index, crew, w.at) : undefined;
    return device ? [{ device, runId: w.runId }] : [];
  });
}

/** One entry for each machine that has an alarm, and one for each machine a run acted on last. */
export function troubleOf(
  index: BlueprintIndex,
  crew: Crew,
  input: TroubleInput,
): Pick<CrewWorld, "alarms" | "activity" | "partners"> {
  const alarms = new Map<string, CrewAlarm>();
  for (const a of input.alarms) {
    const device = deviceIn(index, crew, a.entityId);
    if (!device) continue;
    const old = alarms.get(device);
    const severity =
      a.severity === "critical" || old?.severity === "critical" ? "critical" : "warning";
    alarms.set(device, {
      device,
      severity,
      ageS: Math.max(old?.ageS ?? 0, Math.max(0, input.t - a.since)),
    });
  }
  const activity = activityOf(index, crew, input);
  const partners = partnersOf(index, crew, input.partners ?? []);
  return { alarms: [...alarms.values()], activity, ...(partners.length > 0 ? { partners } : {}) };
}

/** The machines of this room that an engineer of another team comes to (work at a console brings nobody). */
function partnersOf(
  index: BlueprintIndex,
  crew: Crew,
  work: readonly PartnerWork[],
): CrewPartner[] {
  return work.flatMap((p): CrewPartner[] => {
    const device = p.onSite ? deviceIn(index, crew, p.device) : undefined;
    if (!device) return [];
    const who = p.who === "vendor" ? "벤더" : p.team;
    return [
      { device, replacing: p.replacing, text: `${p.replacing ? "교체 중" : "작업 중"} · ${who}` },
    ];
  });
}

/** A signature that changes when the matter changes, so a new state starts a new walk. */
export const troubleKey = (w: Pick<CrewWorld, "alarms" | "activity" | "partners">): string =>
  [
    ...(w.partners ?? []).map((p) => `+${p.device}`),
    ...w.alarms.map((a) => `${a.device}:${a.severity}:${a.ageS > 120 ? "long" : "new"}`),
    ...w.activity.map((a) => `*${a.device}`),
  ]
    .sort()
    .join("|");
