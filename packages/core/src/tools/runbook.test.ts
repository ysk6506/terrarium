import { describe, expect, test } from "vitest";
import {
  parseRunbookMarkdown,
  type Runbook,
  runbookProblems,
  runbookPrompt,
  searchRunbooks,
  toolsIn,
} from "./runbook";

const TEAM = `# 디스크 꽉 참 대응

1. 알람을 확인한다 \`list_alarms\`
2. 호스트 디스크를 본다
   - 확인: 사용률이 90%를 넘는지
   - 툴: run_command
3. 오래된 로그를 지운다 (run_command로 rm)
4. 서비스가 돌아왔는지 본다
   확인: service_status의 상태가 healthy
`;

describe("a team's runbook pasted as Markdown [REQ-082]", () => {
  test("a heading is the title, each numbered line a step, with its check and tools", () => {
    const { runbook, parsed } = parseRunbookMarkdown(TEAM);
    expect(parsed).toBe(true);
    expect(runbook.title).toBe("디스크 꽉 참 대응");
    expect(runbook.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(runbook.steps[0]).toMatchObject({
      todo: "알람을 확인한다 `list_alarms`",
      tools: ["list_alarms"],
    });
    expect(runbook.steps[1]).toMatchObject({
      todo: "호스트 디스크를 본다",
      check: "사용률이 90%를 넘는지",
      tools: ["run_command"],
    });
    expect(runbook.steps[2]?.tools).toEqual(["run_command"]);
    expect(runbook.steps[3]).toMatchObject({ check: "service_status의 상태가 healthy" });
  });

  test("bullets work like numbers", () => {
    const { runbook } = parseRunbookMarkdown("- 알람 보기\n- 조치하기");
    expect(runbook.steps.map((s) => s.todo)).toEqual(["알람 보기", "조치하기"]);
  });

  test("text with no list becomes one step, so pasting never fails", () => {
    const { runbook, parsed } = parseRunbookMarkdown(
      "먼저 알람을 보고 `list_alarms` 그다음 고친다",
    );
    expect(parsed).toBe(false);
    expect(runbook.steps).toHaveLength(1);
    expect(runbook.steps[0]?.tools).toEqual(["list_alarms"]);
    expect(runbook.title).toBe("팀 절차서");
  });

  test("an empty paste is an empty runbook", () => {
    expect(parseRunbookMarkdown("   ").runbook.steps).toEqual([]);
  });

  test("tool names are found only when they are tools", () => {
    expect(toolsIn("use `run_command` then not_a_tool and list_alarms")).toEqual([
      "run_command",
      "list_alarms",
    ]);
  });
});

const BOOK: Runbook = {
  title: "냉방기 정지",
  steps: [
    { id: "s1", todo: "알람 확인", check: "", tools: ["list_alarms"] },
    {
      id: "s2",
      todo: "다른 냉방기 설정 온도 낮추기",
      check: "방 온도",
      tools: ["set_cooling_setpoint"],
    },
  ],
};

describe("giving and finding a runbook [REQ-082]", () => {
  test("the agent reads the steps with their checks and tools", () => {
    const text = runbookPrompt(BOOK);
    expect(text).toContain("냉방기 정지");
    expect(text).toContain("1. 알람 확인 [툴: list_alarms]");
    expect(text).toContain(
      "2. 다른 냉방기 설정 온도 낮추기 (확인: 방 온도) [툴: set_cooling_setpoint]",
    );
  });

  test("a search finds the runbook that fits the words, and falls back to all", () => {
    const other: Runbook = {
      title: "디스크 꽉 참",
      steps: [{ id: "s1", todo: "로그 지우기", check: "", tools: ["run_command"] }],
    };
    expect(searchRunbooks([BOOK, other], "디스크")[0]).toBe(other);
    expect(searchRunbooks([BOOK, other], "냉방기")[0]).toBe(BOOK);
    expect(searchRunbooks([BOOK, other], "아무 말")).toHaveLength(2);
    expect(searchRunbooks([BOOK, other], "")).toHaveLength(2);
  });

  test("problems are said in words", () => {
    expect(runbookProblems(BOOK)).toEqual([]);
    expect(runbookProblems({ title: "x", steps: [] })).toEqual(["절차서에 단계가 하나도 없어요"]);
    const bad = runbookProblems({
      title: "x",
      steps: [{ id: "s1", todo: " ", check: "", tools: ["nope"] }],
    });
    expect(bad).toEqual(["1단계에 할 일이 없어요", "1단계의 'nope'는 없는 툴이에요"]);
  });
});
