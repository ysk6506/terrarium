/**
 * LLM API 등록 (REQ-099, ADR-0119): the model APIs the workspace registered for later (reading results, guiding).
 * Nothing calls them yet except "연결 확인". Keys and header values are sealed with the server's secret box and
 * never leave it: the views carry the last four letters of the key and the names of headers, nothing else.
 * Anyone can register, check and choose the default; changing or deleting is for whoever registered it.
 */
import type {
  CreateModelRequest,
  LlmModelView,
  ModelCheckView,
  UpdateModelRequest,
} from "@terrarium/core/contract";
import { InvalidInputError } from "@terrarium/core/contract";
import type { LlmCheckRecord, LlmModelRecord } from "@terrarium/core/experiments";
import { ConflictError } from "@terrarium/core/kernel";
import {
  checkLlm,
  createLlmClient,
  type FetchLike,
  type LlmCheck,
  type LlmFailReason,
  type LlmKind,
} from "@terrarium/core/llm";
import type { SecretBox } from "../adapters";
import { addressProblem, problem } from "./connection-form";
import { must, ownerOnly, type PlatformContext, type Viewer } from "./context";

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

export const modelView = (m: LlmModelRecord): LlmModelView => ({
  id: m.id,
  name: m.name,
  kind: m.kind as LlmKind,
  baseUrl: m.baseUrl,
  ...(m.defaultModel ? { defaultModel: m.defaultModel } : {}),
  hasKey: m.sealedKey !== undefined,
  ...(m.keyTail ? { keyHint: `…${m.keyTail}` } : {}),
  headers: m.headers.map((h) => h.name),
  isDefault: m.isDefault,
  owner: m.owner,
  createdAt: m.createdAt,
  ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}),
  ...(m.lastCheck ? { lastCheck: checkView(m.lastCheck) } : {}),
});

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

  async list(): Promise<LlmModelView[]> {
    return (await this.ctx.store.listModels()).map(modelView);
  }

  private async find(id: string): Promise<LlmModelRecord> {
    return must(await this.ctx.store.getModel(id), "등록한 모델");
  }

  private async nameTaken(name: string, exceptId?: string): Promise<boolean> {
    return (await this.ctx.store.listModels()).some((m) => m.name === name && m.id !== exceptId);
  }

  async create(viewer: Viewer, input: CreateModelRequest): Promise<LlmModelView> {
    addressIssue(input.baseUrl, this.options.allowedHosts);
    if (await this.nameTaken(input.name)) throw new ConflictError(NAME_TAKEN);
    const key = input.apiKey ?? "";
    const tail = tailOf(key);
    const record: LlmModelRecord = {
      id: this.ctx.stamps.id("llm"),
      owner: viewer.name,
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
      ...(key ? { sealedKey: this.options.box.seal(key) } : {}),
      ...(tail ? { keyTail: tail } : {}),
      headers: input.headers.map((h) => ({ name: h.name, sealed: this.options.box.seal(h.value) })),
      // the first one registered is the default until someone chooses another
      isDefault: (await this.ctx.store.listModels()).length === 0,
      createdAt: this.ctx.stamps.now(),
    };
    await this.ctx.store.putModel(record);
    return modelView(record);
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
    const old = await this.find(id);
    ownerOnly(viewer, old.owner, "고치기");
    if (input.baseUrl !== undefined) addressIssue(input.baseUrl, this.options.allowedHosts);
    if (input.name !== undefined && (await this.nameTaken(input.name, id)))
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
    return modelView(saved);
  }

  async remove(viewer: Viewer, id: string): Promise<{ readonly deleted: boolean }> {
    const old = await this.find(id);
    ownerOnly(viewer, old.owner, "지우기");
    await this.ctx.store.deleteModel(id);
    if (old.isDefault) {
      const [next] = await this.ctx.store.listModels();
      if (next) await this.ctx.store.putModel({ ...next, isDefault: true });
    }
    return { deleted: true };
  }

  async setDefault(id: string): Promise<LlmModelView> {
    const chosen = await this.find(id);
    for (const m of await this.ctx.store.listModels())
      if (m.isDefault && m.id !== id) await this.ctx.store.putModel({ ...m, isDefault: false });
    const saved = { ...chosen, isDefault: true };
    await this.ctx.store.putModel(saved);
    return modelView(saved);
  }

  /** Read the list, else one short completion; keep what came back on the record. */
  async check(id: string): Promise<LlmModelView> {
    const model = await this.find(id);
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
    return modelView(saved);
  }

  private async run(model: LlmModelRecord): Promise<LlmCheck> {
    const now = this.options.now ?? Date.now;
    try {
      const { box } = this.options;
      const client = createLlmClient(model.kind as LlmKind, {
        baseUrl: model.baseUrl,
        ...(model.sealedKey ? { apiKey: box.open(model.sealedKey) } : {}),
        headers: Object.fromEntries(model.headers.map((h) => [h.name, box.open(h.sealed)])),
        ...(model.defaultModel ? { model: model.defaultModel } : {}),
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
        ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
      });
      return await checkLlm(client, {
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
