/**
 * What the services a service calls make of it (REQ-100, ADR-0121). A `calls` link says the caller leans on the callee:
 *
 *   - the callee is down      the caller is slowed; stopped when the link is `critical` (it cannot answer without it)
 *   - the callee is slow      the caller is slowed (its own calls wait for the answer)
 *   - the call has a breaker  a callee that is down makes the caller slowed, never stopped: the breaker opens after a few
 *                             failures and the caller answers with a fallback. When the callee is back the breaker tries
 *                             one call (half-open) and closes by itself. A breaker that is open (tripped, or stuck by a
 *                             fault) keeps the caller slowed even when the callee is well
 *
 * Calls between workloads of the container layer are drawn and widen the impact range, but their health is the
 * container layer's (a workload with no running pod already stops what leans on it).
 */

import { breakerOfLink, callDef, callsOut } from "./app";
import type { Entity, Link } from "./blueprint";
import type { ServiceStatus } from "./service";
import type { WorldReader } from "./world";

export interface CallsVerdict {
  readonly status: ServiceStatus;
  readonly reasons: readonly string[];
}

/** The status of a callee service, asked of whoever knows (it may itself be waiting on its callees). */
export type CalleeStatus = (serviceId: string) => ServiceStatus;

function linkVerdict(
  world: WorldReader,
  link: Link,
  calleeStatus: CalleeStatus,
): { to: ServiceStatus; why: string } | undefined {
  const index = world.index;
  const callee = index.find(link.to);
  if (callee?.kind !== "service") return undefined;
  const breaker = breakerOfLink(index, link.id);
  const mode = breaker ? world.stateAs(breaker.id, "circuit_breaker") : undefined;
  const theirs = calleeStatus(callee.id);
  if (mode && mode.mode !== "closed")
    return {
      to: "degraded",
      why: `${callee.name} 호출을 서킷 브레이커가 막고 있어요(${mode.mode === "open" ? "열림" : "반열림"}${mode.stuck ? ", 열린 채 굳었어요" : ""}) — 대체 응답만 가요`,
    };
  if (theirs === "down")
    return {
      to: breaker || !callDef(link).critical ? "degraded" : "down",
      why: `${callee.name}가 멈춰서 호출이 시간 초과돼요`,
    };
  if (theirs === "degraded")
    return { to: "degraded", why: `${callee.name}가 느려서 응답을 기다려요` };
  return undefined;
}

export function callsHealth(
  world: WorldReader,
  service: Entity,
  calleeStatus: CalleeStatus,
): CallsVerdict {
  const out = callsOut(world.index, service.id);
  let status: ServiceStatus = "healthy";
  const reasons: string[] = [];
  for (const link of out) {
    const v = linkVerdict(world, link, calleeStatus);
    if (!v) continue;
    reasons.push(v.why);
    if (v.to === "down" || status === "healthy") status = v.to;
  }
  return { status, reasons };
}
