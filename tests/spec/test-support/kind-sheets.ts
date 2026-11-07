/**
 * A probe sheet for each fault kind that no built-in template injects (REQ-110, ADR-0133): the fault on the first entity
 * it can be put on, in the first test world that has one, scored by the services' recovery like the layer sheets. The
 * reference solution is held to 100 on them as on the templates, so a fault kind never ends up outside the grader's reach.
 */
import {
  ALL_SCENARIO_TEMPLATES,
  dependents,
  layerTemplate,
  type ScenarioTemplate,
  servicesOf,
} from "@terrarium/core/scenario";
import {
  type Blueprint,
  BlueprintIndex,
  type Domain,
  FAULT_SPECS,
  type FaultType,
  LEAD_ROWS,
} from "@terrarium/core/world";
import { appLab } from "../../../packages/core/src/world/test-support/app-lab";
import { dbLab } from "../../../packages/core/src/world/test-support/db-lab";
import { gpuLab } from "../../../packages/core/src/world/test-support/gpu-lab";
import { k8sLab } from "../../../packages/core/src/world/test-support/k8s-lab";
import { networkLab } from "../../../packages/core/src/world/test-support/net-lab";
import { campusBlueprint } from "../../../packages/core/src/world/test-support/sample-campus";
import { sdnLab } from "../../../packages/core/src/world/test-support/sdn-lab";
import { siteBlueprint } from "../site-support";
import { accelLab, coolingLab, powerLab } from "./ladder-labs";

const WORLDS: ReadonlyArray<readonly [string, () => Blueprint]> = [
  ["campus", campusBlueprint],
  ["network", networkLab],
  ["gpu", gpuLab],
  ["sdn", () => sdnLab({ cloudNative: true })],
  ["app", () => appLab({ level: "mesh" })],
  ["site", () => siteBlueprint("warm")],
  ["train", () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" })],
  ["serve", () => accelLab("gpu-serving-pool")],
  ["power", () => powerLab("pwr-substation")],
  ["cooling", () => coolingLab("cool-liquid")],
  ["rdhx", () => coolingLab("cool-rdhx")],
  ["immersion", () => coolingLab("cool-immersion")],
  ["bbu", () => powerLab("pwr-rack-bbu")],
  ["pod", () => accelLab("gpu-liquid-pod", { network: "net-leaf-spine" })],
];

/** Where a kind is played when the first world with a target is not the one that layer is told in. */
const PREFER: Readonly<Partial<Record<FaultType, () => Blueprint>>> = {
  storage_controller_failure: () => dbLab({ shape: "shared_aa", storage: "dual" }),
  evpn_session_flap: () => sdnLab({}),
  nfv_firewall_overload: () => sdnLab({}),
  k8s_control_plane_down: () => k8sLab(),
  k8s_image_pull_failure: () => k8sLab(),
  k8s_cni_failure: () => k8sLab(),
  replication_lag_high: () => appLab({ level: "multiregion" }),
  db_secondary_down: () => dbLab({ shape: "replicated" }),
  db_backup_corrupt: () => dbLab({ shape: "single" }),
  db_leader_lost: () => siteBlueprint("raft"),
  db_node_lagging: () => siteBlueprint("raft"),
  db_az_failure: () => siteBlueprint("raft"),
  geo_replication_lag: () => siteBlueprint("warm"),
  dr_site_stale: () => siteBlueprint("warm"),
  wan_degraded: () => siteBlueprint("warm"),
  ups_module_fail: () => powerLab("pwr-n1-ups"),
  gpu_thermal_throttle: () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" }),
};

export interface KindCase {
  readonly id: string;
  readonly kind: FaultType;
  readonly world: string;
  readonly blueprint: Blueprint;
  readonly template: ScenarioTemplate;
}

/** The fault kinds that no built-in template injects. */
export const templateLessKinds = (): FaultType[] => {
  const used = new Set(ALL_SCENARIO_TEMPLATES.flatMap((t) => t.faultTypes));
  return FAULT_SPECS.filter((f) => f.status === "supported" && !used.has(f.type)).map(
    (f) => f.type,
  );
};

/** The kinds only a team can mend: the sheet allows the team's longest visit (a night and weekend surcharge included). */
const HANDOFF = new Set<FaultType>(["switch_failure", "nfv_firewall_overload"]);

function teamS(kind: FaultType): number {
  const row = LEAD_ROWS[kind];
  const longest =
    row.kind === "replace" && row.spareDefault === false ? (row.ordered?.[2] ?? 0) : row.spare[2];
  return longest + 600 + 300;
}

/** The kinds that belong on the last entity of their kind (the secondary of a pair), not the first. */
const LAST = new Set<FaultType>(["db_secondary_down"]);

function sheetFor(kind: FaultType, targetKinds: readonly string[]): ScenarioTemplate {
  const spec = FAULT_SPECS.find((f) => f.type === kind);
  const domain = (spec?.domain ?? "server") as Domain;
  const base = layerTemplate({
    id: `kind-${kind}`,
    name: spec?.label ?? kind,
    summary: spec?.description ?? kind,
    difficulty: "보통",
    fault: kind,
    find: (index) => {
      const all = targetKinds
        .flatMap((k) => [...index.ofKind(k as never)])
        .sort((a, b) => a.id.localeCompare(b.id));
      const target = LAST.has(kind) ? all.at(-1) : all[0];
      if (!target) return `no ${targetKinds.join("/")}`;
      const mine = dependents(index, target.id);
      // a fault in the plant touches no service by a link: the sheet asks that every service of the world is up at the end
      const services =
        mine.length > 0
          ? mine
          : servicesOf(
              index,
              [...index.ofKind("service")].map((e) => e.id),
            );
      return { target, roots: [target.id], services, where: target.name };
    },
    report: (c) => `${c.where}에서 알림이 왔다.`,
    waitS: 30,
    forbid: [],
    timeLimitS: HANDOFF.has(kind) ? 4 * 86_400 : 2 * 3600,
    budget: HANDOFF.has(kind) ? 500 : 40,
    own: [domain],
    cause: domain,
    recovery: true,
  });
  if (!HANDOFF.has(kind)) return base;
  return {
    ...base,
    build: (index, worldId) => ({ ...base.build(index, worldId), expectedRecoveryS: teamS(kind) }),
  };
}

/** One probe case per template-less kind, in the first world that has something to put the fault on. */
export function kindCases(): KindCase[] {
  return templateLessKinds().map((kind) => {
    const spec = FAULT_SPECS.find((f) => f.type === kind);
    const template = sheetFor(kind, spec?.targets ?? []);
    const preferred = PREFER[kind];
    const worlds = preferred ? ([["preferred", preferred], ...WORLDS] as typeof WORLDS) : WORLDS;
    for (const [world, make] of worlds) {
      const blueprint = make();
      if (!template.unavailable(new BlueprintIndex(blueprint)))
        return { id: template.id, kind, world, blueprint, template };
    }
    throw new Error(`no world has a target for ${kind}`);
  });
}
