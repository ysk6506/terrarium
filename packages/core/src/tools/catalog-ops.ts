/**
 * The tools for handing work over and keeping track of it (REQ-093, ADR-0098, ADR-0099, ADR-0100): `escalate`,
 * `events_since`, and the three ticket tools. They live in a file of their own and are added to the catalog at its end.
 * `optional` means off unless the experiment turns it on (the domain scope turns `escalate` and `events_since` on; the
 * tickets are the harness's own business unless asked for).
 */
import type { JsonSchema, ToolSpec } from "./catalog";
import type { ToolDoc } from "./docs";

type OpsSpec = Omit<ToolSpec, "realism" | "description">;

const obj = (properties: JsonSchema["properties"], required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
});
const str = (description: string, values?: readonly string[]) => ({
  type: "string",
  description,
  ...(values ? { enum: values } : {}),
});
const num = (description: string) => ({ type: "number", description });

/** The words under the ticket tools on the tool picker, from ADR-0099 item 3. */
export const TICKET_HELP =
  "하네스에 할 일 관리가 없을 때 켜요. 켜면 넘긴 요청이 자동으로 '기다리는 중' 티켓이 돼요. 꺼도 상대의 진행·완료는 `events_since`로 들어와요.";

/** The picker shows the three ticket tools as one line. */
export const TICKET_BUNDLE = { id: "tickets", label: "작업 티켓(선택)" } as const;

const bundle = { optional: true, help: TICKET_HELP, bundle: TICKET_BUNDLE } as const;

export const OPS_SPECS: readonly OpsSpec[] = [
  {
    name: "escalate",
    title: "도메인 팀에 넘기기",
    category: "act",
    mutating: true,
    optional: true,
    help: "내 도메인을 고르면 켜져요. 내 도메인 밖의 고장은 이 툴로 그 도메인 팀에 넘겨요.",
    inputSchema: obj(
      {
        domain: str(
          "The domain to hand over: service_os, virtualization, server, network, storage or facility (data center infrastructure: power and cooling)",
        ),
        note: str("What you saw, for the record (not used to decide anything)"),
      },
      ["domain"],
    ),
  },
  {
    name: "events_since",
    title: "새 사건 보기",
    category: "observe",
    mutating: false,
    optional: true,
    help: "내 도메인을 고르면 켜져요. 알람과 넘긴 일의 진행·완료가 들어와요.",
    inputSchema: obj({
      cursor: num("The cursor the last call returned (0 or none for everything so far)"),
    }),
  },
  {
    name: "create_ticket",
    title: "작업 티켓 만들기",
    category: "act",
    mutating: false,
    ...bundle,
    inputSchema: obj(
      {
        title: str("What there is to do"),
        status: str("mine (to do), waiting (waiting for someone) or done", [
          "mine",
          "waiting",
          "done",
        ]),
        waitingFor: str("Whom you wait for (status waiting)"),
        dueInSeconds: num("Seconds from now by which it is due"),
        note: str("Anything to remember"),
      },
      ["title"],
    ),
  },
  {
    name: "update_ticket",
    title: "작업 티켓 바꾸기",
    category: "act",
    mutating: false,
    ...bundle,
    inputSchema: obj(
      {
        id: str("Ticket id"),
        title: str("New title"),
        status: str("mine, waiting or done", ["mine", "waiting", "done"]),
        waitingFor: str("Whom you wait for (status waiting)"),
        dueInSeconds: num("Seconds from now by which it is due"),
        note: str("Anything to remember"),
      },
      ["id"],
    ),
  },
  {
    name: "list_tickets",
    title: "작업 티켓 목록",
    category: "observe",
    mutating: false,
    ...bundle,
    inputSchema: obj({ status: str("Only tickets in this status", ["mine", "waiting", "done"]) }),
  },
];

const d = (doc: ToolDoc): ToolDoc => doc;

export const OPS_DOCS: Readonly<Record<string, ToolDoc>> = {
  escalate: d({
    realism: "common",
    summary:
      "Hand every fault that exists in one domain over to that domain's team (or its vendor), and learn when each will be gone.",
    use: "the cause is in a domain outside your own, or a part must be replaced, and your own tools cannot fix it.",
    notUse:
      "your own tools can fix it (restart, remount, settings): do that yourself. Faults that appear after the call are not included; call again for them.",
    example: '{"domain":"server","note":"srv-a1 reports memory errors"}',
    cost: "low",
    costWhy: "one call; the wait itself is world time, not calls",
    details:
      "Domains: service_os, virtualization, server, network, storage, facility (data center infrastructure: power and cooling). The answer tells, for each fault, how long the team needs. Until then the fault stays and so does its damage, so use your own tools for a temporary fix (move the VM, fail the service over) and put things back once the team is done. Progress and completion arrive in events_since.",
  }),
  events_since: d({
    realism: "common",
    summary:
      "The alarms raised and cleared, and the progress of work handed to other teams, since the cursor.",
    use: "you want to know what changed without listing everything, or whether a team has finished.",
    notUse:
      "you need a number over time (use query_metrics) or one device's state (use get_entity).",
    example: '{"cursor":42}',
    cost: "low",
    costWhy: "only what is new",
    details:
      "Returns { cursor, events }. Pass the cursor back next time. Event types: alarm_raised, alarm_cleared, handed (a team has the work), started (an engineer is on site or at the console), done (the fault is gone).",
  }),
  create_ticket: d({
    realism: "common",
    summary:
      "Write down a piece of work, so it is not forgotten while you wait or do something else.",
    use: "you hand something over, or find work you cannot do now.",
    notUse: "your harness already tracks tasks for you.",
    example: '{"title":"VM을 srv-a1로 되돌리기","status":"waiting","waitingFor":"서버 팀"}',
    cost: "low",
    costWhy: "one small record",
    details:
      "Statuses: mine (you have to do it), waiting (someone else has it; say whom with waitingFor and by when with dueInSeconds), done.",
  }),
  update_ticket: d({
    realism: "common",
    summary: "Change a work ticket: its status, whom you wait for, its note.",
    use: "the situation of a piece of work changes, or you have finished it.",
    notUse: "the ticket does not exist yet (use create_ticket).",
    example: '{"id":"t1","status":"done"}',
    cost: "low",
    costWhy: "one small record",
  }),
  list_tickets: d({
    realism: "common",
    summary: "The work tickets, with their status, whom you wait for and by when.",
    use: "you come back to work and want to know what is open.",
    notUse: "you want what the world did (use events_since).",
    example: '{"status":"mine"}',
    cost: "low",
    costWhy: "a short list",
  }),
};
