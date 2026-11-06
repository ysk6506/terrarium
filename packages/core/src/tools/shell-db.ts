/**
 * What the fake shell prints for the database and storage commands of a database host (REQ-095): `pg_isready`,
 * `psql -c "select pg_is_in_recovery()"` and the replay lag, and `multipath -ll`. Like the rest of the shell the
 * output is made from the state in the shape of the real tool; a host without a database does not have the tools.
 */
import {
  controllersOf,
  type Entity,
  poolDef,
  poolOfInstance,
  type WorldPort,
} from "@terrarium/core/world";

export interface DbShellResult {
  readonly output: string;
  readonly exitCode: number;
}

/** The database instance that runs on a host, if one does. */
export function instanceOn(world: WorldPort, hostId: string): Entity | undefined {
  return world.index
    .incoming(hostId, "hosted_on")
    .map((l) => world.index.find(l.from))
    .find((e): e is Entity => e?.kind === "db_instance");
}

const missing = (cmd: string): DbShellResult => ({
  output: `bash: ${cmd}: command not found`,
  exitCode: 127,
});

const SOCKET = "/var/run/postgresql:5432";

export function pgIsReady(world: WorldPort, hostId: string): DbShellResult {
  const e = instanceOn(world, hostId);
  if (!e) return missing("pg_isready");
  const s = world.stateAs(e.id, "db_instance");
  if (s.restore) return { output: `${SOCKET} - rejecting connections`, exitCode: 1 };
  if (s.status === "down") return { output: `${SOCKET} - no response`, exitCode: 2 };
  return { output: `${SOCKET} - accepting connections`, exitCode: 0 };
}

const table = (head: string, value: string): string =>
  ` ${head} \n${"-".repeat(head.length + 2)}\n ${value}\n(1 row)`;

const interval = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const hh = String(Math.floor(whole / 3600)).padStart(2, "0");
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}.${String(ms).padStart(3, "0")}`;
};

/** The queries the shell knows; any other is answered with the list. */
export const PSQL_QUERIES: readonly string[] = [
  "select pg_is_in_recovery()",
  "select now() - pg_last_xact_replay_timestamp()",
];

export function psql(world: WorldPort, hostId: string, sql: string | undefined): DbShellResult {
  const e = instanceOn(world, hostId);
  if (!e) return missing("psql");
  const s = world.stateAs(e.id, "db_instance");
  if (s.status === "down")
    return {
      output:
        'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory\n\tIs the server running locally and accepting connections on that socket?',
      exitCode: 2,
    };
  const q = (sql ?? "").replace(/\s+/g, " ").trim().replace(/;$/, "").toLowerCase();
  if (q === PSQL_QUERIES[0])
    return { output: table("pg_is_in_recovery", s.role === "primary" ? "f" : "t"), exitCode: 0 };
  if (q === PSQL_QUERIES[1])
    return {
      output: table("?column?", s.role === "primary" ? "" : interval(s.lagS)),
      exitCode: 0,
    };
  return {
    output: `이 질의는 아직 못 해요: ${sql ?? ""}\n되는 질의: ${PSQL_QUERIES.join(" · ")}`,
    exitCode: 1,
  };
}

const PATHS: ReadonlyArray<readonly [string, string]> = [
  ["5:0:0:1 sdb 8:16", "5:0:0:1"],
  ["6:0:0:1 sdc 8:32", "6:0:0:1"],
];

export function multipath(world: WorldPort, hostId: string): DbShellResult {
  const e = instanceOn(world, hostId);
  if (!e) return missing("multipath");
  const poolId = poolOfInstance(world.index, e.id);
  const pool = poolId ? world.index.entity(poolId) : undefined;
  if (!poolId || !pool || poolDef(pool).mode !== "dual" || !poolDef(pool).multipath)
    return { output: "Nov 06 12:00:00 | DM multipath kernel driver not loaded", exitCode: 1 };
  const ps = world.stateAs(poolId, "storage_pool");
  const lines = [
    "mpatha (3600a098000aabbcc00001) dm-2 TERRA,ARRAY C-Mode",
    "size=500G features='3 queue_if_no_path pg_init_retries 50' hwhandler='1 alua' wp=rw",
  ];
  controllersOf(world.index, poolId).forEach((c, i) => {
    const cs = world.stateAs(c.id, "storage_controller");
    const [dev] = PATHS[i] ?? PATHS[0] ?? ["", ""];
    const last = i === controllersOf(world.index, poolId).length - 1;
    const state =
      cs.status === "down"
        ? "failed faulty running"
        : cs.path === "cut"
          ? "failed faulty offline"
          : "active ready running";
    const group = c.id === ps.activePath && state.startsWith("active") ? "active" : "enabled";
    lines.push(
      `${last ? "`" : "|"}-+- policy='service-time 0' prio=${group === "active" ? 50 : 10} status=${group}`,
      `${last ? " " : "|"} \`- ${dev} ${state}`,
    );
  });
  return { output: lines.join("\n"), exitCode: 0 };
}
