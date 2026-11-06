/**
 * The operating system of hosts moves with time and with the faults on them (REQ-087, ADR-0091): a leak
 * climbs a few percent a minute, a crash loop restarts a process every half minute, a drifting clock drifts.
 * Only hosts that have a stored state are walked (a host nobody looked at and nothing broke on has none).
 *
 * Everything is a function of the host's state, the faults on it and the time since they began, so a replay
 * of the same events gives the same host. When a fault ends (an operator fixed it, a technician came) the
 * state it had bent returns to normal here, so every way a fault can end leaves a healthy host.
 */
import {
  type Fault,
  type FaultType,
  type HostOs,
  line,
  logTo,
  memoryOf,
  type OsProcess,
  type StateOf,
  type World,
  type WorldEvent,
} from "@terrarium/core/world";
import { effectiveUtil } from "./power";

const CAUSE = "physics";
const SERVICE_WEIGHT = 12;
const HOT_WEIGHT = 60;
const SERVICE_MEM_PCT = 9;
/** Where the memory of a process that was killed for running out starts again. */
const OOM_PCT = 99;
const OOM_RESTART_SECONDS = 20;
const BOOT_LOG = "Linux version 5.14.0-427.el9.x86_64 (mockbuild@x86-64-03) #1 SMP PREEMPT_DYNAMIC";

type Host = StateOf<"server"> | StateOf<"vm">;

const faultOf = (faults: readonly Fault[], type: FaultType): Fault | undefined =>
  faults.find((f) => f.type === type);

const param = (fault: Fault, name: string): number => fault.params[name] ?? 0;

/** The process that does the service's work on this host (the one the faults pick on). */
function culprit(os: HostOs): OsProcess | undefined {
  return (
    os.processes.find((p) => p.user === "svc") ?? os.processes.find((p) => p.name === "rsyslogd")
  );
}

function physicallyUp(state: Host): boolean {
  return state.kind === "server"
    ? state.powered && state.adminOn && !state.rebooting
    : state.running;
}

/** Whether the system is up now, and the events that end a panic. */
function systemUp(world: World, state: Host, faults: readonly Fault[]): boolean {
  const os = state.os as HostOs;
  const t = world.time();
  const panic = faultOf(faults, "kernel_panic");
  const panicking = panic !== undefined && t - panic.since < param(panic, "downSeconds");
  const rebooting = os.downUntil !== undefined && t < os.downUntil;
  if (os.up && panicking) {
    logTo(os, line(t, "kernel", "err", "Kernel panic - not syncing: Fatal exception in interrupt"));
    logTo(os, line(t, "kernel", "err", "Rebooting in 10 seconds.."));
  }
  return physicallyUp(state) && !panicking && !rebooting;
}

/** The host boots again: the clock of its uptime restarts and its processes come up. */
function boot(os: HostOs, t: number): void {
  os.up = true;
  os.uptimeS = 0;
  delete os.downUntil;
  for (const p of os.processes) {
    p.state = "running";
    p.restarts = 0;
    delete p.until;
    delete p.loop;
  }
  logTo(os, line(t, "kernel", "info", BOOT_LOG));
  logTo(os, line(t, "systemd", "info", "Reached target Multi-User System."));
}

/** The processes that were restarting come back when their time is up. */
function comeBack(os: HostOs, t: number): void {
  for (const p of os.processes)
    if (p.state === "restarting" && p.until !== undefined && t >= p.until) {
      p.state = "running";
      delete p.until;
    }
}

function diskFaults(os: HostOs, faults: readonly Fault[], dt: number, t: number): void {
  const full = faultOf(faults, "disk_full");
  const flood = faultOf(faults, "log_flood");
  if (full && os.diskPct < 100) {
    os.diskPct = 100;
    logTo(
      os,
      line(t, culprit(os)?.name ?? "rsyslogd", "err", "write error: No space left on device"),
    );
  }
  os.logRate = flood ? 4500 : 2;
  if (flood) {
    const before = Math.floor(os.diskPct / 10);
    os.diskPct = Math.min(
      100,
      Math.round((os.diskPct + (param(flood, "pctPerMin") * dt) / 60) * 10) / 10,
    );
    const name = culprit(os)?.name ?? "app";
    if (Math.floor(os.diskPct / 10) > before || t - flood.since < dt)
      logTo(
        os,
        line(
          t,
          name,
          "err",
          `ERROR upstream connection failed, retrying (attempt ${Math.round(t - flood.since)}) — ${Math.round(os.logRate)} lines/s`,
        ),
      );
  } else if (!full && os.diskPct >= 99.5) {
    os.diskPct = 58; // the fault was ended by someone else; the logs are gone
  }
}

function memoryFaults(os: HostOs, faults: readonly Fault[], dt: number, t: number): void {
  const leak = faultOf(faults, "memory_leak");
  const p = culprit(os);
  if (!p) return;
  if (!leak) {
    p.memPct = Math.min(p.memPct, SERVICE_MEM_PCT);
    return;
  }
  if (p.state !== "running") return;
  const before = memoryOf(os);
  p.memPct += (param(leak, "pctPerMin") * dt) / 60;
  const used = memoryOf(os);
  if (before < 90 && used >= 90)
    logTo(
      os,
      line(
        t,
        "kernel",
        "warn",
        `Memory cgroup is nearly out of memory: ${Math.round(used)}% in use`,
      ),
    );
  if (used >= OOM_PCT) oomKill(os, p, t);
}

/** The kernel kills the process that holds the memory; it comes back a little later and starts to leak again. */
function oomKill(os: HostOs, p: OsProcess, t: number): void {
  logTo(
    os,
    line(
      t,
      "kernel",
      "err",
      `Out of memory: Killed process ${p.pid} (${p.name}) total-vm:8467228kB, anon-rss:7340032kB`,
    ),
  );
  logTo(
    os,
    line(
      t,
      "systemd",
      "warn",
      `${p.name}.service: A process of this unit has been killed by the OOM killer.`,
    ),
  );
  p.state = "restarting";
  p.until = t + OOM_RESTART_SECONDS;
  p.restarts += 1;
  p.memPct = SERVICE_MEM_PCT;
}

function crashLoop(os: HostOs, faults: readonly Fault[], t: number): void {
  const loop = faultOf(faults, "process_crashloop");
  const p = culprit(os);
  if (!p) return;
  if (!loop) {
    if (p.loop !== undefined) {
      delete p.loop;
      if (p.state === "restarting") p.state = "running";
    }
    return;
  }
  const times = Math.floor((t - loop.since) / Math.max(1, param(loop, "intervalS")));
  for (let n = (p.loop ?? 0) + 1; n <= times && n <= (p.loop ?? 0) + 3; n++) {
    p.restarts += 1;
    logTo(
      os,
      line(
        t,
        "systemd",
        "err",
        `${p.name}.service: Main process exited, code=exited, status=1/FAILURE`,
      ),
    );
    logTo(
      os,
      line(
        t,
        "systemd",
        "warn",
        `${p.name}.service: Scheduled restart job, restart counter is at ${p.restarts}.`,
      ),
    );
  }
  p.loop = times;
  p.state = "restarting";
  delete p.until;
}

function zombieFaults(os: HostOs, faults: readonly Fault[], dt: number, t: number): void {
  const zombie = faultOf(faults, "zombie_pileup");
  if (!zombie) {
    os.zombies = 0;
    return;
  }
  const added = (param(zombie, "perMin") * dt) / 60;
  const before = os.zombies;
  os.zombies = Math.min(32_000, Math.floor(before + added));
  if (before < 3000 && os.zombies >= 3000)
    logTo(os, line(t, "systemd", "err", "fork: retry: Resource temporarily unavailable"));
}

function fileSystemFaults(os: HostOs, faults: readonly Fault[], t: number): void {
  if (!faultOf(faults, "fs_readonly")) {
    os.fs = "rw";
    return;
  }
  if (os.fs === "ro") return;
  os.fs = "ro";
  logTo(
    os,
    line(
      t,
      "kernel",
      "err",
      "EXT4-fs error (device sda2): ext4_journal_check_start:84: comm kworker: Detected aborted journal",
    ),
  );
  logTo(os, line(t, "kernel", "err", "EXT4-fs (sda2): Remounting filesystem read-only"));
}

function clockFaults(os: HostOs, faults: readonly Fault[], dt: number, t: number): void {
  const drift = faultOf(faults, "ntp_drift");
  if (!drift) {
    if (Math.abs(os.ntpOffsetS) > 0.5) os.ntpOffsetS = 0.001;
    return;
  }
  const before = os.ntpOffsetS;
  os.ntpOffsetS = Math.round((before + (param(drift, "secPerMin") * dt) / 60) * 1000) / 1000;
  if (Math.floor(os.ntpOffsetS / 60) > Math.floor(before / 60))
    logTo(
      os,
      line(t, "chronyd", "warn", `System clock wrong by ${os.ntpOffsetS.toFixed(1)} seconds`),
    );
}

function nameAndCertFaults(os: HostOs, faults: readonly Fault[], t: number): void {
  const dns = faultOf(faults, "dns_failure") === undefined;
  if (!dns && os.dnsOk)
    logTo(
      os,
      line(
        t,
        "systemd-resolved",
        "err",
        "Failed to send DNS query to 10.20.0.53: Connection timed out",
      ),
    );
  os.dnsOk = dns;
  const cert = faultOf(faults, "cert_expired") === undefined;
  if (!cert && os.certOk)
    logTo(
      os,
      line(
        t,
        culprit(os)?.name ?? "app",
        "err",
        "TLS handshake failed: certificate has expired (notAfter=Oct 31 23:59:59 2026 GMT)",
      ),
    );
  os.certOk = cert;
}

/** Heavy CPU on the host is the service's process, so `top` shows who it is. */
function weigh(os: HostOs, busy: boolean): void {
  const p = culprit(os);
  if (p) p.w = busy ? HOT_WEIGHT : SERVICE_WEIGHT;
}

/** Move the operating system of one host by `dt` seconds. */
function stepHost(world: World, id: string, dt: number, events: WorldEvent[]): void {
  const state = world.stateOf(id) as Host;
  const os = state.os as HostOs;
  const t = world.time();
  const faults = world.faultsOn(id);
  const up = systemUp(world, state, faults);
  const panic = faultOf(faults, "kernel_panic");
  if (panic && t - panic.since >= param(panic, "downSeconds"))
    events.push(world.apply({ type: "fault.remove", faultId: panic.id }, CAUSE));
  if (!up) {
    os.up = false;
    os.cpuPct = 0;
    return;
  }
  if (!os.up) boot(os, t);
  os.uptimeS += dt;
  comeBack(os, t);
  diskFaults(os, faults, dt, t);
  memoryFaults(os, faults, dt, t);
  crashLoop(os, faults, t);
  zombieFaults(os, faults, dt, t);
  fileSystemFaults(os, faults, t);
  clockFaults(os, faults, dt, t);
  nameAndCertFaults(os, faults, t);
  const util =
    state.kind === "server" ? effectiveUtil(world, world.index.entity(id)) : state.cpuUsage;
  weigh(
    os,
    faultOf(faults, "cpu_runaway") !== undefined || faultOf(faults, "vm_cpu_spike") !== undefined,
  );
  os.cpuPct = Math.round(util * 100);
  os.memPct = memoryOf(os);
}

/** Step every host that has an operating-system state. Events: the end of a kernel panic. */
export function updateHostOs(world: World, dt: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (const id of [...world.osHosts()].sort()) stepHost(world, id, dt, events);
  return events;
}
