/**
 * The agent's speech bubble over the board (REQ-078 step 2, ADR-0084 item 5): who, what, when. It shows for three
 * seconds after a call; the tile the call touched keeps its colour until the next call. `usePulse` is that
 * three seconds: it starts when a new call appears (a call arriving live, the replay passing one, a drag
 * landing on one) and not for the call that was already there when the view opened.
 */
import { useEffect, useRef, useState } from "react";
import { hallTopology } from "../../logic";

export interface AgentLook {
  readonly bubble: hallTopology.Bubble | undefined;
  readonly effect: "read" | "write";
  /** Within three seconds of the call. */
  readonly active: boolean;
}

/** True for three seconds after `key` changes to a new value; `key` is the number of the call the agent made last. */
export function usePulse(key: number | undefined, ms: number = hallTopology.PULSE_MS): boolean {
  const first = useRef(true);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (key === undefined) {
      setActive(false);
      return;
    }
    setActive(true);
    const timer = setTimeout(() => setActive(false), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);
  return active;
}

export function AgentBubble({ look }: { readonly look: AgentLook }) {
  const { bubble } = look;
  if (!look.active || !bubble) return null;
  return (
    <output className={`topo-card topo-agent topo-agent-${bubble.effect}`} aria-live="polite">
      <span className="who">
        <i aria-hidden="true" />
        {bubble.who}
      </span>
      <code>{bubble.call}</code>
      <span className={`when${bubble.failed ? " bad" : ""}`}>{bubble.when}</span>
    </output>
  );
}
