/**
 * Everything the server reaches outside itself, built from the config in one place. The rest of the
 * server sees only ports (ExperimentStore, HarnessPort, RealitySource, TelemetryPort).
 */
import path from "node:path";
import type { TelemetryPort } from "@terrarium/core/analysis";
import type { SourceView } from "@terrarium/core/contract";
import type { ExperimentStore, HarnessPort } from "@terrarium/core/experiments";
import { MemorySource, type RealitySource, sampleGraph } from "@terrarium/core/sources/realimport";
import { ClickStackTelemetry } from "./clickstack";
import type { Config, HarnessConfig } from "./config";
import { secret } from "./config";
import { falkorSource } from "./falkordb";
import { HttpHarness } from "./harness/http";
import { type FetchLike, OpenAiHarness } from "./harness/openai";
import { ScriptedHarness } from "./harness/scripted";
import { SqliteStore } from "./sqlite-store";

export const SAMPLE_SOURCE_ID = "sample";

export interface SourceEntry {
  readonly view: SourceView;
  readonly source: RealitySource;
}

export interface Adapters {
  readonly store: ExperimentStore;
  readonly harnesses: readonly HarnessPort[];
  readonly sources: ReadonlyMap<string, SourceEntry>;
  readonly telemetry?: { readonly port: TelemetryPort; readonly name: string };
  close(): Promise<void>;
}

export interface AdapterOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Injected for tests; the real fetch otherwise. */
  readonly fetch?: FetchLike;
  /** A store to use instead of the SQLite file (tests, or running without a disk). */
  readonly store?: ExperimentStore;
}

export function harnessFor(
  config: HarnessConfig,
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike,
): HarnessPort {
  switch (config.kind) {
    case "scripted":
      return new ScriptedHarness(config.id, config.name);
    case "openai":
      return new OpenAiHarness(config, secret(env, config.apiKeyEnv), fetchImpl);
    case "http":
      return new HttpHarness(config, secret(env, config.tokenEnv), fetchImpl);
  }
}

function realitySources(config: Config, env: NodeJS.ProcessEnv) {
  const sources = new Map<string, SourceEntry>([
    [
      SAMPLE_SOURCE_ID,
      {
        view: {
          id: SAMPLE_SOURCE_ID,
          name: "샘플 그래프 (가상)",
          kind: "sample",
          readOnly: true,
          configured: true,
        },
        source: new MemorySource("sample: 가상 cloud_topology", sampleGraph()),
      },
    ],
  ]);
  const closers: Array<() => Promise<void>> = [];
  for (const s of config.sources) {
    const { source, graph } = falkorSource(s, {
      ...(s.usernameEnv ? { username: secret(env, s.usernameEnv) } : {}),
      ...(s.passwordEnv ? { password: secret(env, s.passwordEnv) } : {}),
    });
    closers.push(() => graph.close());
    sources.set(s.id, {
      view: { id: s.id, name: s.name, kind: "falkordb", readOnly: true, configured: true },
      source,
    });
  }
  return { sources, closers };
}

export function buildAdapters(config: Config, options: AdapterOptions = {}): Adapters {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  // Secrets are resolved first, so a missing one fails before anything is opened.
  const harnesses = config.harnesses.map((h) => harnessFor(h, env, fetchImpl));
  const { sources, closers } = realitySources(config, env);
  const t = config.telemetry;
  const telemetry = t
    ? { port: new ClickStackTelemetry(t, secret(env, t.passwordEnv), fetchImpl), name: t.name }
    : undefined;
  const ownStore = options.store
    ? undefined
    : new SqliteStore(path.join(config.dataDir, "terrarium.db"));
  return {
    store: options.store ?? (ownStore as SqliteStore),
    harnesses,
    sources,
    ...(telemetry ? { telemetry } : {}),
    async close() {
      await Promise.all(closers.map((c) => c().catch(() => undefined)));
      ownStore?.close();
    },
  };
}
