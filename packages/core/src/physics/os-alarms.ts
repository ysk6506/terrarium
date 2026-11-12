/**
 * The alarms a monitoring agent on a host raises (REQ-087, ADR-0091): disk, memory, processes, file system, clock,
 * name lookup, certificate. They carry the kind `os`. Only hosts that have an operating-system state are looked at;
 * a host nothing happened to has nothing to report.
 */
import { AUTH_SKEW_S, type HostOs, type StateOf, type World } from "@terrarium/core/world";
import type { Draft, Hit } from "./alarm-scan";

type Rule = (os: HostOs, name: string) => Hit | undefined;

const pct = (v: number): string => `${Math.round(v)}%`;

const RULES: readonly Rule[] = [
  (os, name) =>
    os.diskPct >= 90
      ? [
          "os_disk_full",
          os.diskPct >= 98 ? "critical" : "warning",
          `${name} 디스크 ${pct(os.diskPct)}`,
        ]
      : undefined,
  (os, name) =>
    os.memPct >= 90
      ? [
          "os_memory_high",
          os.memPct >= 97 ? "critical" : "warning",
          `${name} 메모리 ${pct(os.memPct)}`,
        ]
      : undefined,
  (os, name) => {
    const p = os.processes.find((q) => q.state === "restarting" || q.state === "failed");
    return p
      ? [
          "os_process_down",
          "critical",
          `${name}에서 ${p.name} 프로세스가 죽었고 재시작 ${p.restarts}번째예요`,
        ]
      : undefined;
  },
  (os, name) =>
    os.fs === "ro"
      ? ["os_fs_readonly", "critical", `${name} 파일시스템이 읽기 전용이에요`]
      : undefined,
  (os, name) =>
    Math.abs(os.ntpOffsetS) > 1
      ? [
          "os_ntp_drift",
          Math.abs(os.ntpOffsetS) > AUTH_SKEW_S ? "critical" : "warning",
          `${name} 시계가 ${Math.round(os.ntpOffsetS)}초 어긋나 있어요`,
        ]
      : undefined,
  (os, name) =>
    os.dnsOk ? undefined : ["os_dns_failure", "warning", `${name}에서 이름 풀이가 실패해요`],
  (os, name) =>
    os.zombies >= 100
      ? [
          "os_zombies",
          os.zombies >= 3000 ? "critical" : "warning",
          `${name} 좀비 프로세스 ${os.zombies}개`,
        ]
      : undefined,
  (os, name) =>
    os.logRate >= 200
      ? ["os_log_flood", "warning", `${name} 로그가 초당 ${Math.round(os.logRate)}줄 쏟아져요`]
      : undefined,
  (os, name) =>
    os.certOk ? undefined : ["os_cert_expired", "critical", `${name} 인증서가 만료됐어요`],
  (os, name) => (os.up ? undefined : ["os_down", "critical", `${name} 운영체제가 내려가 있어요`]),
];

/** The operating-system alarms of every host that has a state. */
export function osAlarms(world: World, out: Draft[]): void {
  for (const id of [...world.osHosts()].sort()) {
    const state = world.stateOf(id) as StateOf<"server"> | StateOf<"vm">;
    const os = state.os;
    // A host the equipment took away has its own alarms (power lost, VM stopped); this is for one that is on.
    if (!os || !(state.kind === "server" ? state.powered && state.adminOn : state.running))
      continue;
    // A system that is down says only that; its other numbers are stale.
    const rules = os.up ? RULES : RULES.slice(-1);
    const name = world.index.entity(id).name;
    for (const rule of rules) {
      const hit = rule(os, name);
      if (hit)
        out.push({ entityId: id, code: hit[0], severity: hit[1], kind: "os", message: hit[2] });
    }
  }
}
