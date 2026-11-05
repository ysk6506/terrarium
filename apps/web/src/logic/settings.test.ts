import { describe, expect, test } from "vitest";
import {
  DEFAULT_SETTINGS,
  hrefOf,
  parseLocation,
  readSettings,
  SETTING_DEFS,
  SETTINGS_KEY,
  SETTINGS_SECTION,
  saveSetting,
  sectionOf,
  titleOf,
  world3d,
} from ".";

/** A store in memory. */
function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[SETTINGS_KEY, initial]]);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("the settings screen keeps its choices in this browser [REQ-036]", () => {
  test("nothing saved reads as the defaults: graphics left to the machine", () => {
    expect(readSettings(memory())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.graphics).toBe("auto");
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  test("the graphics row offers automatic, high and light, in that order", () => {
    const row = SETTING_DEFS.find((d) => d.key === "graphics");
    expect(row?.options.map((o) => o.label)).toEqual(["자동", "높음", "가볍게"]);
    expect(row?.options.map((o) => o.value)).toEqual(["auto", "high", "light"]);
  });

  test("a choice is saved and read back", () => {
    const store = memory();
    expect(saveSetting(store, "graphics", "light").graphics).toBe("light");
    expect(readSettings(store).graphics).toBe("light");
    expect(JSON.parse(store.data.get(SETTINGS_KEY) as string)).toEqual({ graphics: "light" });
  });

  test("a damaged or hand-edited entry falls back to the defaults", () => {
    expect(readSettings(memory("{not json"))).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(memory('{"graphics":"ultra"}'))).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(memory("[1,2]"))).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(memory('"text"'))).toEqual(DEFAULT_SETTINGS);
  });

  test("a storage that refuses does not break the screen", () => {
    const refusing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSettings(refusing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSetting(refusing, "graphics", "high").graphics).toBe("high");
    expect(saveSetting(undefined, "graphics", "high").graphics).toBe("high");
  });
});

describe("the settings screen has an address and a place in the rail [REQ-038]", () => {
  test("an address and the screen it opens are one round trip", () => {
    const page = { name: "settings" } as const;
    expect(hrefOf(page)).toBe("/settings");
    expect(parseLocation("/settings")).toEqual(page);
    expect(parseLocation("/settings/")).toEqual(page);
  });

  test("it sits at the foot of the rail, outside the sections above", () => {
    expect(SETTINGS_SECTION.label).toBe("설정");
    expect(sectionOf({ name: "settings" })).toBe("settings");
    expect(titleOf({ name: "settings" })).toBe("설정 — 테라리움");
  });
});

describe("the words of the settings and of the graphics notice follow the glossary [REQ-071]", () => {
  const RETIRED = [
    "도구",
    "삭제",
    "수정",
    "취소",
    "월드",
    "배점",
    "까닭",
    "경보",
    "가동",
    "한도",
    "노출",
    "장애",
    "주입",
  ];
  const texts = [
    world3d.QUALITY_NOTICE,
    ...SETTING_DEFS.flatMap((d) => [d.label, d.help, ...d.options.map((o) => o.label)]),
  ];

  test("none of the words the glossary retired is used", () => {
    expect(texts.filter((t) => RETIRED.some((w) => t.includes(w)))).toEqual([]);
  });

  test("the sentences end like people talk: 해요체", () => {
    const sentences = texts
      .flatMap((t) => t.split(/(?<=[.])\s*/))
      .map((t) => t.trim().replace(/[.]$/, ""))
      .filter((t) => t.length > 12);
    expect(sentences.length).toBeGreaterThan(2);
    expect(sentences.filter((t) => !/(요|죠)$/.test(t))).toEqual([]);
  });

  test("the notice says what happened and how to go back", () => {
    expect(world3d.QUALITY_NOTICE).toBe("그래픽을 가볍게 바꿨어요. 설정에서 되돌릴 수 있어요");
  });
});
