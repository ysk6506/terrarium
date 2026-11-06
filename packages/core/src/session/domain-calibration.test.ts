import { DOMAIN_TEMPLATES } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../world/test-support/service-lab";
import { calibrate, commonReach, recoveryPath } from ".";

const blueprint = serviceLab();
const index = new BlueprintIndex(blueprint);
const memory = DOMAIN_TEMPLATES[0] as (typeof DOMAIN_TEMPLATES)[number];

describe("the templates with the cause outside the agent's domain pass the discrimination check [REQ-093]", () => {
  for (const template of DOMAIN_TEMPLATES) {
    test(`${template.id}: a way back exists, the common tools reach the cause, and doing nothing earns nothing`, () => {
      const config = { blueprint, scenario: template.build(index, blueprint.id) };
      expect(recoveryPath(config)).toMatchObject({ applicable: true, ok: true });
      expect(commonReach(config)?.reached).toBe(true);
      const calibration = calibrate(config);
      expect(calibration.warnings).toEqual([]);
      expect(calibration.floor).toBeLessThanOrEqual(10);
    });
  }
});

describe("when nothing the agent's own tools do brings a service back, handing the fault to its team does [REQ-093]", () => {
  const noStandby = {
    ...blueprint,
    links: blueprint.links.filter((l) => !(l.kind === "service_on" && l.props.role === "standby")),
  };

  test("a service with no standby on a machine with bad memory comes back through the server team", () => {
    const scenario = memory.build(index, blueprint.id);
    const path = recoveryPath({ blueprint: noStandby, scenario });
    expect(path).toMatchObject({ applicable: true, ok: true, how: "escalate" });
    expect(path.note).toContain("서버 팀에 넘기면");
  });

  test("if the team would take longer than the task's time limit, the check says so", () => {
    const scenario = memory.build(index, blueprint.id);
    const tight = {
      ...scenario,
      nodes: scenario.nodes.map((n) =>
        n.type === "agent_task" ? { ...n, params: { ...n.params, timeLimitSeconds: 7200 } } : n,
      ),
    };
    const short = recoveryPath({ blueprint: noStandby, scenario: tight });
    expect(short.ok).toBe(false);
    expect(short.note).toContain("제한 시간 안에 돌아오지 않아요");
  });
});
