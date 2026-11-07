/**
 * How the chosen harness gets Terrarium's tools, said on the step where it is chosen (beta feedback 14, 17). A harness
 * that is handed a run address when the run starts needs nothing from the person. A harness that reads its MCP servers
 * from its own settings needs the connection's fixed slot address registered once: it is shown here with copy buttons,
 * three steps, and whether it is registered. The explanation of the two addresses is folded.
 */
import type { HarnessView } from "@terrarium/core/contract";
import { useState } from "react";
import {
  addressKind,
  MCP_WORDS,
  markSlotRegistered,
  registerSteps,
  shortSlotUrl,
  slotRegistered,
  slotToken,
} from "../../logic";
import { browserStore } from "../browser-store";
import { useAction, useApp, useAsync } from "../context";
import { Button, Note } from "../kit";

function Difference() {
  return (
    <details className="fold">
      <summary>{MCP_WORDS.DIFF_SUMMARY}</summary>
      <div className="stack small muted" style={{ marginTop: 8, gap: 6 }}>
        <p style={{ margin: 0 }}>{MCP_WORDS.DIFF_RUN}</p>
        <p style={{ margin: 0 }}>{MCP_WORDS.DIFF_SLOT}</p>
      </div>
    </details>
  );
}

function CopyRow({ label, value, shown }: { label: string; value: string; shown: string }) {
  const { toast } = useApp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label}를 복사했어요`);
    } catch {
      toast("복사하지 못했어요. 브라우저가 클립보드를 막고 있어요", "bad");
    }
  };
  return (
    <div className="mcp-url">
      <span title={label}>{shown}</span>
      <Button
        data-moss-skip="세부 조절"
        size="small"
        kind="quiet"
        aria-label={`${label} 복사`}
        onClick={copy}
      >
        복사
      </Button>
    </div>
  );
}

function SlotGuide({ harness, onChange }: { harness: HarnessView; onChange: () => void }) {
  const { api, toast } = useApp();
  const { busy, run } = useAction();
  const list = useAsync((signal) => api.call("listConnections", { signal }), []);
  const slot = harness.mcpSlot ?? harness.id;
  const [done, setDone] = useState(() => slotRegistered(browserStore(), slot));
  const url = list.data?.find((c) => c.id === harness.id)?.mcpSlotUrl;
  const check = async () => {
    const ok = await run(() => api.call("recheckConnection", { params: { id: harness.id } }));
    if (ok?.status !== "ok") return toast(ok?.error ?? "연결을 확인하지 못했어요", "bad");
    markSlotRegistered(browserStore(), slot, true);
    setDone(true);
    toast(MCP_WORDS.CHECKED_OK);
    onChange();
  };
  const reset = () => {
    markSlotRegistered(browserStore(), slot, false);
    setDone(false);
    onChange();
  };
  return (
    <div className="mcp-guide stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <b>{MCP_WORDS.SLOT_HEAD}</b>
        <span className={`status ${done ? "status-good" : "status-warn"}`}>
          {done ? MCP_WORDS.SLOT_DONE : MCP_WORDS.SLOT_TODO}
        </span>
      </div>
      {done ? (
        <Button data-moss-skip="세부 조절" size="small" kind="quiet" onClick={reset}>
          {MCP_WORDS.UNREGISTER}
        </Button>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {MCP_WORDS.SLOT_HELP}
          </p>
          {url ? (
            <>
              <CopyRow label="슬롯 주소" value={url} shown={shortSlotUrl(url)} />
              <CopyRow
                label="토큰"
                value={slotToken(url)}
                shown={`토큰 ${slotToken(url).slice(0, 4)}…`}
              />
            </>
          ) : (
            <Note tone="warn">
              슬롯 주소를 아직 받지 못했어요. 연결 화면에서 이 연결을 다시 확인해 주세요.
            </Note>
          )}
          <ol className="list-plain small">
            {registerSteps(harness.kind, harness.name).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <div>
            <Button
              data-moss-skip="세부 조절"
              kind="primary"
              size="small"
              busy={busy}
              onClick={check}
            >
              {MCP_WORDS.CHECK}
            </Button>
          </div>
        </>
      )}
      <Difference />
    </div>
  );
}

/** The card under the agent picker: the run-address sentence, or the slot address to register once. */
export function McpGuide({
  harness,
  onChange,
}: {
  readonly harness: HarnessView;
  /** Called when the registration mark changes, so the start button can follow. */
  readonly onChange: () => void;
}) {
  const kind = addressKind(harness);
  if (kind === "slot") return <SlotGuide harness={harness} onChange={onChange} />;
  return (
    <div className="mcp-guide stack" style={{ gap: 8 }}>
      <b>{kind === "run" ? MCP_WORDS.RUN_TEXT : MCP_WORDS.NONE_TEXT}</b>
      {kind === "run" && (
        <p className="small muted" style={{ margin: 0 }}>
          {MCP_WORDS.RUN_HELP}
        </p>
      )}
      <Difference />
    </div>
  );
}

/** Whether the chosen harness needs its slot address registered and nobody has said it is: the start waits for it. */
export function slotPending(harness: HarnessView | undefined): boolean {
  return (
    harness !== undefined &&
    addressKind(harness) === "slot" &&
    !slotRegistered(browserStore(), harness.mcpSlot ?? harness.id)
  );
}
