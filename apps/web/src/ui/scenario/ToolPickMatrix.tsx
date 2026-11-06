/**
 * The tool-pick check in the editor's side panel (REQ-080, ADR-0087 item 3): a table of situations by tools that
 * shows which tool a reference agent reaches for when it reads only the descriptions, and the pairs it cannot tell
 * apart. A pair is shown so the author can write the sentence that separates them.
 */
import type { ToolPickCheck } from "@terrarium/core/session";
import { toolPicker } from "../../logic";
import { Note } from "../kit";

const { PICK_WORDS: W } = toolPicker;

const MARK: Readonly<
  Record<toolPicker.PickCell, { readonly text: string; readonly label: string }>
> = {
  hit: { text: "●", label: W.HIT },
  extra: { text: "●", label: W.EXTRA },
  miss: { text: "○", label: W.MISS },
  "": { text: "", label: "" },
};

export function ToolPickMatrix({ check }: { readonly check: ToolPickCheck }) {
  const m = toolPicker.pickMatrix(check);
  return (
    <div className="stack tool-pick" data-testid="tool-pick">
      <h4 style={{ margin: 0 }}>{W.TITLE}</h4>
      <p className="small muted">{W.LEDE}</p>
      <div className="pick-scroll">
        <table className="pick-matrix">
          <thead>
            <tr>
              <th scope="col">상황</th>
              {m.columns.map((t) => (
                <th key={t} scope="col" className="pick-col">
                  <span>{toolPicker.titleOf(t)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                {row.cells.map((cell, i) => (
                  <td
                    key={m.columns[i]}
                    className={`pick-cell pick-${cell || "none"}`}
                    {...(cell ? { "aria-label": MARK[cell].label, title: MARK[cell].label } : {})}
                  >
                    {MARK[cell].text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny muted pick-legend">
        ● {W.HIT} · ○ {W.MISS}
      </p>
      {m.pairs.length === 0 ? (
        <Note tone="good">{W.NO_PAIR}</Note>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">{W.PAIR_HEAD}</b>
          <ul className="issues" aria-label={W.PAIR_HEAD}>
            {m.pairs.map((p) => (
              <li key={`${p.a}|${p.b}`} className="issue issue-static pick-pair">
                <span className="issue-mark" />
                <span>
                  {W.pair(p.a, p.b)} '{p.situations.join("', '")}'에서 둘 다 골라져요.{" "}
                  <span className="muted">{W.FIX}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
