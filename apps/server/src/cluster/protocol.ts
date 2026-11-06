/**
 * What control planes and worker nodes say to each other (ADR-0032). Plain JSON over HTTP with a
 * shared bearer token. A node is a process that runs sessions; the control plane decides which node
 * gets which session and keeps everything else (store, scheduler, harness calls, API).
 */
import { timingSafeEqual } from "node:crypto";
import type { EndReason } from "@terrarium/core/oracle";
import type { AgentTask } from "@terrarium/core/scenario";
import type { CallResult, HumanAct, HumanResolution } from "@terrarium/core/session";
import type { ToolSpec } from "@terrarium/core/tools";
import type { Blueprint } from "@terrarium/core/world";
import type { PlainSessionConfig, WorkerError } from "../runtime";

export const NODE_PATH = "/node/v1";
export const CLUSTER_PATH = "/cluster/v1";

/** A node's answer to "how busy are you", also what it tells the control plane on every heartbeat. */
export interface NodeReport {
  /** Stable for the node's life, unique among nodes. */
  readonly id: string;
  /** Where the control plane reaches this node. */
  readonly url: string;
  /** Sessions this node can hold at once. */
  readonly slots: number;
  /** Sessions it holds now. */
  readonly open: number;
  /** Finishing what it has and taking nothing new (scale-in, restart). */
  readonly draining: boolean;
  readonly version: string;
}

/** The session config without the blueprint: the world is sent once per node and then referred to by digest. */
export type SlimConfig = Omit<PlainSessionConfig, "blueprint">;

export interface OpenRequest {
  readonly config: SlimConfig;
  readonly digest: string;
  /** Present when the node has not seen this world yet. */
  readonly blueprint?: Blueprint;
}

export interface OpenReply {
  readonly id: string;
  readonly task: AgentTask;
  readonly specs: readonly ToolSpec[];
}

/** What a person does for a waiting agent on a session that lives on a node (ADR-0087 item 4). */
export type HumanOp =
  | { readonly kind: "act"; readonly tool: string; readonly args: Record<string, unknown> }
  | { readonly kind: "resolve"; readonly resolution: HumanResolution };

export interface HumanReply {
  readonly act?: HumanAct;
  readonly result?: CallResult;
  /** The tools the agent has now. */
  readonly specs: readonly ToolSpec[];
}

export interface StateReply {
  readonly endedBy?: EndReason;
}

/** The body of every error a node sends. `code` lets the client raise the same kind of error. */
export interface ErrorReply {
  readonly error: WorkerError;
}

/** Error codes that belong to the cluster, not to sessions. */
export const NEED_BLUEPRINT = "blueprint_needed";
export const NODE_FULL = "node_full";
export const NODE_DRAINING = "node_draining";

/** True when the Authorization header carries this token (compared in constant time). */
export function bearerMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** A node url must be plain http(s) without credentials: it is where the token is sent. */
export function checkedNodeUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function isNodeReport(v: unknown): v is NodeReport {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const count = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
  return (
    typeof r.id === "string" &&
    /^[A-Za-z0-9._:-]{1,80}$/.test(r.id) &&
    checkedNodeUrl(r.url) !== undefined &&
    count(r.slots) &&
    (r.slots as number) <= 10_000 &&
    count(r.open) &&
    typeof r.draining === "boolean" &&
    typeof r.version === "string"
  );
}
