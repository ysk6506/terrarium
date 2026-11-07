import { problemName } from "@terrarium/core/scenario";
import { DEFAULT_SHAPE, planShape } from "@terrarium/core/sources/worldgen";
import {
  chipById,
  drTargets,
  LADDER,
  type Layers,
  linkMsOf,
  spanText,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { planFigures } from "../worldgen-scale";
import { capList } from "./cap";
import { cardOf, chipsOfLayer } from "./ladders";
import { shapeView } from "./shape-view";
import { builtFact } from "./short-flow";

const viewWith = (layers: Partial<Layers>) =>
  shapeView({ ...DEFAULT_SHAPE, layers: { ...DEFAULT_SHAPE.layers, ...layers } });

const SITE = ["site-dr-cold", "site-dr-warm", "site-dr-hot", "site-multi-active"] as const;
const FORMERLY_DOTTED = [...SITE, "sto-geo", "db-distributed-sql", "db-managed-multiaz"] as const;

describe("the seven chips that were dotted are solid and their cards say what the core does [REQ-106]", () => {
  test.each(FORMERLY_DOTTED)(
    "%s: modelled, and the card lists the faults the chip really has",
    (id) => {
      const chip = chipById(id);
      expect(chip?.modeled).toBe(true);
      const names = [...(chip?.stops ?? []), ...(chip?.slows ?? [])].map(problemName);
      expect(names.length).toBeGreaterThan(0);
      expect(cardOf(id)?.faults.split(" · ")).toEqual(names);
      expect(cardOf(id)?.result).not.toMatch(/아직 흉내|가까운 모양으로/);
    },
  );

  test("the site ladder is one room, two rooms, two buildings, DR cold, warm, hot, active-active", () => {
    expect(LADDER.site.map((c) => c.id)).toEqual([
      "site-one-room",
      "site-two-rooms",
      "site-two-buildings",
      ...SITE,
    ]);
    expect(chipsOfLayer("site").map((c) => c.card.id)).toEqual(LADDER.site.map((c) => c.id));
  });

  test("a site card shows RTO and RPO worked out from the mode, and they shrink to the right", () => {
    const promises = SITE.map((id) => cardOf(id)?.promise ?? "");
    expect(promises.every((p) => /^RTO .+ · RPO .+/.test(p))).toBe(true);
    expect(cardOf("site-dr-cold")?.promise).toBe(
      `RTO ${spanText(drTargets("cold", linkMsOf(300)).rtoS)} · RPO ${spanText(drTargets("cold", linkMsOf(300)).rpoS)}`,
    );
    expect(cardOf("site-dr-hot")?.promise).toContain("RPO 0초");
    expect(cardOf("site-one-room")?.promise).toBeUndefined();
  });

  test("a long list of faults on a card is capped at three and says how many more", () => {
    const capped = capList(cardOf("site-multi-active")?.faults ?? "");
    expect(capped.split(" · ").length).toBeLessThanOrEqual(4);
    expect(capped).toMatch(/외 \d+가지/);
  });

  test("every card of the seven has a picture that breaks something and a text that ends in 요", () => {
    for (const id of FORMERLY_DOTTED) {
      const card = cardOf(id);
      expect(card?.diagram.cut, id).toBeDefined();
      const [r, i] = card?.diagram.cut ?? [0, 0];
      expect(card?.diagram.rows[r]?.n, id).toBeGreaterThan(i);
      expect(card?.what, id).toMatch(/요\.?$|요\. /);
    }
  });
});

describe("'이 모양이면' counts the new chips [REQ-106]", () => {
  test("a DR site adds the site faults and the scenarios of the sheets, and no layer is dotted", () => {
    const one = viewWith({ site: "site-one-room" });
    const warm = viewWith({ site: "site-dr-warm" });
    expect(one.problems).not.toContain("site_power_loss");
    expect(warm.problems).toEqual(
      expect.arrayContaining(["site_power_loss", "wan_link_down", "replication_broken"]),
    );
    expect(warm.scenarios).toBeGreaterThan(one.scenarios);
    expect(warm.templateIds).toEqual(expect.arrayContaining(["site-power-loss", "wan-link-cut"]));
    expect(warm.dotted).toEqual([]);
    expect(warm.dr?.promise).toBe(cardOf("site-dr-warm")?.promise);
    expect(one.dr).toBeUndefined();
  });

  test("the raft and the managed database add their own sheets", () => {
    expect(viewWith({ database: "db-distributed-sql" }).templateIds).toContain("db-quorum-lost");
    expect(viewWith({ database: "db-managed-multiaz" }).templateIds).toEqual(
      expect.arrayContaining(["db-managed-flapping", "db-managed-storage-full"]),
    );
    expect(viewWith({ storage: "sto-geo", site: "site-dr-cold" }).templateIds).toContain(
      "geo-replica-broken",
    );
  });

  test("the entry screen's counts follow the site chip: two buildings, and the done line names the sites", () => {
    const plan = planShape({
      ...DEFAULT_SHAPE,
      layers: { ...DEFAULT_SHAPE.layers, site: "site-dr-warm" },
    });
    expect(plan.buildings).toBe(2);
    const units = planFigures(plan, { ...DEFAULT_SHAPE.layers, site: "site-dr-warm" }).map(
      (f) => f.unit,
    );
    expect(units.join(" ")).toContain("사이트 둘");
    const single = planFigures(planShape(DEFAULT_SHAPE), DEFAULT_SHAPE.layers).map((f) => f.unit);
    expect(single.join(" ")).not.toContain("건물");
    expect(builtFact("테스트", viewWith({ site: "site-dr-warm" }))).toMatch(
      /사이트 둘\(DR 웜 · RTO/,
    );
    expect(builtFact("테스트", viewWith({ site: "site-one-room" }))).not.toContain("사이트 둘");
  });
});
