import { describe, expect, test, vi } from "vitest";
import type { FromWorker, ToWorker } from "./worker-protocol";

const port = vi.hoisted(() => {
  const handlers: Array<(msg: unknown) => void> = [];
  return {
    handlers,
    sent: [] as unknown[],
    postMessage(message: unknown) {
      this.sent.push(message);
    },
    on(_event: string, handler: (msg: unknown) => void) {
      handlers.push(handler);
    },
  };
});
vi.mock("node:worker_threads", () => ({ parentPort: port }));

describe("the entry point of a session worker thread [REQ-032]", () => {
  test("[REQ-032] it wires the thread's port to the sessions: a message in is answered on the port", async () => {
    await import("./session-worker");
    expect(port.handlers).toHaveLength(1);
    const call: ToWorker = { kind: "call", id: "none", seq: 7, tool: "list_alarms", args: {} };
    port.handlers[0]?.(call);
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));
    const reply = port.sent[0] as FromWorker;
    expect(reply).toMatchObject({ kind: "failed", id: "none", seq: 7 });
  });
});
