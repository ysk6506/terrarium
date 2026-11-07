/**
 * 이끼 패널의 대화와 일 (REQ-103, ADR-0124): 입력을 질문이나 동작으로 읽고, 질문은 서버에 묻고, 동작은 등록된 핸들러로 한다.
 * `change` 동작은 "이렇게 할게요" 카드에서 하기를 눌러야 하고, 여러 단계 일은 체크리스트로 보여 주며
 * 사용자가 화면을 직접 누르면 멈추고 "이어서 할까요?"를 물어요.
 */
import type { MossAnswerView } from "@terrarium/core/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageName } from "../../logic";
import {
  type ActionArgs,
  type ActionSpec,
  actionById,
  actionsOf,
  findAction,
  mark,
  type Plan,
  parseInput,
  planOf,
  readScreen,
  withStatus,
} from "../../moss";
import { messageOf, useApp } from "../context";
import { confirmText, HIGHLIGHT_MS, perform } from "./run-action";

export type Msg =
  | { readonly id: number; readonly kind: "user"; readonly text: string }
  | { readonly id: number; readonly kind: "wait" }
  | {
      readonly id: number;
      readonly kind: "answer";
      readonly view: MossAnswerView;
      readonly route: PageName;
    }
  | { readonly id: number; readonly kind: "say"; readonly text: string; readonly bad?: boolean }
  | { readonly id: number; readonly kind: "plan"; readonly plan: Plan }
  | {
      readonly id: number;
      readonly kind: "confirm";
      readonly text: string;
      readonly label: string;
      readonly state: "open" | "done" | "stopped";
    }
  | { readonly id: number; readonly kind: "resume"; readonly state: "open" | "done" | "stopped" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 사용자가 직접 화면을 누르거나 쳤는가: 패널 안의 일이나 단독 수식 키는 아니에요. */
function isUserTouch(e: Event): boolean {
  const target = e.target as Element | null;
  if (target?.closest?.(".moss-root")) return false;
  if (e instanceof KeyboardEvent)
    return !["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key);
  return true;
}

export interface Chat {
  readonly msgs: readonly Msg[];
  readonly busy: boolean;
  /** 지금 하고 있는 일 한 줄 ("사다리로 갈게요"). */
  readonly saying: string | undefined;
  send(text: string): void;
  run(id: string): void;
  decide(msgId: number, yes: boolean): void;
  clear(): void;
}

type NewMsg = DistributiveOmit<Msg, "id">;

/** 말풍선들과, 사용자가 고를 때까지 기다리는 카드(gate). */
function useMessages() {
  const [msgs, setMsgs] = useState<readonly Msg[]>([]);
  const seq = useRef(0);
  const gates = useRef(new Map<number, (yes: boolean) => void>());
  const add = useCallback((m: NewMsg): number => {
    const id = ++seq.current;
    setMsgs((all) => [...all, { ...m, id } as Msg]);
    return id;
  }, []);
  const patch = useCallback((id: number, change: Partial<Msg>) => {
    setMsgs((all) => all.map((m) => (m.id === id ? ({ ...m, ...change } as Msg) : m)));
  }, []);
  const drop = useCallback((id: number) => setMsgs((all) => all.filter((m) => m.id !== id)), []);
  /** 카드를 띄우고 사용자가 고를 때까지 기다린다. */
  const gate = useCallback(
    (m: NewMsg): Promise<boolean> => {
      const id = add(m);
      return new Promise((resolve) => {
        gates.current.set(id, (yes) => {
          gates.current.delete(id);
          patch(id, { state: yes ? "done" : "stopped" });
          resolve(yes);
        });
      });
    },
    [add, patch],
  );
  const decide = (msgId: number, yes: boolean) => gates.current.get(msgId)?.(yes);
  return { msgs, add, patch, drop, gate, decide, clear: () => setMsgs([]) };
}

type Messages = ReturnType<typeof useMessages>;

/** 사용자가 직접 화면을 누르거나 쳤는지 지켜본다: 일하는 동안만 `watching`을 켜요. */
function useTouchWatch() {
  const touched = useRef(false);
  const watching = useRef(false);
  useEffect(() => {
    const onTouch = (e: Event) => {
      if (watching.current && isUserTouch(e)) touched.current = true;
    };
    document.addEventListener("pointerdown", onTouch, true);
    document.addEventListener("keydown", onTouch, true);
    return () => {
      document.removeEventListener("pointerdown", onTouch, true);
      document.removeEventListener("keydown", onTouch, true);
    };
  }, []);
  return { touched, watching };
}

interface Outcome {
  readonly ran: boolean;
  readonly note?: string;
}

type RunOne = (spec: ActionSpec, args: ActionArgs) => Promise<Outcome>;

interface PlanIo {
  readonly messages: Messages;
  readonly runOne: RunOne;
  readonly touched: { current: boolean };
  readonly watching: { current: boolean };
}

/** 여러 단계 일: 체크리스트를 띄우고 한 단계씩 하며, 사용자가 화면을 직접 누르면 "이어서 할까요?"로 멈춰요. */
async function runPlan(spec: ActionSpec, args: ActionArgs, io: PlanIo): Promise<void> {
  const { messages, runOne, touched, watching } = io;
  let plan = planOf(spec, args);
  const id = messages.add({ kind: "plan", plan });
  const show = (next: Plan) => {
    plan = next;
    messages.patch(id, { plan: next });
  };
  watching.current = true;
  touched.current = false;
  try {
    for (let i = 0; i < plan.steps.length; i++) {
      show(mark(plan, i, "now"));
      const step = actionById(plan.steps[i]?.id ?? "");
      if (!step) throw new Error("모르는 단계예요");
      if (step.kind === "change") show(withStatus(plan, "confirm"));
      const out = await runOne(step, args);
      if (!out.ran) {
        show(withStatus(mark(plan, i, "skipped"), "cancelled"));
        return;
      }
      show(withStatus(mark(plan, i, "done", out.note), "running"));
      await sleep(HIGHLIGHT_MS * 0.7);
      if (touched.current && i < plan.steps.length - 1) {
        show(withStatus(plan, "paused"));
        const go = await messages.gate({ kind: "resume", state: "open" });
        touched.current = false;
        if (!go) {
          show(withStatus(plan, "cancelled"));
          return;
        }
        show(withStatus(plan, "running"));
      }
    }
    show(withStatus(plan, "done"));
  } catch (err) {
    show(withStatus(plan, "failed", messageOf(err)));
  } finally {
    watching.current = false;
  }
}

/** 동작 하나(또는 여러 단계 일)를 시작한다: "이렇게 할게요" 카드, 한 줄 말, 체크리스트까지. */
function useStarter(messages: Messages, setBusy: (b: boolean) => void) {
  const { navigate, page } = useApp();
  const { add, gate } = messages;
  const [saying, setSaying] = useState<string>();
  const { touched, watching } = useTouchWatch();

  const runOne: RunOne = useCallback(
    async (spec, args) => {
      if (spec.kind === "change") {
        const text = confirmText(spec);
        const yes = await gate({ kind: "confirm", text, label: spec.label, state: "open" });
        if (!yes) return { ran: false };
      }
      setSaying(spec.saying ?? `${spec.label} 할게요`);
      try {
        const note = await perform(spec, args, { navigate });
        return { ran: true, ...(note ? { note } : {}) };
      } finally {
        setTimeout(() => setSaying(undefined), HIGHLIGHT_MS);
      }
    },
    [gate, navigate],
  );

  const start = useCallback(
    async (spec: ActionSpec, typed: ActionArgs) => {
      // 지금 화면의 주소에 든 값(실험 id 등)이 기본 인자예요: "이 실험으로 다시 돌려 줘"가 어느 실험인지 알아요.
      const args = { ...pageArgs(page), ...typed };
      setBusy(true);
      try {
        if (spec.steps) await runPlan(spec, args, { messages, runOne, touched, watching });
        else {
          const out = await runOne(spec, args);
          if (out.note) add({ kind: "say", text: out.note });
        }
      } catch (err) {
        add({ kind: "say", text: messageOf(err), bad: true });
      } finally {
        setBusy(false);
      }
    },
    [messages, runOne, add, page, touched, watching, setBusy],
  );
  return { start, saying };
}

export function useMossChat(): Chat {
  const { api, page } = useApp();
  const messages = useMessages();
  const { add, drop } = messages;
  const [busy, setBusy] = useState(false);
  const { start, saying } = useStarter(messages, setBusy);
  const routeRef = useRef(page.name);
  routeRef.current = page.name;

  const ask = useCallback(
    async (question: string) => {
      const r = routeRef.current;
      const wait = add({ kind: "wait" });
      setBusy(true);
      try {
        const view = await api.call("askMoss", {
          body: {
            screen: r,
            question,
            state: readScreen(r),
            actions: actionsOf(r).map((a) => ({ id: a.id, label: a.label })),
          },
        });
        drop(wait);
        add({ kind: "answer", view, route: r });
      } catch (err) {
        drop(wait);
        add({ kind: "say", text: messageOf(err), bad: true });
      } finally {
        setBusy(false);
      }
    },
    [api, add, drop],
  );

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      add({ kind: "user", text: t });
      const parsed = parseInput(t, actionsOf(routeRef.current));
      if (parsed.intent === "command" && parsed.action) void start(parsed.action, parsed.args);
      else void ask(t);
    },
    [add, start, ask],
  );

  const run = useCallback(
    (id: string) => {
      const spec = findAction(routeRef.current, id);
      if (spec) void start(spec, {});
    },
    [start],
  );

  return {
    msgs: messages.msgs,
    busy,
    saying,
    send,
    run,
    decide: messages.decide,
    clear: messages.clear,
  };
}

/** 화면 주소의 글자·숫자 값만 인자로 (`name`은 빼요). */
function pageArgs(page: object): ActionArgs {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, val] of Object.entries(page)) {
    if (
      k !== "name" &&
      (typeof val === "string" || typeof val === "number" || typeof val === "boolean")
    )
      out[k] = val;
  }
  return out;
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
