import { describe, expect, test } from "vitest";
import { DEFAULT_SHAPE, recount, type ServiceDraft, type ShapeSpec, shapeProblem } from ".";

const draft = (over: Partial<ServiceDraft> = {}): ServiceDraft =>
  ({ ...DEFAULT_SHAPE.services[0], ...over }) as ServiceDraft;
const spec = (over: Partial<ShapeSpec> = {}): ShapeSpec => ({ ...DEFAULT_SHAPE, ...over });

describe("a service card's counts are added up from its parts [REQ-094]", () => {
  test("nodes, hosts and switches are the sums of the parts of that role, and a role with no part keeps the card's number", () => {
    const d = draft({
      nodes: 2,
      hosts: 5,
      switches: 7,
      parts: [
        { label: "앱", role: "node", count: 3 },
        { label: "앱 둘", role: "node" },
        { label: "호스트", role: "host", count: 4 },
      ],
    });
    expect(recount(d)).toMatchObject({ nodes: 4, hosts: 4, switches: 7 });
  });

  test("the nodes never fall below one, and the other fields of the card are kept", () => {
    const d = draft({ nodes: 0, parts: [{ label: "빈 것", role: "node", count: 0 }] });
    const r = recount(d);
    expect(r.nodes).toBe(1);
    expect(r.name).toBe(d.name);
  });
});

describe("shapeProblem says in words what is wrong with a spec, or nothing [REQ-094]", () => {
  test("the default spec has no problem", () => {
    expect(shapeProblem(spec())).toBeUndefined();
  });

  test("no services, too many services, a name that is empty and a node count out of range are each named", () => {
    expect(shapeProblem(spec({ services: [] }))).toBe("서비스를 하나는 골라 주세요");
    expect(shapeProblem(spec({ services: Array.from({ length: 40 }, () => draft()) }))).toContain(
      "서비스는",
    );
    expect(shapeProblem(spec({ services: [draft({ name: "  " })] }))).toBe(
      "서비스 이름이 비어 있어요",
    );
    expect(shapeProblem(spec({ services: [draft({ nodes: 61 })] }))).toContain(
      "노드는 1~60개 사이여야 해요",
    );
  });

  test("a server count out of range is refused unless the site is built as it really is", () => {
    expect(shapeProblem(spec({ servers: 1 }))).toContain("서버는");
    expect(shapeProblem(spec({ servers: 10_000_000 }))).toContain("서버는");
    expect(shapeProblem(spec({ servers: 1, real: true }))).toBeUndefined();
  });

  test("the three size numbers come all together or not at all", () => {
    expect(shapeProblem(spec({ rooms: 1 }))).toBe("서버룸·룸당 랙·랙당 서버는 셋 다 함께 정해요");
  });

  test("a site that does not exist is named", () => {
    expect(shapeProblem(spec({ site: "nowhere" as ShapeSpec["site"] }))).toContain(
      "알 수 없는 사업장 'nowhere'",
    );
  });
});
