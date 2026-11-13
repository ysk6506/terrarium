/** Entry point of a session worker thread (ADR-0027): wires the thread's port to WorkerSessions. */
import { parentPort } from "node:worker_threads";
import { type ShellEngineKind, shellEngineOf } from "../shell";
import type { ToWorker } from "./worker-protocol";
import { WorkerSessions } from "./worker-sessions";

const port = parentPort;
if (port) {
  const kind: ShellEngineKind = process.env.TERRARIUM_SHELL_ENGINE === "wasm" ? "wasm" : "legacy";
  const shellEngine = shellEngineOf(kind);
  const sessions = new WorkerSessions((message) => port.postMessage(message), {
    ...(shellEngine ? { shellEngine } : {}),
  });
  port.on("message", (msg: ToWorker) => void sessions.handle(msg));
}
