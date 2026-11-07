/**
 * The tools of the application layer (REQ-100, ADR-0121): look at a load balancer and its backends, take a backend out of the
 * rotation and put it back, look at the circuit breakers on the calls between services and reset one, look at the service
 * mesh and roll its configuration back, send all traffic to one region. They live in a file of their own and are added to
 * the catalog at its end. All belong to the service/OS team (domains.ts). The load balancer tools are a real team's daily
 * tools (`common`); the breaker, mesh and region tools are owned by fewer teams (`rare`).
 */
import type { JsonSchema, ToolSpec } from "./catalog";
import type { ToolDoc } from "./docs";

type AppSpec = Omit<ToolSpec, "realism" | "description" | "area">;

const obj = (properties: JsonSchema["properties"], required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
});
const str = (description: string) => ({ type: "string", description });

export const APP_SPECS: readonly AppSpec[] = [
  {
    name: "lb_status",
    title: "로드 밸런서 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({
      service: str("Service id; leave out to see every load balancer of the world"),
    }),
  },
  {
    name: "lb_drain",
    title: "백엔드 로테이션에서 빼기",
    category: "act",
    mutating: true,
    inputSchema: obj(
      { backend: str("App instance id (a backend of a load balancer) to take out") },
      ["backend"],
    ),
  },
  {
    name: "lb_enable",
    title: "백엔드 로테이션에 되돌리기",
    category: "act",
    mutating: true,
    inputSchema: obj({ backend: str("App instance id that was drained") }, ["backend"]),
  },
  {
    name: "breaker_status",
    title: "서킷 브레이커 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({
      service: str(
        "Only the breakers on the calls of this service (caller or callee); leave out for all",
      ),
    }),
  },
  {
    name: "breaker_reset",
    title: "서킷 브레이커 리셋",
    category: "act",
    mutating: true,
    inputSchema: obj({ link: str("The calls link id (or the breaker id) to close") }, ["link"]),
  },
  {
    name: "mesh_status",
    title: "서비스 메시 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({
      instance: str("Only the sidecar next to this app instance; leave out to see every sidecar"),
    }),
  },
  {
    name: "mesh_rollback",
    title: "메시 설정 되돌리기",
    category: "act",
    mutating: true,
    inputSchema: obj({
      control: str("Mesh control plane id; leave out when the world has one"),
    }),
  },
  {
    name: "region_failover",
    title: "리전으로 트래픽 옮기기",
    category: "act",
    mutating: true,
    inputSchema: obj({ region: str("Region id that gets all the traffic") }, ["region"]),
  },
];

const d = (doc: ToolDoc): ToolDoc => doc;

export const APP_DOCS: Readonly<Record<string, ToolDoc>> = {
  lb_status: d({
    area: "observe",
    realism: "common",
    summary:
      "Each load balancer with its backends: status, which backends are in the rotation, which are failing their health checks or flapping, and for a global balancer the regions in the rotation.",
    use: "a service answers some requests and fails others, an alarm names a load balancer, or you want to know which replica is the bad one.",
    notUse:
      "you want the state of the process on a host (use run_command) or the calls between services (use breaker_status).",
    example: '{"service":"svc-portal"}',
    cost: "low",
    costWhy: "one read of the balancer",
    details:
      "A balancer takes a backend out after 3 failed health checks and puts it back after 2 good ones; `autoRemoveInSeconds` says how long a failing backend stays in. A drained backend stays out whatever its checks say.",
  }),
  lb_drain: d({
    area: "act",
    realism: "common",
    summary:
      "Take one backend out of the load balancer's rotation. It gets no new requests and stays out until lb_enable, whatever its health checks say.",
    use: "lb_status shows a backend that flaps or answers errors and you want requests off it while it is looked at.",
    notUse:
      "the backend is already dead (the balancer takes it out by itself after 3 failed checks) or it is the last one in the rotation.",
    example: '{"backend":"app-portal-1"}',
    cost: "low",
    costWhy: "one backend",
    details: "Draining does not fix the backend, it only stops it from hurting the service.",
  }),
  lb_enable: d({
    area: "act",
    realism: "common",
    summary:
      "Give a drained backend back to the load balancer's health checks. It re-enters the rotation after 2 good checks.",
    use: "the backend you drained is fixed.",
    notUse: "the backend was not drained, or it is still failing (it would flap back in).",
    example: '{"backend":"app-portal-1"}',
    cost: "low",
    costWhy: "one backend",
  }),
  breaker_status: d({
    area: "observe",
    realism: "rare",
    summary:
      "The circuit breakers on the calls between services: caller, callee, closed/open/half-open, times it opened, how long it stays open, and whether the call is critical.",
    use: "a service is slow although its own hosts are fine, or lists a service it calls in its reasons.",
    notUse: "the trouble is a backend of one service (use lb_status).",
    example: '{"service":"svc-portal"}',
    cost: "low",
    costWhy: "one read of the breakers",
    details:
      "A breaker opens after 5 failures in a row and tries one call after its reset time (half-open). `stuck: true` means a fault holds it open whatever the callee does.",
  }),
  breaker_reset: d({
    area: "act",
    realism: "rare",
    summary:
      "Close a circuit breaker by hand. A breaker stuck open is freed; if the callee is still down it opens again after a few failures.",
    use: "breaker_status shows a breaker open (or stuck) while the callee is well.",
    notUse: "the callee is down (the breaker is doing its job) or the breaker is closed.",
    example: '{"link":"call-portal-license"}',
    cost: "low",
    costWhy: "one breaker",
  }),
  mesh_status: d({
    area: "observe",
    realism: "rare",
    summary:
      "The service mesh: the control plane (up or down, configuration revision, retry setting) and the sidecar next to each replica (up or down, mTLS, revision).",
    use: "calls between services are slow or multiplied, a sidecar alarm is up, or you changed the mesh configuration.",
    notUse: "the mesh is not in the world, or the trouble is a load balancer (use lb_status).",
    example: '{"instance":"app-portal-1"}',
    cost: "low",
    costWhy: "one read of the mesh",
    details:
      "A control plane that is down does not stop traffic: sidecars keep the configuration they have. It only cannot push or roll back.",
  }),
  mesh_rollback: d({
    area: "act",
    realism: "rare",
    summary:
      "Put the mesh back to its previous configuration (the one before the last push). Ends a retry storm caused by a bad retry setting.",
    use: "mesh_status shows the retry setting aggressive and calls multiplied.",
    notUse:
      "the control plane is down (restart istiod on its host first) or the setting is already as designed.",
    example: '{"control":"mesh-control"}',
    cost: "low",
    costWhy: "one configuration push",
  }),
  region_failover: d({
    area: "act",
    realism: "rare",
    summary:
      "Send all traffic to one region. The global load balancer stops moving traffic by itself; users of the region it leaves log in again.",
    use: "a region is down and you do not want to wait for the global balancer to notice (about 5 minutes), or a region's data copy trails and reads there are stale.",
    notUse: "the target region is down itself, or there is no global load balancer.",
    example: '{"region":"region-b"}',
    cost: "medium",
    costWhy: "sessions of the region left are lost",
    details:
      "The region that was down is the cloud team's to bring back (escalate). Traffic stays pinned to the region you chose until you choose the other.",
  }),
};
