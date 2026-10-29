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
  type SavedWorld,
  UnavailableError,
  type UpdateWorldRequest,
} from "@terrarium/core/contract";
import type { WorldOrigin, WorldRecord, WorldSummary } from "@terrarium/core/experiments";
import { ConflictError, TerrariumError } from "@terrarium/core/kernel";
import { importReality } from "@terrarium/core/sources/realimport";
import { generateWorld, sitePreset } from "@terrarium/core/sources/worldgen";
import {
  type Blueprint,
  blueprintDigest,
  type Issue,
  validateBlueprint,
} from "@terrarium/core/world";
import { must, ownerOnly, type PlatformContext, type Viewer } from "./context";

/** Blueprint problems as form issues: the path names the entity or link that is wrong. */
export function blueprintIssues(issues: readonly Issue[]) {
  return issues
    .filter((i) => i.severity === "error")
    .map((i) => ({ path: i.entityId ?? i.linkId ?? "", message: `${i.message}. ${i.fix}` }));
}

export class Worlds {
  constructor(private readonly ctx: PlatformContext) {}

  list(): Promise<WorldSummary[]> {
    return this.ctx.store.listWorlds();
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
      throw new InvalidInputError(`세계에 고칠 곳이 ${errors.length}군데 있다`, errors);
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
    provenance?: Record<string, unknown>,
  ) {
    return {
      id: this.ctx.stamps.id("w"),
      name,
      owner: viewer.name,
      origin,
      createdAt: this.ctx.stamps.now(),
      ...(provenance ? { provenance } : {}),
    };
  }

  create(viewer: Viewer, req: CreateWorldRequest): Promise<SavedWorld> {
    return this.save(this.fresh(viewer, req.name, "builder"), req.blueprint);
  }

  async generate(viewer: Viewer, req: GenerateWorldRequest): Promise<GeneratedWorld> {
    const result = generateWorld(req.spec, this.ctx.catalog);
    const preset = sitePreset(req.spec.site);
    const name = req.name ?? req.spec.name ?? `${preset?.name ?? req.spec.site} 생성 세계`;
    const saved = await this.save(
      this.fresh(viewer, name, "worldgen", { spec: req.spec, notes: result.notes }),
      result.blueprint,
    );
    return { ...saved, stats: result.stats };
  }

  async import(viewer: Viewer, req: ImportWorldRequest): Promise<ImportedWorld> {
    const entry = must(this.ctx.sources.get(req.source), `현실 소스 '${req.source}'`);
    const base = this.fresh(viewer, req.name ?? `${entry.view.name}에서 가져온 세계`, "import");
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
      throw new UnavailableError(`${entry.view.name}에 닿을 수 없다: ${(err as Error).message}`);
    }
    const saved = await this.save(
      { ...base, provenance: { source: req.source, report: imported.report } },
      imported.blueprint,
    );
    return { ...saved, report: imported.report };
  }

  async update(viewer: Viewer, id: string, req: UpdateWorldRequest): Promise<SavedWorld> {
    const current = await this.get(id);
    ownerOnly(viewer, current.owner, "세계 수정");
    if (current.digest !== req.baseDigest)
      throw new ConflictError(
        "그사이 이 세계가 바뀌었다. 새로고침해서 바뀐 내용을 본 뒤 다시 저장한다",
      );
    const { blueprint, digest: _digest, updatedAt: _updatedAt, ...base } = current;
    return this.save({ ...base, name: req.name ?? current.name }, req.blueprint ?? blueprint);
  }

  async delete(viewer: Viewer, id: string): Promise<{ deleted: boolean }> {
    const current = await this.get(id);
    ownerOnly(viewer, current.owner, "세계 삭제");
    return { deleted: await this.ctx.store.deleteWorld(id) };
  }
}
