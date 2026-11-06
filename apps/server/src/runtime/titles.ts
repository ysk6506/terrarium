/**
 * 칭호 (REQ-101, ADR-0122): what a person has done, said with the number and the unit that earned it. No levels and no
 * badges without a stated condition. A title is earned once and never lost: new ones are found from the records
 * (worlds, scenarios, experiments, runs, hearts, 변별력 점검 marks) and written to the awards table, and the table is what
 * a later look reads first. Worked out for everyone at once and remembered until a write that matters (see `watchStore`).
 */
import type { TitleView } from "@terrarium/core/contract";
import type {
  CalibrationMark,
  Experiment,
  ScenarioRecord,
  TitleAward,
  WorldLike,
  WorldSummary,
} from "@terrarium/core/experiments";
import type { PlatformContext } from "./context";

interface TitleDef {
  readonly key: string;
  readonly label: string;
  readonly means: string;
}

/** In the order they are shown: the first two go next to the name. */
export const TITLES: readonly TitleDef[] = [
  { key: "runs-1000", label: "실험 1,000번", means: "실험을 1,000번 만들었어요" },
  {
    key: "others-scenario",
    label: "남이 쓰는 시나리오",
    means: "내 시나리오로 다른 사람이 만든 실험이 10번이 됐어요",
  },
  {
    key: "others-world",
    label: "남이 쓰는 세계",
    means: "내 세계에서 다른 사람이 실험을 10번 돌렸어요",
  },
  {
    key: "careful-author",
    label: "꼼꼼한 출제자",
    means: "변별력 점검을 모두 통과한 시나리오가 5개가 됐어요",
  },
  { key: "runs-100", label: "실험 100번", means: "실험을 100번 만들었어요" },
  { key: "likes-10", label: "좋아요 10", means: "내 세계가 다른 사람에게 좋아요를 10번 받았어요" },
  { key: "first-recovery", label: "첫 복구", means: "에이전트가 내 시나리오를 처음 통과했어요" },
  { key: "first-world", label: "첫 세계", means: "세계를 처음 만들었어요" },
];

const BY_KEY = new Map(TITLES.map((t) => [t.key, t]));

/** What the conditions are worked out from. */
export interface TitleFacts {
  readonly worlds: readonly WorldSummary[];
  readonly scenarios: readonly ScenarioRecord[];
  readonly experiments: readonly Pick<Experiment, "owner" | "createdAt" | "recipe">[];
  /** When an agent first passed each scenario, by scenario id. */
  readonly firstPass: ReadonlyMap<string, string>;
  readonly likes: readonly WorldLike[];
  readonly marks: readonly CalibrationMark[];
}

type Earned = Map<string, Map<string, string>>;

function grant(into: Earned, user: string, key: string, at: string | undefined): void {
  if (at === undefined) return;
  const mine = into.get(user) ?? new Map<string, string>();
  mine.set(key, at);
  into.set(user, mine);
}

/** The moment the `n`th of these happened (counting from 1), when there are that many. */
function nth(times: readonly string[], n: number): string | undefined {
  return [...times].sort()[n - 1];
}

function groupTimes<T>(
  items: readonly T[],
  pick: (item: T) => [string, string] | undefined,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const item of items) {
    const found = pick(item);
    if (!found) continue;
    out.set(found[0], [...(out.get(found[0]) ?? []), found[1]]);
  }
  return out;
}

function ownRuns(f: TitleFacts, into: Earned): void {
  const times = groupTimes(f.experiments, (e) => [e.owner, e.createdAt]);
  for (const [user, at] of times) {
    grant(into, user, "runs-100", nth(at, 100));
    grant(into, user, "runs-1000", nth(at, 1000));
  }
}

function firstWorld(f: TitleFacts, into: Earned): void {
  // a saved template is a recipe for a world, not a world; a sample is nobody's work
  const made = f.worlds.filter((w) => w.origin !== "template" && w.origin !== "sample");
  for (const [user, at] of groupTimes(made, (w) => [w.owner, w.createdAt]))
    grant(into, user, "first-world", nth(at, 1));
}

/** Others' experiments on what I made: worlds (`others-world`) or scenarios (`others-scenario`). */
function usedByOthers(f: TitleFacts, into: Earned): void {
  const worldOwner = new Map(f.worlds.map((w) => [w.id, w.owner]));
  const scenarioOwner = new Map(f.scenarios.map((s) => [s.id, s.owner]));
  const used = (
    key: string,
    owners: ReadonlyMap<string, string>,
    id: (e: TitleFacts["experiments"][number]) => string,
  ) => {
    const times = groupTimes(f.experiments, (e) => {
      const owner = owners.get(id(e));
      return owner && owner !== e.owner ? [owner, e.createdAt] : undefined;
    });
    for (const [user, at] of times) grant(into, user, key, nth(at, 10));
  };
  used("others-world", worldOwner, (e) => e.recipe.worldId);
  used("others-scenario", scenarioOwner, (e) => e.recipe.scenarioId);
}

function recoveries(f: TitleFacts, into: Earned): void {
  const times = groupTimes(f.scenarios, (s) => {
    const at = f.firstPass.get(s.id);
    return at ? [s.owner, at] : undefined;
  });
  for (const [user, at] of times) grant(into, user, "first-recovery", nth(at, 1));
}

function carefulAuthors(f: TitleFacts, into: Earned): void {
  const owner = new Map(f.scenarios.map((s) => [s.id, s.owner]));
  const clean = new Map<string, string>();
  for (const m of f.marks) {
    const seen = clean.get(m.scenarioId);
    if (m.clean && (seen === undefined || m.at < seen)) clean.set(m.scenarioId, m.at);
  }
  const times = groupTimes([...clean], ([id, at]) => {
    const who = owner.get(id);
    return who ? [who, at] : undefined;
  });
  for (const [user, at] of times) grant(into, user, "careful-author", nth(at, 5));
}

/** Hearts from other people on my worlds. */
function hearts(f: TitleFacts, into: Earned): void {
  const owner = new Map(f.worlds.map((w) => [w.id, w.owner]));
  const times = groupTimes(f.likes, (l) => {
    const who = owner.get(l.worldId);
    return who && who !== l.user ? [who, l.at] : undefined;
  });
  for (const [user, at] of times) grant(into, user, "likes-10", nth(at, 10));
}

/** Every title the records say someone has earned, with the moment they earned it. */
export function earnedTitles(facts: TitleFacts): TitleAward[] {
  const into: Earned = new Map();
  for (const rule of [ownRuns, firstWorld, usedByOthers, recoveries, carefulAuthors, hearts])
    rule(facts, into);
  return [...into].flatMap(([user, keys]) =>
    [...keys].map(([key, earnedAt]) => ({ user, key, earnedAt })),
  );
}

/** A person's awards as the screen shows them: in the order of `TITLES`. */
export function viewsOf(awards: readonly TitleAward[]): TitleView[] {
  return TITLES.flatMap((def) => {
    const award = awards.find((a) => a.key === def.key);
    return award
      ? [{ key: def.key, label: def.label, means: def.means, earnedAt: award.earnedAt }]
      : [];
  });
}

export class Titles {
  private cache?: { readonly version: number; readonly byUser: Map<string, TitleView[]> };
  private pending?: Promise<Map<string, TitleView[]>>;

  constructor(
    private readonly ctx: PlatformContext,
    private readonly version: () => number,
  ) {}

  private async facts(): Promise<TitleFacts> {
    const { store } = this.ctx;
    const [worlds, scenarios, experiments, likes, marks] = await Promise.all([
      store.listWorlds(),
      store.listScenarios(),
      store.listExperiments(),
      store.listLikes(),
      store.listCalibrationMarks(),
    ]);
    return {
      worlds,
      scenarios,
      experiments,
      likes,
      marks,
      firstPass: await this.passes(scenarios, experiments),
    };
  }

  /** When an agent first passed each stored scenario. */
  private async passes(
    scenarios: readonly ScenarioRecord[],
    experiments: readonly Experiment[],
  ): Promise<Map<string, string>> {
    const known = new Set(scenarios.map((s) => s.id));
    const first = new Map<string, string>();
    for (const e of experiments) {
      if (!known.has(e.recipe.scenarioId)) continue;
      for (const run of await this.ctx.store.listRuns(e.id)) {
        const at = run.finishedAt ?? run.startedAt ?? run.queuedAt;
        const seen = first.get(e.recipe.scenarioId);
        if (run.result?.score.passed && (seen === undefined || at < seen))
          first.set(e.recipe.scenarioId, at);
      }
    }
    return first;
  }

  private async work(): Promise<Map<string, TitleView[]>> {
    const version = this.version();
    const found = earnedTitles(await this.facts());
    const kept = await this.ctx.store.listTitleAwards();
    const have = new Set(kept.map((a) => `${a.user}\u0000${a.key}`));
    const fresh = found.filter((a) => !have.has(`${a.user}\u0000${a.key}`));
    if (fresh.length > 0) await this.ctx.store.putTitleAwards(fresh);
    const byUser = new Map<string, TitleAward[]>();
    for (const a of [...kept, ...fresh]) byUser.set(a.user, [...(byUser.get(a.user) ?? []), a]);
    const views = new Map([...byUser].map(([user, awards]) => [user, viewsOf(awards)] as const));
    this.cache = { version, byUser: views };
    return views;
  }

  private async all(): Promise<Map<string, TitleView[]>> {
    if (this.cache && this.cache.version === this.version()) return this.cache.byUser;
    this.pending ??= this.work().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** Everything one person has earned, the ones to show first first. */
  async of(user: string): Promise<TitleView[]> {
    return (await this.all()).get(user) ?? [];
  }

  async ofMany(users: Iterable<string>): Promise<Map<string, TitleView[]>> {
    const all = await this.all();
    return new Map([...new Set(users)].map((u) => [u, all.get(u) ?? []] as const));
  }
}

export const titleLabel = (key: string): string | undefined => BY_KEY.get(key)?.label;
