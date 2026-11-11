/**
 * What the world refuses to do to the site and DR layer, and why (REQ-106, ADR-0129): a command that does not make sense
 * is turned back before it is recorded, with the reason in words, whoever sends it. The tools check some of this first;
 * these go to the world itself.
 */
import { siteLinks, spanText } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { siteLab } from "./site-lab";

const move = (lab: ReturnType<typeof siteLab>, site: string) => {
  lab.world.apply({ type: "dr.failover", target: "dr-plan", site }, "operator");
  lab.physics.run(3 * 3600);
};

describe("a move between the sites is refused when it makes no sense [REQ-106]", () => {
  test("[REQ-106] a command aimed at a thing that is not a plan, or at a site that is not the plan's, says what is wrong", () => {
    const lab = siteLab("warm");
    expect(() =>
      lab.world.apply({ type: "dr.failover", target: "site-a", site: "site-b" }, "operator"),
    ).toThrow("'site-a'는 DR 계획이 아니에요");
    expect(() =>
      lab.world.apply({ type: "dr.failover", target: "dr-plan", site: "vol-svc-svc2" }, "operator"),
    ).toThrow("'vol-svc-svc2'는 이 DR 계획의 사이트가 아니에요 (site-a, site-b)");
  });

  test("[REQ-106] a drill is refused while a move is running, and allowed again when it is done", () => {
    const lab = siteLab("warm");
    lab.world.apply({ type: "dr.failover", target: "dr-plan", site: "site-b" }, "operator");
    expect(() => lab.world.apply({ type: "dr.drill", target: "dr-plan" }, "operator")).toThrow(
      "전환하는 중에는 모의 훈련을 할 수 없어요",
    );
    lab.physics.run(3 * 3600);
    expect(() =>
      lab.world.apply({ type: "dr.drill", target: "dr-plan" }, "operator"),
    ).not.toThrow();
  });

  test("[REQ-106] going back to the primary site waits until that site is well and the line between the sites is up", () => {
    const lab = siteLab("warm");
    move(lab, "site-b");
    lab.inject("site_power_loss", "site-a");
    lab.physics.run(120);
    expect(() => lab.world.apply({ type: "dr.failback", target: "dr-plan" }, "operator")).toThrow(
      "본 사이트가 아직 온전하지 않아서 돌아갈 수 없어요",
    );
    lab.clear("site_power_loss");
    lab.physics.run(600);
    const link = siteLinks(lab.world.index)[0]?.id as string;
    lab.inject("wan_link_down", link);
    lab.physics.run(60);
    expect(() => lab.world.apply({ type: "dr.failback", target: "dr-plan" }, "operator")).toThrow(
      "사이트 간 회선이 끊겨 있어서 데이터를 되돌릴 수 없어요",
    );
  });

  test("[REQ-106] a copy cannot be promoted at a site that is down", () => {
    const lab = siteLab("warm");
    lab.inject("site_power_loss", "site-b");
    lab.physics.run(120);
    expect(() =>
      lab.world.apply(
        { type: "volume.promote", target: "vol-svc-svc2", site: "site-b" },
        "operator",
      ),
    ).toThrow("'site-b'가 멈춰 있어서 볼륨을 올릴 수 없어요");
  });

  test("[REQ-106] a span of seconds is told in the words an operator uses", () => {
    expect(spanText(0)).toBe("0초");
    expect(spanText(90)).toBe("90초");
    expect(spanText(119)).toBe("119초");
    expect(spanText(150)).toBe("150초");
    expect(spanText(600)).toBe("10분");
    expect(spanText(3_600)).toBe("1시간");
    expect(spanText(5_400)).toBe("1.5시간");
    expect(spanText(4 * 3_600)).toBe("4시간");
  });
});

describe("a consensus ring and a managed database refuse what cannot be done [REQ-106]", () => {
  const ring = (lab: ReturnType<typeof siteLab>) =>
    [...lab.world.index.ofKind("db_node")]
      .filter((n) => n.id.startsWith("svc-iap-"))
      .map((n) => n.id);

  test("[REQ-106] the lead is not handed to a node that is down, to one that is behind, or when no majority is left", () => {
    const lab = siteLab("raft");
    const [a, b, c] = ring(lab) as [string, string, string];
    lab.inject("db_node_lagging", c);
    lab.physics.run(120);
    expect(() => lab.world.apply({ type: "dbnode.transfer", target: c }, "operator")).toThrow(
      "뒤처진 노드는 리더가 될 수 없어요",
    );
    lab.clear("db_node_lagging");
    lab.inject("db_quorum_lost", a, { down: 2 });
    lab.physics.run(120);
    expect(() => lab.world.apply({ type: "dbnode.transfer", target: a }, "operator")).toThrow(
      "멈춘 노드에는 리더를 넘길 수 없어요",
    );
    expect(() => lab.world.apply({ type: "dbnode.transfer", target: c }, "operator")).toThrow(
      "과반이 없어서 리더를 옮길 수 없어요",
    );
    expect(b).toBeDefined();
  });

  test("[REQ-106] a zone that is down cannot be switched to", () => {
    const lab = siteLab("managed");
    lab.inject("db_az_failure", "svc-iap-managed", { az: 2 });
    lab.physics.run(200);
    expect(() =>
      lab.world.apply({ type: "dbm.failover", target: "svc-iap-managed", az: 2 }, "operator"),
    ).toThrow("은 멈춰 있어서 받을 수 없어요");
  });
});
