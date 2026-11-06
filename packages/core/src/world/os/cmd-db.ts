/**
 * What the fake shell prints for the database and storage commands of a database host (REQ-095): `pg_isready`,
 * `psql -c "..."` and `multipath -ll`. Like the rest of the shell the output is made from the state in the shape
 * of the real tool; a host without a database does not have the tools.
 */
import type { Entity } from "../blueprint";
import { controllersOf, poolDef, poolOfInstance } from "../db";
import { parseArgs } from "./args";
import { type Cmd, fail, ok, type R, unsupported } from "./types";

/** The database instance that runs on a host, if one does. */
export function instanceOn(c: Pick<Cmd, "world" | "h">): Entity | undefined {
  const { world } = c.h;
  return world.index
    .incoming(c.h.id, "hosted_on")
    .map((l) => world.index.find(l.from))
    .find((e): e is Entity => e?.kind === "db_instance");
}

const missing = (cmd: string): R => fail(`bash: ${cmd}: command not found`, 127);

const SOCKET = "/var/run/postgresql:5432";

export function pgIsReady(c: Cmd): R {
  const e = instanceOn(c);
  if (!e) return missing("pg_isready");
  const s = c.h.world.stateAs(e.id, "db_instance");
  if (s.restore) return { out: `${SOCKET} - rejecting connections\n`, code: 1 };
  if (s.status === "down") return { out: `${SOCKET} - no response\n`, code: 2 };
  return ok(`${SOCKET} - accepting connections\n`);
}

const table = (head: string, value: string): string =>
  ` ${head} \n${"-".repeat(head.length + 2)}\n ${value}\n(1 row)\n`;

const interval = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const hh = String(Math.floor(whole / 3600)).padStart(2, "0");
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}.${String(ms).padStart(3, "0")}`;
};

/** The queries the shell knows; any other is outside the simulation. */
export const PSQL_QUERIES: readonly string[] = [
  "select pg_is_in_recovery()",
  "select now() - pg_last_xact_replay_timestamp()",
  "select 1",
  "select version()",
];

const DOWN =
  'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory\n\tIs the server running locally and accepting connections on that socket?';

interface Answer {
  readonly head: string;
  readonly value: string;
}

function answerOf(q: string, role: string, lagS: number): Answer | undefined {
  if (q === PSQL_QUERIES[0])
    return { head: "pg_is_in_recovery", value: role === "primary" ? "f" : "t" };
  if (q === PSQL_QUERIES[1])
    return { head: "?column?", value: role === "primary" ? "" : interval(lagS) };
  if (q === PSQL_QUERIES[2]) return { head: "?column?", value: "1" };
  if (q === PSQL_QUERIES[3])
    return { head: "version", value: "PostgreSQL 16.2 on x86_64-pc-linux-gnu" };
  return undefined;
}

export function psql(c: Cmd): R {
  const e = instanceOn(c);
  if (!e) return missing("psql");
  const p = parseArgs(c.args, { bool: "tAq", val: "cUdhpf" });
  const sql = p.flags.get("c");
  if (sql === undefined) return unsupported("psql", "대화형 접속과 -f");
  const s = c.h.world.stateAs(e.id, "db_instance");
  if (s.status === "down") return fail(DOWN, 2);
  const q = sql.replace(/\s+/g, " ").trim().replace(/;$/, "").toLowerCase();
  const a = answerOf(q, s.role, s.lagS);
  if (!a)
    return {
      ...unsupported("psql", `질의 "${sql}"`),
      err: `이 질의는 아직 못 해요: ${sql}\n되는 질의: ${PSQL_QUERIES.join(" · ")}`,
    };
  return ok(p.flags.has("t") ? `${a.value}\n` : table(a.head, a.value));
}

const PATHS: ReadonlyArray<readonly [string, string]> = [
  ["5:0:0:1 sdb 8:16", "5:0:0:1"],
  ["6:0:0:1 sdc 8:32", "6:0:0:1"],
];

export function multipath(c: Cmd): R {
  const e = instanceOn(c);
  if (!e) return missing("multipath");
  const { world } = c.h;
  const poolId = poolOfInstance(world.index, e.id);
  const pool = poolId ? world.index.entity(poolId) : undefined;
  if (!poolId || !pool || poolDef(pool).mode !== "dual" || !poolDef(pool).multipath)
    return { out: "Nov 06 12:00:00 | DM multipath kernel driver not loaded\n", code: 1 };
  const ps = world.stateAs(poolId, "storage_pool");
  const lines = [
    "mpatha (3600a098000aabbcc00001) dm-2 TERRA,ARRAY C-Mode",
    "size=500G features='3 queue_if_no_path pg_init_retries 50' hwhandler='1 alua' wp=rw",
  ];
  const controllers = controllersOf(world.index, poolId);
  controllers.forEach((ctl, i) => {
    const cs = world.stateAs(ctl.id, "storage_controller");
    const [dev] = PATHS[i] ?? PATHS[0] ?? ["", ""];
    const last = i === controllers.length - 1;
    const state =
      cs.status === "down"
        ? "failed faulty running"
        : cs.path === "cut"
          ? "failed faulty offline"
          : "active ready running";
    const group = ctl.id === ps.activePath && state.startsWith("active") ? "active" : "enabled";
    lines.push(
      `${last ? "`" : "|"}-+- policy='service-time 0' prio=${group === "active" ? 50 : 10} status=${group}`,
      `${last ? " " : "|"} \`- ${dev} ${state}`,
    );
  });
  return ok(`${lines.join("\n")}\n`);
}
