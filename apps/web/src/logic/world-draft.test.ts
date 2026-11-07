import { DEFAULT_SHAPE } from "@terrarium/core/sources/worldgen";
import { beforeEach, describe, expect, it } from "vitest";
import { type WorldDraft, worldDraft, worthKeeping } from "./world-draft";

const draft = (over: Partial<WorldDraft> = {}): WorldDraft => ({
  v: 1,
  services: DEFAULT_SHAPE.services,
  manual: {},
  apart: {},
  size: {},
  name: DEFAULT_SHAPE.name,
  step: "services",
  ladder: 0,
  metas: {},
  cost: 0,
  ...over,
});

describe("만들던 세계 [REQ-109]", () => {
  beforeEach(() => worldDraft.clear());

  it("[REQ-109] 쓴 것은 다른 메뉴에 갔다 와도 그대로 읽히고, 지우면 없다 (저장소가 없어도)", () => {
    expect(worldDraft.read()).toBeUndefined();
    const d = draft({ step: "ladders", ladder: 1, size: { rooms: 2 } });
    worldDraft.write(d);
    expect(worldDraft.read()).toEqual(d);
    worldDraft.clear();
    expect(worldDraft.read()).toBeUndefined();
  });

  it("[REQ-109] 서비스를 더했거나 층을 눌렀거나 숫자를 고쳤을 때만 '이어서 할까요?'를 물을 만하다", () => {
    const first = DEFAULT_SHAPE.services[0] as never;
    const name = DEFAULT_SHAPE.name;
    expect(worthKeeping(draft(), first, name)).toBe(false);
    expect(worthKeeping(draft({ manual: { database: "db-single" } }), first, name)).toBe(true);
    expect(worthKeeping(draft({ size: { perRack: 12 } }), first, name)).toBe(true);
    expect(worthKeeping(draft({ cost: -1 }), first, name)).toBe(true);
    expect(worthKeeping(draft({ name: "내 세계" }), first, name)).toBe(true);
    const two = [...DEFAULT_SHAPE.services, { ...DEFAULT_SHAPE.services[0], key: "x" }] as never;
    expect(worthKeeping(draft({ services: two }), first, name)).toBe(true);
    const edited = [
      { ...DEFAULT_SHAPE.services[0], load: { rps: 1, dataGB: 1, users: 1, maxDowntimeS: 9 } },
    ] as never;
    expect(worthKeeping(draft({ services: edited }), first, name)).toBe(true);
  });
});
