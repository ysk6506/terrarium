/**
 * The ways back that are the accelerator layer's own (REQ-107): reset a GPU, let the scheduler leave a node and start the job
 * again, run the pool again, bring the scheduler back, start the standby pump of a CDU. A scripted agent tries each and
 * returns the first that brings every service back.
 */
import { TOOL_SPECS } from "@terrarium/core/tools";
import type { RecoveryPath } from "./probes";
import { Session, type SessionConfig } from "./session";

type Config = Omit<SessionConfig, "tools" | "seed"> & { readonly seed?: number };

/** A job restarts from its checkpoint five minutes after it fails, so the settling takes longer than elsewhere. */
const SETTLE_SECONDS = 420;
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

const troubled = (s: Session): boolean => {
  const r = s.call("list_services", {});
  return r.ok && (r.data as Array<{ status: string }>).some((x) => x.status !== "healthy");
};

const serverOf = (gpu: string): string => gpu.replace(/-gpu\d+$/, "");
const hostOf = (s: Session, id: string): string | undefined =>
  (s.call("get_entity", { id }).data as { connections?: Record<string, string[]> } | undefined)
    ?.connections?.hosted_on_to?.[0];

/** `n` is which candidate to try when the way needs a pick (the GPU to reset, the node to leave). */
type Try = readonly [
  NonNullable<RecoveryPath["how"]>,
  string,
  number,
  (s: Session, n: number) => void,
];

const resume = (s: Session) => {
  for (const job of ids(s, "training_job")) s.call("job_resume", { job });
};

const tries = (s: Session): readonly Try[] => [
  [
    "gpu_reset",
    "떨어진 GPU를 리셋하면 돌아와요",
    ids(s, "gpu").length,
    (x, n) => {
      const gpu = ids(x, "gpu")[n];
      if (gpu) x.call("gpu_reset", { server: serverOf(gpu), gpu });
      resume(x);
    },
  ],
  [
    "node_drain",
    "고장 난 노드를 빼고 잡을 이어 주면 돌아와요",
    ids(s, "gpu").length,
    (x, n) => {
      const gpu = ids(x, "gpu")[n];
      if (gpu) x.call("node_drain", { node: serverOf(gpu) });
      resume(x);
    },
  ],
  ["job_resume", "잡을 이어 가면 돌아와요", 1, (x) => resume(x)],
  [
    "pool_scale",
    "풀을 다시 나누면 돌아와요",
    1,
    (x) => {
      for (const pool of ids(x, "inference_pool")) x.call("pool_scale", { pool, replicas: 16 });
    },
  ],
  [
    "run_command",
    "스케줄러가 선 호스트에서 slurmctld를 다시 시작하면 돌아와요",
    1,
    (x) => {
      for (const sched of ids(x, "job_scheduler")) {
        const host = hostOf(x, sched);
        if (host) x.call("run_command", { host, cmd: "systemctl restart slurmctld" });
      }
      resume(x);
    },
  ],
  [
    "cdu_pump_switch",
    "CDU의 예비 펌프를 돌리면 돌아와요",
    1,
    (x) => {
      for (const cdu of ids(x, "cdu")) x.call("cdu_pump_switch", { cdu });
    },
  ],
];

export function accelPath(config: Config): RecoveryPath | undefined {
  const probe = open(config);
  if (ids(probe, "gpu").length === 0 && ids(probe, "cdu").length === 0) return undefined;
  for (const [how, note, count, act] of tries(probe)) {
    for (let n = 0; n < count; n++) {
      const s = open(config);
      if (!troubled(s)) return undefined;
      act(s, n);
      s.call("wait", { seconds: SETTLE_SECONDS });
      if (!troubled(s)) return { applicable: true, ok: true, how, note };
    }
  }
  return undefined;
}
