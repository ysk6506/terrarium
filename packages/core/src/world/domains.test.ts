import { SeededRng } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import {
  DOMAIN_IDS,
  DOMAINS,
  domainChoices,
  FAULT_DOMAIN,
  faultDomain,
  MISTAKE_DOMAIN,
  parseDomain,
} from "./domains";
import { FAULT_SPECS, MISTAKE_SPECS } from "./faults";
import {
  AFTER_HOURS_FACTOR,
  clockAt,
  describeLeadSettings,
  formatSpan,
  isAfterHours,
  isDefaultLeadSettings,
  LEAD_ROWS,
  leadRange,
  roundLead,
  sampleLead,
  workWindow,
} from "./lead-times";

const H = 3600;
const D = 86_400;
const WEEKDAY_NOON = { weekday: 1, hour: 11 };
const SATURDAY = { weekday: 5, hour: 11 };

describe("every fault and mistake has a domain [REQ-093]", () => {
  test("no fault type or mistake type is left without a domain, and the six domains are the ones the ADR names", () => {
    expect(DOMAIN_IDS).toEqual([
      "service_os",
      "virtualization",
      "server",
      "network",
      "storage",
      "facility",
    ]);
    expect(DOMAINS.map((d) => d.team)).toContain("데이터센터 인프라 팀");
    for (const spec of FAULT_SPECS) expect(DOMAIN_IDS).toContain(FAULT_DOMAIN[spec.type]);
    for (const spec of MISTAKE_SPECS) expect(DOMAIN_IDS).toContain(MISTAKE_DOMAIN[spec.type]);
    expect(Object.keys(FAULT_DOMAIN).sort()).toEqual(FAULT_SPECS.map((s) => s.type).sort());
    expect(faultDomain("memory_failure")).toBe("server");
    expect(faultDomain("link_down")).toBe("network");
    expect(faultDomain("chiller_failure")).toBe("facility");
    expect(faultDomain("disk_full")).toBe("service_os");
  });

  test("a domain is named by its id or by what people call it; anything else is not a domain", () => {
    expect(parseDomain("facility")).toBe("facility");
    expect(parseDomain("데이터센터 인프라")).toBe("facility");
    expect(parseDomain("서버 팀")).toBe("server");
    expect(parseDomain("hvac")).toBeUndefined();
    expect(parseDomain(3)).toBeUndefined();
    expect(domainChoices()).toContain("network (네트워크)");
  });
});

describe("lead times per kind of fault [REQ-093]", () => {
  test("every fault has a row with minimum <= typical <= maximum, and a part bought is slower than a part in stock", () => {
    for (const spec of FAULT_SPECS) {
      const row = LEAD_ROWS[spec.type];
      expect(row, spec.type).toBeDefined();
      const ranges = row.ordered ? [row.spare, row.ordered] : [row.spare];
      for (const [min, typ, max] of ranges) {
        expect(min).toBeGreaterThan(0);
        expect(min).toBeLessThanOrEqual(typ);
        expect(typ).toBeLessThanOrEqual(max);
      }
      if (row.ordered) expect(row.spare[1]).toBeLessThanOrEqual(row.ordered[1]);
    }
  });

  test("the defaults are the table of lead-times.md: a memory module takes 4 hours to 3 days, typically a day", () => {
    const r = leadRange("memory_failure", undefined, WEEKDAY_NOON);
    expect([r.min, r.typ, r.max]).toEqual([4 * H, D, 3 * D]);
    expect(r).toMatchObject({ kind: "replace", who: "vendor", spare: true, surcharged: false });
    expect(leadRange("setpoint_drift", undefined, WEEKDAY_NOON)).toMatchObject({
      min: 15 * 60,
      typ: 45 * 60,
      max: 2 * H,
      kind: "remote",
    });
    expect(isDefaultLeadSettings({})).toBe(true);
    expect(describeLeadSettings(undefined)).toBe("기본값");
  });

  test("worked example 1: with no spare the part is ordered, and the vendor's SLA stretches the wait", () => {
    const none = leadRange("memory_failure", { spares: "no" }, WEEKDAY_NOON);
    expect([none.min, none.typ, none.max]).toEqual([D, 2 * D, 5 * D]);
    expect(none.spare).toBe(false);
    const fast = leadRange("memory_failure", { spares: "no", vendorSla: "4h" }, WEEKDAY_NOON);
    expect([fast.min, fast.typ, fast.max]).toEqual([6 * H, 12 * H, 30 * H]);
    const slow = leadRange("memory_failure", { spares: "no", vendorSla: "3d" }, WEEKDAY_NOON);
    expect(slow.typ).toBe(6 * D);
    // a spare in the building makes the SLA beside the point
    const spare = leadRange("memory_failure", { spares: "yes", vendorSla: "3d" }, WEEKDAY_NOON);
    expect(spare.typ).toBe(D);
    // a chiller part is not in stock unless the experiment says it is
    expect(leadRange("chiller_failure", undefined, WEEKDAY_NOON).spare).toBe(false);
    expect(leadRange("chiller_failure", { spares: "yes" }, WEEKDAY_NOON).typ).toBe(12 * H);
  });

  test("worked example 2: on a weekend, work on site takes 1.5 times as long at the typical and the longest, remote work does not", () => {
    const weekday = leadRange("memory_failure", undefined, WEEKDAY_NOON);
    const weekend = leadRange("memory_failure", undefined, SATURDAY);
    expect(weekend).toMatchObject({ min: weekday.min, surcharged: true });
    expect(weekend.typ).toBe(weekday.typ * AFTER_HOURS_FACTOR);
    expect(weekend.max).toBe(weekday.max * AFTER_HOURS_FACTOR);
    expect(leadRange("memory_failure", { afterHours: false }, SATURDAY).surcharged).toBe(false);
    expect(leadRange("disk_full", undefined, SATURDAY).surcharged).toBe(false);
    expect(leadRange("grid_outage", undefined, SATURDAY).surcharged).toBe(false);
    expect(leadRange("breaker_trip", undefined, SATURDAY).surcharged).toBe(true);
  });

  test("the day and hour count from the moment the agent gets the task, from a weekday morning, a weekday night or a weekend", () => {
    expect(clockAt(1000, 1000, "weekday_day")).toEqual({ weekday: 1, hour: 10 });
    expect(isAfterHours(clockAt(1000 + 8 * H, 1000, "weekday_day"))).toBe(true);
    expect(isAfterHours(clockAt(1000 + 3 * H, 1000, "weekday_day"))).toBe(false);
    expect(clockAt(1000 + 14 * H, 1000, "weekday_day")).toEqual({ weekday: 2, hour: 0 });
    expect(isAfterHours(clockAt(0, 0, "weekday_night"))).toBe(true);
    expect(isAfterHours(clockAt(0, 0, "weekend"))).toBe(true);
    expect(clockAt(2 * D, 0, "weekday_day").weekday).toBe(3);
    expect(isAfterHours({ weekday: 0, hour: 9 })).toBe(false);
    expect(isAfterHours({ weekday: 4, hour: 18 })).toBe(true);
    expect(isAfterHours({ weekday: 6, hour: 12 })).toBe(true);
  });

  test("a draw lies inside the range and comes from the seed: the same fault gives the same wait", () => {
    const r = leadRange("memory_failure", undefined, WEEKDAY_NOON);
    expect(sampleLead(r, () => 0)).toBeCloseTo(r.typ, 5);
    expect(sampleLead(r, () => -1.645)).toBeCloseTo(r.min, 0);
    expect(sampleLead(r, () => 1.645)).toBeCloseTo(r.max, 0);
    expect(sampleLead(r, () => -9)).toBe(r.min);
    expect(sampleLead(r, () => 9)).toBe(r.max);
    const draw = (seed: number) =>
      sampleLead(r, () => new SeededRng(seed).fork("lead:f1").gauss(0, 1));
    expect(draw(5)).toBe(draw(5));
    const seen = new Set([1, 2, 3, 4, 5, 6].map(draw));
    expect(seen.size).toBeGreaterThan(3);
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(r.min);
      expect(v).toBeLessThanOrEqual(r.max);
    }
    expect(roundLead(4 * H + 4 * 60)).toBe(4 * H);
    expect(roundLead(4 * H + 7 * 60)).toBe(4 * H + 10 * 60);
    expect(roundLead(10)).toBe(600);
  });

  test("the last stretch of the wait is the work: on site for a part or a breaker, at a console otherwise", () => {
    expect(workWindow("replace")).toEqual({ seconds: 30 * 60, onSite: true });
    expect(workWindow("visit").onSite).toBe(true);
    expect(workWindow("remote").onSite).toBe(false);
    expect(formatSpan(4 * H + 10 * 60)).toBe("4시간 10분");
    expect(formatSpan(D + 2 * H)).toBe("1일 2시간");
    expect(formatSpan(2 * D)).toBe("2일");
    expect(describeLeadSettings({ vendorSla: "4h", spares: "no", afterHours: false })).toBe(
      "벤더 4시간 · 예비 부품 모두 없음 · 야간·주말 가산 없음 · 평일 낮에 시작",
    );
  });
});
