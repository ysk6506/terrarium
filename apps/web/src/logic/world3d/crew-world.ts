/**
 * What is the matter in a room, for the people in it (REQ-074, ADR-0078): the alarms of the world and
 * the runs at work, narrowed to the racks and machines of one room. An alarm on a server counts for the
 * rack it stands in. Pure: the same inputs always give the same answer.
 */
import type { Alarm, BlueprintIndex } from "@terrarium/core/world";
import { isIdle, type Worker } from "../activity";
import type { Crew, CrewActivity, CrewAlarm, CrewWorld } from "./crew";

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
  /** The page's clock, ms, for telling a quiet run from a busy one. */
  readonly now: number;
}

/** One entry for each machine that has an alarm, and one for each machine a run acted on last. */
export function troubleOf(
  index: BlueprintIndex,
  crew: Crew,
  input: TroubleInput,
): Pick<CrewWorld, "alarms" | "activity"> {
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
  const activity: CrewActivity[] = [];
  for (const w of input.workers) {
    const device =
      w.at && w.last?.effect === "act" && !isIdle(w, input.now)
        ? deviceIn(index, crew, w.at)
        : undefined;
    if (device) activity.push({ device, runId: w.runId });
  }
  return { alarms: [...alarms.values()], activity };
}

/** A signature that changes when the matter changes, so a new state starts a new walk. */
export const troubleKey = (w: Pick<CrewWorld, "alarms" | "activity">): string =>
  [
    ...w.alarms.map((a) => `${a.device}:${a.severity}:${a.ageS > 120 ? "long" : "new"}`),
    ...w.activity.map((a) => `*${a.device}`),
  ]
    .sort()
    .join("|");
