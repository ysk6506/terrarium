/**
 * The size of a "서비스부터" world as three numbers (REQ-109, ADR-0132): server rooms, racks in a room, servers in a
 * rack. The starting values come from what the services carry (`ServiceLoad`): servers needed = what the requests, the
 * people, the data and the GPU hours each ask for, summed, with background servers on top. What the chosen shape needs
 * beyond that (a second site mirrors everything, a training cluster stands in GPU racks, a room a choice insists on) is
 * added by `planShape` and said in one line by `sizingNotes`. A spec that only has the old `servers` still works: it
 * means the same world as before, and `sizeFromServers` maps it onto the three numbers.
 */
import { IAP_LOAD, type ServiceLoad, wholeLoad as whole } from "@terrarium/core/world";
import type { ServiceDraft, ShapePlan, ShapeSpec } from "./shaped-plan";

export interface SizeAsk {
  readonly rooms: number;
  readonly racksPerRoom: number;
  readonly perRack: number;
}

export const SIZE_LIMITS = {
  rooms: { min: 1, max: 8 },
  racksPerRoom: { min: 1, max: 228 },
  perRack: { min: 4, max: 22 },
  servers: { min: 12, max: 4_800 },
} as const;

/** Per server: 50 requests a second, 100 people at once, 250 GB of data, 100 GPU hours a month. */
export const PER_SERVER = { rps: 50, users: 100, dataGB: 250, gpuHours: 100 } as const;
/** Background servers (what the agent has to search through) for each server a service needs, and the least a world has. */
export const BACKGROUND = { perNeeded: 4, least: 120 } as const;
/** The servers a default rack holds, and the racks a room holds comfortably. */
export const DEFAULT_PER_RACK = 20;
export const ROOM_RACKS_COMFORT = 48;

/** What a service without numbers (an older spec, a custom one) is taken to carry. */
export const GUESS_LOAD: ServiceLoad = { rps: 100, dataGB: 500, users: 200, maxDowntimeS: 300 };

export const loadOf = (s: Pick<ServiceDraft, "key" | "load">): ServiceLoad =>
  s.load ?? (s.key === "iap" ? IAP_LOAD : GUESS_LOAD);

/** Servers one service needs: the requests, the people, the data and the GPU hours each ask for. */
export function serversForLoad(load: ServiceLoad): number {
  const w = whole(load);
  return (
    Math.ceil(w.rps / PER_SERVER.rps) +
    Math.ceil(w.users / PER_SERVER.users) +
    Math.ceil(w.dataGB / PER_SERVER.dataGB) +
    Math.ceil(w.gpuHours / PER_SERVER.gpuHours)
  );
}

export const workloadServers = (services: readonly Pick<ServiceDraft, "key" | "load">[]): number =>
  services.reduce((n, s) => n + serversForLoad(loadOf(s)), 0);

export const askTotal = (a: SizeAsk): number => a.rooms * a.racksPerRoom * a.perRack;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Rooms and racks that fit `servers` at `perRack` to a rack: a room holds about 48 racks before another is opened. */
export function sizeFor(servers: number, perRack = DEFAULT_PER_RACK): SizeAsk {
  const per = clamp(Math.round(perRack), SIZE_LIMITS.perRack.min, SIZE_LIMITS.perRack.max);
  const racks = Math.max(3, Math.ceil(servers / per));
  const rooms = clamp(Math.ceil(racks / ROOM_RACKS_COMFORT), 1, SIZE_LIMITS.rooms.max);
  return {
    rooms,
    racksPerRoom: clamp(Math.ceil(racks / rooms), 1, SIZE_LIMITS.racksPerRoom.max),
    perRack: per,
  };
}

/** The sizing a world starts with: what its services need, times the background, at least 120 servers. */
export function defaultSize(services: readonly Pick<ServiceDraft, "key" | "load">[]): SizeAsk {
  const servers = Math.max(BACKGROUND.least, workloadServers(services) * BACKGROUND.perNeeded);
  return sizeFor(Math.min(servers, SIZE_LIMITS.servers.max));
}

/** The three numbers an old spec's single `servers` stands for. */
export const sizeFromServers = (servers: number): SizeAsk => sizeFor(servers);

/** The three numbers a spec asks for, or undefined for an old spec that only has `servers`. */
export function askOf(
  spec: Pick<ShapeSpec, "rooms" | "racksPerRoom" | "perRack">,
): SizeAsk | undefined {
  const { rooms, racksPerRoom, perRack } = spec;
  return rooms !== undefined && racksPerRoom !== undefined && perRack !== undefined
    ? { rooms, racksPerRoom, perRack }
    : undefined;
}

/** Share of a rack's units filled for this many servers a rack (20 is the 0.8 the generator always used). */
export const fillFor = (perRack: number): number =>
  clamp(Math.round((perRack / 25) * 100) / 100, 0.1, 0.9);

/** What is wrong with the three numbers, in words, or undefined. */
export function sizeProblem(ask: SizeAsk): string | undefined {
  const { rooms, racksPerRoom, perRack, servers } = SIZE_LIMITS;
  const bad = (v: number, r: { min: number; max: number }) =>
    !Number.isInteger(v) || v < r.min || v > r.max;
  if (bad(ask.rooms, rooms)) return `서버룸은 ${rooms.min}~${rooms.max}곳 사이로 정해요`;
  if (bad(ask.racksPerRoom, racksPerRoom))
    return `룸당 랙은 ${racksPerRoom.min}~${racksPerRoom.max}대 사이로 정해요`;
  if (bad(ask.perRack, perRack)) return `랙당 서버는 ${perRack.min}~${perRack.max}대 사이로 정해요`;
  const total = askTotal(ask);
  if (total < servers.min || total > servers.max)
    return `서버는 모두 ${servers.min}~${servers.max.toLocaleString("ko-KR")}대 사이로 정해요 (지금 ${total.toLocaleString("ko-KR")}대)`;
  return undefined;
}

/** The three numbers as the spec carries them (and `servers`, their product, for readers of the old field). */
export const sizeFields = (
  ask: SizeAsk,
): Pick<ShapeSpec, "servers" | "rooms" | "racksPerRoom" | "perRack"> => ({
  servers: askTotal(ask),
  rooms: ask.rooms,
  racksPerRoom: ask.racksPerRoom,
  perRack: ask.perRack,
});

/**
 * One line on what the shape added on top of the three numbers, or nothing when it added nothing: a second site
 * mirrors rooms, racks and servers; a training cluster stands in GPU racks; a choice may insist on more rooms; and
 * a service may need more hosts than the servers asked for.
 */
export function sizingNotes(ask: SizeAsk, plan: ShapePlan): string[] {
  const notes: string[] = [];
  if (plan.buildings > 1)
    notes.push(`건물이 ${plan.buildings}동이라 서버룸·랙·서버가 같은 만큼 더 들어가요`);
  const asked = ask.rooms * plan.buildings;
  if (plan.rooms > asked) notes.push(`고른 모양이 서버룸을 ${plan.rooms}곳으로 만들어요`);
  if (plan.denseRacks > 0)
    notes.push(
      `${plan.dense?.gpu ? "GPU" : "고밀도"} 랙 ${plan.denseRacks}대(서버 ${plan.denseServers}대)가 따로 더해져요`,
    );
  const want = askTotal(ask) * plan.buildings;
  if (plan.servers > want && plan.denseRacks === 0)
    notes.push(
      `서비스가 쓰는 호스트가 많아서 서버를 ${plan.servers.toLocaleString("ko-KR")}대로 맞췄어요`,
    );
  return notes;
}

/** What the plan comes to in the three words of the screen: servers (GPU ones too), racks (GPU racks too) and server rooms. */
export function sizeTotals(plan: ShapePlan): { servers: number; racks: number; rooms: number } {
  // a dense rack is two places wide and one place is kept for the row that cannot be paired: those are not racks
  const plain = plan.computeRacks - (plan.dense ? 2 * plan.dense.racks + 1 : 0);
  return {
    servers: plan.servers + plan.gpuServers,
    racks: plain + plan.denseRacks,
    rooms: plan.rooms,
  };
}

/**
 * What the world comes to, in the words of every screen that names its size (REQ-111): servers, all racks, and the
 * racks by kind: those that hold servers and those at the head of each row that hold the network and the storage. The
 * builder's foot counts the generated world and says the same; a test holds the two together.
 */
export function worldTotals(plan: ShapePlan): {
  servers: number;
  racks: number;
  serverRacks: number;
  baseRacks: number;
  rooms: number;
} {
  return {
    servers: plan.servers + plan.denseServers,
    racks: plan.racks,
    serverRacks: plan.racks - plan.infraRacks,
    baseRacks: plan.infraRacks,
    rooms: plan.rooms,
  };
}
