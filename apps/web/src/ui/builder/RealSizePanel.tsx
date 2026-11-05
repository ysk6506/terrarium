/**
 * What a building's real size and a floor's bare floor mean for the room picked (REQ-076, ADR-0081): a line that
 * says the building keeps the size of the real one and how much floor is left on this storey and the others, and
 * the section that says where a room's cooling and power come from, with the ways to put more of them outside it.
 */
import { type Entity, type RoomPurpose, roomPurposeOf } from "@terrarium/core/world";
import { builder } from "../../logic";
import { Button, Note } from "../kit";
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

function Groups({
  title,
  groups,
}: {
  readonly title: string;
  readonly groups: readonly builder.SourceGroup[];
}) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="small" style={{ fontWeight: 600 }}>
        {title}
      </div>
      {groups.length === 0 && <div className="tiny muted">연결된 것이 아직 없어요</div>}
      {groups.slice(0, 6).map((g) => (
        <div key={`${g.what}|${g.where}`} className="small">
          {g.what} {g.count}대 · <span className="muted">{g.where}</span>
        </div>
      ))}
      {groups.length > 6 && <div className="tiny muted">그 밖에 {groups.length - 6}가지 더</div>}
    </div>
  );
}

/** Take the person to a place and put the tool in their hand. */
function goAndPick(b: Builder, way: builder.OutsideWay): void {
  b.go(way.level);
  setTimeout(() => b.setTool(way.tool), 0);
}

function Ways({
  room,
  what,
  b,
}: {
  readonly room: Entity;
  readonly what: "cooling" | "power";
  readonly b: Builder;
}) {
  const ways = builder.outsideWays(b.state.index, room.id, what);
  return (
    <div className="row">
      {ways.map((w) => (
        <Button key={w.key} size="small" onClick={() => goAndPick(b, w)}>
          {w.label}
        </Button>
      ))}
    </div>
  );
}

const NO_EQUIPMENT: ReadonlySet<RoomPurpose> = new Set(["storage", "lobby", "cleanroom"]);

/** "이 방의 냉방·전력은 어디서": the units that cool and feed the room, and where more of them can stand outside it. */
export function SourcesPanel({ room, b }: { readonly room: Entity; readonly b: Builder }) {
  // A storeroom, a lobby or a cleanroom bay has nothing in it that needs cooling or feeding.
  if (NO_EQUIPMENT.has(roomPurposeOf(room))) return null;
  const sources = builder.roomSources(b.state.index, catalog, room.id);
  return (
    <div className="builder-block stack" data-testid="sources-panel">
      <Groups title="냉방" groups={sources.cooling} />
      <Ways room={room} what="cooling" b={b} />
      <Groups title="전기" groups={sources.power} />
      <Ways room={room} what="power" b={b} />
      <p className="tiny muted">
        설비는 방 밖에도 놓아요. 같은 층 기계실·전기실이나 건물 밖 마당에 놓고 방의 랙에 이어요.
      </p>
    </div>
  );
}

/** The power a site draws against its grid connection, on the site's page. */
export function PowerLine({ b }: { readonly b: Builder }) {
  const use = builder.siteUse(b.state.blueprint, catalog);
  if (!use) return null;
  const share = use.usedW / (use.capacity.mw * 1e6);
  return (
    <Note tone={share > 0.95 ? "bad" : share > 0.8 ? "warn" : undefined}>
      <span data-testid="site-power">
        수전 용량 {builder.siteUseText(use)}를 쓰고 있어요
        {use.capacity.estimated ? ". 이 용량은 사업장 규모로 짐작한 값이에요" : ""}
      </span>
    </Note>
  );
}
