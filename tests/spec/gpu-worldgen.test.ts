import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_SHAPE, planShape } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, hasErrors, LADDER, validateBlueprint } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { shapedLab } from "./test-support/ladder-labs";

const catalog = new Catalog();
const lab = (layers: Record<string, string>, cards?: string[]) => {
  const bp = shapedLab({ layers, ...(cards ? { cards } : {}) });
  return { bp, index: new BlueprintIndex(bp) };
};
const ofKinds = (index: BlueprintIndex, kind: string) => index.ofKind(kind as never).length;

describe("worlds shaped by the accelerator chips [REQ-107]", () => {
  test("no GPU chip builds no GPU entities, and the old worlds are unchanged in kind", () => {
    const { index } = lab({ accel: "gpu-none" });
    for (const k of [
      "gpu",
      "nvlink_domain",
      "ib_fabric",
      "job_scheduler",
      "training_job",
      "inference_pool",
    ])
      expect(ofKinds(index, k), k).toBe(0);
  });

  test.each(LADDER.accel.filter((c) => c.id !== "gpu-none").map((c) => c.id))(
    "%s: a valid world with GPU servers on dense racks, and no room overlaps",
    (accel) => {
      const layers: Record<string, string> = { accel };
      if (accel === "gpu-training-cluster" || accel === "gpu-liquid-pod")
        layers.network = "net-leaf-spine";
      if (accel === "gpu-liquid-pod")
        Object.assign(layers, { cooling: "cool-liquid", power: "pwr-ab" });
      const { bp, index } = lab(layers, [
        accel === "gpu-serving-pool" ? "ai-serving" : "training-pipeline",
      ]);
      const issues = validateBlueprint(bp, catalog);
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(hasErrors(issues)).toBe(false);
      expect(ofKinds(index, "gpu")).toBeGreaterThan(0);
      expect(ofKinds(index, "nvlink_domain")).toBeGreaterThan(0);
    },
  );

  test("the training cluster has a fabric link per GPU server, a scheduler, a job with spares and a service on the job", () => {
    const { index } = lab({ accel: "gpu-training-cluster", network: "net-leaf-spine" }, [
      "training-pipeline",
    ]);
    const servers = new Set(index.ofKind("gpu").map((g) => String(g.props.server)));
    expect(ofKinds(index, "ib_link")).toBe(servers.size);
    expect(ofKinds(index, "ib_fabric")).toBe(1);
    const job = index.entity("train-job");
    expect(String(job.props.spares).split(",").length).toBe(2);
    expect(index.incoming("train-job", "depends_on").length).toBeGreaterThan(0);
  });

  test("the pod is on liquid: CDUs on dense racks that leave the room's air alone", () => {
    const { index } = lab(
      {
        accel: "gpu-liquid-pod",
        network: "net-leaf-spine",
        cooling: "cool-liquid",
        power: "pwr-ab",
      },
      ["training-pipeline"],
    );
    expect(ofKinds(index, "cdu")).toBeGreaterThanOrEqual(2);
    const dense = index.ofKind("rack").filter((r) => r.props.leakPolicy === "poweroff");
    expect(dense.length).toBeGreaterThan(0);
  });

  test("the plan counts GPUs, CDUs and the kilowatts the chips add", () => {
    const base = planShape(DEFAULT_SHAPE);
    const pod = planShape({
      ...DEFAULT_SHAPE,
      layers: {
        ...DEFAULT_SHAPE.layers,
        accel: "gpu-liquid-pod",
        network: "net-leaf-spine",
        cooling: "cool-liquid",
        power: "pwr-ab",
      },
    });
    expect(base.gpus).toBe(0);
    expect(base.cdus).toBe(0);
    expect(pod.gpus).toBeGreaterThan(0);
    expect(pod.cdus).toBeGreaterThanOrEqual(2);
    expect(pod.kw).toBeGreaterThan(base.kw);
    expect(pod.gpuKw).toBeGreaterThan(0);
  });
});

describe("worlds shaped by the power and cooling chips [REQ-107]", () => {
  test("the substation chip builds a substation with two transformers, an ATS per side and generators with fuel by the hour", () => {
    const { index } = lab({ power: "pwr-substation" });
    expect(ofKinds(index, "substation")).toBe(1);
    expect(ofKinds(index, "bbu")).toBeGreaterThan(0);
    expect(index.ofKind("generator").every((g) => typeof g.props.fuelLitres === "number")).toBe(
      true,
    );
  });

  test("N+1 UPS has one more UPS module than 2N, rack BBU adds a battery and a bus per rack with servers", () => {
    const two = ofKinds(lab({ power: "pwr-ab" }).index, "ups");
    expect(ofKinds(lab({ power: "pwr-n1-ups" }).index, "ups")).toBeGreaterThan(two);
    const bbu = lab({ power: "pwr-rack-bbu" }).index;
    expect(ofKinds(bbu, "bbu")).toBe(ofKinds(bbu, "dc_bus"));
  });

  test("rear doors and immersion tanks are entities on the racks they serve", () => {
    expect(ofKinds(lab({ cooling: "cool-rdhx" }).index, "rdhx")).toBeGreaterThan(0);
    expect(ofKinds(lab({ cooling: "cool-immersion" }).index, "immersion_tank")).toBeGreaterThan(0);
  });
});
