/** Entry point of a session worker thread (ADR-0027): wires the thread's port to WorkerSessions. */
import { parentPort } from "node:worker_threads";
import type { ToWorker } from "./worker-protocol";
import { WorkerSessions } from "./worker-sessions";

const port = parentPort;
if (port) {
  const sessions = new WorkerSessions((message) => port.postMessage(message));
  port.on("message", (msg: ToWorker) => void sessions.handle(msg));
}
