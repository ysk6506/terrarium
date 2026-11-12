/**
 * Connections (REQ-051, ADR-0042): the harnesses and agents experiments can run on. Some come from the
 * server's config file and cannot be changed from the screen; the rest are registered by people, kept in
 * the store and rebuilt when the server starts. Each one is reached through the connector of its protocol,
 * so this file knows no protocol. It is also the directory the executor looks harnesses up in.
 */
import type { TelemetryAdapter } from "@terrarium/core/analysis";
import {
  type CheckConnectionRequest,
  type ConnectionCheck,
  type ConnectionView,
  type ConnectorSpec,
  type CreateConnectionRequest,
  InvalidInputError,
  type ScopeRequest,
  type TelemetryAdapterList,
  type TryConnectionRequest,
  type TryResult,
  UnavailableError,
  type UpdateConnectionRequest,
} from "@terrarium/core/contract";
import type { ConnectionRecord, HarnessPort } from "@terrarium/core/experiments";
import { ConflictError } from "@terrarium/core/kernel";
import { CONNECTORS, type Connector, connectorOf } from "../adapters";
import {
  compose,
  fail,
  messageOf,
  metadataOf,
  probe,
  problem,
  recordOf,
  slug,
  toolsNotes,
} from "./connection-form";
import type { ConnectionsOptions } from "./connection-options";
import { portFor } from "./connection-port";
import { adapterList, adapterOf, composeTraces, reachNote, type Traces } from "./connection-traces";
import { tryTalk } from "./connection-try";
import { discover, type Entry, expiryOf, viewOf } from "./connection-view";
import { type HarnessDirectory, must, type Viewer } from "./context";
import { allow, canSee, mustSee, standing } from "./permissions";
import { canChangeScope, changeScope, startingScope } from "./scoping";

export type { ConnectionsOptions, FixedConnection } from "./connection-options";

const AGENTS_TIMEOUT_MS = 10_000;
const AGENTS_TTL_MS = 30_000;
const RETENTION_DAYS = 30;
const WARN_DAYS = 7;

export { addressProblem } from "./connection-form";

export class Connections implements HarnessDirectory {
  private readonly fixed = new Map<string, Entry>();
  private readonly added = new Map<string, Entry>();
  private readonly seen = new Map<string, { at: number; view: ConnectionView }>();

  constructor(private readonly options: ConnectionsOptions) {
    for (const { port, config } of options.fixed) {
      const { kind, id, name, description, metadata, traces, ...settings } = config ?? {
        kind: port.info.kind,
        id: port.info.id,
        name: port.info.name,
      };
      const chosen = traces as Traces | undefined;
      this.fixed.set(port.info.id, {
        id,
        source: "config",
        connector: kind,
        name,
        description: description ?? port.info.description,
        settings,
        metadata: metadataOf(metadata),
        port,
        ...(chosen ? { traces: chosen } : {}),
        ...this.adapterEntry(chosen),
      });
    }
  }

  /** The adapter a choice stands for (in a config file, secrets are named variables). */
  private adapterEntry(chosen: Traces | undefined): { readonly adapter?: TelemetryAdapter } {
    const adapter = adapterOf(chosen, this.options.connect, this.options.box);
    return adapter ? { adapter } : {};
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

  /** Who made it and who can see it: a connection of the config file has neither owner nor scope and is for everyone signed in. */
  standingOf(id: string) {
    const entry = this.fixed.get(id) ?? this.added.get(id);
    if (!entry) return undefined;
    return entry.record ? standing(entry.record) : {};
  }

  /**
   * Where this connection's traces are read from. A choice made on the form wins ("default" is the server's own
   * telemetry); a connection nobody chose for keeps the older rule: the server's, if the harness says it emits traces.
   */
  telemetryOf(id: string): TelemetryAdapter | undefined {
    const entry = this.fixed.get(id) ?? this.added.get(id);
    if (!entry) return undefined;
    const chosen = entry.traces?.kind;
    if (chosen === "none") return undefined;
    if (chosen === "default") return this.options.defaultTelemetry;
    if (chosen !== undefined) return entry.adapter;
    return entry.port?.info.telemetry === "clickstack" ? this.options.defaultTelemetry : undefined;
  }

  /** The tools traces can be kept in, and the server's own default. */
  telemetryAdapters(): TelemetryAdapterList {
    return adapterList(this.options.defaultTelemetry);
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

  /** The connections the person can see, each saying whether they may change who sees it. */
  async views(viewer: Viewer): Promise<ConnectionView[]> {
    const seen = this.entries().filter((e) => canSee(viewer, this.standingOf(e.id) ?? {}));
    return Promise.all(seen.map(async (e) => this.forViewer(viewer, await this.viewOfEntry(e))));
  }

  /** Whether the person asking may change who sees a connection made on the screen: its maker and admins. */
  private forViewer(viewer: Viewer, view: ConnectionView): ConnectionView {
    if (view.source !== "screen") return view;
    return { ...view, sharing: { ...view.sharing, canChange: canChangeScope(viewer, view.owner) } };
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
      ...(record.traces ? { traces: record.traces } : {}),
    };
    try {
      return { ...entry, port: this.portOf(record), ...this.adapterEntry(record.traces) };
    } catch (err) {
      return { ...entry, error: messageOf(err) };
    }
  }

  private async viewOfEntry(entry: Entry): Promise<ConnectionView> {
    const kept = this.seen.get(entry.id);
    const ttl = this.options.agentsTtlMs ?? AGENTS_TTL_MS;
    if (kept && Date.now() - kept.at < ttl) return kept.view;
    const looked = await discover(entry, this.options.agentsTimeoutMs ?? AGENTS_TIMEOUT_MS);
    const view = viewOf(entry, looked, {
      slotUrl: this.options.slotUrl,
      expiry: this.expiryOf(entry),
      reads: this.telemetryOf(entry.id),
    });
    this.seen.set(entry.id, { at: Date.now(), view });
    return view;
  }

  // ── trying, adding, changing, removing ──────────────────────────────────────────────────────

  /** The port this record describes, or an InvalidInputError whose issues name the form fields. */
  private portOf(record: ConnectionRecord): HarnessPort {
    return portFor(record, this.options);
  }

  private connectorFor(kind: string): Connector {
    const connector = connectorOf(kind);
    if (!connector) return fail([problem("connector", `연결 방식 '${kind}'을 몰라요`)]);
    return connector;
  }

  /** The connection being changed or tried as a change; its owner only, since its secrets travel with it. */
  private ownedScreenEntry(viewer: Viewer, id: string, action: string): Entry {
    const entry = this.screenEntry(viewer, id, action === "연결 지우기" ? "지울" : "바꿀");
    allow(
      viewer,
      action === "연결 지우기" ? "remove" : "change",
      { owner: entry.record?.owner },
      action,
    );
    return entry;
  }

  /** A connection the viewer may use: the config file's are for everyone signed in, one made on the screen carries its maker's secrets. */
  private usable(viewer: Viewer, id: string): Entry {
    const entry = must(this.fixed.get(id) ?? this.added.get(id), `연결 '${id}'`);
    // using needs sight; a connection the person cannot see answers as one that is not there
    mustSee(viewer, this.standingOf(id) ?? {}, `연결 '${id}'`);
    return entry;
  }

  private screenEntry(viewer: Viewer, id: string, verb: string): Entry {
    if (this.fixed.has(id))
      throw new InvalidInputError(`서버 설정 파일에 적힌 연결은 화면에서 ${verb} 수 없어요`, [
        problem("id", "설정 파일에서 고친 뒤 서버를 다시 시작해 주세요"),
      ]);
    const entry = must(this.added.get(id), `연결 '${id}'`);
    mustSee(viewer, this.standingOf(id) ?? {}, `연결 '${id}'`);
    return entry;
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
    const composed = this.composed(connector, input, base);
    const name = typeof input.config.name === "string" ? input.config.name : "확인";
    const port = this.portOf({
      id: input.id ?? "check",
      name,
      connector: input.connector,
      config: composed.config,
      secrets: composed.secrets,
      headers: composed.headers,
      owner: viewer.id,
      createdAt: this.options.stamps.now(),
    });
    const result = await probe(port, this.options.agentsTimeoutMs ?? AGENTS_TIMEOUT_MS);
    const reach = await this.reachNotes(composed.traces);
    const notes = [
      ...result.notes,
      ...toolsNotes(connector, composed.config, toolsBaseUrl),
      ...reach,
    ];
    return { ...result, notes };
  }

  /** What was typed, split into what is kept in the open, what is sealed, and where its traces go. */
  private composed(
    connector: Connector,
    input: CheckConnectionRequest | CreateConnectionRequest | UpdateConnectionRequest,
    base: ConnectionRecord | undefined,
  ) {
    const { box, connect, allowedHosts } = this.options;
    const traces = composeTraces(input.traces, base?.traces, box, connect.env, allowedHosts);
    return { ...compose(connector, input, base, box), ...(traces ? { traces } : {}) };
  }

  /** A note when the tool the person chose for traces does not answer. */
  private async reachNotes(traces: Traces | undefined): Promise<string[]> {
    const adapter =
      traces?.kind === "default"
        ? this.options.defaultTelemetry
        : adapterOf(traces, this.options.connect, this.options.box);
    const note = adapter ? await reachNote(adapter) : undefined;
    return note ? [note] : [];
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
      {
        id,
        owner: viewer.id,
        createdAt: this.options.stamps.now(),
        // a connection carries its maker's secrets: private until they say otherwise
        ...startingScope(viewer, input, "private"),
      },
      {
        name: input.name,
        description: input.description ?? "",
        connector: input.connector,
        metadata: input.metadata,
      },
      this.composed(connector, input, undefined),
    );
    const port = this.portOf(record);
    await this.options.store.putConnection(record);
    return this.forViewer(viewer, await this.fresh(this.entryOf(record, port)));
  }

  /** Change a connection: its owner only. Nothing is saved unless the new settings build. */
  async update(
    viewer: Viewer,
    id: string,
    input: UpdateConnectionRequest,
  ): Promise<ConnectionView> {
    const kept = this.ownedScreenEntry(viewer, id, "연결 고치기").record as ConnectionRecord;
    const base = kept;
    const connector = this.connectorFor(base.connector);
    const record = recordOf(
      base,
      {
        name: input.name ?? base.name,
        description: input.description ?? base.description ?? "",
        connector: base.connector,
        metadata: input.metadata ?? base.metadata,
      },
      this.composed(connector, input, base),
    );
    const port = this.portOf(record);
    await this.options.store.putConnection(record);
    return this.forViewer(viewer, await this.fresh(this.entryOf(record, port)));
  }

  /** Who can see a connection (ADR-0174): the one place its scope changes; nothing else about it is rebuilt. */
  async setScope(viewer: Viewer, id: string, req: ScopeRequest): Promise<ConnectionView> {
    const what = "연결 공개 범위 바꾸기";
    const entry = this.ownedScreenEntry(viewer, id, what);
    const record = changeScope(viewer, entry.record as ConnectionRecord, req, what);
    await this.options.store.putConnection(record);
    const next: Entry = { ...entry, record };
    this.added.set(id, next);
    return this.forViewer(viewer, await this.fresh(next));
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
      ...(record.traces ? { traces: record.traces } : {}),
      ...this.adapterEntry(record.traces),
    };
    this.added.set(record.id, entry);
    return entry;
  }

  /** "말 걸어 보기": one question to one agent of a connection, nothing else touched. */
  async talk(viewer: Viewer, id: string, input: TryConnectionRequest): Promise<TryResult> {
    const entry = this.usable(viewer, id);
    if (!entry.port)
      throw new UnavailableError(entry.error ?? "이 연결은 아직 만들어지지 않았어요");
    return tryTalk(
      entry.port,
      this.telemetryOf(id),
      input,
      this.options.stamps.id("try"),
      this.options.tryOptions,
    );
  }

  /** Ask again now: a harness that was down may be up, one whose agents changed shows them. */
  async recheck(viewer: Viewer, id: string): Promise<ConnectionView> {
    const entry = this.usable(viewer, id);
    const again = entry.record && !entry.port ? this.fromRecord(entry.record) : entry;
    if (again !== entry) this.added.set(id, again);
    return this.forViewer(viewer, await this.fresh(again));
  }

  /** Keep using it: the clock that removes unused connections starts over. Whoever may use the connection. */
  async keep(viewer: Viewer, id: string): Promise<ConnectionView> {
    this.screenEntry(viewer, id, "바꿀");
    await this.touch(id);
    return this.forViewer(viewer, await this.fresh(must(this.added.get(id), `연결 '${id}'`)));
  }

  private fresh(entry: Entry): Promise<ConnectionView> {
    this.seen.delete(entry.id);
    return this.viewOfEntry(entry);
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
    return expiryOf(entry.record, this.retentionDays, this.now());
  }

  /** The person's own connections that will be removed within the warning time. */
  async expiring(viewer: Viewer) {
    return (await this.views(viewer))
      .filter(
        (v) => v.owner === viewer.id && v.daysLeft !== undefined && v.daysLeft <= this.warnDays,
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
