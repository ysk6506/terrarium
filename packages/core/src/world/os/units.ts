/**
 * `systemctl` of a fake host (ADR-0117 decision 3): units are the host's processes (the system daemons, the
 * services, a database, a CNI plug-in). Status, restart counter and the last journal lines all come from the same
 * state and event list as `ps` and `journalctl`. `start`, `stop`, `restart`, `enable` and `disable` change the world.
 */
import { DB_PROCESS } from "../host-os";
import { type OsProcess, pidOf, processNamed } from "../os";
import { parseArgs } from "./args";
import { dateAt, sdStamp } from "./clock";
import { instanceOn } from "./cmd-db";
import { formatJournal, journalLines } from "./journal";
import { lastStart, processTable } from "./procs";
import { badFlag } from "./real-options";
import { act, type Cmd, emulationGap, fail, ok, type R } from "./types";

const unitName = (arg: string): string => arg.replace(/\.service$/, "");

function ago(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 2 * 86_400) return `${Math.floor(s / 86_400)} days ago`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min ago`;
  if (s >= 60) return `${Math.floor(s / 60)}min ${s % 60}s ago`;
  return `${s}s ago`;
}

const stateWord = (p: OsProcess): { active: string; sub: string } =>
  p.state === "running"
    ? { active: "active", sub: "running" }
    : p.state === "restarting"
      ? { active: "activating", sub: "auto-restart" }
      : p.state === "failed"
        ? { active: "failed", sub: "failed" }
        : { active: "inactive", sub: "dead" };

const description = (c: Cmd, name: string): string =>
  c.h.services.find((s) => s.process === name)?.name ?? name;

const enabled = (c: Cmd, name: string): boolean => !(c.h.os.disabled ?? []).includes(name);

const looping = (c: Cmd, p: OsProcess): boolean =>
  c.h.spans.some((s) => s.type === "process_crashloop" && s.until === undefined) &&
  p.user === "svc";

function activeLine(c: Cmd, p: OsProcess, startT: number): string {
  const { h } = c;
  const since = sdStamp(dateAt(startT));
  if (p.state === "running") return `active (running) since ${since} UTC; ${ago(h.t - startT)}`;
  if (p.state === "restarting" && looping(c, p))
    return `activating (auto-restart) (Result: exit-code) since ${since} UTC; ${ago(5)}`;
  if (p.state === "restarting")
    return `activating (start) since ${since} UTC; ${ago(c.h.t - startT)}`;
  if (p.state === "failed")
    return `failed (Result: exit-code) since ${since} UTC; ${ago(h.t - startT)}`;
  return `inactive (dead) since ${since} UTC; ${ago(h.t - startT)}`;
}

function statusOf(c: Cmd, name: string): string {
  const { h } = c;
  const p = processNamed(h.os, name) as OsProcess;
  const row = processTable(h).find((r) => r.unit === name);
  const startT = row?.startT ?? lastStart(h, p) ?? h.bootT;
  const dot = p.state === "running" ? "●" : p.state === "stopped" ? "○" : "×";
  const lines = [
    `${dot} ${name}.service - ${description(c, name)}`,
    `     Loaded: loaded (/etc/systemd/system/${name}.service; ${enabled(c, name) ? "enabled" : "disabled"}; preset: disabled)`,
    `     Active: ${activeLine(c, p, startT)}`,
  ];
  if (row)
    lines.push(
      `   Main PID: ${row.pid} (${name})`,
      `      Tasks: ${row.threads} (limit: 1648954)`,
      `     Memory: ${(row.rssKb / 1024 / 1024).toFixed(1)}G`,
      `     CGroup: /system.slice/${name}.service`,
      `             └─${row.pid} ${row.args}`,
    );
  else
    lines.push(
      `    Process: ${pidOf(p)} ExecStart=/opt/app/bin/${name} (code=exited, status=1/FAILURE)`,
    );
  const recent = journalLines(h, { units: [name], n: 10 }).map((l) => formatJournal(h, l));
  return `${lines.join("\n")}\n\n${recent.join("\n")}\n`;
}

function status(c: Cmd, names: readonly string[]): R {
  const out: string[] = [];
  let code = 0;
  let err = "";
  for (const n of names) {
    if (!processNamed(c.h.os, n)) {
      err += `Unit ${n}.service could not be found.\n`;
      code = 4;
    } else {
      out.push(statusOf(c, n));
      const p = processNamed(c.h.os, n) as OsProcess;
      if (p.state !== "running") code = Math.max(code, 3);
    }
  }
  return { out: out.join("\n"), ...(err ? { err } : {}), code };
}

const VERBS = ["start", "stop", "restart", "reload", "try-restart", "reload-or-restart"] as const;

function change(c: Cmd, verb: string, names: readonly string[]): R {
  let err = "";
  let code = 0;
  for (const n of names) {
    const failure = changeOne(c, verb, n);
    if (failure) {
      err += `${failure.message}\n`;
      code = code || failure.code;
    }
  }
  return { out: "", ...(err ? { err } : {}), code };
}

interface Failure {
  readonly message: string;
  readonly code: number;
}

/** Do one verb on one unit; the failure, or undefined. */
function changeOne(c: Cmd, verb: string, name: string): Failure | undefined {
  if (!processNamed(c.h.os, name))
    return {
      message: `Failed to ${verb} ${name}.service: Unit ${name}.service not found.`,
      code: 5,
    };
  if (verb === "reload") return undefined;
  if (verb === "stop" || verb === "start") {
    act(c, verb, name);
    return undefined;
  }
  const db = name === DB_PROCESS ? instanceOn(c) : undefined;
  if (db && c.h.world.faultsOn(db.id).some((f) => f.type === "db_primary_down"))
    return {
      message:
        'Job for postgresql.service failed because the control process exited with error code.\nSee "systemctl status postgresql.service" and "journalctl -xeu postgresql.service" for details.',
      code: 1,
    };
  act(c, "restart", name);
  return undefined;
}

function toggle(c: Cmd, verb: "enable" | "disable", names: readonly string[]): R {
  if (c.h.os.fs === "ro") return fail(`Failed to ${verb} unit: Read-only file system`, 1);
  let out = "";
  for (const n of names) {
    if (!processNamed(c.h.os, n))
      return fail(`Failed to ${verb} unit: Unit file ${n}.service does not exist.`, 1);
    act(c, verb, n);
    const link = `/etc/systemd/system/multi-user.target.wants/${n}.service`;
    out +=
      verb === "enable"
        ? `Created symlink ${link} → /etc/systemd/system/${n}.service.\n`
        : `Removed "${link}".\n`;
  }
  return ok(out);
}

function listUnits(c: Cmd, failedOnly: boolean, all: boolean): R {
  const rows = c.h.os.processes
    .map((p) => ({ name: p.name, ...stateWord(p) }))
    .filter((r) => (failedOnly ? r.active === "failed" : all || r.active !== "inactive"));
  const w = Math.max(24, ...rows.map((r) => r.name.length + 8));
  const lines = rows.map(
    (r) =>
      `${failedOnly ? "● " : "  "}${`${r.name}.service`.padEnd(w)} loaded ${r.active.padEnd(10)} ${r.sub.padEnd(12)} ${description(c, r.name)}`,
  );
  const head = `  ${"UNIT".padEnd(w)} LOAD   ACTIVE     SUB          DESCRIPTION`;
  const tail = `\n${rows.length} loaded units listed.`;
  return rows.length === 0 && failedOnly
    ? ok("  UNIT LOAD ACTIVE SUB DESCRIPTION\n0 loaded units listed.\n")
    : ok(`${head}\n${lines.join("\n")}\n${tail}\n`);
}

function show(c: Cmd, name: string, props: readonly string[]): R {
  const p = processNamed(c.h.os, name);
  if (!p) return fail(`Unit ${name}.service could not be found.`, 1);
  const { active, sub } = stateWord(p);
  const all: Array<[string, string]> = [
    ["Id", `${name}.service`],
    ["LoadState", "loaded"],
    ["ActiveState", active],
    ["SubState", sub],
    ["MainPID", String(p.state === "running" ? pidOf(p) : 0)],
    ["NRestarts", String(p.restarts)],
    ["UnitFileState", enabled(c, name) ? "enabled" : "disabled"],
    ["Result", p.state === "running" ? "success" : "exit-code"],
  ];
  const rows = props.length ? all.filter(([k]) => props.includes(k)) : all;
  return ok(`${rows.map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
}

function isState(c: Cmd, verb: string, name: string): R {
  const p = processNamed(c.h.os, name);
  if (verb === "is-enabled")
    return enabled(c, name) && p ? ok("enabled\n") : { out: "disabled\n", code: 1 };
  const word = p ? stateWord(p).active : "inactive";
  const good = verb === "is-failed" ? word === "failed" : word === "active";
  return { out: `${word}\n`, code: good ? 0 : verb === "is-failed" ? 1 : 3 };
}

interface Call {
  readonly c: Cmd;
  readonly verb: string;
  readonly names: readonly string[];
  readonly p: ReturnType<typeof parseArgs>;
}

const VERB_HANDLERS: Readonly<Record<string, (k: Call) => R>> = {
  status: (k) =>
    k.names.length
      ? status(k.c, k.names)
      : emulationGap({
          tool: "systemctl",
          feature: "status-no-unit",
          what: "status (유닛 이름 없이)",
          supported: SYSTEMCTL_SUPPORTED,
          example: "systemctl list-units --failed",
        }),
  enable: (k) => toggle(k.c, "enable", k.names),
  disable: (k) => toggle(k.c, "disable", k.names),
  "list-units": (k) =>
    listUnits(k.c, k.p.flags.has("--failed"), k.p.flags.has("--all") || k.p.flags.has("a")),
  "daemon-reload": () => ok(""),
  show: (k) =>
    show(
      k.c,
      k.names[0] ?? "",
      (k.p.flags.get("p") ?? k.p.flags.get("--property") ?? "").split(",").filter(Boolean),
    ),
  "is-active": (k) => isState(k.c, k.verb, k.names[0] ?? ""),
  "is-enabled": (k) => isState(k.c, k.verb, k.names[0] ?? ""),
  "is-failed": (k) => isState(k.c, k.verb, k.names[0] ?? ""),
  cat: (k) => catUnit(k.c, k.names[0] ?? ""),
};

export function systemctl(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "al",
    val: "tp",
    long: {
      failed: "bool",
      all: "bool",
      "no-pager": "bool",
      "no-legend": "bool",
      now: "bool",
      full: "bool",
      type: "val",
      property: "val",
      state: "val",
    },
  });
  if (p.bad) return badFlag("systemctl", p);
  const [verb = "list-units", ...rest] = p.rest;
  const names = rest.map(unitName);
  if ((VERBS as readonly string[]).includes(verb) && names.length > 0)
    return change(c, verb, names);
  const handler = VERB_HANDLERS[verb];
  if ((VERBS as readonly string[]).includes(verb)) return fail("Too few arguments.", 1);
  return handler ? handler({ c, verb, names, p }) : verbRefusal(verb);
}

/** Verbs of the real systemctl (`systemctl --help`, systemd 255) the fake has no handler for. */
const REAL_VERBS = new Set(
  "list-sockets list-timers list-dependencies list-unit-files list-jobs list-machines start stop reload restart try-restart reload-or-restart try-reload-or-restart kill clean freeze thaw mask unmask link revert add-wants add-requires edit set-property reset-failed is-system-running get-default set-default show-environment set-environment unset-environment import-environment default rescue emergency halt poweroff reboot kexec suspend hibernate hybrid-sleep exit switch-root isolate cancel preset preset-all".split(
    " ",
  ),
);

const SYSTEMCTL_SUPPORTED =
  "status <유닛>, start|stop|restart|reload <유닛>, enable|disable <유닛>, is-active|is-enabled|is-failed <유닛>, show -p, cat, list-units [--failed] [-a], daemon-reload, 옵션 -a -l -t -p --failed --no-pager --now";

function verbRefusal(verb: string): R {
  if (!REAL_VERBS.has(verb)) return fail(`Unknown command verb ${verb}.`, 1);
  return emulationGap({
    tool: "systemctl",
    feature: `verb:${verb}`,
    what: verb,
    supported: SYSTEMCTL_SUPPORTED,
    example: "systemctl list-units --failed",
  });
}

function catUnit(c: Cmd, name: string): R {
  const path = `/etc/systemd/system/${name}.service`;
  const text = c.fs.read(path);
  return text === undefined
    ? fail(`No files found for ${name}.service.`, 1)
    : ok(`# ${path}\n${text}`);
}
