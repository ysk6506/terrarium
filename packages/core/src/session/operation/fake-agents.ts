/**
 * Four stand-in agents for checking that an operation measures what it should (ADR-0094): one that does nothing, one
 * that only looks every five minutes, one that looks and fixes, and one that looks every minute from three angles.
 * They run against a session with a simulated wall clock, so a test needs no timers. Fixing is a stand-in for the
 * agent's repair tools (it removes the faults that are up), so the discrimination does not depend on one tool's physics.
 */
import type { Session } from "../session";

export interface FakeAgent {
  readonly name: string;
  /** Called once per simulated real second while the run goes on. */
  tick(s: Session): void;
}

interface Shape {
  readonly name: string;
  /** World seconds between two looks; none for an agent that never looks. */
  readonly every?: number;
  readonly fixes: boolean;
  /** Extra calls on each look (the angle count). */
  readonly extra?: readonly string[];
}

/** The stand-in for the agent's repair tools: every fault that is up goes away. */
function fixEverything(s: Session): void {
  for (const f of s.world.faults())
    if (f.id.startsWith("gen:")) s.world.apply({ type: "fault.remove", faultId: f.id }, "tool:fix");
}

function agent(shape: Shape): FakeAgent {
  let cursor = 0;
  let nextLook = 0;
  let fixAt: number | undefined;
  return {
    name: shape.name,
    tick(s) {
      const now = s.worldTime;
      if (shape.fixes && fixAt !== undefined && now >= fixAt) {
        fixEverything(s);
        fixAt = undefined;
      }
      if (shape.every === undefined || now < nextLook) return;
      nextLook = now + shape.every;
      const seen = s.call("events_since", { cursor });
      const data = seen.data as { cursor: number; events: Array<{ type: string }> } | undefined;
      if (data) cursor = data.cursor;
      for (const tool of shape.extra ?? []) s.call(tool, {});
      if (shape.fixes && data?.events.some((e) => e.type === "alarm_raised")) fixAt ??= now + 60;
    },
  };
}

export const makeFakeAgents = (): Record<"idle" | "watcher" | "fixer" | "frantic", FakeAgent> => ({
  idle: agent({ name: "아무것도 안 함", fixes: false }),
  watcher: agent({ name: "5분마다 조회만", every: 300, fixes: false }),
  fixer: agent({ name: "5분마다 조회 + 복구", every: 300, fixes: true }),
  frantic: agent({
    name: "1분마다 폭주",
    every: 60,
    fixes: true,
    extra: ["list_alarms", "service_status"],
  }),
});

/** Play a session with a simulated wall clock of one tick per second until it ends. */
export function playShift(s: Session, who: FakeAgent, maxElapsed = 100_000): void {
  for (let elapsed = 1; s.status === "running" && elapsed < maxElapsed; elapsed++) {
    s.sync(elapsed);
    if (s.status === "running") who.tick(s);
  }
}
