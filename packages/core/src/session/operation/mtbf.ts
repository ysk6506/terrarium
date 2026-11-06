/**
 * The failure-rate table of operation mode (REQ-090, ADR-0094 item 1): for each fault, how many world hours one piece
 * of equipment of its kind runs on average before it happens (MTBF, at the "보통" preset). The numbers are the
 * simulator's own, shorter than a vendor's datasheet, so that an eight-hour shift in a mid-sized world sees a few
 * incidents. They are data: the same table drives the generator, the guide and the experiment screen.
 */
import type { EntityKind, FaultType } from "@terrarium/core/world";

export interface Mtbf {
  readonly type: FaultType;
  /** The equipment kinds it can happen to. */
  readonly kinds: readonly EntityKind[];
  /** World hours per piece of equipment, at "보통". */
  readonly hours: number;
}

export const MTBF_TABLE: readonly Mtbf[] = [
  { type: "fan_failure", kinds: ["server"], hours: 1_800 },
  { type: "psu_failure", kinds: ["server"], hours: 2_400 },
  { type: "memory_failure", kinds: ["server"], hours: 3_600 },
  { type: "bmc_unresponsive", kinds: ["server"], hours: 1_500 },
  { type: "cpu_runaway", kinds: ["server"], hours: 1_200 },
  { type: "sensor_drift", kinds: ["server"], hours: 4_800 },
  { type: "vm_cpu_spike", kinds: ["vm"], hours: 700 },
  { type: "disk_failure", kinds: ["storage"], hours: 3_000 },
  { type: "switch_failure", kinds: ["switch"], hours: 6_000 },
  { type: "cooling_unit_failure", kinds: ["cooling_unit"], hours: 5_000 },
  { type: "cooling_unit_degraded", kinds: ["cooling_unit"], hours: 3_000 },
  { type: "setpoint_drift", kinds: ["cooling_unit"], hours: 3_600 },
  { type: "breaker_trip", kinds: ["pdu"], hours: 9_000 },
  { type: "disk_full", kinds: ["server", "vm"], hours: 1_400 },
  { type: "log_flood", kinds: ["server", "vm"], hours: 1_800 },
  { type: "memory_leak", kinds: ["server", "vm"], hours: 1_800 },
  { type: "process_crashloop", kinds: ["server", "vm"], hours: 1_200 },
  { type: "zombie_pileup", kinds: ["server", "vm"], hours: 3_000 },
  { type: "fs_readonly", kinds: ["server", "vm"], hours: 4_000 },
  { type: "ntp_drift", kinds: ["server", "vm"], hours: 2_400 },
  { type: "dns_failure", kinds: ["server", "vm"], hours: 6_000 },
  { type: "kernel_panic", kinds: ["server", "vm"], hours: 5_000 },
  { type: "cert_expired", kinds: ["server", "vm"], hours: 8_000 },
  // SDN 오버레이와 클라우드 네이티브 네트워크 (REQ-097)
  { type: "sdn_controller_down", kinds: ["sdn_controller"], hours: 4_000 },
  { type: "sdn_sync_failed", kinds: ["vtep"], hours: 3_000 },
  { type: "vxlan_tunnel_down", kinds: ["vtep"], hours: 8_000 },
  { type: "evpn_session_flap", kinds: ["vtep"], hours: 5_000 },
  { type: "ingress_controller_down", kinds: ["ingress"], hours: 2_400 },
  { type: "cni_plugin_failure", kinds: ["cni"], hours: 3_600 },
  { type: "nfv_firewall_overload", kinds: ["nfv_function"], hours: 2_000 },
];

/**
 * How busy each hour of the day is, relative to the day's average (the world has no workload pattern of its own, so
 * this is the default: busy by day, quiet by night). Hour 0 is midnight of the world's clock.
 */
export const DAY_PATTERN: readonly number[] = [
  0.4, 0.3, 0.3, 0.3, 0.4, 0.6, 0.9, 1.3, 1.6, 1.8, 1.8, 1.6, 1.4, 1.6, 1.8, 1.8, 1.6, 1.4, 1.1,
  0.9, 0.8, 0.6, 0.5, 0.4,
];

/** The pattern's weight at a world time (seconds), the clock starting at midnight. */
export function dayWeight(t: number, pattern: readonly number[] = DAY_PATTERN): number {
  const hour = Math.floor((((t % 86_400) + 86_400) % 86_400) / 3_600);
  return pattern[hour] ?? 1;
}
