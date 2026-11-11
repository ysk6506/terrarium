/** The tables of the community features (REQ-101): hearts on worlds, scenario checks, titles earned. */
import type { StatementSync } from "node:sqlite";
import type { CalibrationMark, TitleAward, WorldLike } from "@terrarium/core/experiments";

type Row = Record<string, unknown>;

export class CommunityTables {
  constructor(private readonly sql: (text: string) => StatementSync) {}

  putLike(like: WorldLike): void {
    this.sql("INSERT OR IGNORE INTO world_likes (world_id, user_name, at) VALUES (?, ?, ?)").run(
      like.worldId,
      like.user,
      like.at,
    );
  }

  deleteLike(worldId: string, user: string): boolean {
    return (
      Number(
        this.sql("DELETE FROM world_likes WHERE world_id = ? AND user_name = ?").run(worldId, user)
          .changes,
      ) > 0
    );
  }

  listLikes(): WorldLike[] {
    const rows = this.sql(
      "SELECT world_id, user_name, at FROM world_likes ORDER BY at, world_id, user_name",
    ).all() as Row[];
    return rows.map((r) => ({
      worldId: String(r.world_id),
      user: String(r.user_name),
      at: String(r.at),
    }));
  }

  putCalibrationMark(mark: CalibrationMark): void {
    this.sql(
      "INSERT OR REPLACE INTO calibration_marks (scenario_id, digest, at, clean) VALUES (?, ?, ?, ?)",
    ).run(mark.scenarioId, mark.digest, mark.at, mark.clean ? 1 : 0);
  }

  listCalibrationMarks(): CalibrationMark[] {
    const rows = this.sql(
      "SELECT scenario_id, digest, at, clean FROM calibration_marks ORDER BY at, scenario_id",
    ).all() as Row[];
    return rows.map((r) => ({
      scenarioId: String(r.scenario_id),
      digest: String(r.digest),
      at: String(r.at),
      clean: Number(r.clean) === 1,
    }));
  }

  listTitleAwards(): TitleAward[] {
    const rows = this.sql(
      "SELECT user_name, key, earned_at FROM title_awards ORDER BY earned_at, user_name, key",
    ).all() as Row[];
    return rows.map((r) => ({
      user: String(r.user_name),
      key: String(r.key),
      earnedAt: String(r.earned_at),
    }));
  }

  putTitleAwards(awards: readonly TitleAward[]): void {
    for (const a of awards)
      this.sql(
        "INSERT OR IGNORE INTO title_awards (user_name, key, earned_at) VALUES (?, ?, ?)",
      ).run(a.user, a.key, a.earnedAt);
  }
}
