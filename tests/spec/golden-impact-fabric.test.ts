/**
 * Golden: the impact range (REQ-078, ADR-0084) of every failure origin on the `fabric` world of the golden matrix. Each fault
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
  "breaker_trip@panel-1": "6/2/3 334:035f95f7c4bf6800",
  "breaker_trip@pdu-b": "2/1/1 226:12fa238acf99311d",
  "grid_outage@ups-1": "0/0/0 151:13985775ac0bc208",
  "ups_battery_degraded@ups-1": "0/0/0 144:0eac7d4fe31f2b10",
  "utility_outage@panel-1": "14/2/3 325:01e1553c0ce10410",
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
  "memory_failure@srv-a1": "1/1/1 165:0a3a2230582ce615",
  "memory_failure@srv-b1": "1/1/1 165:1259211ea915fc01",
  "firmware_update_failure@srv-a1": "1/1/1 165:0a3a2230582ce615",
  "firmware_update_failure@srv-b1": "1/1/1 165:1259211ea915fc01",
  "link_down@g-rail1-gsp1-25": "0/0/0 158:16dfbffddc440a12",
  "link_down@g-stor-b-rail1-24": "0/0/0 161:1e66961455857e01",
  "switch_failure@gsp1": "0/0/0 213:18503a8268e67d1a",
  "switch_failure@tor-a": "0/0/0 151:1cd0d2268a4be417",
  "disk_failure@stor-b": "0/0/0 153:0275d90ca1f7810e",
  "vm_cpu_spike@vm-db": "0/0/0 151:139dd97dc2b7ad00",
  "vm_cpu_spike@vm-web": "0/0/0 153:0f6c6a3f32e16f1a",
  "disk_full@srv-a1": "1/1/1 173:0de0c175898e2802",
  "disk_full@vm-web": "0/0/0 153:0f6c6a3f32e16f1a",
  "log_flood@srv-a1": "1/1/1 173:0de0c175898e2802",
  "log_flood@vm-web": "0/0/0 153:0f6c6a3f32e16f1a",
  "memory_leak@srv-a1": "1/1/1 165:0a3a2230582ce615",
  "memory_leak@vm-web": "0/0/0 145:1764f6de45a3cb14",
  "process_crashloop@srv-a1": "1/1/1 173:0de0c175898e2802",
  "process_crashloop@vm-web": "0/0/0 153:0f6c6a3f32e16f1a",
  "zombie_pileup@srv-a1": "1/1/1 165:0a3a2230582ce615",
  "zombie_pileup@vm-web": "0/0/0 145:1764f6de45a3cb14",
  "fs_readonly@srv-a1": "1/1/1 173:0de0c175898e2802",
  "fs_readonly@vm-web": "0/0/0 153:0f6c6a3f32e16f1a",
  "ntp_drift@srv-a1": "1/1/1 173:0de0c175898e2802",
  "ntp_drift@vm-web": "0/0/0 153:0f6c6a3f32e16f1a",
  "dns_failure@srv-a1": "1/1/1 173:0de0c175898e2802",
  "dns_failure@vm-web": "0/0/0 153:0f6c6a3f32e16f1a",
  "kernel_panic@srv-a1": "1/1/1 173:0de0c175898e2802",
  "kernel_panic@vm-web": "0/0/0 153:0f6c6a3f32e16f1a",
  "cert_expired@srv-a1": "1/1/1 173:0de0c175898e2802",
  "cert_expired@vm-web": "0/0/0 153:0f6c6a3f32e16f1a",
  "storage_node_lost@stor-b": "0/0/0 145:0d4425bdf21eb70c",
  "ups_module_fail@ups-1": "6/2/3 322:031801780abf7500",
};

describe("the impact range of the fabric world is the recorded one [REQ-078] [REQ-001]", () => {
  test("fabric: every failure origin makes the recorded range", () => {
    expect(impactFingerprints(goldenWorld("fabric"))).toEqual(EXPECTED);
  }, 120_000);
});
