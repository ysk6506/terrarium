/**
 * "말 걸어 보기" under a connection (REQ-079, ADR-0085): pick an agent, send one sentence, see the answer
 * where the button is, and one line on how it went — the time, whether tools were called, and whether the
 * turn's traces reached the place the connection says. Nothing here is scored or changes a world.
 */
import type { ConnectionView, TryResult } from "@terrarium/core/contract";
import { useState } from "react";
import { DEFAULT_QUESTION, hiddenWarning, traceAdvice, tryDetail, tryFacts } from "../../logic";
import { useAction, useApp } from "../context";
import { Button, Note, SelectField, TextField, ToneDot } from "../kit";

/** Why the button is switched off, if it is. */
export function whyNot(view: ConnectionView, agentCount: number): string | undefined {
  if (!view.canTalk) return "이 연결 방식은 아직 말 걸어 보기를 못 해요";
  if (view.status !== "ok") return "연결이 안 돼 있어요. '다시 확인'을 먼저 눌러 보세요";
  if (agentCount === 0) return "말 걸 에이전트가 없어요";
  return undefined;
}

function Answer({ result }: { readonly result: TryResult }) {
  if (!result.ok) return <Note tone="bad">{result.error ?? "답을 받지 못했어요"}</Note>;
  const detail = tryDetail(result);
  const advice = traceAdvice(result.trace);
  return (
    <div className="stack" style={{ gap: 8 }} aria-live="polite">
      <Note tone="good">{result.text || "(빈 답이 왔어요)"}</Note>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {tryFacts(result).map((f) => (
          <ToneDot key={f.text} tone={f.tone}>
            {f.text}
          </ToneDot>
        ))}
      </div>
      {detail && <span className="small muted">{detail}</span>}
      {advice && <span className="small muted">{advice}</span>}
    </div>
  );
}

export function TryPanel({
  view,
  agents,
}: {
  readonly view: ConnectionView;
  /** The agents to choose from: the list, with the left-out ones when the person is looking at everything. */
  readonly agents: ConnectionView["agents"];
}) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const [picked, setPicked] = useState<string>();
  const [text, setText] = useState(DEFAULT_QUESTION);
  const [result, setResult] = useState<TryResult>();
  const agent = agents.find((a) => a.id === picked) ?? agents[0];
  const why = whyNot(view, agents.length);
  const warning = hiddenWarning(agent);
  const send = async () => {
    if (!agent) return;
    const sent = await run(() =>
      api.call("tryConnection", {
        params: { id: view.id },
        body: { agentId: agent.id, text: text.trim() || DEFAULT_QUESTION },
      }),
    );
    if (sent) setResult(sent);
  };
  return (
    <section className="stack" style={{ gap: 12 }} aria-label={`${view.name}에 말 걸어 보기`}>
      <p className="small muted" style={{ margin: 0 }}>
        한 문장을 보내고 답을 받아요. 툴은 쓰지 않고 실험에는 아무 영향이 없어요.
      </p>
      <SelectField
        label="에이전트"
        value={agent?.id}
        options={agents.map((a) => ({
          value: a.id,
          label: a.hidden ? `${a.name} · 숨겼던 에이전트` : a.name,
        }))}
        onChange={setPicked}
        placeholder="에이전트가 없어요"
      />
      {warning && <Note tone="warn">{warning}</Note>}
      <TextField label="보낼 말" value={text} onChange={setText} maxLength={2000} />
      <div>
        <Button
          kind="primary"
          busy={busy}
          disabled={why !== undefined}
          {...(why ? { why } : {})}
          onClick={send}
        >
          {busy ? "물어보는 중" : "보내서 답 보기"}
        </Button>
      </div>
      {result && <Answer result={result} />}
    </section>
  );
}
