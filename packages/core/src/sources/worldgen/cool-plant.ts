/**
 * The plant behind the CDUs of a room (REQ-107): dry coolers beside the building, one more than the heat needs (at least two),
 * every CDU wired to every one of them. A liquid loop with no plant behind it would never reject its heat.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintAssembler } from "@terrarium/core/sources";

const MODEL = "gl-drycooler-2mw";
const PLAN_SHARE = 0.6;

export function plantFor(
  site: { readonly asm: BlueprintAssembler; readonly catalog: Catalog },
  where: { readonly siteId: string; readonly building: string; readonly tag: string },
  cdus: readonly string[],
  loadKw: number,
): void {
  if (cdus.length === 0) return;
  const cap = site.catalog.getOf(MODEL, "chiller").capacityKw;
  const count = Math.max(2, Math.ceil(loadKw / (PLAN_SHARE * cap)) + 1);
  for (let i = 0; i < count; i++) {
    const id = `${where.building}-dry${i + 1}`;
    site.asm.yardItem(
      where.siteId,
      `${where.tag} 냉각수 플랜트`,
      {
        id,
        kind: "chiller",
        name: `${where.tag}-DC-${i + 1}`,
        modelId: MODEL,
        props: { loop: "cond" },
      },
      where.building,
    );
    for (const cdu of cdus) site.asm.link("cooling", cdu, id);
  }
}
