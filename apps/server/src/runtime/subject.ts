/** Who runs an experiment, as it is now (REQ-052): the harness and the agent, put in one record. */
import type { AgentInfo, HarnessInfo, Metadata, Subject } from "@terrarium/core/experiments";

export const present = (m: Metadata | undefined): m is Metadata =>
  m !== undefined && Object.keys(m).length > 0;

/** Kept with the experiment so later changes to the connection do not rewrite it. */
export function subjectOf(
  harness: HarnessInfo,
  agent: AgentInfo | undefined,
  metadata: Metadata | undefined,
): Subject {
  return {
    harness: {
      id: harness.id,
      name: harness.name,
      kind: harness.kind,
      toolTransport: harness.toolTransport,
      ...(present(metadata) ? { metadata } : {}),
    },
    agent: {
      id: agent?.id ?? "",
      name: agent?.name ?? agent?.id ?? "",
      ...(agent?.model ? { model: agent.model } : {}),
      ...(agent?.description ? { description: agent.description } : {}),
      ...(present(agent?.facts) ? { facts: agent.facts } : {}),
    },
  };
}
