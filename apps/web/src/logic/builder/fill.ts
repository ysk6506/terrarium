/**
 * "서버룸 채우기" (REQ-043, REQ-047): racks in rows with the aisles sealed or not, servers in them, and the cooling,
 * panels and UPS to carry them, wired the way a data centre is (see wiring.ts for the rules). Only an empty room is
 * filled, so nothing a person put there is touched; undo takes it all back at once.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { RACK_DEPTH_M, RACK_UNITS_DEFAULT, RACK_WIDTH_M, withJosa } from "@terrarium/core/kernel";
import {
  type Blueprint,
  BlueprintIndex,
  type Entity,
  footprint,
  type Link,
  type LinkKind,
  roomPurposeOf,
} from "@terrarium/core/world";
import { type Edit, EditError, nextId, nextName } from "./edit";
import {
  type At,
  FILL_MODELS,
  type FillAisle,
  type FillOptions,
  facing,
  type PodPlan,
  planRoom,
  type RoomPlan,
} from "./fill-plan";
import { assertPower } from "./power";

export interface Fill extends Edit {
  readonly racks: number;
  readonly servers: number;
  readonly coolingUnits: number;
}

/** Hands out the next ids and names of a kind without scanning the blueprint again for each one. */
class Counters {
  private readonly ids = new Map<string, { prefix: string; n: number }>();
  private readonly names = new Map<string, { word: string; n: number }>();

  constructor(private readonly index: BlueprintIndex) {}

  id(kind: Entity["kind"] | "link"): string {
    let c = this.ids.get(kind);
    if (!c) {
      const first = nextId(this.index, kind);
      const cut = first.lastIndexOf("-");
      c = { prefix: first.slice(0, cut), n: Number(first.slice(cut + 1)) - 1 };
      this.ids.set(kind, c);
    }
    c.n++;
    return `${c.prefix}-${c.n}`;
  }

  name(kind: Entity["kind"], base?: string): string {
    let c = this.names.get(kind);
    if (!c) {
      const first = nextName(this.index, kind, undefined, base);
      const cut = first.lastIndexOf(" ");
      c = { word: first.slice(0, cut), n: Number(first.slice(cut + 1)) - 1 };
      this.names.set(kind, c);
    }
    c.n++;
    return `${c.word} ${c.n}`;
  }
}

interface Build {
  readonly counters: Counters;
  readonly entities: Entity[];
  readonly links: Link[];
}

const spot = (a: At) => ({ type: "spot" as const, x: a.x, y: a.y, rotation: a.rotation });

function add(b: Build, e: Omit<Entity, "props"> & { props?: Entity["props"] }): Entity {
  const entity: Entity = { props: {}, ...e };
  b.entities.push(entity);
  return entity;
}

function connect(b: Build, kind: LinkKind, from: string, to: string): void {
  b.links.push({ id: b.counters.id("link"), kind, from, to, props: {} });
}

interface Standing {
  readonly id: string;
  /** Where along the room it stands, 0 at the west wall to 1 at the east wall. */
  readonly along: number;
  readonly pduA?: string;
  readonly pduB?: string;
}

/** The racks of one pair of rows, and the aisle round them when it is sealed. */
function emitPod(
  b: Build,
  roomId: string,
  pod: PodPlan,
  aisle: FillAisle,
  roomW: number,
): Standing[] {
  let parent = roomId;
  if (aisle !== "none") {
    const hot = aisle === "hot";
    parent = add(b, {
      id: b.counters.id("containment"),
      kind: "containment",
      name: b.counters.name("containment", hot ? "열복도" : "냉복도"),
      parentId: roomId,
      placement: {
        type: "area",
        x: pod.x,
        y: pod.y,
        w: pod.perRow * RACK_WIDTH_M,
        d: 2 * RACK_DEPTH_M + 1.2,
      },
      props: { aisle },
    }).id;
  }
  const out: Standing[] = [];
  for (const row of [0, 1] as const)
    for (let col = 0; col < pod.perRow; col++) {
      const x = Math.round((pod.x + col * RACK_WIDTH_M) * 1000) / 1000;
      const y = Math.round((pod.y + (row === 0 ? 0 : RACK_DEPTH_M + 1.2)) * 1000) / 1000;
      const rack = add(b, {
        id: b.counters.id("rack"),
        kind: "rack",
        name: b.counters.name("rack"),
        parentId: parent,
        placement: spot({ x, y, rotation: facing(aisle, row) }),
        props: { units: RACK_UNITS_DEFAULT },
      });
      out.push({ id: rack.id, along: (x + RACK_WIDTH_M / 2) / roomW });
    }
  return out;
}

const unit = (u: number) => ({ type: "unit" as const, u });

/** Two PDUs, a ToR switch at the top and servers from the bottom up; every device on both PDUs. */
function fillRack(b: Build, rack: Standing, servers: number): Standing {
  const mount = (kind: Entity["kind"], modelId: string, u: number, name: string, props = {}) =>
    add(b, {
      id: b.counters.id(kind),
      kind,
      name,
      parentId: rack.id,
      modelId,
      placement: unit(u),
      props,
    });
  const pduA = mount("pdu", FILL_MODELS.pdu, 1, "PDU A", { feed: "A" });
  const pduB = mount("pdu", FILL_MODELS.pdu, 1, "PDU B", { feed: "B" });
  const tor = mount("switch", FILL_MODELS.tor, RACK_UNITS_DEFAULT, b.counters.name("switch"));
  const devices = [tor];
  for (let u = 1; u <= servers; u++)
    devices.push(mount("server", FILL_MODELS.server, u, b.counters.name("server")));
  for (const d of devices) {
    connect(b, "power", d.id, pduA.id);
    connect(b, "power", d.id, pduB.id);
    if (d.kind === "server") connect(b, "network", d.id, tor.id);
  }
  return { ...rack, pduA: pduA.id, pduB: pduB.id };
}

/** Cooling units, panels and UPS where the plan puts them, and the cables between them and to the racks. */
function emitEquipment(b: Build, roomId: string, plan: RoomPlan, racks: readonly Standing[]): void {
  const stand = (kind: Entity["kind"], modelId: string, at: At, name: string) =>
    add(b, { id: b.counters.id(kind), kind, name, parentId: roomId, modelId, placement: spot(at) })
      .id;
  const cooling = plan.cooling.map((at) =>
    stand("cooling_unit", FILL_MODELS.cooling, at, b.counters.name("cooling_unit", "항온항습기")),
  );
  const upsA = plan.upsA.map((at) => stand("ups", plan.upsModel, at, b.counters.name("ups")));
  const upsB = plan.upsB.map((at) => stand("ups", plan.upsModel, at, b.counters.name("ups")));
  const panelsA = plan.panelsA.map((at) =>
    stand("power_panel", FILL_MODELS.panel, at, b.counters.name("power_panel")),
  );
  const panelsB = plan.panelsB.map((at) =>
    stand("power_panel", FILL_MODELS.panel, at, b.counters.name("power_panel")),
  );
  panelsA.forEach((p, i) => {
    connect(b, "power", p, upsA[i % upsA.length] as string);
  });
  panelsB.forEach((p, i) => {
    connect(b, "power", p, upsB[i % upsB.length] as string);
  });
  cooling.forEach((c, j) => {
    const side = j % 2 === 0 ? panelsA : panelsB;
    connect(b, "power", c, side[Math.floor(j / 2) % side.length] as string);
  });
  racks.forEach((rack, i) => {
    if (rack.pduA) connect(b, "power", rack.pduA, panelsA[i % panelsA.length] as string);
    if (rack.pduB) connect(b, "power", rack.pduB, panelsB[i % panelsB.length] as string);
    const first = Math.min(cooling.length - 1, Math.floor(rack.along * cooling.length));
    for (const j of new Set([first, (first + 1) % cooling.length]))
      connect(b, "cooling", rack.id, cooling[j] as string);
  });
}

/** Fill an empty server room: racks, servers, cooling and power, all wired. */
export function fillRoom(
  bp: Blueprint,
  catalog: Catalog,
  roomId: string,
  options: FillOptions,
): Fill {
  const index = new BlueprintIndex(bp);
  const room = index.entity(roomId);
  if (room.kind !== "room" || roomPurposeOf(room) !== "data_hall")
    throw new EditError(`${withJosa(room.name, "은")} 서버룸이 아니에요`);
  if (index.childrenOf(roomId).length > 0)
    throw new EditError(
      `${room.name}에는 이미 놓인 것이 있어요. 비어 있는 서버룸만 채울 수 있어요`,
    );
  const rect = footprint(room, catalog);
  if (!rect) throw new EditError(`${withJosa(room.name, "은")} 크기를 알 수 없어요`);
  const plan = planRoom(catalog, rect.w, rect.d, options.load);
  const b: Build = { counters: new Counters(index), entities: [], links: [] };
  let racks = plan.pods.flatMap((pod) => emitPod(b, roomId, pod, options.aisle, rect.w));
  if (options.load !== "empty") racks = racks.map((r) => fillRack(b, r, plan.serversPerRack));
  else racks = racks.map((r) => ({ ...r }));
  emitEquipment(b, roomId, plan, racks);
  const next = {
    ...bp,
    entities: [...bp.entities, ...b.entities],
    links: [...bp.links, ...b.links],
  };
  assertPower(bp, next, catalog);
  return {
    blueprint: next,
    select: [],
    racks: plan.racks,
    servers: options.load === "empty" ? 0 : plan.racks * plan.serversPerRack,
    coolingUnits: plan.cooling.length,
  };
}
