/**
 * Runs that wait for a person (REQ-081, ADR-0087 item 4). The card says what the agent asked, shows its last five
 * calls, and offers what a person can do: answer in words, act in the world for the agent, hand over more tools, or
 * end the run. It sits on the home page, on the experiment and on the run, so whoever is looking sees it.
 */
import type { EscalationCard } from "@terrarium/core/contract";
import { useEffect, useState } from "react";
import { HUMAN_ACTIONS, humanTalk, CARD_WORDS as W } from "../../logic";
import { messageOf, useApp, useAsync, useNow } from "../context";
import { Button, Note, SelectField, Tabs, TextField } from "../kit";
import { ToolPicker } from "./tool-picker";

type Mode = "reply" | "act" | "more";

const POLL_MS = 2000;

/** The runs waiting for a person now, kept fresh while the screen is open. */
export function useEscalations(filter: {
  readonly experimentId?: string;
  readonly runId?: string;
}) {
  const { api } = useApp();
  const list = useAsync((signal) => api.call("listEscalations", { signal }), []);
  const { reload } = list;
  useEffect(() => {
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  const cards = (list.data ?? []).filter(
    (c) =>
      (!filter.experimentId || c.experimentId === filter.experimentId) &&
      (!filter.runId || c.runId === filter.runId),
  );
  return { cards, reload };
}

function Asked({ card }: { readonly card: EscalationCard }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <b>{W.ASKED}</b>
      <blockquote className="escalation-ask">{card.request.request}</blockquote>
      <b className="small">{W.RECENT}</b>
      {card.request.recent.length === 0 ? (
        <p className="small muted">{W.NO_CALLS}</p>
      ) : (
        <ol className="list-plain small escalation-recent">
          {card.request.recent.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the same tool can be called twice in a row
            <li key={i} className={c.ok ? undefined : "escalation-failed"}>
              {humanTalk.recentLine(c)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Reply({
  onSend,
  busy,
}: {
  readonly onSend: (text: string) => void;
  readonly busy: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <div className="stack" data-moss-skip="사람이 정하는 일">
      <TextField label={W.REPLY_LABEL} value={text} multiline maxLength={2000} onChange={setText} />
      <Button
        kind="primary"
        busy={busy}
        disabled={text.trim() === ""}
        why={W.REPLY_LABEL}
        onClick={() => onSend(text.trim())}
      >
        {W.REPLY_SEND}
      </Button>
    </div>
  );
}

function Act({
  card,
  send,
  busy,
}: {
  readonly card: EscalationCard;
  readonly send: (body: Parameters<typeof toBody>[0]) => void;
  readonly busy: boolean;
}) {
  const { api } = useApp();
  const world = useAsync(
    (signal) => api.call("runWorld", { params: { id: card.runId }, signal }),
    [card.runId],
  );
  const [actionId, setActionId] = useState(HUMAN_ACTIONS[0]?.id ?? "");
  const action =
    HUMAN_ACTIONS.find((a) => a.id === actionId) ??
    (HUMAN_ACTIONS[0] as (typeof HUMAN_ACTIONS)[number]);
  const targets = humanTalk.targetsOf(action, world.data?.blueprint);
  const [picked, setPicked] = useState("");
  const [values, setValues] = useState<Record<string, number>>({});
  // the target is the one picked while it still fits the action, else the first the action can be done to
  const target = targets.some((t) => t.id === picked) ? picked : (targets[0]?.id ?? "");
  const value = values[action.id] ?? action.value?.start ?? 0;
  return (
    <div className="stack" data-moss-skip="사람이 정하는 일">
      <SelectField
        label="할 일"
        value={actionId}
        options={HUMAN_ACTIONS.map((a) => ({ value: a.id, label: a.label }))}
        onChange={setActionId}
      />
      <SelectField
        label="어디에"
        value={target}
        options={targets.map((t) => ({ value: t.id, label: t.name }))}
        onChange={setPicked}
        {...(targets.length === 0 ? { help: "이 세계에는 이 조치를 할 대상이 없어요" } : {})}
      />
      {action.value && (
        <label className="field-inline">
          <span className="small">
            {action.value.label} ({action.value.unit})
          </span>
          <input
            className="input"
            type="number"
            min={action.value.min}
            max={action.value.max}
            value={value}
            onChange={(e) => setValues({ ...values, [action.id]: Number(e.target.value) })}
          />
        </label>
      )}
      <Button
        busy={busy}
        disabled={target === ""}
        why="대상을 골라 주세요"
        onClick={() => send({ kind: "act", tool: action.tool, args: action.args(target, value) })}
      >
        {W.ACT_DO}
      </Button>
      {card.acts.length === 0 ? (
        <p className="small muted">{W.ACT_NONE}</p>
      ) : (
        <ul className="list-plain small escalation-acts" aria-label="한 조치">
          {card.acts.map((a, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: acts are kept in the order they were done
            <li key={i}>{a.summary}</li>
          ))}
        </ul>
      )}
      <Button kind="primary" busy={busy} onClick={() => send({ kind: "acted" })}>
        {W.ACT_DONE}
      </Button>
    </div>
  );
}

function More({
  card,
  send,
  busy,
}: {
  readonly card: EscalationCard;
  readonly send: (body: Parameters<typeof toBody>[0]) => void;
  readonly busy: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([...card.tools]);
  const extra = picked.filter((t) => !card.tools.includes(t));
  return (
    <div className="stack" data-moss-skip="사람이 정하는 일">
      <ToolPicker selected={picked} onChange={setPicked} given={card.tools} noPresets />
      <Button
        kind="primary"
        busy={busy}
        disabled={extra.length === 0}
        why={W.MORE_NONE}
        onClick={() => send({ kind: "more_tools", tools: extra })}
      >
        {W.MORE_SEND(extra.length)}
      </Button>
    </div>
  );
}

/** Keeps the type of an answer in one place. */
function toBody(
  b:
    | { kind: "reply"; text: string }
    | { kind: "act"; tool: string; args: Record<string, unknown> }
    | { kind: "acted" }
    | { kind: "more_tools"; tools: string[] }
    | { kind: "end" },
) {
  return b;
}

function Card({ card, onDone }: { readonly card: EscalationCard; readonly onDone: () => void }) {
  const { api } = useApp();
  const now = useNow(10_000);
  const [mode, setMode] = useState<Mode>("reply");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const send = async (body: Parameters<typeof toBody>[0]) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.call("answerEscalation", { params: { id: card.runId }, body });
      onDone();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="panel panel-pad escalation-card stack"
      aria-label={W.TITLE}
      data-testid="escalation-card"
      data-moss-skip="사람이 정하는 일"
    >
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 18 }}>
          <span className="status status-busy">{W.TITLE}</span>
        </h2>
        <span className="small muted">
          {card.experimentName} · {humanTalk.waitingSince(card, now)} · {W.STILL}
        </span>
      </div>
      <Asked card={card} />
      <Tabs
        label="사람이 할 수 있는 것"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: "reply", label: W.REPLY },
          { id: "act", label: W.ACT },
          { id: "more", label: W.MORE },
        ]}
      >
        {mode === "reply" && (
          <Reply busy={busy} onSend={(text) => void send({ kind: "reply", text })} />
        )}
        {mode === "act" && <Act card={card} busy={busy} send={(b) => void send(b)} />}
        {mode === "more" && <More card={card} busy={busy} send={(b) => void send(b)} />}
      </Tabs>
      {error && <Note tone="bad">{error}</Note>}
      <div className="row">
        {confirmEnd ? (
          <>
            <span className="small">{W.END_ASK}</span>
            <Button
              kind="danger"
              size="small"
              busy={busy}
              onClick={() => void send({ kind: "end" })}
            >
              {W.END}
            </Button>
            <Button kind="quiet" size="small" onClick={() => setConfirmEnd(false)}>
              그만두기
            </Button>
          </>
        ) : (
          <Button kind="quiet" size="small" onClick={() => setConfirmEnd(true)}>
            {W.END}
          </Button>
        )}
      </div>
    </section>
  );
}

/** The cards of the runs that wait for a person, for the whole app or one experiment or run; nothing when none wait. */
export function EscalationCards(filter: {
  readonly experimentId?: string;
  readonly runId?: string;
}) {
  const { cards, reload } = useEscalations(filter);
  if (cards.length === 0) return null;
  return (
    <section className="stack" aria-label={W.TITLE} aria-live="polite">
      {cards.map((card) => (
        <Card key={card.runId} card={card} onDone={reload} />
      ))}
    </section>
  );
}
