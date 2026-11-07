/**
 * What a building's real size and a floor's bare floor mean for the room picked (REQ-076, ADR-0081): a line that
 * says the building keeps the size of the real one and how much floor is left on this storey and the others.
 */
import type { Entity } from "@terrarium/core/world";
import { builder } from "../../logic";
import { Button } from "../kit";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

/** The storey and building a thing is on: a room's own, a floor's, or a building's (the level being looked at, else its first). */
function placeOf(
  b: Builder,
  entity: Entity | undefined,
): { building: string; floor?: string } | undefined {
  const { index, level } = b.state;
  const at = entity ?? (level.kind === "site" ? undefined : index.find(level.id));
  if (!at) return undefined;
  if (at.kind === "building") {
    const here = level.kind === "floor" ? index.enclosing(level.id, "building") : undefined;
    return here?.id === at.id && level.kind === "floor"
      ? { building: at.id, floor: level.id }
      : { building: at.id };
  }
  const floor = at.kind === "floor" ? at : index.enclosing(at.id, "floor");
  const building = floor ? index.enclosing(floor.id, "building") : undefined;
  return building && floor ? { building: building.id, floor: floor.id } : undefined;
}

/** "이 건물은 실제 크기예요 · 이 층 빈 바닥 N m² · 다른 층 M m²", with a button to each other floor that has room. */
export function RealSizeNote({ entity, b }: { readonly entity?: Entity; readonly b: Builder }) {
  const place = placeOf(b, entity);
  const note = place
    ? builder.floorNote(b.state.index, catalog, place.building, place.floor)
    : undefined;
  if (!note) return null;
  return (
    <div className="builder-block stack" data-testid="floor-note">
      <p className="small" data-testid="floor-note-text">
        {builder.floorNoteText(note)}
      </p>
      {note.floor && note.floor.coreM2 > 0 && (
        <p className="tiny muted">
          층 {builder.squareMetres(note.floor.floorM2)} 가운데 방과 클린룸 베이{" "}
          {builder.squareMetres(note.floor.roomsM2 + note.floor.bayM2)}, 승강기·계단·복도(코어){" "}
          {builder.squareMetres(note.floor.coreM2)}를 뺀 만큼이 비어 있어요. 옅은 초록으로 그려져
          있어요.
        </p>
      )}
      {note.others.length > 0 && (
        <div className="row">
          {note.others.slice(0, 3).map((f) => (
            <Button
              key={f.floorId}
              size="small"
              onClick={() => b.go({ kind: "floor", id: f.floorId })}
            >
              {f.name} {builder.squareMetres(f.freeM2)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
