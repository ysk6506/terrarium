/**
 * How big a host says it is (REQ-098, ADR-0117): a server has the memory and cores of its model, a VM those it was given,
 * and a VM that was given nothing is a small one of the usual size.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../../packages/core/src/world/test-support/service-lab";

function shellOn(strip: boolean) {
  const bp = serviceLab();
  const world = World.fromBlueprint(
    {
      ...bp,
      entities: strip
        ? bp.entities.map((e) => (e.id === "vm-web" ? { ...e, props: {} } : e))
        : bp.entities,
    },
    new Catalog(),
  );
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  const box = new Toolbox(TOOL_NAMES);
  const ctx = { world, facades: {} as Facades };
  return (host: string, cmd: string): string =>
    (box.call("run_command", { host, cmd }, ctx).data as { output: string }).output;
}

describe("the size of a host [REQ-098]", () => {
  test("[REQ-098] a VM says the memory and the cores it was given, a server those of its model", () => {
    const sh = shellOn(false);
    expect(sh("vm-web", "grep -c ^processor /proc/cpuinfo")).toBe("8");
    expect(sh("vm-web", "free -m | sed -n 2p")).toMatch(/^Mem:\s+32768 /);
    expect(sh("srv-b1", "grep -c ^processor /proc/cpuinfo")).toBe("64");
    expect(sh("srv-a2", "grep -c ^processor /proc/cpuinfo")).toBe("96");
  });

  test("[REQ-098] a VM that was given nothing has four cores and sixteen GiB", () => {
    const sh = shellOn(true);
    expect(sh("vm-web", "grep -c ^processor /proc/cpuinfo")).toBe("4");
    expect(sh("vm-web", "free -m | sed -n 2p")).toMatch(/^Mem:\s+16384 /);
  });
});
