/**
 * What the world refuses to do to a database or a storage path, and why (REQ-095, ADR-0107 item 6): a command that makes
 * no sense is turned back before it is recorded, with the reason in words, whoever sends it. The tools check some of this
 * first; these go to the world itself.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { type Blueprint, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type DbLabOptions, dbLab } from "../../packages/core/src/world/test-support/db-lab";

function boot(options: DbLabOptions, edit: (bp: Blueprint) => Blueprint = (bp) => bp) {
  const world = World.fromBlueprint(edit(dbLab(options)), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  return { world, physics };
}

describe("a promotion or a restore is refused when it makes no sense [REQ-095]", () => {
  test("[REQ-095] an instance that is being restored cannot be promoted, nor restored again", () => {
    const { world } = boot({ shape: "replicated" });
    world.apply({ type: "db.restore", target: "db-2", backup: "latest" }, "operator");
    expect(() => world.apply({ type: "db.promote", target: "db-2" }, "operator")).toThrow(
      "'db-2'는 복원 중이에요",
    );
    expect(() =>
      world.apply({ type: "db.restore", target: "db-2", backup: "latest" }, "operator"),
    ).toThrow("'db-2'는 이미 복원 중이에요");
  });

  test("[REQ-095] a backup is named latest or backup-N, within the number the cluster keeps", () => {
    const { world } = boot({ shape: "replicated" });
    for (const backup of ["backup-0", "backup-99", "yesterday", "backup-"]) {
      expect(() => world.apply({ type: "db.restore", target: "db-2", backup }, "operator")).toThrow(
        /백업은 latest 또는 backup-1 … backup-\d+ 중에서 골라요/,
      );
    }
    expect(() =>
      world.apply({ type: "db.restore", target: "db-2", backup: "backup-2" }, "operator"),
    ).not.toThrow();
  });

  test("[REQ-095] an instance that belongs to no cluster is turned away", () => {
    const { world } = boot({ shape: "replicated" }, (bp) => ({
      ...bp,
      links: bp.links.filter((l) => !(l.from === "db-2" && l.kind === "member_of")),
    }));
    expect(() => world.apply({ type: "db.promote", target: "db-2" }, "operator")).toThrow(
      "'db-2'는 어느 클러스터에도 속하지 않아요",
    );
    expect(() =>
      world.apply({ type: "db.restore", target: "db-2", backup: "latest" }, "operator"),
    ).toThrow("'db-2'는 어느 클러스터에도 속하지 않아요");
  });

  test("[REQ-095] a controller that belongs to no pool has no path to switch to", () => {
    const { world } = boot({ shape: "replicated", storage: "dual" }, (bp) => ({
      ...bp,
      links: bp.links.filter((l) => l.id !== "ctl-a-in"),
    }));
    expect(() => world.apply({ type: "storage.path_switch", target: "ctl-a" }, "operator")).toThrow(
      "'ctl-a'는 어느 풀에도 속하지 않아요",
    );
  });
});
