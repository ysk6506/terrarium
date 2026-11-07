import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, readSettings, SETTING_DEFS, SETTINGS_KEY, saveSetting } from ".";

function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[SETTINGS_KEY, initial]]);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("설정의 소리 줄 [REQ-105]", () => {
  test("기본은 켜짐이고 그래픽 바로 다음에 있다", () => {
    expect(DEFAULT_SETTINGS.sound).toBe("on");
    const keys = SETTING_DEFS.map((d) => d.key);
    expect(keys.indexOf("sound")).toBe(keys.indexOf("graphics") + 1);
    const row = SETTING_DEFS.find((d) => d.key === "sound");
    expect(row?.label).toBe("소리");
    expect(row?.options.map((o) => o.value)).toEqual(["on", "off"]);
  });

  test("끄면 기억하고, 켜짐은 기본이라 저장하지 않는다", () => {
    const store = memory();
    expect(saveSetting(store, "sound", "off").sound).toBe("off");
    expect(readSettings(store).sound).toBe("off");
    expect(JSON.parse(store.data.get(SETTINGS_KEY) as string)).toEqual({ sound: "off" });
    saveSetting(store, "sound", "on");
    expect(JSON.parse(store.data.get(SETTINGS_KEY) as string)).toEqual({});
  });

  test("엉뚱한 값은 켜짐으로 돌아간다", () => {
    expect(readSettings(memory('{"sound":"loud"}')).sound).toBe("on");
  });
});
