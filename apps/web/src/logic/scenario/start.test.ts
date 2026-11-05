import { ALL_SCENARIO_TEMPLATES, TEMPLATE_GROUPS } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../../../../packages/core/src/world/test-support/sample-campus";
import { chosenStart, EMPTY_START, startGroups, stepStart } from "./start";

const index = new BlueprintIndex(campusBlueprint());
const groups = startGroups(TEMPLATE_GROUPS, index);
const cards = groups.flatMap((g) => g.cards);

describe("the new-scenario cards", () => {
  test("[REQ-071] every built-in template is on exactly one card, and the empty canvas is the last card", () => {
    const ids = cards.map((c) => c.id);
    expect(ids.slice(0, -1).sort()).toEqual(ALL_SCENARIO_TEMPLATES.map((t) => t.id).sort());
    expect(ids.at(-1)).toBe(EMPTY_START);
    expect(groups.map((g) => g.label).slice(0, 2)).toEqual(["설비", "네트워크·전원 설정"]);
  });

  test("[REQ-071] a template the world cannot use stays on its card and says why", () => {
    const blocked = cards.filter((c) => c.unavailable);
    for (const c of blocked) expect(c.unavailable?.length).toBeGreaterThan(0);
    expect(cards.filter((c) => c.id !== EMPTY_START).every((c) => c.difficulty)).toBe(true);
  });

  test("[REQ-071] the first usable card is chosen unless the person picked another that still works", () => {
    const firstUsable = cards.find((c) => !c.unavailable)?.id;
    expect(chosenStart(groups, undefined)).toBe(firstUsable);
    const other = cards.filter((c) => !c.unavailable)[1]?.id;
    expect(chosenStart(groups, other)).toBe(other);
    const blocked = cards.find((c) => c.unavailable)?.id;
    expect(chosenStart(groups, blocked)).toBe(firstUsable);
  });

  test("[REQ-071] with no world loaded yet every template is offered, and with none usable the empty canvas is chosen", () => {
    const loading = startGroups(TEMPLATE_GROUPS, undefined);
    expect(loading.flatMap((g) => g.cards).some((c) => c.unavailable)).toBe(false);
    const none = groups.map((g) => ({
      ...g,
      cards: g.cards.map((c) => (c.id === EMPTY_START ? c : { ...c, unavailable: "없어요" })),
    }));
    expect(chosenStart(none, undefined)).toBe(EMPTY_START);
  });

  test("[REQ-071] arrow keys skip cards that cannot be used and wrap around", () => {
    const usableIds = cards.filter((c) => !c.unavailable).map((c) => c.id);
    const last = usableIds.at(-1) ?? "";
    expect(last).toBe(EMPTY_START);
    expect(stepStart(groups, last, 1)).toBe(usableIds[0]);
    expect(stepStart(groups, usableIds[0] ?? "", -1)).toBe(last);
    expect(stepStart(groups, usableIds[0] ?? "", 1)).toBe(usableIds[1]);
  });
});
