/**
 * The world each built-in scenario template is played in when `operator` is held to 100 (REQ-110, ADR-0133): the small
 * world of the layer's own tests where the baseline rows know one, else the first test world the template fits.
 */
import type { ScenarioTemplate } from "@terrarium/core/scenario";
import { ALL_SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { appLab } from "../../../packages/core/src/world/test-support/app-lab";
import { gpuLab } from "../../../packages/core/src/world/test-support/gpu-lab";
import { networkLab } from "../../../packages/core/src/world/test-support/net-lab";
import { campusBlueprint } from "../../../packages/core/src/world/test-support/sample-campus";
import { sdnLab } from "../../../packages/core/src/world/test-support/sdn-lab";
import { siteBlueprint } from "../site-support";
import { LAYER_ROWS, OTHER_ROWS } from "./baseline-worlds";
import { accelLab, powerLab } from "./ladder-labs";

const FALLBACK: ReadonlyArray<() => Blueprint> = [
  campusBlueprint,
  networkLab,
  gpuLab,
  () => sdnLab({ cloudNative: true }),
  () => appLab({ level: "mesh" }),
  () => siteBlueprint("warm"),
  () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" }),
  () => accelLab("gpu-serving-pool"),
  () => powerLab("pwr-substation"),
];

/** Where a template is played, by id, when the baseline rows do not say. */
const EXPLICIT: Readonly<Record<string, () => Blueprint>> = {
  "bgp-neighbor-shut": gpuLab,
  "gpu-rail-port-shut": gpuLab,
  "wrong-vlan-port": networkLab,
  "port-shut-by-mistake": networkLab,
  "gateway-interface-shut": networkLab,
  "static-route-removed": networkLab,
  "gpu-memory-leak": () => accelLab("gpu-serving-pool"),
  "nvlink-down": () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" }),
  "ib-link-flap": () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" }),
  "mig-misconfig": () => accelLab("gpu-serving-pool"),
  "scheduler-down-job": () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" }),
  "power-cap-rack-limit": () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" }),
  "power-cap-cooling-short": () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" }),
  "sidecar-crash": () => appLab({ level: "mesh" }),
  "cni-plugin-failure": () => sdnLab({ cloudNative: true }),
};

export interface Case {
  readonly id: string;
  readonly world: string;
  readonly blueprint: Blueprint;
  readonly template: ScenarioTemplate;
}

/** Every built-in template with the world it is played in. */
export function operatorCases(): Case[] {
  const rows = [...LAYER_ROWS, ...OTHER_ROWS];
  return ALL_SCENARIO_TEMPLATES.map((template) => {
    const row = rows.find((r) => r.template === template.id);
    const makers: Array<[string, () => Blueprint]> = [
      ...(row ? ([[row.world, row.make]] as Array<[string, () => Blueprint]>) : []),
      ...(EXPLICIT[template.id]
        ? ([["explicit", EXPLICIT[template.id]]] as Array<[string, () => Blueprint]>)
        : []),
      ...FALLBACK.map((f, i) => [`fallback ${i}`, f] as [string, () => Blueprint]),
    ];
    for (const [world, make] of makers) {
      const blueprint = make();
      if (!template.unavailable(new BlueprintIndex(blueprint)))
        return { id: template.id, world, blueprint, template };
    }
    throw new Error(`no world fits ${template.id}`);
  });
}

/** The same template in each world it is told apart by (a site that mends itself or not). */
export function siteModeCases(): Case[] {
  const template = ALL_SCENARIO_TEMPLATES.find(
    (t) => t.id === "site-power-loss",
  ) as ScenarioTemplate;
  return (["cold", "warm", "hot", "active"] as const).map((w) => ({
    id: `site-power-loss`,
    world: w,
    blueprint: siteBlueprint(w),
    template,
  }));
}
