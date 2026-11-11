/**
 * Golden: the impact range (REQ-078, ADR-0084) of every failure origin on the `sdn` world of the golden matrix. Each fault
 * type the world can host is put on its first and last target (and on an uplink for link faults), the physics runs 120 s,
 * and the equipment in the range, the rooms, racks and servers it reaches, the severity and the service impact are
 * fingerprinted. It protects the blast-radius engine while it moves to one propagation engine (ADR-0168).
 * An expectation here may change only through the test-lock amend procedure (ADR-0004), with an ADR that
 * explains why the behaviour of an existing world changed. A red test here means exactly that.
 * Read docs/design-docs/golden-safety-net.md first.
 */
import { describe, expect, test } from "vitest";
import { impactFingerprints } from "./test-support/golden-impact";
import { goldenWorld } from "./test-support/golden-matrix";

const EXPECTED: Readonly<Record<string, string>> = {
  "(healthy)": "0 137:0eec6b06ca2a7006",
  "cooling_unit_failure@crah-1": "6/2/3 227:0ee6bfc10272c510",
  "cooling_unit_failure@crah-2": "3/1/1 191:1b776d84dded8f00",
  "cooling_unit_degraded@crah-1": "0/0/0 145:1b763cc603417f07",
  "cooling_unit_degraded@crah-2": "0/0/0 145:04875f7880e24616",
  "setpoint_drift@crah-1": "0/0/0 153:0398aa517261600d",
  "setpoint_drift@crah-2": "0/0/0 153:0e8bb4b2e4de850a",
  "breaker_trip@panel-1": "8/2/3 477:0d99bcb4fcc9521a",
  "breaker_trip@pdu-b": "3/1/1 269:0eb3bbdc568b921f",
  "grid_outage@ups-1": "0/0/0 151:13985775ac0bc208",
  "ups_battery_degraded@ups-1": "0/0/0 144:0eac7d4fe31f2b10",
  "utility_outage@panel-1": "22/2/3 414:012a80e55817c004",
  "coolant_leak@rack-a": "1/1/2 173:10d6964afd16c31f",
  "coolant_leak@rack-b": "1/1/1 173:1d38beae6cfacc0f",
  "immersion_circulation_failure@rack-a": "1/1/2 165:0d4caa44c73c560c",
  "immersion_circulation_failure@rack-b": "1/1/1 165:0930c0ddcdd4720e",
  "ats_stuck@panel-1": "0/0/0 146:15ab1dd44288b81d",
  "fan_failure@srv-a1": "1/1/1 173:0de0c175898e2802",
  "fan_failure@srv-b1": "1/1/1 173:1add452ba24cd911",
  "psu_failure@srv-a1": "1/1/1 173:0de0c175898e2802",
  "psu_failure@srv-b1": "1/1/1 173:1add452ba24cd911",
  "sensor_drift@srv-a1": "1/1/1 173:0de0c175898e2802",
  "sensor_drift@srv-b1": "1/1/1 173:1add452ba24cd911",
  "cpu_runaway@srv-a1": "1/1/1 173:0de0c175898e2802",
  "cpu_runaway@srv-b1": "1/1/1 173:1add452ba24cd911",
  "bmc_unresponsive@srv-a1": "1/1/1 165:0a3a2230582ce615",
  "bmc_unresponsive@srv-b1": "1/1/1 165:1259211ea915fc01",
  "memory_failure@srv-a1": "1/1/1 203:1cca042bdc07c10e",
  "memory_failure@srv-b1": "1/1/1 189:0a60601d8dd38f01",
  "firmware_update_failure@srv-a1": "1/1/1 165:0a3a2230582ce615",
  "firmware_update_failure@srv-b1": "1/1/1 165:1259211ea915fc01",
  "link_down@l-network-srv-a1-tor-a-10": "1/1/1 220:0d80555bf6eb6c04",
  "link_down@n-tor-b-sp2-5": "0/0/0 157:17d027f6d515fb13",
  "link_down@n-sp1-core1-6": "0/0/0 155:19493cea5aafed1d",
  "switch_failure@core1": "9/2/3 270:1570412636cda017",
  "switch_failure@tor-b": "1/1/1 240:04cb63b027a09c1a",
  "disk_failure@stor-b": "0/0/0 153:0275d90ca1f7810e",
  "vm_cpu_spike@vm-db": "0/0/0 151:139dd97dc2b7ad00",
  "vm_cpu_spike@vm-web2": "0/0/0 168:0e601c73563d440d",
  "disk_full@srv-a1": "1/1/1 173:0de0c175898e2802",
  "disk_full@vm-web2": "0/0/0 168:0e601c73563d440d",
  "log_flood@srv-a1": "1/1/1 173:0de0c175898e2802",
  "log_flood@vm-web2": "0/0/0 155:0dd75533d5bc0f0e",
  "memory_leak@srv-a1": "1/1/1 165:0a3a2230582ce615",
  "memory_leak@vm-web2": "0/0/0 146:18dd498ba02fae04",
  "process_crashloop@srv-a1": "1/1/1 173:0de0c175898e2802",
  "process_crashloop@vm-web2": "0/0/0 168:0e601c73563d440d",
  "zombie_pileup@srv-a1": "1/1/1 165:0a3a2230582ce615",
  "zombie_pileup@vm-web2": "0/0/0 146:18dd498ba02fae04",
  "fs_readonly@srv-a1": "1/1/1 173:0de0c175898e2802",
  "fs_readonly@vm-web2": "0/0/0 168:0e601c73563d440d",
  "ntp_drift@srv-a1": "1/1/1 173:0de0c175898e2802",
  "ntp_drift@vm-web2": "0/0/0 155:0dd75533d5bc0f0e",
  "dns_failure@srv-a1": "1/1/1 173:0de0c175898e2802",
  "dns_failure@vm-web2": "0/0/0 168:0e601c73563d440d",
  "kernel_panic@srv-a1": "1/1/1 212:1ab6ce8b1caf021f",
  "kernel_panic@vm-web2": "0/0/0 168:0e601c73563d440d",
  "cert_expired@srv-a1": "1/1/1 173:0de0c175898e2802",
  "cert_expired@vm-web2": "0/0/0 168:0e601c73563d440d",
  "storage_node_lost@stor-b": "0/0/0 145:0d4425bdf21eb70c",
  "sdn_controller_down@sdn-ctl-1": "0/0/0 159:135daeaf813bbc18",
  "sdn_controller_down@sdn-ctl-2": "0/0/0 159:025108983fecbe15",
  "sdn_sync_failed@vtep-tor-a": "0/0/0 215:11460a2266418d0e",
  "sdn_sync_failed@vtep-tor-b": "0/0/0 187:04c780a5bcb4d41e",
  "vxlan_tunnel_down@vtep-tor-a": "0/0/0 215:11460a2266418d0e",
  "vxlan_tunnel_down@vtep-tor-b": "0/0/0 187:04c780a5bcb4d41e",
  "evpn_session_flap@vtep-tor-a": "2/0/0 176:177587545cfcc815",
  "evpn_session_flap@vtep-tor-b": "1/0/0 161:0a8e37ca07802f04",
  "ingress_controller_down@ingress-portal": "0/0/0 182:0478eaa3805fce0e",
  "cni_plugin_failure@cni-1": "0/0/0 164:015768f275e9101e",
  "cni_plugin_failure@cni-2": "0/0/0 164:1fd2fa0f1f7d7e16",
  "nfv_firewall_overload@nfv-fw": "0/0/0 166:0b9cf9388a68790e",
  "ups_module_fail@ups-1": "8/2/3 465:1f82db1195337706",
};

describe("the impact range of the sdn world is the recorded one [REQ-078] [REQ-001]", () => {
  test("sdn: every failure origin makes the recorded range", () => {
    expect(impactFingerprints(goldenWorld("sdn"))).toEqual(EXPECTED);
  }, 120_000);
});
