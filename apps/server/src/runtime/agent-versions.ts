/**
 * Versions of agents (REQ-053): every experiment looks at its agent again, and when the agent says something
 * different from the newest version a new version is written, with the date and what changed. People can add
 * a version of their own, name or annotate any version, and delete one.
 *
 * The version lives with the connection: it is kept for (harness, agent) and goes away with the connection.
 */
import {
  type AddAgentVersionRequest,
  type AgentHistoryView,
  type AgentVersionView,
  type EditAgentVersionRequest,
  UnavailableError,
} from "@terrarium/core/contract";
import {
  type AgentHistory,
  type AgentKey,
  addManual,
  changesOf,
  editVersion,
  newest,
  observe,
  pendingChange,
  removeVersion,
  type Subject,
  snapshotOf,
} from "@terrarium/core/experiments";
import { must, type PlatformContext, type Viewer } from "./context";
import { allow, allowRunOn, sightOf } from "./permissions";
import { subjectOf } from "./subject";

export class AgentVersions {
  /** One change to a history at a time: two experiments made together must not both write version 3. */
  private readonly lanes = new Map<string, Promise<unknown>>();

  constructor(private readonly ctx: PlatformContext) {}

  private serially<T>(key: AgentKey, job: () => Promise<T>): Promise<T> {
    const lane = JSON.stringify([key.harnessId, key.agentId]);
    const run = (this.lanes.get(lane) ?? Promise.resolve()).then(job, job);
    const tail = run.catch(() => undefined);
    this.lanes.set(lane, tail);
    void tail.then(() => {
      if (this.lanes.get(lane) === tail) this.lanes.delete(lane);
    });
    return run;
  }

  /**
   * An experiment is being made on this agent: look at it, write a new version if it differs from the
   * newest, and say which version the experiment runs as.
   */
  observe(viewer: Viewer, subject: Subject): Promise<number> {
    const key = { harnessId: subject.harness.id, agentId: subject.agent.id };
    return this.serially(key, async () => {
      const history = await this.ctx.store.getAgentHistory(key.harnessId, key.agentId);
      const seen = observe(history, key, snapshotOf(subject), this.ctx.stamps.now(), viewer.id);
      if (seen.created) await this.ctx.store.putAgentHistory(seen.history);
      return seen.version.n;
    });
  }

  /** The agent as it is now, asked of its harness. */
  private async live(harnessId: string, agentId: string): Promise<Subject> {
    const harness = must(this.ctx.harnesses.get(harnessId), `하네스 '${harnessId}'`);
    const agents = await harness.agents();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`하네스가 에이전트 '${agentId}'를 알려 주지 않아요`);
    return subjectOf(harness.info, agent, this.ctx.harnesses.metadata?.(harnessId));
  }

  private async view(
    viewer: Viewer,
    history: AgentHistory | undefined,
    key: AgentKey,
  ): Promise<AgentHistoryView> {
    // how many experiments ran as each version: the ones the person may see
    const experiments = await this.ctx.store.listExperiments({ visibleTo: sightOf(viewer) });
    const used = new Map<number, number>();
    for (const e of experiments)
      if (
        e.recipe.harnessId === key.harnessId &&
        e.recipe.agentId === key.agentId &&
        e.agentVersion !== undefined
      )
        used.set(e.agentVersion, (used.get(e.agentVersion) ?? 0) + 1);
    const versions: AgentVersionView[] = history
      ? [...history.versions]
          .sort((a, b) => b.n - a.n)
          .map((v) => ({
            n: v.n,
            at: v.at,
            source: v.source,
            ...(v.by ? { by: v.by } : {}),
            ...(v.label ? { label: v.label } : {}),
            ...(v.note ? { note: v.note } : {}),
            attributes: v.attributes,
            snapshot: v.snapshot,
            changes: changesOf(history, v.n),
            experiments: used.get(v.n) ?? 0,
          }))
      : [];
    try {
      const subject = await this.live(key.harnessId, key.agentId);
      const pending = pendingChange(history, snapshotOf(subject));
      return { ...key, versions, ...(pending ? { pending } : {}) };
    } catch (err) {
      return { ...key, versions, pendingError: (err as Error).message };
    }
  }

  /** The connection, if the person can see it: one they cannot answers as one that is not there. */
  private known(viewer: Viewer, harnessId: string): void {
    allowRunOn(viewer, this.ctx.harnesses, harnessId);
    must(this.ctx.harnesses.get(harnessId), `하네스 '${harnessId}'`);
  }

  async history(viewer: Viewer, harnessId: string, agentId: string): Promise<AgentHistoryView> {
    this.known(viewer, harnessId);
    const key = { harnessId, agentId };
    return this.view(viewer, await this.ctx.store.getAgentHistory(harnessId, agentId), key);
  }

  /** Whoever made a connection decides what its versions say; the config file's connections have no owner, so admins do. */
  private mayEdit(viewer: Viewer, harnessId: string): void {
    allow(
      viewer,
      "editAgentVersions",
      { owner: this.ctx.harnesses.ownerOf?.(harnessId) },
      "버전 바꾸기",
    );
  }

  async add(
    viewer: Viewer,
    harnessId: string,
    agentId: string,
    req: AddAgentVersionRequest,
  ): Promise<AgentHistoryView> {
    this.known(viewer, harnessId);
    this.mayEdit(viewer, harnessId);
    const key = { harnessId, agentId };
    const history = await this.serially(key, async () => {
      const before = await this.ctx.store.getAgentHistory(harnessId, agentId);
      // The first version has nothing to copy, so it is the agent as it is now.
      const snapshot = newest(before)
        ? {}
        : snapshotOf(
            await this.live(harnessId, agentId).catch((err: Error) => {
              throw new UnavailableError(
                `에이전트를 확인할 수 없어 버전을 더할 수 없어요: ${err.message}`,
              );
            }),
          );
      const added = addManual(before, key, snapshot, this.ctx.stamps.now(), viewer.id, req);
      await this.ctx.store.putAgentHistory(added.history);
      return added.history;
    });
    return this.view(viewer, history, key);
  }

  private async change(
    viewer: Viewer,
    harnessId: string,
    agentId: string,
    edit: (history: AgentHistory) => AgentHistory,
  ): Promise<AgentHistoryView> {
    this.known(viewer, harnessId);
    this.mayEdit(viewer, harnessId);
    const key = { harnessId, agentId };
    const history = await this.serially(key, async () => {
      const before = must(
        await this.ctx.store.getAgentHistory(harnessId, agentId),
        `에이전트 '${agentId}'의 버전`,
      );
      const after = edit(before);
      await this.ctx.store.putAgentHistory(after);
      return after;
    });
    return this.view(viewer, history, key);
  }

  edit(
    viewer: Viewer,
    harnessId: string,
    agentId: string,
    n: number,
    req: EditAgentVersionRequest,
  ): Promise<AgentHistoryView> {
    return this.change(viewer, harnessId, agentId, (h) =>
      editVersion(h, n, {
        ...(req.label === undefined ? {} : { label: req.label }),
        ...(req.note === undefined ? {} : { note: req.note }),
        ...(req.attributes === undefined ? {} : { attributes: req.attributes }),
      }),
    );
  }

  remove(viewer: Viewer, harnessId: string, agentId: string, n: number): Promise<AgentHistoryView> {
    return this.change(viewer, harnessId, agentId, (h) => removeVersion(h, n));
  }
}
