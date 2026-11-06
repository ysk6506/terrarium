/**
 * What the run handed to other teams (REQ-093, ADR-0098 item 5): the list of hand-offs (always, once there is one),
 * the ticket board (when the ticket tools were on), and how the agent used the wait. It reads the run's recorded
 * events, which the replay fetches too, so a run that is still going shows its hand-offs as they progress.
 */
import type { RunView } from "@terrarium/core/contract";
import { handoffs } from "../../logic";
import { Note, Section } from "../kit";
import { useRunData } from "../topology/useRunData";

const W = handoffs.HANDOFF_WORDS;

function HandoffTable({ blocks }: { readonly blocks: readonly handoffs.HandoffBlock[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{W.columns.domain}</th>
            <th>{W.columns.fault}</th>
            <th>{W.columns.eta}</th>
            <th>{W.columns.progress}</th>
            <th>{W.columns.done}</th>
          </tr>
        </thead>
        <tbody>
          {blocks.flatMap((b) =>
            b.faults.length === 0
              ? [
                  <tr key={b.id}>
                    <td>
                      {b.domain}
                      <div className="tiny muted">{b.handedText}</div>
                    </td>
                    <td colSpan={4} className="muted">
                      {W.noFault}
                    </td>
                  </tr>,
                ]
              : b.faults.map((f, i) => (
                  <tr key={`${b.id}-${f.faultId}`}>
                    <td>
                      {i === 0 && (
                        <>
                          {b.domain}
                          <div className="tiny muted">{b.handedText}</div>
                        </>
                      )}
                    </td>
                    <td>
                      {f.label}
                      <div className="tiny muted">{f.target}</div>
                    </td>
                    <td>{f.eta}</td>
                    <td>
                      <span
                        className={`status status-${f.progress === "done" ? "good" : f.progress === "working" ? "busy" : "warn"}`}
                      >
                        {handoffs.PROGRESS_LABELS[f.progress]}
                      </span>
                      <div className="tiny muted">{f.who}</div>
                    </td>
                    <td className="small">{f.doneText ?? "—"}</td>
                  </tr>
                )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function TicketBoard({ events }: { readonly events: Parameters<typeof handoffs.ticketBoard>[0] }) {
  const board = handoffs.ticketBoard(events);
  return (
    <div className="ticket-board">
      <style>{TICKET_CSS}</style>
      {handoffs.TICKET_COLUMNS.map((col) => (
        <section key={col.id} className="ticket-col" aria-label={col.label}>
          <h3>
            {col.label} <span className="tiny muted">{board[col.id].length}개</span>
          </h3>
          {board[col.id].length === 0 && <p className="tiny muted">비어 있어요</p>}
          <ul className="list-plain">
            {board[col.id].map((t) => (
              <li key={t.id} className="ticket-card">
                <b>{t.title}</b>
                {t.detail && <span className="small muted">{t.detail}</span>}
                {t.auto && <span className="tiny muted">넘길 때 저절로 만들어졌어요</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const TICKET_CSS = `
.ticket-board {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 720px) {
  .ticket-board {
    grid-template-columns: minmax(0, 1fr);
  }
}
.ticket-col h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.ticket-card {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
}
.ticket-col .list-plain {
  display: grid;
  gap: 8px;
}
.ticket-col .list-plain li + li {
  margin-top: 0;
}
`;

function Measure({ view }: { readonly view: RunView }) {
  const report = view.run.result?.score.handoff;
  if (!report) return null;
  return (
    <div className="stack">
      <p className="small">{handoffs.handoffSummary(report)}</p>
      {handoffs.measureLines(report).map((m) => (
        <div key={m.id} className="handoff-measure">
          <b className="small">
            {report.rows.find((r) => r.id === m.id)?.team}에 넘긴 일 — {W.measure}
          </b>
          <ul className="list-plain">
            {m.lines.map((l) => (
              <li key={l.label} className="small">
                <span
                  className={`status status-${l.tone === "good" ? "good" : l.tone === "bad" ? "bad" : "busy"}`}
                >
                  {l.label}
                </span>{" "}
                {l.value}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The "넘긴 일" part of a run's page; nothing at all when the run handed nothing over. */
export function HandoffSection({ view, live }: { readonly view: RunView; readonly live: boolean }) {
  const { run } = view;
  const { data } = useRunData(run.id, view.experiment.experiment.recipe.worldId, live);
  if (!data) return null;
  const { events } = data.record;
  const blocks = handoffs.handoffBlocks(events, (id) => data.index.find(id)?.name ?? id);
  if (blocks.length === 0 && !handoffs.hasTickets(events)) return null;
  return (
    <>
      {blocks.length > 0 && (
        <Section
          title={W.title}
          aside={
            view.run.result?.scope && (
              <span className="tiny muted">{handoffs.scopeText(view.run.result.scope)}</span>
            )
          }
        >
          <div className="stack">
            <HandoffTable blocks={blocks} />
            <Measure view={view} />
          </div>
        </Section>
      )}
      {handoffs.hasTickets(events) && (
        <Section title={W.tickets}>
          <TicketBoard events={events} />
        </Section>
      )}
      {blocks.length === 0 && <Note>{W.none}</Note>}
    </>
  );
}
