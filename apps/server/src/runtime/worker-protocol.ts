/** Messages between the server's main thread and a session worker (ADR-0027). Plain data only. */
import type { EndReason } from "@terrarium/core/oracle";
import type { AgentTask } from "@terrarium/core/scenario";
import type { CallResult, RunResult } from "@terrarium/core/session";
import type { ToolSpec } from "@terrarium/core/tools";
import type { Blueprint, RunEvent } from "@terrarium/core/world";
import type { PlainSessionConfig } from "./hosts";
import type { WorldIdentity } from "./world-cache";

/** The worker was asked to open a session on a world it does not hold, and the message carried no blueprint. */
export const NEED_BLUEPRINT = "blueprint_needed";

export type ToWorker =
  | {
      readonly kind: "open";
      readonly id: string;
      /** The session's config without its blueprint: the world comes by `world`, or in `blueprint` the first time. */
      readonly config: Omit<PlainSessionConfig, "blueprint" | "world">;
      readonly world: WorldIdentity;
      readonly blueprint?: Blueprint;
    }
  | {
      readonly kind: "call";
      readonly id: string;
      readonly seq: number;
      readonly tool: string;
      readonly args: Record<string, unknown>;
    }
  | {
      readonly kind: "finish";
      readonly id: string;
      readonly seq: number;
      readonly reason?: EndReason;
    }
  | { readonly kind: "dispose"; readonly id: string };

export interface WorkerError {
  readonly message: string;
  /** TerrariumError code, so the main thread can raise the same kind of error. */
  readonly code?: string;
}

export type FromWorker =
  | {
      readonly kind: "opened";
      readonly id: string;
      readonly task: AgentTask;
      readonly specs: readonly ToolSpec[];
      /** What the run had written by the time the agent got its task: the scenario's first faults. */
      readonly events: readonly RunEvent[];
    }
  | { readonly kind: "open_failed"; readonly id: string; readonly error: WorkerError }
  | {
      readonly kind: "called";
      readonly id: string;
      readonly seq: number;
      readonly result: CallResult;
      /** What the run wrote while the call was made, apart from the answer: the agent never sees it. */
      readonly events: readonly RunEvent[];
    }
  | {
      readonly kind: "finished";
      readonly id: string;
      readonly seq: number;
      readonly result: RunResult;
    }
  | {
      readonly kind: "failed";
      readonly id: string;
      readonly seq: number;
      readonly error: WorkerError;
    }
  /** A realtime session ran out of time on its own. */
  | { readonly kind: "ended"; readonly id: string; readonly reason: EndReason };
