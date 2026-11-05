/** How a hall is cooled, and what a rack is, for the 3D view (REQ-044). */
import type { Catalog, RackModel } from "@terrarium/core/catalog";
import { type BlueprintIndex, type Entity, isBulkRack } from "@terrarium/core/world";

export type CoolingMode = "air" | "hybrid" | "dlc" | "immersion";

export const COOLING_MODES: readonly CoolingMode[] = ["air", "hybrid", "dlc", "immersion"];

export const MODE_LABELS: Readonly<Record<CoolingMode, string>> = {
  air: "공랭",
  hybrid: "공랭+수랭",
  dlc: "직접수랭",
  immersion: "액침",
};

/** What a rack is built as: a plain rack, one with a rear-door coil, one with liquid manifolds, or a tank. */
export type RackForm = "air" | "rdhx" | "dlc" | "tank";

export function rackFormOf(model: RackModel | undefined): RackForm {
  if (!model) return "air";
  if (model.form === "tank" || model.cooling === "immersion") return "tank";
  if (model.cooling === "dlc") return "dlc";
  if (model.cooling === "rdhx") return "rdhx";
  return "air";
}

export function rackModelOf(catalog: Catalog, rack: Entity): RackModel | undefined {
  if (!rack.modelId || !catalog.has(rack.modelId)) return undefined;
  const model = catalog.get(rack.modelId);
  return model.kind === "rack" ? model : undefined;
}

const isMode = (value: unknown): value is CoolingMode => COOLING_MODES.some((m) => m === value);

/** The mode that a set of rack forms adds up to. */
export function modeOfForms(forms: ReadonlySet<RackForm>): CoolingMode {
  const air = forms.has("air");
  const liquid = forms.has("rdhx") || forms.has("dlc");
  const tank = forms.has("tank");
  if (!liquid && !tank) return "air";
  if (air || (liquid && tank) || (forms.has("rdhx") && forms.has("dlc"))) return "hybrid";
  if (tank) return "immersion";
  return forms.has("dlc") ? "dlc" : "hybrid";
}

/** How a data hall is cooled: what it says, else what its racks add up to; undefined for a hall with no racks. */
export function hallMode(
  index: BlueprintIndex,
  catalog: Catalog,
  room: Entity,
): CoolingMode | undefined {
  const said = room.props.cooling;
  if (isMode(said)) return said;
  const forms = new Set<RackForm>();
  for (const rack of racksIn(index, room.id)) forms.add(rackFormOf(rackModelOf(catalog, rack)));
  return forms.size === 0 ? undefined : modeOfForms(forms);
}

/** Racks standing in a room, whether on the floor or inside a containment. */
export function racksIn(index: BlueprintIndex, roomId: string): Entity[] {
  const direct = index.childrenOf(roomId, "rack");
  const inPods = index
    .childrenOf(roomId, "containment")
    .flatMap((pod) => index.childrenOf(pod.id, "rack"));
  return [...direct, ...inPods];
}

/** Servers a rack holds: its own, or what a light rack counts. */
export function serversIn(index: BlueprintIndex, rack: Entity): number {
  if (isBulkRack(rack)) return Number(rack.props.bulkServers) || 0;
  return index.childrenOf(rack.id, "server").length;
}
