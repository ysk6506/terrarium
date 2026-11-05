/**
 * What a connection's agents are, and which were left out of the list and why (REQ-051, ADR-0085). A harness
 * that can say what it hid does (`inventory`); one that hides nothing is just its `agents()`.
 */
import type { AgentCensus } from "@terrarium/core/contract";
import type { AgentInfo, HarnessPort } from "@terrarium/core/experiments";

export async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${Math.round(ms / 1000)}초 안에 답이 없어요`)), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export interface Survey {
  /** The list people work with: experiments pick from it. */
  readonly agents: readonly AgentInfo[];
  readonly census: AgentCensus;
  /** Left out and not in `agents`. */
  readonly hiddenAgents: readonly AgentInfo[];
}

export const NO_AGENTS: Survey = {
  agents: [],
  hiddenAgents: [],
  census: { shown: 0, total: 0, hidden: [], includesHidden: false, notes: [] },
};

/** Ask the harness for its agents, within `wait` ms. Throws what the harness threw. */
export async function survey(port: HarnessPort, wait: number): Promise<Survey> {
  if (!port.inventory) {
    const agents = await within(port.agents(), wait);
    return {
      agents,
      hiddenAgents: [],
      census: {
        shown: agents.length,
        total: agents.length,
        hidden: [],
        includesHidden: false,
        ...(agents.length === 0 ? { empty: "응답에 에이전트가 하나도 없어요" } : {}),
        notes: [],
      },
    };
  }
  const inv = await within(port.inventory(), wait);
  const hidden = inv.hidden.flatMap((h) => h.agents);
  const includes = inv.includesHidden === true;
  return {
    agents: includes ? [...inv.shown, ...hidden] : inv.shown,
    hiddenAgents: includes ? [] : hidden,
    census: {
      shown: inv.shown.length,
      total: inv.shown.length + hidden.length,
      hidden: inv.hidden.map((h) => ({ reason: h.reason, count: h.agents.length })),
      includesHidden: includes,
      ...(inv.empty !== undefined ? { empty: inv.empty } : {}),
      notes: inv.notes ?? [],
    },
  };
}
