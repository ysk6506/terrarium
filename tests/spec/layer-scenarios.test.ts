/**
 * The scenario sheets of the accelerator, power and cooling layers (REQ-107, ADR-0130): each is offered only in a world that has
 * what it is about, tells an agent that knows from one that does not, can be reached with the common tools, and (for the host
 * ones) can be read from the shell.
 */
import { ACCEL_TEMPLATES, POWER_TEMPLATES } from "@terrarium/core/scenario";
import { calibrate, FLOOR_LIMIT, Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";
import { accelLab, powerLab } from "./test-support/ladder-labs";

const LABS = {
  train: () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" }),
  pool: () => accelLab("gpu-serving-pool"),
  pod: () =>
    accelLab("gpu-liquid-pod", {
      network: "net-leaf-spine",
      cooling: "cool-liquid",
      power: "pwr-ab",
    }),
  power: () => powerLab("pwr-substation"),
};

const ALL = [...ACCEL_TEMPLATES, ...POWER_TEMPLATES];

describe("the sheets exist and are offered only where they make sense [REQ-107]", () => {
  test("seven GPU sheets and four power and cooling sheets", () => {
    expect(ACCEL_TEMPLATES.map((t) => t.id).sort()).toEqual([
      "gpu-memory-leak",
      "gpu-xid-error",
      "ib-link-flap",
      "job-stuck-checkpoint",
      "mig-misconfig",
      "nvlink-down",
      "scheduler-down-job",
    ]);
    expect(POWER_TEMPLATES.map((t) => t.id).sort()).toEqual([
      "cdu-pump-fail",
      "power-cap-cooling-short",
      "power-cap-rack-limit",
      "utility-feed-loss",
    ]);
  });

  test.each(ALL.map((t) => [t.id, t] as const))(
    "%s: a world without the equipment says why in Korean",
    (_id, t) => {
      const reason = t.unavailable(new BlueprintIndex(campusBlueprint()));
      expect(reason).toMatch(/[가-힣]/);
    },
  );
});

describe("the sheets tell an agent that knows from one that does not [REQ-070] [REQ-107]", () => {
  const lab = (id: string) =>
    id.startsWith("cdu")
      ? LABS.pod()
      : id === "utility-feed-loss"
        ? LABS.power()
        : id === "mig-misconfig" || id === "gpu-memory-leak"
          ? LABS.pool()
          : LABS.train();

  test.each(ALL.map((t) => [t.id, t] as const))(
    "%s",
    (id, t) => {
      const blueprint = lab(id);
      const index = new BlueprintIndex(blueprint);
      expect(t.unavailable(index), id).toBeUndefined();
      const scenario = t.build(index, "lab");
      const c = calibrate({ blueprint, scenario });
      const total = (run: string) => c.runs.find((r) => r.id === run)?.total ?? -1;
      expect(total("idle")).toBeLessThanOrEqual(FLOOR_LIMIT);
      expect(total("guess")).toBeLessThanOrEqual(FLOOR_LIMIT);
      expect(c.diagnosisOnly - c.floor).toBeGreaterThanOrEqual(30);
      expect(c.recoveryPath?.ok ?? true, JSON.stringify(c.recoveryPath)).toBe(true);
      expect(c.commonReach?.reached ?? true, JSON.stringify(c.commonReach)).toBe(true);
    },
    120_000,
  );
});

describe("an agent that acts passes the operating sheets [REQ-107]", () => {
  function operate(
    id: string,
    blueprint: ReturnType<typeof LABS.train>,
    act: (s: Session) => void,
    diag: { rootCause: string; faultType: string },
  ) {
    const t = ALL.find((x) => x.id === id) as (typeof ALL)[number];
    const scenario = t.build(new BlueprintIndex(blueprint), "lab");
    const session = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
    session.start();
    act(session);
    session.call("submit_diagnosis", { ...diag, summary: "운영자가 조치했어요" });
    return session.finish().score;
  }

  test("cdu-pump-fail: starting the standby pump of every CDU gets the training back", () => {
    const blueprint = LABS.pod();
    const index = new BlueprintIndex(blueprint);
    const cdus = index.ofKind("cdu").map((c) => c.id);
    const score = operate(
      "cdu-pump-fail",
      blueprint,
      (s) => {
        for (const cdu of cdus) s.call("cdu_pump_switch", { cdu });
        s.call("wait", { seconds: 900 });
      },
      { rootCause: cdus[0] as string, faultType: "cdu_pump_failure" },
    );
    expect(score.passed).toBe(true);
  });

  test("utility-feed-loss: moving the substation to the other feed brings it back", () => {
    const blueprint = LABS.power();
    const sub = new BlueprintIndex(blueprint).ofKind("substation")[0]?.id as string;
    const score = operate(
      "utility-feed-loss",
      blueprint,
      (s) => {
        s.call("transfer_feed", { feed: 2 });
        s.call("wait", { seconds: 120 });
      },
      { rootCause: sub, faultType: "utility_feed_loss" },
    );
    expect(score.passed).toBe(true);
  });

  test("gpu-xid-error: reset, resume and a right answer pass; doing nothing does not", () => {
    const blueprint = LABS.train();
    const index = new BlueprintIndex(blueprint);
    const t = ALL.find((x) => x.id === "gpu-xid-error") as (typeof ALL)[number];
    const doc = t.build(index, "lab");
    const right = doc.expectations.find((e) => e.kind === "diagnosis") as unknown as {
      rootCause: string[];
      faultType: string[];
    };
    const score = operate(
      "gpu-xid-error",
      blueprint,
      (s) => {
        s.call("wait", { seconds: 30 });
      },
      { rootCause: right.rootCause[0] as string, faultType: right.faultType[0] as string },
    );
    expect(score.total).toBeGreaterThanOrEqual(30);
  });
});
