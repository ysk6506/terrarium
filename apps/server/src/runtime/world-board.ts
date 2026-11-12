/**
 * 세계 인기와 좋아요 (REQ-101, ADR-0122): the world list in the order people ask for, each world with the evidence for
 * it. Nothing here is stored besides the hearts: the score is counted again from experiment and world records every time
 * (`worldStats` in core). A heart is one per person per world.
 */
import type { LikeView, WorldCardView } from "@terrarium/core/contract";
import {
  type PopularWorld,
  PUBLIC_SIGHT,
  sortWorlds,
  type WorldSort,
  type WorldStats,
  worldStats,
} from "@terrarium/core/experiments";
import { must, type PlatformContext, type Viewer } from "./context";
import { allow, mustSee, standing } from "./permissions";
import { canChangeScope } from "./scoping";
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
    const [listed, everyones, experiments, allLikes] = await Promise.all([
      this.worlds.list(viewer),
      store.listWorlds(PUBLIC_SIGHT),
      store.listExperiments({ visibleTo: PUBLIC_SIGHT }),
      store.listLikes(),
    ]);
    // Popularity counts only what is for everyone: worlds, experiments and hearts on them. A private world has no
    // evidence on the list, and nobody learns from the order that a private experiment exists. Templates are not
    // listed, but a world started from one still counts for it.
    const open = new Set(everyones.map((w) => w.id));
    const likes = allLikes.filter((l) => open.has(l.worldId));
    const stats = worldStats({
      worlds: everyones as readonly PopularWorld[],
      experiments: experiments.map((e) => ({ worldId: e.recipe.worldId, createdAt: e.createdAt })),
      likes,
      now: this.ctx.stamps.now(),
    });
    const nothing = (w: PopularWorld) =>
      worldStats({ worlds: [w], experiments: [], likes: [], now: this.ctx.stamps.now() }).get(
        w.id,
      ) as WorldStats;
    const shown = sortWorlds(listed, stats, sort, viewer.id);
    const owners = await this.titles.ofMany(shown.map((w) => w.owner));
    return shown.map((w) => ({
      ...w,
      stats: stats.get(w.id) ?? nothing(w),
      canChangeScope: canChangeScope(viewer, w.owner),
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
    const world = must(await this.ctx.store.getWorld(id), `세계 ${id}`);
    mustSee(viewer, standing(world), `세계 ${id}`, { kind: "world", id, name: world.name });
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
