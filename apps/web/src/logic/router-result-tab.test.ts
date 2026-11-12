import { describe, expect, test } from "vitest";
import { hrefOf, parseLocation, RESULT_TABS } from "./router";

describe("the tab of a result is in the address [REQ-037]", () => {
  test("[REQ-037] the summary has the plain address; the others carry ?tab=", () => {
    expect(hrefOf({ name: "experiment", id: "e-1" })).toBe("/experiments/e-1");
    expect(hrefOf({ name: "experiment", id: "e-1", tab: "summary" })).toBe("/experiments/e-1");
    expect(hrefOf({ name: "experiment", id: "e-1", tab: "runs" })).toBe(
      "/experiments/e-1?tab=runs",
    );
    expect(hrefOf({ name: "experiment", id: "e-1", tab: "process" })).toBe(
      "/experiments/e-1?tab=process",
    );
    expect(hrefOf({ name: "experiment", id: "e-1", tab: "world" })).toBe(
      "/experiments/e-1?tab=world",
    );
  });

  test("[REQ-037] every address reads back as the page it came from; an unknown tab is the summary", () => {
    for (const tab of RESULT_TABS) {
      const page = {
        name: "experiment" as const,
        id: "e-1",
        ...(tab === "summary" ? {} : { tab }),
      };
      const [path, search] = hrefOf(page).split("?");
      expect(parseLocation(path as string, search ? `?${search}` : "")).toEqual(page);
    }
    expect(parseLocation("/experiments/e-1", "?tab=nope")).toEqual({
      name: "experiment",
      id: "e-1",
    });
  });

  test("[REQ-040] the fork form's situation count is in its address and is read back only when it is sane", () => {
    const href = hrefOf({ name: "newExperiment", forkOf: "e-1", runs: 10 });
    expect(href).toBe("/experiments/new?fork=e-1&runs=10");
    expect(parseLocation("/experiments/new", "?fork=e-1&runs=10")).toEqual({
      name: "newExperiment",
      forkOf: "e-1",
      runs: 10,
    });
    expect(parseLocation("/experiments/new", "?fork=e-1&runs=0")).toEqual({
      name: "newExperiment",
      forkOf: "e-1",
    });
    expect(parseLocation("/experiments/new", "?fork=e-1&runs=abc")).toEqual({
      name: "newExperiment",
      forkOf: "e-1",
    });
  });
});
