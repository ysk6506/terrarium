/**
 * `curl -I http://<service>/healthz` for a service behind a load balancer (REQ-100): the answer is what the balancer
 * says about the backends, as a health endpoint of a balancer does (status code and a header with the count).
 */
import { appInstancesOf, lbOf } from "../app";
import type { WorldReader } from "../world";

export interface HealthReply {
  readonly code: string;
  readonly headers: string[];
  readonly body: string;
}

/** The balancer's health answer for a service, or undefined when no balancer stands in front of it. */
export function lbHealthReply(world: WorldReader, serviceId: string): HealthReply | undefined {
  const lb = lbOf(world.index, serviceId);
  if (!lb) return undefined;
  const s = world.stateAs(lb.id, "load_balancer");
  const backends = appInstancesOf(world.index, serviceId).map((e) =>
    world.stateAs(e.id, "app_instance"),
  );
  const inRotation = backends.filter((b) => b.inRotation).length;
  const healthy = backends.filter((b) => b.status === "ok").length;
  const head = [
    `X-LB: ${lb.id}`,
    `X-Backends-Healthy: ${healthy}/${backends.length}`,
    `X-Backends-In-Rotation: ${inRotation}/${backends.length}`,
  ];
  const code = s.status === "down" ? "503 Service Unavailable" : "200 OK";
  return {
    code,
    headers: [
      `HTTP/1.1 ${code}`,
      "Server: haproxy",
      "Content-Type: application/json",
      ...head,
      ...(s.status === "degraded" ? ["X-LB-Status: degraded"] : []),
    ],
    body: `{"status":"${s.status === "ok" ? "ok" : s.status}"}`,
  };
}
