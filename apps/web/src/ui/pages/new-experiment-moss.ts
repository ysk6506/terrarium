/**
 * 새 실험 화면이 이끼에게 내놓는 읽기와 동작 (REQ-103, ADR-0124). 모두 폼이 쓰는 같은 `set`과 `launch`를 부른다.
 */
import { MAX_SEEDS, type ScenarioRecord, type WorldSummary } from "@terrarium/core/experiments";
import { experiment, howWords } from "../../logic";
import { draftState, pickByText, useMossScreen } from "../../moss";

type Draft = experiment.Draft;

const POLL_MS = 60;
const WAIT_MS = 3000;

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WizardMoss {
  readonly draft: Draft;
  readonly set: (change: Partial<Draft>) => void;
  readonly worlds: readonly WorldSummary[];
  /** 고른 세계의 시나리오. 아직 읽는 중이면 undefined. */
  readonly scenarios: readonly ScenarioRecord[] | undefined;
  readonly harness: { readonly name: string } | undefined;
  /** 하네스의 에이전트들: 고른 에이전트의 이름을 상태에 적어요. */
  readonly agents: readonly { readonly id: string; readonly name: string }[] | undefined;
  /** 단계마다 남은 것(아직 못 시작하는 이유). */
  readonly problems: {
    readonly what: readonly string[];
    readonly who: readonly string[];
    readonly how: readonly string[];
  };
  readonly launch: () => Promise<void>;
}

export function useWizardMoss(w: WizardMoss): void {
  const world = w.worlds.find((x) => x.id === w.draft.worldId);
  const scenario = w.scenarios?.find((s) => s.id === w.draft.scenarioId);
  const agent = w.agents?.find((a) => a.id === w.draft.agentId);
  const names = {
    ...(world ? { world: world.name } : {}),
    ...(scenario ? { scenario: scenario.name } : {}),
    ...(w.harness ? { harness: w.harness.name } : {}),
    ...(agent ? { agent: agent.name } : {}),
  };
  const remaining = [...w.problems.what, ...w.problems.who, ...w.problems.how];
  const line = () =>
    [
      names.world,
      names.scenario ? `시나리오 ${names.scenario}` : undefined,
      `툴 ${w.draft.tools.length}개`,
      `${w.draft.runs}번`,
    ]
      .filter(Boolean)
      .join(" · ");
  useMossScreen("newExperiment", {
    read: () => draftState(w.draft, names, remaining),
    summary: () => line(),
    run: {
      "exp-pick-world": (a) => {
        const hit =
          pickByText(String(a.text ?? ""), w.worlds, (x) => x.name) ?? world ?? w.worlds[0];
        if (!hit) throw new Error("고를 세계가 없어요");
        const { scenarioId: _drop, ...rest } = w.draft;
        if (hit.id !== w.draft.worldId) w.set({ ...rest, worldId: hit.id });
        return hit.name;
      },
      "exp-pick-scenario": async (a) => {
        // 세계를 바꾼 직후에는 시나리오를 새로 읽는 중이에요: 읽을 때까지 기다린다.
        for (let t = 0; t < WAIT_MS && w.scenarios === undefined; t += POLL_MS)
          await later(POLL_MS);
        const list = w.scenarios ?? [];
        const hit = pickByText(String(a.text ?? ""), list, (s) => s.name);
        if (hit) w.set({ scenarioId: hit.id });
        const name = (hit ?? scenario ?? list[0])?.name;
        return name
          ? `이 세계의 ${list.length}개 중 ${name}`
          : "이 세계에는 시나리오가 아직 없어요";
      },
      "exp-pick-tools": () => {
        const tools = experiment.emptyDraft().tools;
        w.set(experiment.withTools(w.draft, [...tools]));
        return `기본 묶음 · 툴 ${tools.length}개`;
      },
      "exp-set-runs": (a) => {
        const n = typeof a.n === "number" ? a.n : howWords.RECOMMENDED_RUNS;
        const runs = Math.min(MAX_SEEDS, Math.max(1, Math.round(n)));
        w.set({ runs });
        return `${runs}번`;
      },
      "exp-start": async () => {
        if (remaining.length > 0) throw new Error(`아직 못 시작해요. ${remaining[0]}`);
        await w.launch();
      },
    },
  });
}
