/**
 * 이끼의 옆 패널 (REQ-103, ADR-0124): 360px, 페이지를 가리지 않는다. 머리글 "이끼 · 화면 이름", 질문 칩 셋, 입력칸 하나.
 * 답은 세 문장 안, 접힌 "출처", 이어 물을 칩 둘셋. 목업 #5, #6.
 */
import type { MossAnswerView, MossSourceView } from "@terrarium/core/contract";
import { useEffect, useRef, useState } from "react";
import type { PageName } from "../../logic";
import { actionById, closeMoss, consumePending, panelState, SCREENS, subscribe } from "../../moss";
import { Go, useApp } from "../context";
import { type Chat, type Msg, useMossChat } from "./use-moss";

const basename = (file: string) => file.split("/").at(-1) ?? file;

function Sources({ view, route }: { readonly view: MossAnswerView; readonly route: PageName }) {
  if (view.sources.length === 0) return null;
  const label = (s: MossSourceView) =>
    s.kind === "state" ? SCREENS[route].stateLabel : `${basename(s.file)} › ${s.title}`;
  return (
    <details className="moss-src">
      <summary>출처 {view.sources.length}</summary>
      <div className="moss-chips">
        {view.sources.map((s) => (
          <span
            key={s.kind === "doc" ? s.id : "state"}
            className="moss-chip-src"
            title={s.kind === "doc" ? s.file : undefined}
          >
            {label(s)}
          </span>
        ))}
      </div>
    </details>
  );
}

function Answer({
  view,
  route,
  chat,
}: {
  readonly view: MossAnswerView;
  readonly route: PageName;
  readonly chat: Chat;
}) {
  return (
    <div className="moss-a-wrap">
      <div className={`moss-a${view.answered ? "" : " moss-a-none"}`}>
        {view.answer}
        <Sources view={view} route={route} />
        {view.rough && <p className="moss-rough">모델의 답을 다 읽지 못해 글만 가져왔어요.</p>}
      </div>
      {view.suggestedActions.length > 0 && (
        <div className="moss-chips">
          {view.suggestedActions.map((id) => {
            const spec = actionById(id);
            return spec ? (
              <button
                key={id}
                type="button"
                className="moss-chip moss-chip-do"
                onClick={() => chat.run(id)}
              >
                {spec.label}
              </button>
            ) : null;
          })}
        </div>
      )}
      {view.followUps.length > 0 && (
        <div className="moss-chips">
          {view.followUps.map((q) => (
            <button key={q} type="button" className="moss-chip" onClick={() => chat.send(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const TICK: Readonly<Record<string, string>> = {
  todo: "",
  now: " now",
  done: " done",
  skipped: " skipped",
};

function PlanCard({ msg }: { readonly msg: Extract<Msg, { kind: "plan" }> }) {
  const { plan } = msg;
  return (
    <div className="moss-plan">
      <h5>{plan.title}</h5>
      <ul>
        {plan.steps.map((s) => (
          <li key={s.id}>
            <span className={`moss-tick${TICK[s.status] ?? ""}`} aria-hidden="true" />
            <span>
              {s.label}
              {s.note ? ` — ${s.note}` : ""}
              <span className="sr-only">
                {s.status === "done" ? " (했어요)" : s.status === "now" ? " (하는 중)" : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {plan.status === "paused" && <p className="moss-plan-note">직접 누르셔서 멈췄어요.</p>}
      {plan.status === "failed" && <p className="moss-plan-note bad">{plan.error}</p>}
      {plan.status === "cancelled" && <p className="moss-plan-note">그만뒀어요.</p>}
      {plan.status === "done" && <p className="moss-plan-note">다 했어요.</p>}
    </div>
  );
}

function Decide({
  title,
  text,
  yes,
  no,
  state,
  onYes,
  onNo,
}: {
  readonly title: string;
  readonly text: string;
  readonly yes: string;
  readonly no: string;
  readonly state: "open" | "done" | "stopped";
  readonly onYes: () => void;
  readonly onNo: () => void;
}) {
  return (
    <div className={`moss-confirm${state === "open" ? "" : " closed"}`}>
      <h5>{title}</h5>
      <p>{text}</p>
      {state === "open" ? (
        <div className="moss-confirm-row">
          <button type="button" className="btn btn-primary" onClick={onYes}>
            {yes}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onNo}>
            {no}
          </button>
        </div>
      ) : (
        <p className="moss-plan-note">{state === "done" ? "했어요." : "그만뒀어요."}</p>
      )}
    </div>
  );
}

function Message({ msg, chat }: { readonly msg: Msg; readonly chat: Chat }) {
  switch (msg.kind) {
    case "user":
      return <div className="moss-q-bubble">{msg.text}</div>;
    case "wait":
      return <output className="moss-a moss-wait">찾아보는 중이에요…</output>;
    case "say":
      return <div className={`moss-say${msg.bad ? " bad" : ""}`}>{msg.text}</div>;
    case "answer":
      return <Answer view={msg.view} route={msg.route} chat={chat} />;
    case "plan":
      return <PlanCard msg={msg} />;
    case "confirm":
      return (
        <Decide
          title="이렇게 할게요"
          text={msg.text}
          yes="하기"
          no="그만"
          state={msg.state}
          onYes={() => chat.decide(msg.id, true)}
          onNo={() => chat.decide(msg.id, false)}
        />
      );
    case "resume":
      return (
        <Decide
          title="이어서 할까요?"
          text="직접 누르신 걸 봤어요. 하던 일은 여기까지 해 뒀어요."
          yes="이어서"
          no="그만"
          state={msg.state}
          onYes={() => chat.decide(msg.id, true)}
          onNo={() => chat.decide(msg.id, false)}
        />
      );
  }
}

function Empty({
  route,
  chat,
  awake,
}: {
  readonly route: PageName;
  readonly chat: Chat;
  readonly awake: boolean;
}) {
  const screen = SCREENS[route];
  if (!awake)
    return (
      <div className="moss-a">
        모델을 등록하면 이끼가 깨어나요. <Go to={{ name: "settings" }}>설정에서 모델 등록하기</Go>
      </div>
    );
  return (
    <>
      <div className="moss-a">{screen.oneLine}</div>
      <section className="moss-chips" aria-label="이런 걸 물어보세요">
        {screen.questions.map((q) => (
          <button key={q} type="button" className="moss-chip" onClick={() => chat.send(q)}>
            {q}
          </button>
        ))}
      </section>
    </>
  );
}

/** 입력칸: 질문도 부탁도 여기에. 모델이 없으면 동작 이름만 알아들어요. */
function Input({
  chat,
  awake,
  focusSeq,
}: {
  readonly chat: Chat;
  readonly awake: boolean;
  readonly focusSeq: number;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `focusSeq` is the request to focus again (Cmd+K, `/`)
  useEffect(() => {
    ref.current?.focus();
  }, [focusSeq]);
  useEffect(() => {
    const take = () => {
      const p = panelState().pending;
      if (!p) return;
      consumePending();
      if (p.send && awake) chat.send(p.question);
      else setText(p.question);
    };
    take();
    return subscribe(take);
  }, [chat, awake]);
  return (
    <form
      className="moss-foot"
      onSubmit={(e) => {
        e.preventDefault();
        chat.send(text);
        setText("");
      }}
    >
      <input
        ref={ref}
        className="moss-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="무엇이든 물어보세요"
        aria-label="이끼에게 물어보기"
        maxLength={500}
        disabled={chat.busy}
      />
    </form>
  );
}

export function MossPanel({
  awake,
  focusSeq,
}: {
  readonly awake: boolean;
  readonly focusSeq: number;
}) {
  const { page } = useApp();
  const chat = useMossChat();
  const route = page.name;
  const bodyRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest message when the list changes
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [chat.msgs]);
  return (
    <aside
      className="moss-panel moss-root"
      aria-label={`이끼, ${SCREENS[route].title}`}
      onKeyDown={(e) => e.key === "Escape" && closeMoss()}
    >
      <div className="moss-head">
        <span className="moss-dot" aria-hidden="true" />
        <b>이끼 · {SCREENS[route].title}</b>
        <button type="button" className="moss-x" aria-label="이끼 닫기" onClick={closeMoss}>
          ✕
        </button>
      </div>
      <div className="moss-body" ref={bodyRef} aria-live="polite">
        {chat.msgs.length === 0 && <Empty route={route} chat={chat} awake={awake} />}
        {chat.msgs.map((m) => (
          <Message key={m.id} msg={m} chat={chat} />
        ))}
      </div>
      {chat.saying && <p className="moss-saying">{chat.saying}</p>}
      <Input chat={chat} awake={awake} focusSeq={focusSeq} />
    </aside>
  );
}
