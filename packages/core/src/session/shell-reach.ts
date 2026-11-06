/**
 * The third question of the calibration about tools (ADR-0117 decision 7): for a fault inside a host's operating
 * system, can an agent that types only the common commands (`journalctl`, `ps`, `df`, `cat`, `mount`, `date`, `dig`)
 * on the host see the cause? A scripted agent runs them in the order a person would and looks for the sign each fault
 * leaves in the fake files and processes (world/os). `commonReach` asks whether the tools reach the *equipment*; this
 * asks whether the shell reaches the *cause* once the agent is on it.
 */
import type { ScenarioDoc } from "@terrarium/core/scenario";
import { OS_FAULT_TYPES } from "@terrarium/core/world";
import { Session, type SessionConfig } from "./session";

type Config = Omit<SessionConfig, "tools" | "seed"> & { readonly seed?: number };

export interface ShellReach {
  /** Whether one of the common commands showed the sign of the fault. */
  readonly reached: boolean;
  /** How many commands it typed (all of them, when it did not get there). */
  readonly calls: number;
  /** The command that showed it. */
  readonly via?: string;
  /** The fault it looked for. */
  readonly fault: string;
}

/** What a person types first on a host, in order. */
export const FIRST_LOOK: readonly string[] = [
  "journalctl -p warning -n 40",
  "systemctl list-units --failed",
  "ps aux --sort=-%mem | head -8",
  "df -h",
  "free -m",
  "mount | grep ' / '",
  "cat /etc/resolv.conf",
  "date",
  "timedatectl",
  "cat /var/log/messages | tail -n 40",
  "journalctl -b -1 -p err -n 20",
  "ps aux | grep -c defunct",
  "ls -lS /var/log/*/ | head",
];

/** The text each fault leaves where those commands look. */
export const SIGNS: Readonly<Record<string, RegExp>> = {
  disk_full: /No space left on device|\b100%/,
  log_flood: /upstream connection failed.*lines\/s/,
  memory_leak: /heap usage \d+%|Out of memory|memory cgroup/i,
  process_crashloop: /restart counter is at/,
  zombie_pileup: /not reaped|^\s*[1-9]\d{2,}\s*$/m,
  fs_readonly: /Read-only file system|\(ro,/,
  ntp_drift: /clock wrong by|System clock synchronized: no|clock skew/,
  dns_failure: /Failed to send DNS query|nameserver 10\.20\.99\.53/,
  cert_expired: /certificate has expired/,
  kernel_panic: /Kernel panic/,
};

interface Answer {
  readonly host: string;
  readonly fault: string;
}

/** The host and OS fault the scenario's answer names, if it names one. */
function answerOf(scenario: ScenarioDoc): Answer | undefined {
  for (const e of scenario.expectations) {
    if (e.kind !== "diagnosis") continue;
    const host = e.rootCause[0];
    const fault = e.faultType.find((f) => (OS_FAULT_TYPES as readonly string[]).includes(f));
    if (host && fault) return { host, fault };
  }
  return undefined;
}

/**
 * Whether the common commands reach the cause of an operating-system fault; `undefined` for a scenario whose answer is
 * not one (nothing to look for in the host's files).
 */
export function shellReach(config: Config): ShellReach | undefined {
  const target = answerOf(config.scenario);
  if (!target) return undefined;
  const s = Session.create({ ...config, tools: ["run_command", "wait"], seed: config.seed ?? 1 });
  s.start();
  const sign = SIGNS[target.fault] as RegExp;
  let calls = 0;
  for (const cmd of FIRST_LOOK) {
    calls++;
    const r = s.call("run_command", { host: target.host, cmd });
    const output = String((r.data as { output?: string } | undefined)?.output ?? "");
    if (r.ok && sign.test(output)) return { reached: true, calls, via: cmd, fault: target.fault };
  }
  return { reached: false, calls, fault: target.fault };
}
