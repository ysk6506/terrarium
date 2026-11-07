/**
 * Every fault REQ-106 added is in every table a fault must be in (ADR-0129): its domain, its lead time, the tools that cure
 * it, what an agent can do about it, how often it happens, and a golden key in a world that has it.
 */
import { readFileSync } from "node:fs";
import { CONTROL_ROWS, FAULT_RESPONSES, FAULT_TOOLS } from "@terrarium/core/scenario";
import { MTBF_TABLE } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { FAULT_SPECS, type FaultType, faultDomain, LEAD_ROWS } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";

const SITE_FAULTS = [
  "site_power_loss",
  "wan_link_down",
  "wan_degraded",
  "replication_broken",
  "dr_failover_stuck",
  "split_brain",
  "dr_site_stale",
  "geo_replication_lag",
  "geo_replica_broken",
  "db_leader_lost",
  "db_quorum_lost",
  "db_node_lagging",
  "db_az_failure",
  "db_failover_flapping",
  "db_storage_full",
] as const satisfies readonly FaultType[];

const golden = JSON.parse(
  readFileSync(new URL("./physics-golden.json", import.meta.url), "utf8"),
) as Record<string, Record<string, string>>;

describe("the fifteen faults of REQ-106 are in every table [REQ-106]", () => {
  test.each(SITE_FAULTS)("%s", (type) => {
    const spec = FAULT_SPECS.find((s) => s.type === type);
    expect(spec?.status).toBe("supported");
    expect(faultDomain(type), "domain").toBeTruthy();
    expect(LEAD_ROWS[type], "lead time").toBeDefined();
    expect(FAULT_TOOLS[type], "tools").toBeDefined();
    for (const tool of FAULT_TOOLS[type].tools) expect(TOOL_NAMES, tool).toContain(tool);
    expect(FAULT_RESPONSES[type], "response").toBeDefined();
    for (const via of FAULT_RESPONSES[type].via)
      expect(
        CONTROL_ROWS.map((r) => r.id),
        via,
      ).toContain(via);
    expect(
      MTBF_TABLE.some((m) => m.type === type),
      "how often",
    ).toBe(true);
    const worlds = ["site dr lab", "geo storage lab", "distributed db lab"];
    expect(
      worlds.some((w) => golden[w]?.[`${type}: during`] && golden[w]?.[`${type}: after`]),
      "golden key",
    ).toBe(true);
  });

  test("a fault that is cured by a tool says which tool, and one that is only handed over says so", () => {
    expect(FAULT_TOOLS.site_power_loss.tools).toContain("dr_failover");
    expect(FAULT_TOOLS.dr_failover_stuck.tools).toContain("dr_failover");
    expect(FAULT_TOOLS.db_quorum_lost.tools).toContain("db_node_restart");
    expect(FAULT_TOOLS.db_failover_flapping.tools).toContain("db_managed_failover");
    expect(FAULT_TOOLS.db_storage_full.tools).toContain("db_managed_scale_storage");
    expect(FAULT_TOOLS.wan_link_down.tools).toEqual([]);
    expect(FAULT_TOOLS.geo_replica_broken.tools).toEqual([]);
    expect(FAULT_RESPONSES.wan_link_down.remedy).toBe("diagnose");
  });
});
