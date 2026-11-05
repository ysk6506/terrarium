/**
 * The line under a connection's name that says how many agents it has and why some are not in the list
 * (REQ-079, ADR-0085). The words are made in logic/agent-census; this only lays them out.
 */
import type { AgentCensus } from "@terrarium/core/contract";
import { censusText } from "../../logic";
import { Button, Note } from "../kit";

export function AgentCensusLine({
  census,
  showing,
  onToggle,
  busy,
}: {
  readonly census: AgentCensus;
  /** Whether the left-out agents are in the list right now. */
  readonly showing: boolean;
  readonly onToggle: () => void;
  readonly busy?: boolean;
}) {
  const text = censusText(census, showing);
  const tone = census.total === 0 ? "warn" : undefined;
  return (
    <Note {...(tone ? { tone } : {})}>
      <div className="stack" style={{ gap: 6 }}>
        <span>
          <strong>{text.headline}</strong>
        </span>
        {text.lines.map((line) => (
          <span key={line} className="small">
            {line}
          </span>
        ))}
        {text.action && (
          <div>
            <Button size="small" busy={busy ?? false} onClick={onToggle}>
              {text.action}
            </Button>
          </div>
        )}
      </div>
    </Note>
  );
}
