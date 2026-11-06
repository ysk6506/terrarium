import { DOMAIN_IDS } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { TOOL_NAMES, TOOL_SPECS } from "./catalog";
import {
  scopeTools,
  TOOL_DOMAIN,
  toolDomain,
  toolsForDomains,
  toolsWithoutDomain,
} from "./domains";

describe("every tool has a domain [REQ-093]", () => {
  test("each tool of the catalog is in the table, and the table names no tool that does not exist", () => {
    expect(toolsWithoutDomain()).toEqual([]);
    expect(Object.keys(TOOL_DOMAIN).filter((n) => !TOOL_NAMES.includes(n))).toEqual([]);
    for (const d of Object.values(TOOL_DOMAIN)) expect(["common", ...DOMAIN_IDS]).toContain(d);
  });

  test("the domains of the tools people know: the shell is service/OS, migrating a VM is virtualization, Redfish is server", () => {
    expect(toolDomain("run_command")).toBe("service_os");
    expect(toolDomain("migrate_vm")).toBe("virtualization");
    expect(toolDomain("redfish_request")).toBe("server");
    expect(toolDomain("eapi_request")).toBe("network");
    expect(toolDomain("reset_breaker")).toBe("facility");
    expect(toolDomain("list_alarms")).toBe("common");
    expect(toolDomain("not_a_tool")).toBe("common");
  });

  test("choosing domains keeps their tools and the common ones, drops the others, and adds escalate and events_since", () => {
    const network = toolsForDomains(["network"], TOOL_SPECS);
    expect(network).toEqual(
      expect.arrayContaining([
        "network_cli",
        "list_alarms",
        "escalate",
        "events_since",
        "submit_diagnosis",
      ]),
    );
    expect(network).not.toContain("run_command");
    expect(network).not.toContain("create_ticket");
    expect(scopeTools(["run_command", "network_cli"], ["network"])).toEqual([
      "network_cli",
      "escalate",
      "events_since",
    ]);
    expect(scopeTools(["run_command"], [])).toEqual(["run_command"]);
    expect(scopeTools(["run_command"], undefined)).toEqual(["run_command"]);
  });
});
