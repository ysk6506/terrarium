/** Messages between the server's main thread and a session worker (ADR-0027). Plain data only. */
import type { EndReason } from "@terrarium/core/oracle";
import type { AgentTask } from "@terrarium/core/scenario";
import type { CallResult, RunResult } from "@terrarium/core/session";
import type { ToolSpec } from "@terrarium/core/tools";
import type { PlainSessionConfig } from "./hosts";

export type ToWorker =
  | { readonly kind: "open"; readonly id: string; readonly config: PlainSessionConfig }
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
    }
  | { readonly kind: "open_failed"; readonly id: string; readonly error: WorkerError }
  | {
      readonly kind: "called";
      readonly id: string;
      readonly seq: number;
      readonly result: CallResult;
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
