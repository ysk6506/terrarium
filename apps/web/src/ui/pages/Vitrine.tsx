/**
 * The home page's window onto a world (REQ-006): the newest world's site, turning slowly with its
 * little visitors, so the page shows what the product is the moment it opens. Opened lazily so the
 * home page itself needs no three.js until this arrives.
 */
import { BlueprintIndex } from "@terrarium/core/world";
import { useMemo } from "react";
import { catalog } from "../builder/useBuilder";
import { useApp, useAsync } from "../context";
import { WorldStage } from "../world3d/WorldStage";

/** Slow enough to look still at a glance: one turn takes about three minutes. */
const SPIN_DEG_PER_S = 2;

export default function Vitrine({
  worldId,
  caption,
}: {
  readonly worldId: string;
  readonly caption: string;
}) {
  const { api } = useApp();
  const world = useAsync(
    (signal) => api.call("getWorld", { params: { id: worldId }, signal }),
    [worldId],
  );
  const index = useMemo(
    () => (world.data ? new BlueprintIndex(world.data.blueprint) : undefined),
    [world.data],
  );
  if (!index) return null;
  return (
    <div className="vitrine">
      <WorldStage index={index} catalog={catalog} readOnly label={caption} spin={SPIN_DEG_PER_S} />
      <span className="vitrine-caption">{caption}</span>
    </div>
  );
}
