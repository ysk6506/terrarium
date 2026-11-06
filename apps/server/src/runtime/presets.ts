/**
 * 저장해 둔 것(ADR-0092 결정 3, ADR-0112): 지시문·툴 묶음·절차서를 이름 붙여 서버에 둔다. 만든 사람의 것이고 세계·시나리오와
 * 무관해요. 지운 것은 7일 동안 두었다가 목록을 읽을 때 정리해요.
 */
import type {
  ImportPresetsRequest,
  PresetListView,
  PresetView,
  RenamePresetRequest,
  SavePresetRequest,
} from "@terrarium/core/contract";
import { PRESET_UNDO_DAYS, type PresetKind, type PresetRecord } from "@terrarium/core/experiments";
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import { must, type PlatformContext, type Viewer } from "./context";

const DAY_MS = 86_400_000;

const view = (p: PresetRecord): PresetView => ({
  id: p.id,
  kind: p.kind,
  name: p.name,
  body: p.body,
  createdAt: p.createdAt,
  ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}),
  ...(p.deletedAt ? { deletedAt: p.deletedAt } : {}),
});

/** What a body must be for its kind: a text, a list of tool names, or a runbook with steps. */
export function bodyProblem(kind: PresetKind, body: string): string | undefined {
  if (kind === "instruction") return body.trim() === "" ? "지시문이 비어 있어요" : undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "내용이 올바른 JSON이 아니에요";
  }
  if (kind === "toolset")
    return Array.isArray(parsed) && parsed.every((t) => typeof t === "string")
      ? undefined
      : "툴 묶음은 툴 이름의 목록이어야 해요";
  const steps = (parsed as { steps?: unknown } | null)?.steps;
  return Array.isArray(steps) ? undefined : "절차서에는 단계 목록이 있어야 해요";
}

export class Presets {
  constructor(private readonly ctx: PlatformContext) {}

  /** The records of one person; a preset of someone else is simply not there. */
  private async mine(viewer: Viewer, id: string): Promise<PresetRecord> {
    const found = await this.ctx.store.getPreset(id);
    return must(found?.owner === viewer.name ? found : undefined, "저장해 둔 것");
  }

  private expired(p: PresetRecord): boolean {
    return (
      p.deletedAt !== undefined &&
      Date.parse(this.ctx.stamps.now()) - Date.parse(p.deletedAt) >= PRESET_UNDO_DAYS * DAY_MS
    );
  }

  async list(viewer: Viewer, kind?: PresetKind): Promise<PresetListView> {
    const all = await this.ctx.store.listPresets(viewer.name, kind);
    const gone = all.filter((p) => this.expired(p));
    await Promise.all(gone.map((p) => this.ctx.store.deletePreset(p.id)));
    const kept = all.filter((p) => !gone.includes(p));
    return {
      presets: kept
        .filter((p) => p.deletedAt === undefined)
        .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
        .map(view),
      deleted: kept
        .filter((p) => p.deletedAt !== undefined)
        .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
        .map(view),
    };
  }

  /** A name that is in use among the live ones of this kind. */
  private async named(viewer: Viewer, kind: PresetKind, name: string) {
    return (await this.ctx.store.listPresets(viewer.name, kind)).find(
      (p) => p.name === name && p.deletedAt === undefined,
    );
  }

  async save(viewer: Viewer, input: SavePresetRequest): Promise<PresetView> {
    const kind = input.kind as PresetKind;
    const problem = bodyProblem(kind, input.body);
    if (problem) throw new InvalidValueError(problem);
    const same = await this.named(viewer, kind, input.name);
    const now = this.ctx.stamps.now();
    const saved: PresetRecord = same
      ? { ...same, body: input.body, updatedAt: now }
      : {
          id: this.ctx.stamps.id("pre"),
          owner: viewer.name,
          kind,
          name: input.name,
          body: input.body,
          createdAt: now,
        };
    await this.ctx.store.putPreset(saved);
    return view(saved);
  }

  async import(viewer: Viewer, input: ImportPresetsRequest): Promise<PresetListView> {
    for (const item of input.items) {
      const kind = item.kind as PresetKind;
      if (bodyProblem(kind, item.body) || (await this.named(viewer, kind, item.name))) continue;
      await this.ctx.store.putPreset({
        id: this.ctx.stamps.id("pre"),
        owner: viewer.name,
        kind,
        name: item.name,
        body: item.body,
        createdAt:
          item.createdAt && !Number.isNaN(Date.parse(item.createdAt))
            ? item.createdAt
            : this.ctx.stamps.now(),
      });
    }
    return this.list(viewer);
  }

  async rename(viewer: Viewer, id: string, input: RenamePresetRequest): Promise<PresetView> {
    const found = await this.mine(viewer, id);
    const clash = await this.named(viewer, found.kind, input.name);
    if (clash && clash.id !== id) throw new ConflictError("같은 이름이 이미 있어요");
    const renamed = { ...found, name: input.name, updatedAt: this.ctx.stamps.now() };
    await this.ctx.store.putPreset(renamed);
    return view(renamed);
  }

  async remove(viewer: Viewer, id: string): Promise<{ readonly deleted: boolean }> {
    const found = await this.mine(viewer, id);
    await this.ctx.store.putPreset({ ...found, deletedAt: this.ctx.stamps.now() });
    return { deleted: true };
  }

  async restore(viewer: Viewer, id: string): Promise<PresetView> {
    const { deletedAt: _gone, ...found } = await this.mine(viewer, id);
    if (_gone === undefined) return view(found);
    const clash = await this.named(viewer, found.kind, found.name);
    if (clash)
      throw new ConflictError(
        "같은 이름이 이미 있어서 되돌릴 수 없어요. 이름을 바꾸고 다시 해 주세요",
      );
    await this.ctx.store.putPreset(found);
    return view(found);
  }
}
