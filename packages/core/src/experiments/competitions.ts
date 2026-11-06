/**
 * Competitions, as a port with an in-memory stand-in (REQ-101, ADR-0122). There is no screen and no route yet: 대회 모드
 * (the post-open roadmap) will fill this with real competitions. What exists now is the shape of the data and the rule
 * that turns placings into medals and a person's medals into a tier, so that later work has something to plug into.
 */
import {
  awardMedals,
  countMedals,
  type Medal,
  type MedalCounts,
  type TierId,
  tierOf,
} from "@terrarium/core/ranking";

/** One agent submitted to a competition, by the person who submitted it. */
export interface CompetitionEntry {
  readonly user: string;
  readonly agentKey: string;
  readonly score: number;
  readonly submittedAt: string;
}

export interface Competition {
  readonly id: string;
  readonly name: string;
  readonly entries: readonly CompetitionEntry[];
}

export interface CompetitionsPort {
  put(competition: Competition): Promise<void>;
  get(id: string): Promise<Competition | undefined>;
  list(): Promise<Competition[]>;
}

/** What one person won in one competition: their best agent's rank and medal. */
export interface CompetitionResult {
  readonly competitionId: string;
  readonly rank: number;
  readonly participants: number;
  readonly medal?: Medal;
}

/** Everyone who took part, once, ranked on their best entry. */
export function resultsOf(competition: Competition): Map<string, CompetitionResult> {
  const best = new Map<string, number>();
  for (const e of competition.entries)
    best.set(e.user, Math.max(best.get(e.user) ?? Number.NEGATIVE_INFINITY, e.score));
  const placed = awardMedals([...best].map(([key, score]) => ({ key, score })));
  return new Map(
    placed.map((p) => [
      p.key,
      {
        competitionId: competition.id,
        rank: p.rank,
        participants: placed.length,
        ...(p.medal ? { medal: p.medal } : {}),
      },
    ]),
  );
}

export function medalCountsOf(user: string, competitions: readonly Competition[]): MedalCounts {
  return countMedals(competitions.map((c) => resultsOf(c).get(user)?.medal));
}

export function tierOfUser(user: string, competitions: readonly Competition[]): TierId {
  return tierOf(medalCountsOf(user, competitions));
}

export class MemoryCompetitions implements CompetitionsPort {
  private readonly items = new Map<string, Competition>();

  async put(competition: Competition): Promise<void> {
    this.items.set(competition.id, structuredClone(competition));
  }

  async get(id: string): Promise<Competition | undefined> {
    const c = this.items.get(id);
    return c && structuredClone(c);
  }

  async list(): Promise<Competition[]> {
    return [...this.items.values()].map((c) => structuredClone(c));
  }
}
