/**
 * What a session worker does with each message: hold the sessions assigned to it and answer one
 * message at a time. Errors become messages; the worker never dies of one. Kept apart from the thread
 * entry so it can be tested on the main thread.
 */
import { TerrariumError } from "@terrarium/core/kernel";
import { Session } from "@terrarium/core/session";
import { LocalSession } from "./hosts";
import type { FromWorker, ToWorker, WorkerError } from "./worker-protocol";

export function errorOf(err: unknown): WorkerError {
  if (err instanceof TerrariumError) return { message: err.message, code: err.code };
  return { message: err instanceof Error ? err.message : String(err) };
}

export class WorkerSessions {
  private readonly sessions = new Map<string, LocalSession>();

  constructor(private readonly send: (message: FromWorker) => void) {}

  get size(): number {
    return this.sessions.size;
  }

  private sessionOf(id: string): LocalSession {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`세션 ${id}가 이 워커에 없다`);
    return s;
  }

  private open(id: string, config: Extract<ToWorker, { kind: "open" }>["config"]): void {
    try {
      const local = new LocalSession(Session.create(config), (reason) =>
        this.send({ kind: "ended", id, reason }),
      );
      this.sessions.set(id, local);
      this.send({ kind: "opened", id, task: local.task, specs: local.specs });
    } catch (err) {
      this.send({ kind: "open_failed", id, error: errorOf(err) });
    }
  }

  async handle(msg: ToWorker): Promise<void> {
    if (msg.kind === "open") return this.open(msg.id, msg.config);
    if (msg.kind === "dispose") {
      this.sessions.get(msg.id)?.dispose();
      this.sessions.delete(msg.id);
      return;
    }
    try {
      const session = this.sessionOf(msg.id);
      if (msg.kind === "call")
        this.send({
          kind: "called",
          id: msg.id,
          seq: msg.seq,
          result: await session.call(msg.tool, msg.args),
        });
      else
        this.send({
          kind: "finished",
          id: msg.id,
          seq: msg.seq,
          result: await session.finish(msg.reason),
        });
    } catch (err) {
      this.send({ kind: "failed", id: msg.id, seq: msg.seq, error: errorOf(err) });
    }
  }
}
