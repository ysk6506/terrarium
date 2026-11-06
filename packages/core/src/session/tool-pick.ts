/**
 * The tool-pick check (ADR-0087 item 3): do the tool descriptions tell an agent which tool to reach for? A reference
 * agent that needs no model reads the standard description of every tool and, for each situation an alarm puts it
 * in, picks the tools whose summary and "when to use" fit best. Where it picks two tools for the same situation and
 * neither one's "when not to use" says to use the other instead, the pair is ambiguous: an agent would flip a coin,
 * and the descriptions need a sentence that tells them apart.
 *
 * It is a reading test of the words, not of a model: a model may pick differently, but a description that two tools
 * share word for word cannot be told apart by anyone.
 */
import { TOOL_DOCS, type ToolDoc } from "@terrarium/core/tools";

export interface PickSituation {
  readonly id: string;
  /** The situation in words a person recognises, as an alarm puts it. */
  readonly label: string;
  /** What the situation is about, in the words a description would use. */
  readonly words: readonly string[];
  /** The tools a person would accept as the right first reach. */
  readonly best: readonly string[];
}

export const PICK_SITUATIONS: readonly PickSituation[] = [
  {
    id: "hot_room",
    label: "방 온도가 올라요",
    words: ["hot", "warm", "temperature", "thermal"],
    best: ["facility_status", "set_cooling_setpoint"],
  },
  {
    id: "power_dark",
    label: "전원이 끊겼어요",
    words: ["dark", "power", "breaker", "outage"],
    best: ["facility_status", "reset_breaker"],
  },
  {
    id: "service_down",
    label: "서비스가 멈추거나 느려요",
    words: ["service", "outage", "slowness", "affected"],
    best: ["list_services", "service_status"],
  },
  {
    id: "host_inside",
    label: "서버 안에서 디스크·메모리·프로세스가 이상해요",
    words: ["disk", "memory", "process", "log", "operating system"],
    best: ["run_command"],
  },
  {
    id: "switch_config",
    label: "스위치 포트·VLAN·경로가 이상해요",
    words: ["vlan", "port", "route", "bgp"],
    best: ["network_cli"],
  },
  {
    id: "vm_busy",
    label: "VM이 있는 서버가 뜨겁거나 망가졌어요",
    words: ["failing", "emptied", "migration"],
    best: ["migrate_vm", "vcenter_request"],
  },
  {
    id: "alarm_start",
    label: "알람이 울렸어요 (무엇인지 몰라요)",
    words: ["start a task", "alarm"],
    best: ["list_alarms"],
  },
  {
    id: "after_fix",
    label: "조치했어요 (좋아졌는지 보고 싶어요)",
    words: ["after an action", "changed something", "helped"],
    best: ["list_alarms", "wait"],
  },
  {
    id: "stuck",
    label: "권한이나 툴이 모자라요",
    words: ["lack", "permission", "risky", "decision"],
    best: ["ask_human"],
  },
  {
    id: "no_procedure",
    label: "평소 절차를 몰라요",
    words: ["procedure", "usual", "runbook"],
    best: ["search_runbooks"],
  },
];

export interface PickRow {
  readonly situation: PickSituation;
  /** The tools the reference agent reaches for, best fit first. */
  readonly picked: readonly string[];
  /** Whether one of the tools a person would accept is among them. */
  readonly hit: boolean;
}

export interface AmbiguousPair {
  readonly a: string;
  readonly b: string;
  /** The situations where it picked both. */
  readonly situations: readonly string[];
}

export interface ToolPickCheck {
  /** The tools that were read (columns of the matrix). */
  readonly tools: readonly string[];
  readonly rows: readonly PickRow[];
  readonly ambiguous: readonly AmbiguousPair[];
  /** In plain Korean: what to fix, or nothing when the descriptions tell the tools apart. */
  readonly warnings: readonly string[];
}

const read = (doc: ToolDoc) => `${doc.summary} ${doc.use}`.toLowerCase();

/** How well a tool's description fits a situation: how many of the situation's words its summary and "use" say. */
function fit(doc: ToolDoc, words: readonly string[]): number {
  const text = read(doc);
  return words.filter((w) => text.includes(w)).length;
}

/** One tool's description names the other as what to use instead. */
const defers = (a: string, b: string) => (TOOL_DOCS[a]?.notUse ?? "").includes(b);

function reach(tools: readonly string[], situation: PickSituation): string[] {
  const scored = tools
    .map((name) => ({ name, score: fit(TOOL_DOCS[name] as ToolDoc, situation.words) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  const top = scored[0]?.score ?? 0;
  return scored.filter((x) => x.score >= top).map((x) => x.name);
}

function pairsOf(rows: readonly PickRow[]): AmbiguousPair[] {
  const found = new Map<string, { a: string; b: string; situations: string[] }>();
  for (const row of rows)
    for (const [i, a] of row.picked.entries())
      for (const b of row.picked.slice(i + 1)) {
        if (defers(a, b) || defers(b, a)) continue;
        const key = `${a}|${b}`;
        const entry = found.get(key) ?? { a, b, situations: [] };
        entry.situations.push(row.situation.id);
        found.set(key, entry);
      }
  return [...found.values()];
}

/** Read the descriptions of `tools` against the situations. */
export function toolPickCheck(tools: readonly string[]): ToolPickCheck {
  const known = tools.filter((t) => TOOL_DOCS[t]);
  const rows = PICK_SITUATIONS.map((situation): PickRow => {
    const picked = reach(known, situation);
    return {
      situation,
      picked,
      hit: picked.some((p) => situation.best.includes(p)),
    };
  });
  const ambiguous = pairsOf(rows);
  const label = (id: string) => PICK_SITUATIONS.find((s) => s.id === id)?.label ?? id;
  return {
    tools: known,
    rows,
    ambiguous,
    warnings: [
      ...rows
        .filter(
          (r) => r.picked.length > 0 && !r.hit && r.situation.best.some((b) => known.includes(b)),
        )
        .map((r) => `'${r.situation.label}'에서 기준 에이전트가 맞는 툴을 못 골랐어요`),
      ...ambiguous.map(
        (p) =>
          `\`${p.a}\`와 \`${p.b}\`가 '${label(p.situations[0] as string)}'에서 둘 다 골라져요. 한쪽 설명에 "대신 무엇을 쓰나"를 적어 주세요`,
      ),
    ],
  };
}
