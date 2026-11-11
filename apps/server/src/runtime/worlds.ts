/**
 * Worlds (REQ-009, REQ-010, REQ-035): built in the 3D builder, generated from a site preset, or read
 * from reality. Every save checks the blueprint; errors refuse the save, warnings come back with it.
 * Saves are optimistic: two people editing the same world cannot overwrite each other unknowingly.
 */
import {
  type CreateWorldRequest,
  type GeneratedWorld,
  type GenerateWorldRequest,
  type ImportedWorld,
  type ImportWorldRequest,
  InvalidInputError,
  type PutPhysicsRequest,
  type SavedWorld,
  UnavailableError,
  type UpdateWorldRequest,
  type WorldPhysicsView,
  type WorldWithScope,
} from "@terrarium/core/contract";
import {
  type WorldOrigin,
  type WorldRecord,
  type WorldSummary,
  withScope,
} from "@terrarium/core/experiments";
import { ConflictError, TerrariumError } from "@terrarium/core/kernel";
import { DEFAULT_PROFILE, fingerprintOf, isDefaultProfile } from "@terrarium/core/physics/slots";
import { importReality } from "@terrarium/core/sources/realimport";
import {
  generateCampus,
  generateShaped,
  generateWorld,
  sitePreset,
} from "@terrarium/core/sources/worldgen";
import {
  type Blueprint,
  blueprintDigest,
  type EntityKind,
  type Issue,
  validateBlueprint,
} from "@terrarium/core/world";
import { must, type PlatformContext, type Viewer } from "./context";
import { allow, sightOf } from "./permissions";
import { canChangeScope, changeScope, type ScopeChoice, startingScope } from "./scoping";

/** Blueprint problems as form issues: the path names the entity or link that is wrong. */
export function blueprintIssues(issues: readonly Issue[]) {
  return issues
    .filter((i) => i.severity === "error")
    .map((i) => ({ path: i.entityId ?? i.linkId ?? "", message: `${i.message}. ${i.fix}` }));
}

function physicsViewOf(world: WorldRecord): WorldPhysicsView {
  const profile = world.blueprint.physics ?? DEFAULT_PROFILE;
  return {
    worldId: world.id,
    digest: world.digest,
    profile,
    fingerprint: fingerprintOf(profile),
    isDefault: isDefaultProfile(profile),
  };
}

export class Worlds {
  constructor(private readonly ctx: PlatformContext) {}

  /** The worlds to run; the templates kept for starting new ones are listed apart. */
  async list(viewer: Viewer): Promise<WorldSummary[]> {
    return (await this.ctx.store.listWorlds(sightOf(viewer))).filter(
      (w) => w.origin !== "template",
    );
  }

  async templates(viewer: Viewer): Promise<WorldSummary[]> {
    return (await this.ctx.store.listWorlds(sightOf(viewer))).filter(
      (w) => w.origin === "template",
    );
  }

  /** A world as one person sees it: with the scope it reads as, and whether they may change it. */
  seenBy(viewer: Viewer, world: WorldRecord): WorldWithScope {
    return { ...withScope(world), canChangeScope: canChangeScope(viewer, world.owner) };
  }

  async get(id: string): Promise<WorldRecord> {
    return must(await this.ctx.store.getWorld(id), `세계 ${id}`);
  }

  /** Check, stamp and store; the blueprint takes the record's id and name. */
  private async save(
    base: Omit<WorldRecord, "blueprint" | "digest" | "updatedAt">,
    blueprint: Blueprint,
  ): Promise<SavedWorld> {
    const bp: Blueprint = { ...blueprint, id: base.id, name: base.name };
    const issues = validateBlueprint(bp, this.ctx.catalog);
    const errors = blueprintIssues(issues);
    if (errors.length > 0)
      throw new InvalidInputError(`세계에 고칠 곳이 ${errors.length}군데 있어요`, errors);
    const world: WorldRecord = {
      ...base,
      blueprint: bp,
      digest: blueprintDigest(bp),
      updatedAt: this.ctx.stamps.now(),
    };
    await this.ctx.store.putWorld(world);
    return { world, issues };
  }

  private fresh(
    viewer: Viewer,
    name: string,
    origin: WorldOrigin,
    extra: {
      readonly provenance?: Record<string, unknown>;
      readonly startedFrom?: string;
      readonly scope: ScopeChoice;
    },
  ) {
    return {
      id: this.ctx.stamps.id("w"),
      name,
      owner: viewer.id,
      origin,
      createdAt: this.ctx.stamps.now(),
      // a world is for everyone unless its maker says otherwise: comparing worlds is what the product is for
      ...startingScope(viewer, extra.scope, "everyone"),
      ...(extra.provenance ? { provenance: extra.provenance } : {}),
      ...(extra.startedFrom ? { startedFrom: extra.startedFrom } : {}),
    };
  }

  create(viewer: Viewer, req: CreateWorldRequest): Promise<SavedWorld> {
    return this.save(this.fresh(viewer, req.name, "builder", { scope: req }), req.blueprint);
  }

  /** A world from services (REQ-094): the spec is kept in the record, so a template can build the same world again. */
  private async generateShape(
    viewer: Viewer,
    req: Extract<GenerateWorldRequest, { shape: unknown }>,
  ): Promise<GeneratedWorld> {
    const result = generateShaped(req.shape, this.ctx.catalog);
    const stats: Partial<Record<EntityKind, number>> = {};
    for (const e of result.blueprint.entities) stats[e.kind] = (stats[e.kind] ?? 0) + 1;
    const origin = req.template ? "template" : "worldgen";
    // where it started from is kept only when that place exists (REQ-101): a stale id is not a reason to refuse a save
    const from = req.startedFrom ? await this.ctx.store.getWorld(req.startedFrom) : undefined;
    const saved = await this.save(
      this.fresh(viewer, req.name ?? req.shape.name, origin, {
        provenance: { shape: req.shape, counts: result.counts, notes: result.notes },
        ...(from ? { startedFrom: from.id } : {}),
        scope: req,
      }),
      result.blueprint,
    );
    return { ...saved, stats };
  }

  async generate(viewer: Viewer, req: GenerateWorldRequest): Promise<GeneratedWorld> {
    if ("shape" in req) return this.generateShape(viewer, req);
    const campus = "campus" in req;
    const spec = campus ? req.campus : req.spec;
    const result = campus
      ? generateCampus(req.campus, this.ctx.catalog)
      : generateWorld(req.spec, this.ctx.catalog);
    const preset = sitePreset(spec.site);
    const name = req.name ?? spec.name ?? `${preset?.name ?? spec.site} 생성 세계`;
    const saved = await this.save(
      this.fresh(viewer, name, "worldgen", {
        provenance: { spec, notes: result.notes },
        scope: req,
      }),
      result.blueprint,
    );
    return { ...saved, stats: result.stats };
  }

  async import(viewer: Viewer, req: ImportWorldRequest): Promise<ImportedWorld> {
    // It reads the company's systems with the server's own account, so it is for administrators (ADR-0152).
    allow(viewer, "administer", {}, "소스에서 세계 가져오기");
    const entry = must(this.ctx.sources.get(req.source), `현실 소스 '${req.source}'`);
    const base = this.fresh(viewer, req.name ?? `${entry.view.name}에서 가져온 세계`, "import", {
      scope: {},
    });
    let imported: Awaited<ReturnType<typeof importReality>>;
    try {
      imported = await importReality(entry.source, {
        id: base.id,
        name: base.name,
        catalog: this.ctx.catalog,
        ...(req.siteName ? { siteName: req.siteName } : {}),
        ...(req.rooms ? { rooms: req.rooms } : {}),
        ...(req.maxEntities ? { maxEntities: req.maxEntities } : {}),
        ...(req.assume ? { assume: req.assume } : {}),
      });
    } catch (err) {
      if (err instanceof TerrariumError) throw err;
      throw new UnavailableError(
        `${entry.view.name}에 연결할 수 없어요: ${(err as Error).message}`,
      );
    }
    const saved = await this.save(
      { ...base, provenance: { source: req.source, report: imported.report } },
      imported.blueprint,
    );
    return { ...saved, report: imported.report };
  }

  async update(viewer: Viewer, id: string, req: UpdateWorldRequest): Promise<SavedWorld> {
    const current = await this.get(id);
    allow(viewer, "change", { owner: current.owner }, "세계 고치기");
    if (current.digest !== req.baseDigest)
      throw new ConflictError(
        "그사이 이 세계가 바뀌었어요. 새로고침해서 바뀐 내용을 본 뒤 다시 저장해 주세요",
      );
    const scoped = changeScope(viewer, current, req, "세계 공개 범위 바꾸기");
    if (req.name === undefined && req.blueprint === undefined) {
      // only who sees it changed: the blueprint is not looked at again
      await this.ctx.store.putWorld(scoped);
      return { world: scoped, issues: [] };
    }
    const { blueprint, digest: _digest, updatedAt: _updatedAt, ...base } = scoped;
    return this.save({ ...base, name: req.name ?? current.name }, req.blueprint ?? blueprint);
  }

  /** The physics profile of a world (REQ-113): what was changed from the default physics, and the fingerprint of it. */
  async physics(id: string): Promise<WorldPhysicsView> {
    return physicsViewOf(await this.get(id));
  }

  /** Save a physics profile with the world: a new version of it, so runs on the old physics keep meaning what they ran on. */
  async setPhysics(viewer: Viewer, id: string, req: PutPhysicsRequest): Promise<WorldPhysicsView> {
    const current = await this.get(id);
    allow(viewer, "change", { owner: current.owner }, "세계의 물리 고치기");
    if (current.digest !== req.baseDigest)
      throw new ConflictError(
        "그사이 이 세계가 바뀌었어요. 새로고침해서 바뀐 내용을 본 뒤 다시 저장해 주세요",
      );
    const { blueprint, digest: _digest, updatedAt: _updatedAt, ...base } = current;
    const { physics: _old, ...rest } = blueprint;
    const next = isDefaultProfile(req.profile) ? rest : { ...rest, physics: req.profile };
    const saved = await this.save(base, next);
    return physicsViewOf(saved.world);
  }

  async delete(viewer: Viewer, id: string): Promise<{ deleted: boolean }> {
    const current = await this.get(id);
    allow(viewer, "remove", { owner: current.owner }, "세계 지우기");
    return { deleted: await this.ctx.store.deleteWorld(id) };
  }
}
