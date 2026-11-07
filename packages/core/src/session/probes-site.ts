/**
 * The ways back that are the site and DR layer's own (REQ-106): move the services to the other site, restart the nodes of
 * the ring, pick a zone of the managed database and extend its storage, restart the copy agent. A scripted agent tries each
 * and returns the first that brings every service back. A move of a whole site takes as long as the plan says, so the wait
 * after it follows the time the tool promised.
 */
import type { ScenarioDoc } from "@terrarium/core/scenario";
import { TOOL_SPECS } from "@terrarium/core/tools";
import { FLAP_PERIOD_S, SILENT_SITE_FAULTS } from "@terrarium/core/world";
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

const troubled = (s: Session): boolean => {
  const r = s.call("list_services", {});
  return r.ok && (r.data as Array<{ status: string }>).some((x) => x.status !== "healthy");
};

/** How long the last move said it would take, so the wait that follows is long enough. */
const etaOf = (r: { ok: boolean; data?: unknown }): number =>
  r.ok ? Number((r.data as { etaSeconds?: number } | undefined)?.etaSeconds ?? 0) : 0;

/** What a way needs in the world, how long to wait after it, and what it does. */
interface Try {
  readonly how: NonNullable<RecoveryPath["how"]>;
  readonly needs: string;
  readonly note: string;
  /** Seconds to wait after the act besides the time the tool promised; a way that only stops a repeat must outlast the repeat. */
  readonly settle: number;
  readonly act: (s: Session) => number;
}

const TRIES: readonly Try[] = [
  {
    how: "dr_failover",
    needs: "dr_plan",
    note: "서비스를 복구 사이트로 전환하면 돌아와요",
    settle: SETTLE_SECONDS,
    act: (s) => {
      let wait = 0;
      for (const site of ids(s, "dr_site")) {
        // twice: a move that stopped half-way is finished by pressing it again
        for (let i = 0; i < 2; i++) {
          const r = s.call("dr_failover", { site });
          wait = Math.max(wait, etaOf(r));
          if (r.ok && i === 0) s.call("wait", { seconds: Math.min(wait, 600) + 5 });
        }
      }
      return wait;
    },
  },
  {
    how: "db_node_restart",
    needs: "db_node",
    note: "멈춘 합의 DB 노드를 다시 시작하면 돌아와요",
    settle: SETTLE_SECONDS,
    act: (s) => {
      for (const node of ids(s, "db_node")) s.call("db_node_restart", { node });
      return 0;
    },
  },
  {
    how: "db_managed_scale_storage",
    needs: "db_managed",
    note: "관리형 DB의 저장소를 늘리면 돌아와요",
    settle: SETTLE_SECONDS,
    act: (s) => {
      for (const db of ids(s, "db_managed")) s.call("db_managed_scale_storage", { db });
      return 0;
    },
  },
  {
    how: "db_managed_failover",
    needs: "db_managed",
    note: "관리형 DB의 안정된 영역을 골라 고정하면 돌아와요",
    settle: SETTLE_SECONDS,
    act: (s) => {
      for (const db of ids(s, "db_managed"))
        for (const az of ["1", "2"]) if (s.call("db_managed_failover", { db, az }).ok) break;
      return 0;
    },
  },
];

/** How long the services must stay well to count as back: longer than the managed database's repeat (a flapping one comes back). */
const STEADY_S = FLAP_PERIOD_S + 60;

/** Whether the services stay well for the whole of `STEADY_S`, looked at every half minute. */
function steady(s: Session): boolean {
  for (let waited = 0; waited <= STEADY_S; waited += 30) {
    if (troubled(s)) return false;
    s.call("wait", { seconds: 30 });
  }
  return true;
}

export function sitePath(config: Config): RecoveryPath | undefined {
  const kinds = new Set(config.blueprint.entities.map((e) => e.kind));
  for (const t of TRIES) {
    if (!kinds.has(t.needs as never)) continue;
    const s = open(config);
    if (!troubled(s)) return undefined;
    const eta = t.act(s);
    s.call("wait", { seconds: Math.min(eta, 6 * 3600) + t.settle });
    if (steady(s)) return { applicable: true, ok: true, how: t.how, note: t.note };
  }
  return undefined;
}

/** Whether every fault of a scenario is one that leaves the services alone, so no service is hurt and none needs moving. */
export function onlySilentFaults(scenario: ScenarioDoc): boolean {
  const faults = scenario.nodes.filter((n) => n.type === "inject_fault");
  return (
    faults.length > 0 &&
    faults.every((n) => SILENT_SITE_FAULTS.includes(String(n.params.faultType)))
  );
}
