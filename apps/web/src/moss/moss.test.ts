import { describe, expect, test } from "vitest";
import { numberQuestion, termQuestion } from "./ask";
import { parseInput } from "./match";
import { isLive, mark, nextStep, planOf, withStatus } from "./plan";
import {
  ALL_ACTIONS,
  actionById,
  actionsOf,
  GLOBAL_ACTIONS,
  SCREEN_LIST,
  SCREENS,
} from "./registry";
import { pickByText } from "./states";
import {
  bindScreen,
  closeMoss,
  consumePending,
  findHandler,
  openMoss,
  panelState,
  readScreen,
  summaryFor,
  waitForHandler,
} from "./store";

describe("the screen registry is whole [REQ-103]", () => {
  test("every route has a title, a one-line note, exactly three questions and actions with unique ids", () => {
    const ids = ALL_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCREEN_LIST) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.oneLine.endsWith("요.")).toBe(true);
      expect(s.questions).toHaveLength(3);
      expect(s.questions.every((q) => q.endsWith("?"))).toBe(true);
    }
    expect(Object.keys(SCREENS)).toHaveLength(SCREEN_LIST.length);
  });

  test("anything that changes, starts or deletes is a change and has a card sentence; navigate and read never ask", () => {
    for (const a of ALL_ACTIONS.filter((x) => x.kind === "change" && !x.steps))
      expect(a.confirm).toBeTruthy();
    expect(actionById("exp-start")?.kind).toBe("change");
    expect(actionById("exp-cancel")?.kind).toBe("change");
    expect(actionById("world-build")?.kind).toBe("change");
    expect(actionById("go-worlds")?.kind).toBe("navigate");
    expect(actionById("run-read-scores")?.kind).toBe("read");
  });

  test("steps of a multi-step task are registered actions, and only its last step changes anything", () => {
    const make = actionById("make-experiment");
    expect(make?.kind).toBe("change");
    const steps = (make?.steps ?? []).map((id) => actionById(id));
    expect(steps.every(Boolean)).toBe(true);
    expect(steps.slice(0, -1).every((s) => s?.kind !== "change")).toBe(true);
    expect(steps.at(-1)?.kind).toBe("change");
  });

  test("a screen's actions come first, then the ones usable anywhere", () => {
    const list = actionsOf("run").map((a) => a.id);
    expect(list.slice(0, SCREENS.run.actions.length)).toEqual(SCREENS.run.actions.map((a) => a.id));
    expect(list).toContain("go-home");
    expect(GLOBAL_ACTIONS.every((a) => a.kind !== "read")).toBe(true);
  });
});

describe("a typed line is a question or a request [REQ-103]", () => {
  const actions = actionsOf("home");
  test("a short text that matches an action label runs it", () => {
    expect(parseInput("실험 만들기", actions)).toMatchObject({
      intent: "command",
      action: { id: "make-experiment" },
    });
    expect(parseInput("설정 열기", actions)).toMatchObject({
      intent: "command",
      action: { id: "go-settings" },
    });
  });
  test("a request that ends with 줘 and holds an action's words is that action; the number is taken", () => {
    const p = parseInput("IAP 세계로 실험 하나 만들어 줘", actions);
    expect(p).toMatchObject({ intent: "command", action: { id: "make-experiment" } });
    expect(parseInput("횟수 5번으로 정해 줘", actionsOf("newExperiment")).args).toMatchObject({
      n: 5,
    });
  });
  test("a sentence with a question in it is a question even when it names an action", () => {
    expect(parseInput("실험 만들기는 어떻게 해요?", actions).intent).toBe("question");
    expect(parseInput("이 실행이 왜 30점이에요?", actionsOf("run")).intent).toBe("question");
    expect(parseInput("", actions).intent).toBe("question");
    expect(parseInput("아무 말이나 길게 적어 본 문장이에요 그냥요", actions).intent).toBe(
      "question",
    );
  });
});

describe("the checklist of a multi-step task [REQ-103]", () => {
  test("it lists the steps in order, marks them, and knows when it is live", () => {
    const spec = actionById("make-experiment");
    if (!spec) throw new Error("missing");
    let plan = planOf(spec, {});
    expect(plan.steps.map((s) => s.status)).toEqual(Array(plan.steps.length).fill("todo"));
    expect(nextStep(plan)).toBe(0);
    plan = mark(plan, 0, "done", "홈");
    expect(plan.steps[0]).toMatchObject({ status: "done", note: "홈" });
    expect(nextStep(plan)).toBe(1);
    expect(isLive(plan)).toBe(true);
    expect(isLive(withStatus(plan, "paused"))).toBe(true);
    expect(isLive(withStatus(plan, "done"))).toBe(false);
    expect(isLive(undefined)).toBe(false);
    expect(withStatus(plan, "failed", "왜냐면").error).toBe("왜냐면");
    expect(nextStep(planOf({ ...spec, steps: undefined as never }, {}))).toBe(0);
  });
});

describe("the question a small ? asks [REQ-103]", () => {
  test("a term asks what it is; a number asks why it is that", () => {
    expect(termQuestion("복구 점수")).toBe("복구 점수가 뭐예요?");
    expect(termQuestion("그래픽")).toBe("그래픽이 뭐예요?");
    expect(numberQuestion("이 실행", "30점")).toBe("이 실행이 왜 30점이에요?");
    expect(numberQuestion("이 실험", "12개")).toBe("이 실험이 왜 12개예요?");
  });
});

describe("the store joins the screen and the panel [REQ-103]", () => {
  test("handlers are found by id while the screen is on, and gone after; reads of one route are merged", async () => {
    const off1 = bindScreen("run", {
      read: () => ({ 화면: "실행", 점수: "30점" }),
      run: { "run-read-scores": () => "점수표" },
      summary: () => "30점",
    });
    const off2 = bindScreen("run", { read: () => ({ 사건: [1] }), run: {} });
    expect(findHandler("run-read-scores")?.({})).toBe("점수표");
    expect(summaryFor("run-read-scores")).toBe("30점");
    expect(readScreen("run")).toEqual({ 화면: "실행", 점수: "30점", 사건: [1] });
    off1();
    off2();
    expect(findHandler("run-read-scores")).toBeUndefined();
    expect(readScreen("run")).toEqual({});
    expect(await waitForHandler("run-read-scores", 20)).toBeUndefined();
  });

  test("a handler that arrives while waiting is found", async () => {
    const waiting = waitForHandler("exp-start", 500);
    const off = bindScreen("newExperiment", { run: { "exp-start": () => "시작" } });
    expect((await waiting)?.({})).toBe("시작");
    off();
  });

  test("the panel opens with a question to send once, and closes", () => {
    openMoss({ question: "이 실행이 왜 30점이에요?", send: true });
    expect(panelState()).toMatchObject({
      open: true,
      pending: { question: "이 실행이 왜 30점이에요?", send: true },
    });
    consumePending();
    expect(panelState().pending).toBeUndefined();
    const before = panelState().focusSeq;
    openMoss();
    expect(panelState().focusSeq).toBe(before + 1);
    closeMoss();
    expect(panelState().open).toBe(false);
  });
});

describe("picking by what was said [REQ-103]", () => {
  const worlds = [{ name: "IAP 실험용" }, { name: "작은 서버실" }];
  test("the name with the most words in the text wins; nothing matching is nothing", () => {
    expect(pickByText("IAP 세계로 만들어 줘", worlds, (w) => w.name)?.name).toBe("IAP 실험용");
    expect(pickByText("서버실로", worlds, (w) => w.name)?.name).toBe("작은 서버실");
    expect(pickByText("아무거나", worlds, (w) => w.name)).toBeUndefined();
  });
});
