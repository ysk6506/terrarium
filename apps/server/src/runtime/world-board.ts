/**
 * 세계 인기와 좋아요 (REQ-101, ADR-0122): the world list in the order people ask for, each world with the evidence for
 * it. Nothing here is stored besides the hearts: the score is counted again from experiment and world records every time
 * (`worldStats` in core). A heart is one per person per world.
 */
import type { LikeView, WorldCardView } from "@terrarium/core/contract";
import {
  type PopularWorld,
  sortWorlds,
  type WorldSort,
  type WorldStats,
  worldStats,
} from "@terrarium/core/experiments";
import { must, type PlatformContext, type Viewer } from "./context";
import { allow } from "./permissions";
import type { Titles } from "./titles";
import type { Worlds } from "./worlds";

export class WorldBoard {
  constructor(
    private readonly ctx: PlatformContext,
    private readonly worlds: Worlds,
    private readonly titles: Titles,
  ) {}

  /** The worlds to run (templates are kept apart), in `sort` order, each with its evidence. */
  async list(viewer: Viewer, sort: WorldSort = "popular"): Promise<WorldCardView[]> {
    const { store } = this.ctx;
    const [listed, templates, experiments, likes] = await Promise.all([
      this.worlds.list(),
      this.worlds.templates(),
      store.listExperiments(),
      store.listLikes(),
    ]);
    // templates are not listed, but a world started from one still counts for it
    const stats = worldStats({
      worlds: [...listed, ...templates] as readonly PopularWorld[],
      experiments: experiments.map((e) => ({ worldId: e.recipe.worldId, createdAt: e.createdAt })),
      likes,
      now: this.ctx.stamps.now(),
    });
    const shown = sortWorlds(listed, stats, sort, viewer.id);
    const owners = await this.titles.ofMany(shown.map((w) => w.owner));
    return shown.map((w) => ({
      ...w,
      stats: stats.get(w.id) as WorldStats,
      likes: likes.filter((l) => l.worldId === w.id).length,
      likedByMe: likes.some((l) => l.worldId === w.id && l.user === viewer.id),
      ownerTitles: owners.get(w.owner) ?? [],
    }));
  }

  private async view(worldId: string, viewer: Viewer): Promise<LikeView> {
    const mine = (await this.ctx.store.listLikes()).filter((l) => l.worldId === worldId);
    return {
      worldId,
      likes: mine.length,
      likedByMe: mine.some((l) => l.user === viewer.id),
    };
  }

  private async target(viewer: Viewer, id: string): Promise<void> {
    allow(viewer, "like");
    must(await this.ctx.store.getWorld(id), `세계 ${id}`);
  }

  async like(viewer: Viewer, id: string): Promise<LikeView> {
    await this.target(viewer, id);
    await this.ctx.store.putLike({ worldId: id, user: viewer.id, at: this.ctx.stamps.now() });
    return this.view(id, viewer);
  }

  async unlike(viewer: Viewer, id: string): Promise<LikeView> {
    await this.target(viewer, id);
    await this.ctx.store.deleteLike(id, viewer.id);
    return this.view(id, viewer);
  }
}
