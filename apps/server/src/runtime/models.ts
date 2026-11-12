/**
 * LLM API 등록 (REQ-099, ADR-0119): the model APIs the workspace registered for later (reading results, guiding).
 * Nothing calls them yet except "연결 확인". Keys and header values are sealed with the server's secret box and
 * never leave it: the views carry the last four letters of the key and the names of headers, nothing else.
 * Anyone can register and check what they may see; changing or deleting is for whoever registered it. The one model
 * every user's helper answers with (the default) is a model made for everyone, so no one's private key is spent for
 * another person (ADR-0174, ADR-0179).
 */
import type {
  CreateModelRequest,
  LlmModelView,
  ModelCheckView,
  ScopeRequest,
  UpdateModelRequest,
} from "@terrarium/core/contract";
import { InvalidInputError } from "@terrarium/core/contract";
import {
  type LlmCheckRecord,
  type LlmModelRecord,
  type Scope,
  scopeOf,
  seen,
} from "@terrarium/core/experiments";
import { ConflictError } from "@terrarium/core/kernel";
import {
  checkLlm,
  createLlmClient,
  type FetchLike,
  type LlmCheck,
  type LlmClient,
  type LlmFailReason,
  type LlmKind,
} from "@terrarium/core/llm";
import type { SecretBox } from "../adapters";
import { addressProblem, problem } from "./connection-form";
import { must, type PlatformContext, type Viewer } from "./context";
import { allow, mustSee, sightOf, standing } from "./permissions";
import { canChangeScope, changeScope, startingScope } from "./scoping";

export interface ModelsOptions {
  readonly box: Pick<SecretBox, "seal" | "open">;
  /** Reaches the model APIs; tests hand in a fake. */
  readonly fetch?: FetchLike;
  /** Milliseconds, for timing a check. */
  readonly now?: () => number;
  readonly timeoutMs?: number;
  /** The server's list of addresses a person may point at (`connections.allowedHosts`), if it has one. */
  readonly allowedHosts?: readonly string[];
}

const NAME_TAKEN = "같은 이름으로 등록한 모델이 이미 있어요";

/** Last four letters of a key; a key too short to show part of is shown as nothing. */
export const tailOf = (key: string): string | undefined =>
  key.length >= 8 ? key.slice(-4) : undefined;

const checkView = (c: LlmCheckRecord): ModelCheckView => ({
  at: c.at,
  ok: c.ok,
  ms: c.ms,
  ...(c.via ? { via: c.via } : {}),
  models: c.models,
  ...(c.modelCount !== undefined ? { modelCount: c.modelCount } : {}),
  ...(c.reason ? { reason: c.reason as LlmFailReason } : {}),
  ...(c.error ? { error: c.error } : {}),
});

export const modelView = (
  m: LlmModelRecord,
  viewer: Viewer,
  isDefault = m.isDefault,
): LlmModelView => ({
  id: m.id,
  name: m.name,
  kind: m.kind as LlmKind,
  baseUrl: m.baseUrl,
  ...(m.defaultModel ? { defaultModel: m.defaultModel } : {}),
  hasKey: m.sealedKey !== undefined,
  ...(m.keyTail ? { keyHint: `…${m.keyTail}` } : {}),
  headers: m.headers.map((h) => h.name),
  isDefault,
  owner: m.owner,
  sharing: {
    scope: scopeOf(m),
    ...(m.group ? { group: m.group } : {}),
    canChange: canChangeScope(viewer, m.owner),
  },
  createdAt: m.createdAt,
  ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}),
  ...(m.lastCheck ? { lastCheck: checkView(m.lastCheck) } : {}),
});

const DEFAULT_IS_EVERYONES = "기본 모델은 모두가 써요. 먼저 다른 모델을 기본으로 정해 주세요";
const DEFAULT_NEEDS_EVERYONE =
  "기본 모델은 모두가 쓰니까 범위가 '모두'인 모델만 될 수 있어요. 이 모델의 범위를 먼저 '모두'로 바꿔 주세요";

const refuse = (path: string, message: string): never => {
  throw new InvalidInputError(message, [problem(path, message)]);
};

/** The model everyone's helper uses: a registration chosen as the default, which is always made for everyone. */
const everyonesDefault = (all: readonly LlmModelRecord[]): LlmModelRecord | undefined =>
  all.find((m) => m.isDefault && scopeOf(m) === "everyone");

/**
 * The default one person gets (ADR-0179): everyone's default if there is one, else the first registered of the models that
 * person may see. An admin's fallback counts only what an admin would see as an ordinary user: another person's private
 * key is not spent just because the one asking can read the list.
 */
export function defaultFor(
  viewer: Viewer | undefined,
  all: readonly LlmModelRecord[],
): LlmModelRecord | undefined {
  const shared = everyonesDefault(all);
  if (shared || viewer === undefined) return shared;
  const sight = { id: viewer.id, groups: viewer.groups, admin: false };
  return all.find((m) => seen(sight, m));
}

function addressIssue(baseUrl: string, allowed: readonly string[] | undefined): void {
  const why = addressProblem(baseUrl, allowed);
  if (why) throw new InvalidInputError("모델 주소를 확인해 주세요", [problem("baseUrl", why)]);
}

/** Whether an edit changes where a request goes or what it carries: the address, the key or the headers. */
function changesReach(
  old: LlmModelRecord,
  input: UpdateModelRequest,
  headers: LlmModelRecord["headers"],
): boolean {
  const moved = input.baseUrl !== undefined && input.baseUrl !== old.baseUrl;
  const key = Boolean(input.apiKey) || input.clearKey === true;
  return moved || key || JSON.stringify(headers) !== JSON.stringify(old.headers);
}

export class Models {
  constructor(
    private readonly ctx: PlatformContext,
    private readonly options: ModelsOptions,
  ) {}

  /** One registration as the person sees it: "default" is the default they get, not only everyone's. */
  private async viewFor(viewer: Viewer, m: LlmModelRecord): Promise<LlmModelView> {
    const mine = defaultFor(viewer, await this.ctx.store.listModels());
    return modelView(m, viewer, m.id === mine?.id);
  }

  async list(viewer: Viewer): Promise<LlmModelView[]> {
    const all = await this.ctx.store.listModels();
    const mine = defaultFor(viewer, all);
    return all
      .filter((m) => seen(sightOf(viewer), m))
      .map((m) => modelView(m, viewer, m.id === mine?.id));
  }

  /** A registration, if the person can see it; one they cannot answers as one that is not there. */
  private async find(viewer: Viewer, id: string): Promise<LlmModelRecord> {
    const found = must(await this.ctx.store.getModel(id), "등록한 모델");
    mustSee(viewer, standing(found), "등록한 모델", { kind: "model", id, name: found.name });
    return found;
  }

  /**
   * Whether a name is already used where it would be seen twice: among the maker's own registrations, and among those made
   * for everyone. Another person's "나만" or group model is never looked at, so a clash cannot tell that it exists.
   */
  private async nameTaken(
    name: string,
    owner: string,
    scope: Scope,
    exceptId?: string,
  ): Promise<boolean> {
    return (await this.ctx.store.listModels()).some(
      (m) =>
        m.name === name &&
        m.id !== exceptId &&
        (m.owner === owner || (scope === "everyone" && scopeOf(m) === "everyone")),
    );
  }

  async create(viewer: Viewer, input: CreateModelRequest): Promise<LlmModelView> {
    addressIssue(input.baseUrl, this.options.allowedHosts);
    const scoped = startingScope(viewer, input, "private");
    if (await this.nameTaken(input.name, viewer.id, scopeOf(scoped)))
      throw new ConflictError(NAME_TAKEN);
    const key = input.apiKey ?? "";
    const tail = tailOf(key);
    const all = await this.ctx.store.listModels();
    const record: LlmModelRecord = {
      id: this.ctx.stamps.id("llm"),
      owner: viewer.id,
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
      ...(key ? { sealedKey: this.options.box.seal(key) } : {}),
      ...(tail ? { keyTail: tail } : {}),
      headers: input.headers.map((h) => ({ name: h.name, sealed: this.options.box.seal(h.value) })),
      // the first one made for everyone is the default until someone chooses another; a private one never is
      isDefault: scopeOf(scoped) === "everyone" && everyonesDefault(all) === undefined,
      createdAt: this.ctx.stamps.now(),
      // a registration carries its maker's key: private until they say otherwise
      ...scoped,
    };
    await this.ctx.store.putModel(record);
    return this.viewFor(viewer, record);
  }

  /** The headers after an edit: a row with a value is sealed anew, a row without one keeps the value it had. */
  private headersOf(
    old: LlmModelRecord,
    rows: NonNullable<UpdateModelRequest["headers"]>,
  ): LlmModelRecord["headers"] {
    const issues = rows.flatMap((row, i) =>
      row.value === undefined && !old.headers.some((h) => h.name === row.name)
        ? [problem(`headers.${i}`, "새 헤더에는 값을 적어 주세요")]
        : [],
    );
    if (issues.length > 0) throw new InvalidInputError("헤더를 확인해 주세요", issues);
    return rows.map((row) => ({
      name: row.name,
      sealed:
        row.value !== undefined
          ? this.options.box.seal(row.value)
          : (old.headers.find((h) => h.name === row.name)?.sealed ?? ""),
    }));
  }

  /** The key after an edit: typed anew, cleared, or (left empty) kept. */
  private keyOf(old: LlmModelRecord, input: UpdateModelRequest): Partial<LlmModelRecord> {
    if (input.apiKey) {
      const tail = tailOf(input.apiKey);
      return { sealedKey: this.options.box.seal(input.apiKey), ...(tail ? { keyTail: tail } : {}) };
    }
    if (input.clearKey) return {};
    return {
      ...(old.sealedKey ? { sealedKey: old.sealedKey } : {}),
      ...(old.keyTail ? { keyTail: old.keyTail } : {}),
    };
  }

  async update(viewer: Viewer, id: string, input: UpdateModelRequest): Promise<LlmModelView> {
    const found = await this.find(viewer, id);
    allow(viewer, "change", { owner: found.owner }, "고치기");
    const old = found;
    if (input.baseUrl !== undefined) addressIssue(input.baseUrl, this.options.allowedHosts);
    if (
      input.name !== undefined &&
      (await this.nameTaken(input.name, found.owner, scopeOf(found), id))
    )
      throw new ConflictError(NAME_TAKEN);
    const headers = input.headers ? this.headersOf(old, input.headers) : old.headers;
    const { sealedKey: _k, keyTail: _t, defaultModel: _d, lastCheck: _c, ...rest } = old;
    const model = input.defaultModel === undefined ? old.defaultModel : input.defaultModel;
    const saved: LlmModelRecord = {
      ...rest,
      name: input.name ?? old.name,
      baseUrl: input.baseUrl ?? old.baseUrl,
      headers,
      ...this.keyOf(old, input),
      ...(model ? { defaultModel: model } : {}),
      // what was checked was the old address, key and headers; a check of those says nothing about the new ones
      ...(old.lastCheck && !changesReach(old, input, headers) ? { lastCheck: old.lastCheck } : {}),
      updatedAt: this.ctx.stamps.now(),
    };
    await this.ctx.store.putModel(saved);
    return this.viewFor(viewer, saved);
  }

  async remove(viewer: Viewer, id: string): Promise<{ readonly deleted: boolean }> {
    const old = await this.find(viewer, id);
    allow(viewer, "remove", { owner: old.owner }, "지우기");
    await this.ctx.store.deleteModel(id);
    if (old.isDefault) {
      // the default passes to the first one registered for everyone; with none, there is no default for everyone
      const next = (await this.ctx.store.listModels()).find((m) => scopeOf(m) === "everyone");
      if (next) await this.ctx.store.putModel({ ...next, isDefault: true });
    }
    return { deleted: true };
  }

  /** Who can see a registration (ADR-0174): the one place its scope changes. The default model cannot be narrowed. */
  async setScope(viewer: Viewer, id: string, req: ScopeRequest): Promise<LlmModelView> {
    const found = await this.find(viewer, id);
    allow(viewer, "changeScope", { owner: found.owner }, "모델 공개 범위 바꾸기");
    if (found.isDefault && req.scope !== "everyone") refuse("scope", DEFAULT_IS_EVERYONES);
    const saved = changeScope(viewer, found, req, "모델 공개 범위 바꾸기");
    // made for everyone, a name must not be a second one among those everyone sees
    if (
      scopeOf(saved) === "everyone" &&
      (await this.nameTaken(saved.name, saved.owner, "everyone", id))
    )
      throw new ConflictError(NAME_TAKEN);
    await this.ctx.store.putModel(saved);
    return this.viewFor(viewer, saved);
  }

  /** Choose the model everyone's helper uses: an admin or the model's own maker may, and only a model made for everyone can be it. */
  async setDefault(viewer: Viewer, id: string): Promise<LlmModelView> {
    const chosen = await this.find(viewer, id);
    allow(viewer, "change", { owner: chosen.owner }, "기본 모델 정하기");
    if (scopeOf(chosen) !== "everyone") refuse("scope", DEFAULT_NEEDS_EVERYONE);
    for (const m of await this.ctx.store.listModels())
      if (m.isDefault && m.id !== id) await this.ctx.store.putModel({ ...m, isDefault: false });
    const saved = { ...chosen, isDefault: true };
    await this.ctx.store.putModel(saved);
    return this.viewFor(viewer, saved);
  }

  /** Read the list, else one short completion; keep what came back on the record. */
  async check(viewer: Viewer, id: string): Promise<LlmModelView> {
    const model = await this.find(viewer, id);
    // A check opens the sealed key and calls out with it: whoever can see the registration may ask for one.
    allow(viewer, "use", standing(model), "연결 확인");
    const result = await this.run(model);
    const lastCheck: LlmCheckRecord = {
      at: this.ctx.stamps.now(),
      ok: result.ok,
      ms: result.ms,
      ...(result.via ? { via: result.via } : {}),
      models: result.models,
      ...(result.modelCount !== undefined ? { modelCount: result.modelCount } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
    // read again: someone may have changed the record while the check was out
    const current = (await this.ctx.store.getModel(id)) ?? model;
    const saved = { ...current, lastCheck };
    await this.ctx.store.putModel(saved);
    return this.viewFor(viewer, saved);
  }

  /** The client for a registered model; throws when its sealed key cannot be opened. */
  private clientOf(model: LlmModelRecord): LlmClient {
    const { box } = this.options;
    return createLlmClient(model.kind as LlmKind, {
      baseUrl: model.baseUrl,
      ...(model.sealedKey ? { apiKey: box.open(model.sealedKey) } : {}),
      headers: Object.fromEntries(model.headers.map((h) => [h.name, box.open(h.sealed)])),
      ...(model.defaultModel ? { model: model.defaultModel } : {}),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
    });
  }

  /**
   * The model "the" features use (이끼, REQ-103) for one person: everyone's default, else the first model that person may see;
   * none if there is nothing for them. Without a viewer only everyone's default counts.
   */
  async defaultClient(
    viewer?: Viewer,
  ): Promise<
    { readonly client: LlmClient; readonly name: string; readonly model?: string } | undefined
  > {
    const record = defaultFor(viewer, await this.ctx.store.listModels());
    if (!record) return undefined;
    const client = this.clientOf(record);
    // 모델 이름이 등록에 없으면 마지막 연결 확인이 본 첫 이름, 그것도 없으면 API에 물어 첫 이름을 쓴다.
    const known = record.defaultModel ?? record.lastCheck?.models[0];
    const model = known ?? (await client.listModels().catch(() => []))[0];
    return { client, name: record.name, ...(model ? { model } : {}) };
  }

  private async run(model: LlmModelRecord): Promise<LlmCheck> {
    const now = this.options.now ?? Date.now;
    try {
      return await checkLlm(this.clientOf(model), {
        now,
        ...(model.defaultModel ? { model: model.defaultModel } : {}),
      });
    } catch {
      return {
        ok: false,
        ms: 0,
        models: [],
        reason: "other",
        error: "저장한 키를 열 수 없어요. 키를 다시 넣어 주세요",
      };
    }
  }
}
