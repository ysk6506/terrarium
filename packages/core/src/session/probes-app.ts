/**
 * The ways back that are the application layer's own (REQ-100): take a flapping backend out of the balancer, close a breaker,
 * roll the mesh configuration back, restart the session store, the sidecar or the control plane, send the traffic to one
 * region. A scripted agent tries each and returns the first that brings every service back.
 */
import { TOOL_SPECS } from "@terrarium/core/tools";
import type { RecoveryPath } from "./probes";
import { Session, type SessionConfig } from "./session";

type Config = Omit<SessionConfig, "tools" | "seed"> & { readonly seed?: number };

const SETTLE_SECONDS = 150;
const ALL_TOOLS = TOOL_SPECS.map((t) => t.name);

const open = (config: Config): Session => {
  const session = Session.create({ ...config, tools: ALL_TOOLS, seed: config.seed ?? 1 });
  session.start();
  return session;
};

const ids = (s: Session, kind: string): string[] => {
  const r = s.call("list_entities", { kind });
  return r.ok ? (r.data as Array<{ id: string }>).map((e) => e.id) : [];
};

const hostOf = (s: Session, id: string): string | undefined =>
  (s.call("get_entity", { id }).data as { connections?: Record<string, string[]> } | undefined)
    ?.connections?.hosted_on_to?.[0];

const troubled = (s: Session): boolean => {
  const r = s.call("list_services", {});
  return r.ok && (r.data as Array<{ status: string }>).some((x) => x.status !== "healthy");
};

/** Restart a process on the host of every entity of a kind (the session store, the sidecar, the control plane). */
function restartOn(kind: string, unit: string): (s: Session) => void {
  return (s) => {
    for (const id of ids(s, kind)) {
      // a sidecar stands next to an instance: its host is the instance's host
      const first = hostOf(s, id);
      const host = first && ids(s, "app_instance").includes(first) ? hostOf(s, first) : first;
      if (host) s.call("run_command", { host, cmd: `systemctl restart ${unit}` });
    }
  };
}

/** `n` is which candidate to try when the way needs a pick (the backend to take out): each is tried alone. */
type Try = readonly [NonNullable<RecoveryPath["how"]>, string, (s: Session, n: number) => void];

const TRIES: readonly Try[] = [
  [
    "lb_drain",
    "흔들리는 백엔드를 로드 밸런서에서 빼면 돌아와요",
    (s, n) => {
      const backend = ids(s, "app_instance")[n];
      if (backend) s.call("lb_drain", { backend });
    },
  ],
  [
    "breaker_reset",
    "서킷 브레이커를 리셋하면 돌아와요",
    (s) => {
      for (const link of ids(s, "circuit_breaker")) s.call("breaker_reset", { link });
    },
  ],
  ["mesh_rollback", "메시 설정을 되돌리면 돌아와요", (s) => void s.call("mesh_rollback", {})],
  [
    "run_command",
    "세션 저장소·사이드카·컨트롤 플레인을 다시 시작하면 돌아와요",
    (s) => {
      restartOn("mesh_control", "istiod")(s);
      restartOn("session_store", "redis-server")(s);
      restartOn("mesh_sidecar", "envoy")(s);
      s.call("mesh_rollback", {});
    },
  ],
  [
    "region_failover",
    "트래픽을 멀쩡한 리전 하나로 옮기면 돌아와요",
    (s) => {
      for (const region of ids(s, "region")) if (s.call("region_failover", { region }).ok) return;
    },
  ],
];

export function appPath(config: Config): RecoveryPath | undefined {
  const world = open(config).world.index;
  if (world.ofKind("load_balancer").length + world.ofKind("mesh_control").length === 0)
    return undefined;
  const backends = ids(open(config), "app_instance").length;
  for (const [how, note, act] of TRIES) {
    for (let n = 0; n < (how === "lb_drain" ? backends : 1); n++) {
      const s = open(config);
      if (!troubled(s)) return undefined;
      act(s, n);
      s.call("wait", { seconds: SETTLE_SECONDS });
      if (!troubled(s)) return { applicable: true, ok: true, how, note };
    }
  }
  return undefined;
}
