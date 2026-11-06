import { Catalog } from "@terrarium/core/catalog";
import type { CounterpartEvent, HandedFault, RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { fold } from "./fold";
import { replaySource, restingSource, stateAt } from "./replay";
import { markers, storyLine } from "./story";
import { gridWorld } from "./test-support/grid";

const SPEC = { buildings: 1, floors: 1, rooms: 1, racks: 3, servers: 1 };
const source = gridWorld(SPEC);
const target = "b0f0r0-k1";

const handed = (over: Partial<HandedFault> = {}): HandedFault => ({
  faultId: "f1",
  faultType: "fan_failure",
  target,
  etaSeconds: 3600,
  doneAt: 4000,
  startsAt: 2200,
  kind: "replace",
  onSite: true,
  who: "vendor",
  ...over,
});

const counterpart = (
  seq: number,
  t: number,
  what: "handed" | "started" | "done",
  fault: HandedFault,
  team = "서버 팀",
): RunEvent =>
  (what === "handed"
    ? {
        kind: "counterpart",
        what,
        seq,
        t,
        handoff: "h1",
        domain: "server",
        team,
        summary: "",
        faults: [fault],
      }
    : {
        kind: "counterpart",
        what,
        seq,
        t,
        handoff: "h1",
        domain: "server",
        team,
        summary: "",
        fault,
      }) as CounterpartEvent;

const start: RunEvent = { kind: "score", what: "agent_start", seq: 0, t: 0, scenarioStart: 0 };
const closed: RunEvent = {
  kind: "score",
  what: "closed",
  seq: 9,
  t: 5000,
  reason: "x",
  diagnosed: false,
};

const events = (fault: HandedFault, team?: string): RunEvent[] => [
  start,
  counterpart(1, 400, "handed", fault, team),
  counterpart(2, 2200, "started", fault, team),
  counterpart(3, 4000, "done", fault, team),
  closed,
];

describe("another team's work shows on the board and the time bar [REQ-093]", () => {
  test("from the moment the engineer arrives until the work is done, the equipment says who is working on it", () => {
    const e = events(handed());
    expect([...stateAt(e, 1000).partners]).toEqual([]);
    expect(stateAt(e, 3000).partners.get(target)).toBe("교체 중 · 벤더");
    expect([...stateAt(e, 4000).partners]).toEqual([]);
  });

  test("work at a console says the team instead of the vendor, and is not a replacement", () => {
    const remote = handed({ kind: "remote", onSite: false, who: "team", faultType: "link_down" });
    const e = events(remote, "네트워크 팀");
    expect(stateAt(e, 3000).partners.get(target)).toBe("작업 중 · 네트워크 팀");
  });

  test("the tile of that equipment stands alone and its line is the words, in the replay of a moment", () => {
    const e = events(handed());
    const state = stateAt(e, 3000);
    const base = restingSource(source.index, new Catalog());
    const at = replaySource(base, state);
    expect(at.partners?.get(target)).toBe("교체 중 · 벤더");
    const board = fold({ ...source, partners: state.partners }, { layer: "cooling" });
    const tile = board.tiles.find((t) => t.id === target);
    expect(tile).toMatchObject({ partner: "교체 중 · 벤더", line: "교체 중 · 벤더", group: false });
    const quiet = fold(source, { layer: "cooling" });
    expect(quiet.tiles.find((t) => t.id === target)?.partner).toBeUndefined();
  });

  test("the time bar has a mark where a team finished, saying who and what, and the first line counts the hand-offs", () => {
    const e = events(handed());
    const mark = markers(e).find((m) => m.kind === "partner");
    expect(mark).toMatchObject({ t: 4000, label: "벤더: 교체 완료" });
    const none = markers([start, closed]).map((m) => m.kind);
    expect(none).not.toContain("partner");
    const remote = markers(
      events(handed({ kind: "remote", onSite: false, who: "team" }), "네트워크 팀"),
    );
    expect(remote.find((m) => m.kind === "partner")?.label).toBe("네트워크 팀: 작업 완료");
    const line = storyLine(e);
    expect(line.parts.find((p) => p.kind === "partner")).toMatchObject({
      text: "넘긴 일 1건",
      t: 400,
    });
  });
});
