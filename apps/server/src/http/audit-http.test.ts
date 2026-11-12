import { describe, expect, test } from "vitest";
import { idOfResponse, standingOfResponse } from "./audit-http";

describe("what the recording point reads from an answer [REQ-054]", () => {
  test("[REQ-054] an id is found under any of the names the routes use, and nowhere else", () => {
    expect(idOfResponse({ id: "a" })).toBe("a");
    expect(idOfResponse({ experimentId: "q" })).toBe("q");
    expect(idOfResponse({ world: { id: "w" } })).toBe("w");
    expect(idOfResponse({ scenario: { id: "s" } })).toBe("s");
    expect(idOfResponse({ experiment: { id: "e" } })).toBe("e");
    expect(idOfResponse({ other: { id: "x" } })).toBeUndefined();
    expect(idOfResponse([1, 2])).toBeUndefined();
    expect(idOfResponse("text")).toBeUndefined();
    expect(idOfResponse(null)).toBeUndefined();
  });

  test("[REQ-054] the name, owner, scope and group are read, and a scope that is not one is not", () => {
    expect(
      standingOfResponse({
        world: { name: "홀", owner: "haneul", sharing: { scope: "group", group: "part-a" } },
      }),
    ).toEqual({ name: "홀", owner: "haneul", scope: "group", group: "part-a" });
    expect(standingOfResponse({ scope: "not-a-scope", apiKey: "x" })).toEqual({});
    expect(standingOfResponse(undefined)).toEqual({});
  });
});
