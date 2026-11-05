/**
 * Connections (REQ-051, ADR-0042): the harnesses and agents experiments can run on. Some come from the
 * server's config file and cannot be changed from the screen; the rest are registered by people, kept in
 * the store and rebuilt when the server starts. Each one is reached through the connector of its protocol,
 * so this file knows no protocol. It is also the directory the executor looks harnesses up in.
 */
import {
  type CheckConnectionRequest,
  type ConnectionCheck,
  type ConnectionView,
  type ConnectorSpec,
  type CreateConnectionRequest,
  InvalidInputError,
  parseWith,
  type UpdateConnectionRequest,
} from "@terrarium/core/contract";
import type {
  AgentInfo,
  ConnectionRecord,
  ExperimentStore,
  HarnessInfo,
  HarnessPort,
} from "@terrarium/core/experiments";
import { ConflictError } from "@terrarium/core/kernel";
import {
  CONNECTORS,
  type ConnectContext,
  type Connector,
  connectorOf,
  type HarnessConfig,
  type SecretBox,
} from "../adapters";
import {
  checkFields,
  compose,
  fail,
  given,
  headerViews,
  messageOf,
  metadataOf,
  probe,
  problem,
  recordOf,
  reveal,
  slotView,
  slug,
  toolsNotes,
  withHeaders,
  within,
} from "./connection-form";
import { type HarnessDirectory, must, ownerOnly, type Viewer } from "./context";
import type { Stamps } from "./ids";

/** A harness the config file names: built at start, read-only from the screen. */
export interface FixedConnection {
  readonly port: HarnessPort;
  /** What the file says (settings only name environment variables, never hold secrets). */
  readonly config?: HarnessConfig;
}

export interface ConnectionsOptions {
  readonly store: ExperimentStore;
  readonly stamps: Stamps;
  readonly fixed: readonly FixedConnection[];
  readonly connect: ConnectContext;
  /** Seals the tokens, passwords and secret headers people type (ADR-0043). */
  readonly box: SecretBox;
  /**
   * A connection made on the screen that no experiment has used for `days` days is removed, and its owner is
   * told `warnDays` days before (REQ-051). `days: 0` keeps everything. Defaults: 30 and 7.
   */
  readonly retention?: { readonly days?: number; readonly warnDays?: number };
  /** Hosts people may connect to from the screen. Without it, every host but a cloud's metadata address. */
  readonly allowedHosts?: readonly string[];
  /** How long to wait for a harness to list its agents, ms. */
  readonly agentsTimeoutMs?: number;
  /** How long a harness's agent list is kept before asking again, ms. */
  readonly agentsTtlMs?: number;
  readonly slotUrl?: (slot: string) => string; // the fixed tool address of a harness with a slot
}

interface Entry {
  readonly id: string;
  readonly source: "config" | "screen";
  readonly connector: string;
  readonly name: string;
  readonly description: string;
  /** Without secrets: those are sealed in the record. */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, string>>;
  readonly record?: ConnectionRecord;
  /** Undefined when it could not be built (a screen entry whose settings no longer hold). */
  readonly port?: HarnessPort;
  readonly error?: string;
}

const AGENTS_TIMEOUT_MS = 10_000;
const AGENTS_TTL_MS = 30_000;
const DAY_MS = 86_400_000;
const RETENTION_DAYS = 30;
const WARN_DAYS = 7;

export { addressProblem } from "./connection-form";

export class Connections implements HarnessDirectory {
  private readonly fixed = new Map<string, Entry>();
  private readonly added = new Map<string, Entry>();
  private readonly seen = new Map<string, { at: number; view: ConnectionView }>();

  constructor(private readonly options: ConnectionsOptions) {
    for (const { port, config } of options.fixed) {
      const { kind, id, name, description, metadata, ...settings } = config ?? {
        kind: port.info.kind,
        id: port.info.id,
        name: port.info.name,
      };
      this.fixed.set(port.info.id, {
        id,
        source: "config",
        connector: kind,
        name,
        description: description ?? port.info.description,
        settings,
        metadata: metadataOf(metadata),
        port,
      });
    }
  }

  private get retentionDays(): number {
    return this.options.retention?.days ?? RETENTION_DAYS;
  }

  private get warnDays(): number {
    return this.options.retention?.warnDays ?? WARN_DAYS;
  }

  private now(): number {
    return Date.parse(this.options.stamps.now());
  }

  // ── the directory the executor and the experiment checks use ─────────────────────────────────

  get(id: string): HarnessPort | undefined {
    return (this.fixed.get(id) ?? this.added.get(id))?.port;
  }

  metadata(id: string): Readonly<Record<string, string>> | undefined {
    return (this.fixed.get(id) ?? this.added.get(id))?.metadata;
  }

  ownerOf(id: string): string | undefined {
    return this.added.get(id)?.record?.owner;
  }

  values(): HarnessPort[] {
    return this.entries().flatMap((e) => (e.port ? [e.port] : []));
  }

  private entries(): Entry[] {
    return [...this.fixed.values(), ...this.added.values()];
  }

  /** An experiment was made on it: the clock that removes unused connections starts over. */
  async touch(id: string): Promise<void> {
    const entry = this.added.get(id);
    if (!entry?.record) return;
    const record = { ...entry.record, lastUsedAt: this.options.stamps.now() };
    await this.options.store.putConnection(record);
    this.added.set(id, { ...entry, record });
    this.seen.delete(id);
  }

  // ── what is offered, what exists ────────────────────────────────────────────────────────────

  specs(): ConnectorSpec[] {
    return CONNECTORS.map((c) => c.spec);
  }

  /** Rebuild what people registered before the server stopped. A record that no longer builds is kept and shown as unreachable. */
  async load(): Promise<void> {
    for (const record of await this.options.store.listConnections()) {
      if (this.fixed.has(record.id)) continue;
      this.added.set(record.id, this.fromRecord(record));
    }
  }

  async views(): Promise<ConnectionView[]> {
    return Promise.all(this.entries().map((e) => this.viewOf(e)));
  }

  private fromRecord(record: ConnectionRecord): Entry {
    const entry = {
      id: record.id,
      source: "screen" as const,
      connector: record.connector,
      name: record.name,
      description: record.description ?? "",
      settings: record.config,
      metadata: record.metadata ?? {},
      record,
    };
    try {
      return { ...entry, port: this.portOf(record) };
    } catch (err) {
      return { ...entry, error: messageOf(err) };
    }
  }

  private async viewOf(entry: Entry): Promise<ConnectionView> {
    const kept = this.seen.get(entry.id);
    const ttl = this.options.agentsTtlMs ?? AGENTS_TTL_MS;
    if (kept && Date.now() - kept.at < ttl) return kept.view;
    const view = await this.look(entry);
    this.seen.set(entry.id, { at: Date.now(), view });
    return view;
  }

  /** The agents the connection offers now, or why it could not say. */
  private async discover(
    entry: Entry,
  ): Promise<{ readonly agents: readonly AgentInfo[]; readonly error?: string }> {
    if (!entry.port)
      return { agents: [], ...(entry.error === undefined ? {} : { error: entry.error }) };
    try {
      const wait = this.options.agentsTimeoutMs ?? AGENTS_TIMEOUT_MS;
      return { agents: await within(entry.port.agents(), wait) };
    } catch (err) {
      return { agents: [], error: messageOf(err) };
    }
  }

  private async look(entry: Entry): Promise<ConnectionView> {
    const spec = connectorOf(entry.connector)?.spec;
    const info: HarnessInfo = entry.port?.info ?? {
      id: entry.id,
      name: entry.name,
      kind: entry.connector,
      description: entry.description,
      toolTransport: spec?.toolTransport ?? "mcp",
      telemetry: "none",
    };
    const { agents, error } = await this.discover(entry);
    const record = entry.record;
    return {
      ...info,
      connector: entry.connector,
      scope: spec?.scope ?? "harness",
      source: entry.source,
      ...(record ? { owner: record.owner, createdAt: record.createdAt } : {}),
      agents,
      ...slotView(info, this.options.slotUrl),
      status: error === undefined ? "ok" : "unreachable",
      ...(error === undefined ? {} : { error }),
      metadata: entry.metadata,
      headers: headerViews(record),
      secrets: Object.keys(record?.secrets ?? {}),
      ...(record ? { lastUsedAt: record.lastUsedAt ?? record.createdAt } : {}),
      ...this.expiryOf(entry),
      config: entry.settings,
    };
  }

  // ── trying, adding, changing, removing ──────────────────────────────────────────────────────

  /** The port this record describes, or an InvalidInputError whose issues name the form fields. */
  private portOf(record: ConnectionRecord): HarnessPort {
    const { id, name } = record;
    const connector = connectorOf(record.connector);
    if (!connector) return fail([problem("connector", `연결 방식 '${record.connector}'을 몰라요`)]);
    if (!connector.spec.fromScreen)
      fail([problem("connector", "이 연결 방식은 서버 설정 파일에서만 더할 수 있어요")]);
    const identity = { id, name, description: record.description ?? "" };
    const parsed = parseWith(connector.schema, {
      ...given(record.config),
      ...identity,
      kind: record.connector,
    });
    if (!parsed.ok) return fail(parsed.issues.map((i) => problem(i.path ?? "", i.message)));
    const values = parsed.value as Record<string, unknown>;
    checkFields(connector, values, this.options.connect.env, this.options.allowedHosts);
    const { secrets, headers } = reveal(record, this.options.box);
    try {
      return connector.connect(values, {
        ...this.options.connect,
        fetch: withHeaders(this.options.connect.fetch, headers),
        ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
      });
    } catch (err) {
      return fail([problem("", messageOf(err))]);
    }
  }

  private connectorFor(kind: string): Connector {
    const connector = connectorOf(kind);
    if (!connector) return fail([problem("connector", `연결 방식 '${kind}'을 몰라요`)]);
    return connector;
  }

  /** The connection being changed or tried as a change; its owner only, since its secrets travel with it. */
  private ownedScreenEntry(viewer: Viewer, id: string, action: string): Entry {
    const entry = this.screenEntry(id, action === "연결 지우기" ? "지울" : "바꿀");
    ownerOnly(viewer, entry.record?.owner ?? "", action);
    return entry;
  }

  private screenEntry(id: string, verb: string): Entry {
    if (this.fixed.has(id))
      throw new InvalidInputError(`서버 설정 파일에 적힌 연결은 화면에서 ${verb} 수 없어요`, [
        problem("id", "설정 파일에서 고친 뒤 서버를 다시 시작해 주세요"),
      ]);
    return must(this.added.get(id), `연결 '${id}'`);
  }

  /**
   * Try these settings: connect, ask for the agents, report. Nothing is saved. With `id`, it is a try of
   * changing that connection, so secrets left blank are the ones already kept.
   */
  async check(
    viewer: Viewer,
    input: CheckConnectionRequest,
    toolsBaseUrl?: string,
  ): Promise<ConnectionCheck> {
    const connector = this.connectorFor(input.connector);
    const { id } = input;
    const base = id ? this.ownedScreenEntry(viewer, id, "연결 고치기").record : undefined;
    const composed = compose(connector, input, base, this.options.box);
    const name = typeof input.config.name === "string" ? input.config.name : "확인";
    const port = this.portOf({
      id: input.id ?? "check",
      name,
      connector: input.connector,
      config: composed.config,
      secrets: composed.secrets,
      headers: composed.headers,
      owner: viewer.name,
      createdAt: this.options.stamps.now(),
    });
    const result = await probe(port, this.options.agentsTimeoutMs ?? AGENTS_TIMEOUT_MS);
    const notes = [...result.notes, ...toolsNotes(connector, composed.config, toolsBaseUrl)];
    return { ...result, notes };
  }

  private idFor(input: CreateConnectionRequest): string {
    if (input.id !== undefined) {
      if (this.get(input.id) || this.added.has(input.id))
        fail([problem("id", "같은 id의 연결이 이미 있어요")]);
      return input.id;
    }
    const base = slug(input.name);
    if (base === "") return this.options.stamps.id("c");
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (!this.fixed.has(id) && !this.added.has(id)) return id;
    }
  }

  async create(viewer: Viewer, input: CreateConnectionRequest): Promise<ConnectionView> {
    const connector = this.connectorFor(input.connector);
    const id = this.idFor(input);
    const record = recordOf(
      { id, owner: viewer.name, createdAt: this.options.stamps.now() },
      {
        name: input.name,
        description: input.description ?? "",
        connector: input.connector,
        metadata: input.metadata,
      },
      compose(connector, input, undefined, this.options.box),
    );
    const port = this.portOf(record);
    await this.options.store.putConnection(record);
    return this.fresh(this.entryOf(record, port));
  }

  /** Change a connection: its owner only. Nothing is saved unless the new settings build. */
  async update(
    viewer: Viewer,
    id: string,
    input: UpdateConnectionRequest,
  ): Promise<ConnectionView> {
    const base = this.ownedScreenEntry(viewer, id, "연결 고치기").record as ConnectionRecord;
    const connector = this.connectorFor(base.connector);
    const record = recordOf(
      base,
      {
        name: input.name ?? base.name,
        description: input.description ?? base.description ?? "",
        connector: base.connector,
        metadata: input.metadata ?? base.metadata,
      },
      compose(connector, input, base, this.options.box),
    );
    const port = this.portOf(record);
    await this.options.store.putConnection(record);
    return this.fresh(this.entryOf(record, port));
  }

  private entryOf(record: ConnectionRecord, port: HarnessPort): Entry {
    const entry: Entry = {
      id: record.id,
      source: "screen",
      connector: record.connector,
      name: record.name,
      description: record.description ?? "",
      settings: record.config,
      metadata: record.metadata ?? {},
      record,
      port,
    };
    this.added.set(record.id, entry);
    return entry;
  }

  /** Ask again now: a harness that was down may be up, one whose agents changed shows them. */
  async recheck(id: string): Promise<ConnectionView> {
    const entry = must(this.fixed.get(id) ?? this.added.get(id), `연결 '${id}'`);
    const again = entry.record && !entry.port ? this.fromRecord(entry.record) : entry;
    if (again !== entry) this.added.set(id, again);
    return this.fresh(again);
  }

  /** Keep using it: the clock that removes unused connections starts over. Anyone may; it destroys nothing. */
  async keep(id: string): Promise<ConnectionView> {
    this.screenEntry(id, "바꿀");
    await this.touch(id);
    return this.fresh(must(this.added.get(id), `연결 '${id}'`));
  }

  private fresh(entry: Entry): Promise<ConnectionView> {
    this.seen.delete(entry.id);
    return this.viewOf(entry);
  }

  async remove(viewer: Viewer, id: string): Promise<{ readonly deleted: boolean }> {
    const entry = this.ownedScreenEntry(viewer, id, "연결 지우기");
    const busy = await this.runningOn(id);
    if (busy > 0)
      throw new ConflictError(`이 연결로 돌고 있는 실행이 ${busy}개 있어 지울 수 없어요`);
    await this.forget(id);
    this.added.delete(entry.id);
    this.seen.delete(id);
    return { deleted: true };
  }

  // ── removing what nobody uses ───────────────────────────────────────────────────────────────

  /** When a screen connection will be removed for lack of use. Nothing for the config file's, or when removal is off. */
  private expiryOf(entry: Entry) {
    if (!entry.record || this.retentionDays <= 0) return {};
    const last = Date.parse(entry.record.lastUsedAt ?? entry.record.createdAt);
    const expires = last + this.retentionDays * DAY_MS;
    return {
      expiresAt: new Date(expires).toISOString(),
      daysLeft: Math.max(0, Math.ceil((expires - this.now()) / DAY_MS)),
    };
  }

  /** The person's own connections that will be removed within the warning time. */
  async expiring(viewer: Viewer) {
    return (await this.views())
      .filter(
        (v) => v.owner === viewer.name && v.daysLeft !== undefined && v.daysLeft <= this.warnDays,
      )
      .map((v) => ({ id: v.id, name: v.name, daysLeft: v.daysLeft as number }));
  }

  /** Remove connections made on the screen that no experiment has used for too long; ones with runs going stay. */
  async sweep(): Promise<string[]> {
    const removed: string[] = [];
    for (const entry of [...this.added.values()]) {
      if (this.expiryOf(entry).daysLeft !== 0) continue;
      if ((await this.runningOn(entry.id)) > 0) continue;
      await this.forget(entry.id);
      this.added.delete(entry.id);
      this.seen.delete(entry.id);
      removed.push(entry.id);
    }
    return removed;
  }

  /** Take a connection out of the store, with the versions of its agents (REQ-053). */
  private async forget(id: string): Promise<void> {
    await this.options.store.deleteConnection(id);
    await this.options.store.deleteAgentHistories(id);
  }

  /** Runs queued or running on this connection: removing it would strand them. */
  private async runningOn(id: string): Promise<number> {
    const active = await this.options.store.listActiveRuns();
    const experiments = new Set(active.map((r) => r.experimentId));
    let count = 0;
    for (const experimentId of experiments) {
      const experiment = await this.options.store.getExperiment(experimentId);
      if (experiment?.recipe.harnessId === id)
        count += active.filter((r) => r.experimentId === experimentId).length;
    }
    return count;
  }
}
