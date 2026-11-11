import { describe, expect, test } from "vitest";
import { ACTIONS } from "./permissions";
import { ROUTES, type RouteSpec } from "./routes";

const routes = Object.entries(ROUTES) as [string, RouteSpec][];

describe("every route says who may call it [REQ-054]", () => {
  test("[REQ-054] a route with no declared policy fails here, so a new route cannot be left open by forgetting", () => {
    const undeclared = routes.filter(([, r]) => !r.public && r.policy === undefined);
    expect(undeclared.map(([name]) => name)).toEqual([]);
  });

  test("[REQ-054] a route is public or has a policy, never both", () => {
    for (const [name, r] of routes)
      expect(r.public !== undefined && r.policy !== undefined, name).toBe(false);
  });

  test("[REQ-054] a policy is open, signedIn, admin or one named action the server knows", () => {
    const known = new Set<string>(ACTIONS);
    for (const [name, r] of routes) {
      const p = r.policy;
      if (p === undefined) continue;
      if (typeof p === "string") expect(["open", "signedIn", "admin"], name).toContain(p);
      else expect(known.has(p.action), `${name}: ${p.action}`).toBe(true);
    }
  });

  test("[REQ-054] only the share link is public, and only meta is open to a caller who has not said who they are", () => {
    expect(routes.filter(([, r]) => r.public).map(([n]) => n)).toEqual(["sharedReport"]);
    expect(routes.filter(([, r]) => r.policy === "open").map(([n]) => n)).toEqual(["meta"]);
  });

  test("[REQ-054] every action in the closed list is used by some route or by the server's own checks, and none is spelled twice", () => {
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
    const used = new Set(
      routes.flatMap(([, r]) => (typeof r.policy === "object" ? [r.policy.action] : [])),
    );
    // `administer` is what the policy `admin` stands for; the other actions are each named by a route
    for (const action of ACTIONS)
      if (action !== "administer") expect(used.has(action), action).toBe(true);
  });

  test("[REQ-054] what the survey found open before is now guarded by a named policy", () => {
    const policyOf = (name: string) => (ROUTES as Record<string, RouteSpec>)[name]?.policy;
    expect(policyOf("tryConnection")).toEqual({ action: "use" });
    expect(policyOf("keepConnection")).toEqual({ action: "use" });
    expect(policyOf("recheckConnection")).toEqual({ action: "use" });
    expect(policyOf("checkModel")).toEqual({ action: "use" });
    expect(policyOf("setDefaultModel")).toBe("admin");
    expect(policyOf("importWorld")).toBe("admin");
    expect(policyOf("calibrateScenario")).toEqual({ action: "calibrate" });
    expect(policyOf("createShare")).toEqual({ action: "createShare" });
    expect(policyOf("putCurrentProcess")).toEqual({ action: "editProcess" });
    expect(policyOf("createExperiment")).toEqual({ action: "use" });
    expect(policyOf("forkExperiment")).toEqual({ action: "use" });
  });
});
