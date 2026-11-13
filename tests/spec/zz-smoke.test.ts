import { describe, expect, test } from "vitest";
import { engineLab } from "./test-support/shell-engine-lab";

const cmds = (process.env.SMOKE ?? "").split("@@").filter(Boolean);

describe("smoke", () => {
  test("basics", () => {
    const { run } = engineLab();
    const show = (cmd: string) => {
      const r = run("srv-a2", cmd);
      console.log(
        JSON.stringify(cmd),
        "=>",
        r.exitCode,
        JSON.stringify(r.output),
        r.gaps.map((g) => `${g.tool}:${g.feature}`).join(","),
      );
    };
    for (const c of cmds) show(c);
    expect(1).toBe(1);
  });
});
