/**
 * "알람마다 깨우기" (ADR-0094 item 4): an operation experiment variable. With it on, every new alarm is pushed to a
 * harness that can take it as a short summary; off (the default), the world pushes nothing and the agent must pull.
 */
import type { AlarmWake } from "@terrarium/core/experiments";
import type { RunEvent } from "@terrarium/core/world";

/** What a new alarm says in one line. */
export function alarmSummary(e: RunEvent): string | undefined {
  if (e.kind !== "world" || e.command.type !== "alarm.raise") return undefined;
  const { alarm } = e.command;
  const level = alarm.severity === "critical" ? "심각" : "경고";
  return `[${level}] ${alarm.message} (${alarm.entityId})`;
}

export class AlarmFeed implements AlarmWake {
  private readonly listeners = new Set<(summary: string) => void>();

  subscribe(listener: (summary: string) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Tell the listeners about the alarms among these events. */
  offer(events: readonly RunEvent[]): number {
    let told = 0;
    for (const e of events) {
      const text = alarmSummary(e);
      if (!text) continue;
      told++;
      for (const l of this.listeners) l(text);
    }
    return told;
  }
}
