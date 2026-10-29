/**
 * The home page's window onto a world (REQ-006): the newest world's first room, turning slowly, read
 * only. Opened lazily so the home page itself needs no three.js until this arrives.
 */
import { BlueprintIndex } from "@terrarium/core/world";
import { useMemo } from "react";
import { builder } from "../../logic";
import { Stage } from "../builder/Stage";
import { catalog } from "../builder/useBuilder";
import { useApp, useAsync } from "../context";

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
  const shown = useMemo(() => {
    if (!world.data) return undefined;
    const index = new BlueprintIndex(world.data.blueprint);
    const level = builder.startLevel(index);
    return { level, scene: builder.sceneOf(index, catalog, level), grid: builder.gridOf(level) };
  }, [world.data]);
  if (!shown) return null;
  const fitKey = shown.level.kind === "site" ? "site" : shown.level.id;
  return (
    <div className="vitrine">
      <Stage scene={shown.scene} grid={shown.grid} fitKey={fitKey} readOnly label={caption} />
      <span className="vitrine-caption">{caption}</span>
    </div>
  );
}
