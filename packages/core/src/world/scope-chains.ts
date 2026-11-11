/** For a scoped physics number (REQ-113): an entity's own id, its model and the places it stands in, nearest first. */
import type { BlueprintIndex } from "./graph";

export class ScopeChains {
  private readonly chains = new Map<string, readonly string[]>();

  constructor(private readonly index: BlueprintIndex) {}

  of(id: string): readonly string[] {
    let ids = this.chains.get(id);
    if (!ids) {
      const found: string[] = [];
      for (
        let e = this.index.find(id);
        e && found.length <= 64;
        e = e.parentId ? this.index.find(e.parentId) : undefined
      ) {
        found.push(e.id);
        if (e.modelId) found.push(e.modelId);
      }
      ids = found;
      this.chains.set(id, ids);
    }
    return ids;
  }
}
