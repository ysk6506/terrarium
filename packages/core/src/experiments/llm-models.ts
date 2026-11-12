import type { Shared } from "./scope";

/**
 * A model API registered for the whole workspace (REQ-099, ADR-0119): not an experiment's own connection but something
 * the workspace uses later (reading results, guiding). The key and header values are kept sealed; only the last four
 * letters of the key stay in the open, for the card.
 */
export interface LlmModelRecord extends Shared {
  readonly id: string;
  /** Who registered it; only they change or delete it. */
  readonly owner: string;
  readonly name: string;
  /** `litellm`, `openai` or `anthropic` (the contract names them). */
  readonly kind: string;
  readonly baseUrl: string;
  readonly defaultModel?: string;
  /** The key, sealed by the server's secret box. Absent: none was given. */
  readonly sealedKey?: string;
  /** Last four letters of the key. */
  readonly keyTail?: string;
  /** Extra headers; the values are sealed. */
  readonly headers: readonly { readonly name: string; readonly sealed: string }[];
  /** The one the workspace's later features use. At most one record has it. */
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly lastCheck?: LlmCheckRecord;
}

export interface LlmCheckRecord {
  readonly at: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly via?: "models" | "completion";
  readonly models: readonly string[];
  readonly modelCount?: number;
  readonly reason?: string;
  readonly error?: string;
}
