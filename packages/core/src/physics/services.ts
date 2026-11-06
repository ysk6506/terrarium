/**
 * Services follow the equipment under them (REQ-086, ADR-0091). Each step a service's status is read off its places
 * (`serviceHealth`), and the cost of not running adds up: money for a request or stateful service, queued work for a
 * batch one. The queue drains faster than it filled once the service runs again.
 */
import {
  type Alarm,
  SLOW_HARM_SHARE,
  serviceDef,
  serviceHealth,
  type World,
} from "@terrarium/core/world";
import type { Draft } from "./alarm-scan";

/** Work is caught up at this many times the rate it piled up. */
const CATCH_UP = 2;
const HOUR = 3600;

export function updateServices(world: World, dt: number): void {
  for (const entity of world.index.ofKind("service")) {
    const state = world.stateAs(entity.id, "service");
    const health = serviceHealth(world, entity.id);
    const def = serviceDef(entity);
    if (health.status !== state.status) {
      if (health.status === "healthy") delete state.since;
      else state.since ??= world.time();
    }
    state.status = health.status;
    state.reasons = [...health.reasons];
    const share = health.status === "down" ? 1 : health.status === "degraded" ? SLOW_HARM_SHARE : 0;
    state.lostKrw = Math.round(state.lostKrw + ((def.harm.perHourKrw ?? 0) * share * dt) / HOUR);
    if (def.queue) {
      const rate = def.queue.perHour;
      const change = share > 0 ? rate * share : -rate * CATCH_UP;
      state.backlog = Math.max(0, Math.round(state.backlog + (change * dt) / HOUR));
    }
  }
}

const KIND: Alarm["kind"] = "service";

/** An alarm for each service that is not healthy: critical when it stopped, a warning when it slowed. */
export function serviceAlarms(world: World, out: Draft[]): void {
  for (const entity of world.index.ofKind("service")) {
    const state = world.stateAs(entity.id, "service");
    if (state.status === "healthy") continue;
    const why = state.reasons[0] ? ` — ${state.reasons[0]}` : "";
    out.push({
      entityId: entity.id,
      code: state.status === "down" ? "service_down" : "service_degraded",
      severity: state.status === "down" ? "critical" : "warning",
      kind: KIND,
      message: `${entity.name} ${state.status === "down" ? "멈췄어요" : "느려졌어요"}${why}`,
    });
  }
}
