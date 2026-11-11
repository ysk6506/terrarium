import { describe, expect, test } from "vitest";
import {
  add,
  blankRow,
  change,
  clock,
  draftOf,
  faultsText,
  fileName,
  issuesOf,
  MAX_ROWS,
  minutesOf,
  move,
  numbersLine,
  ontologyRows,
  remove,
  rowsOf,
  signedCount,
  signedTime,
  stepsOf,
  timeText,
  toCsv,
  toJson,
} from ".";

const filled = (who: string, what: string, amount: string, unit: "분" | "시간" = "분") => ({
  ...blankRow(),
  who,
  what,
  amount,
  unit,
});

describe("지금 하는 방식 표 만들기 [REQ-112]", () => {
  test("[REQ-112] 시간은 분이나 시간으로 적고 분으로 저장한다", () => {
    expect(minutesOf({ amount: "50", unit: "분" })).toBe(50);
    expect(minutesOf({ amount: "2", unit: "시간" })).toBe(120);
    expect(minutesOf({ amount: "1,5", unit: "시간" })).toBe(90);
    expect(minutesOf({ amount: "", unit: "분" })).toBeUndefined();
    expect(minutesOf({ amount: "abc", unit: "분" })).toBeUndefined();
    expect(minutesOf({ amount: "-3", unit: "분" })).toBeUndefined();
    expect(minutesOf({ amount: "999999", unit: "시간" })).toBeUndefined();
  });

  test("[REQ-112] 저장된 단계는 시간 단위로 나누어 떨어지면 시간으로 보인다", () => {
    const rows = rowsOf([
      { who: "서버팀", what: "점검", minutes: 120, kind: "physical" },
      { who: "가상화팀", what: "확인", minutes: 50, kind: "check" },
    ]);
    expect(rows.map((r) => [r.amount, r.unit])).toEqual([
      ["2", "시간"],
      ["50", "분"],
    ]);
    expect(rowsOf([])).toHaveLength(1);
  });

  test("[REQ-112] 빈 줄은 건너뛰고 반쯤 채운 줄은 저장을 막으며 무엇이 빠졌는지 말한다", () => {
    const rows = [filled("모니터링 담당", "알람 확인", "10"), blankRow(), filled("서버팀", "", "")];
    const draft = draftOf(rows);
    expect(draft.steps).toHaveLength(1);
    expect(draft.incomplete).toBe(1);
    expect(draft.canSave).toBe(false);
    expect(issuesOf(rows[2] as never)).toEqual(["what", "time"]);
    expect(issuesOf(rows[1] as never)).toEqual([]);
    expect(draftOf([filled("a", "b", "5")]).canSave).toBe(true);
    expect(draftOf([blankRow()]).canSave).toBe(false);
  });

  test("[REQ-112] 단계·사람·시간은 적는 대로 더해진다 (사람은 서로 다른 누가)", () => {
    const rows = [
      filled("모니터링 담당", "알람 확인", "10"),
      filled("가상화팀", "VM 상태 확인", "50"),
      filled("서버팀", "현장 점검", "2", "시간"),
      filled("가상화팀", "VM 옮기기", "30"),
      filled("서비스팀", "서비스 확인", "20"),
    ];
    const { numbers } = draftOf(rows);
    expect(numbers).toEqual({ steps: 5, people: 4, seconds: 230 * 60 });
    expect(numbersLine(numbers)).toBe("5단계 · 사람 4명 · 3시간 50분");
  });

  test("[REQ-112] 줄 더하기·지우기·옮기기: 30줄까지, 지워도 한 줄은 남는다", () => {
    let rows = [blankRow()];
    for (let i = 0; i < 40; i++) rows = add(rows);
    expect(rows).toHaveLength(MAX_ROWS);
    const [a, b] = [filled("a", "1", "1"), filled("b", "2", "2")];
    expect(move([a, b], b.key, -1).map((r) => r.who)).toEqual(["b", "a"]);
    expect(move([a, b], a.key, -1).map((r) => r.who)).toEqual(["a", "b"]);
    expect(remove([a, b], a.key).map((r) => r.who)).toEqual(["b"]);
    expect(remove([a], a.key)).toHaveLength(1);
    expect(change([a, b], b.key, { kind: "approve" })[1]?.kind).toBe("approve");
    expect(stepsOf([change([a], a.key, { kind: "physical" })[0] as never])[0]?.kind).toBe(
      "physical",
    );
  });
});

describe("숫자를 말로 [REQ-112]", () => {
  test("[REQ-112] 시간은 분 단위로, 바뀐 양은 부호와 함께", () => {
    expect(timeText(230 * 60)).toBe("3시간 50분");
    expect(timeText(5100)).toBe("1시간 25분");
    expect(timeText(45)).toBe("45초");
    expect(signedTime(-145 * 60)).toBe("−2시간 25분");
    expect(signedTime(600)).toBe("+10분");
    expect(signedTime(0)).toBe("0분");
    expect(signedCount(-3)).toBe("−3");
    expect(signedCount(-2.7)).toBe("−2.7");
    expect(signedCount(0)).toBe("0");
    expect(clock(4200)).toBe("01:10");
    expect(faultsText(["호스트 정지", "a", "b"])).toBe("3개 — 호스트 정지 · 외 2");
    expect(faultsText(["부품"])).toBe("부품");
    expect(faultsText([])).toBe("—");
  });
});

describe("Object · Link · Action 표 내보내기 [REQ-112]", () => {
  const needs = {
    scenarios: 2,
    objects: [{ kind: "server", label: "서버", count: 12 }],
    links: [{ kind: "power", label: "전원", count: 7 }],
    actions: [
      {
        id: "power.server",
        label: "서버 전원",
        targets: [{ kind: "server", label: "서버", count: 12 }],
        faults: [{ type: "fan_failure", label: "팬 고장, 심함" }],
        scenarios: 1,
      },
    ],
  };
  const use = {
    runs: 1,
    actions: [
      {
        id: "power.server",
        label: "서버 전원",
        counts: { agent: 3, approved: 0, physical: 0, handoff: 0 },
        total: 3,
        doer: "agent" as const,
        needed: true,
        alwaysApproved: false,
      },
    ],
    byDoer: { agent: 1, approved: 0, physical: 0, handoff: 0, none: 0 },
    alwaysApproved: 0,
    line: "",
  };

  test("[REQ-112] 객체·링크·액션이 한 표로 나가고 쓴 것은 실험을 골랐을 때만 붙는다", () => {
    const rows = ontologyRows(needs, use);
    expect(rows.map((r) => r.type)).toEqual(["Object", "Link", "Action"]);
    expect(rows[2]).toMatchObject({ count: 3, doer: "에이전트", targets: "서버 12" });
    expect(ontologyRows(needs)[2]).toMatchObject({ count: "", doer: "" });
  });

  test("[REQ-112] 시나리오에 없던 액션을 에이전트가 썼으면 그것도 Action 줄로 나간다", () => {
    const extra = {
      id: "vm.migrate",
      label: "VM 옮기기",
      counts: { agent: 2, approved: 0, physical: 0, handoff: 0 },
      total: 2,
      doer: "agent" as const,
      alwaysApproved: false,
      needed: false,
    };
    const rows = ontologyRows(needs, { ...use, actions: [...use.actions, extra] });
    expect(rows.filter((r) => r.type === "Action").map((r) => r.id)).toEqual([
      "power.server",
      "vm.migrate",
    ]);
  });

  test("[REQ-112] CSV는 쉼표·따옴표를 감싸고 수식으로 읽힐 글을 막고 BOM으로 시작한다", () => {
    const csv = toCsv(ontologyRows(needs, use));
    expect(csv.startsWith("﻿type,id,name,count,targets,faults,doer\r\n")).toBe(true);
    expect(csv).toContain('"팬 고장, 심함"');
    const hostile = toCsv([
      {
        type: "Object",
        id: "x",
        name: '=HYPERLINK("a")',
        count: 1,
        targets: "",
        faults: "",
        doer: "",
      },
    ]);
    expect(hostile).toContain('"\'=HYPERLINK(""a"")"');
  });

  test("[REQ-112] JSON은 세 묶음이고 파일 이름은 세계 이름에서 만든다", () => {
    const json = JSON.parse(toJson("홀", ontologyRows(needs, use)));
    expect(json.world).toBe("홀");
    expect([json.objects.length, json.links.length, json.actions.length]).toEqual([1, 1, 1]);
    expect(fileName("IAP 실험용 / 1", "csv")).toBe("IAP-실험용-1-ontology.csv");
    expect(fileName("///", "json")).toBe("world-ontology.json");
  });
});
