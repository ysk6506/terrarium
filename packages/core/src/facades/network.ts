/**
 * The management interfaces of a switch (REQ-062, ADR-0059): the CLI over SSH, Arista eAPI and Cisco
 * NX-API. Which of them a switch has depends on the OS it runs (EOS: CLI and eAPI, NX-OS: CLI and
 * NX-API, IOS XE: CLI). A request is a tool call; nothing listens on a socket. A switch without power
 * does not answer.
 */
import { NotFoundError } from "@terrarium/core/kernel";
import type { ProfileRegistry } from "@terrarium/core/profiles";
import type { EmulationGap, Entity, WorldPort } from "@terrarium/core/world";
import { CliSession, type Mode } from "./netos-cli";
import { runEapi, runNxapi } from "./netos-http";
import { type Memo, type Os, type SwitchView, switchView } from "./netos-model";
import { noService, speaks } from "./protocols";

export interface CliRequest {
  readonly commands: readonly string[];
  /** Log in, enter configuration mode, run the commands and leave it (what a script library's config call does). */
  readonly configure?: boolean;
}

export interface CliStepOut {
  readonly command: string;
  readonly prompt: string;
  readonly output: string;
  readonly ok: boolean;
}

export type CliResponse =
  | {
      readonly device: string;
      readonly os: Os;
      readonly steps: CliStepOut[];
      readonly prompt: string;
      /** The emulation gaps of the lines, keys only (ADR-0184); absent when there were none. */
      readonly gaps?: readonly EmulationGap[];
    }
  | { readonly timeout: true; readonly device: string; readonly message: string };

type Json = Record<string, unknown>;

/** `{ gaps }` when there were any, so a response without gaps keeps its old shape. */
const gapsField = (gaps: readonly EmulationGap[]): { gaps?: readonly EmulationGap[] } =>
  gaps.length > 0 ? { gaps } : {};
export type HttpApiResponse =
  | Json
  | { readonly timeout: true; readonly device: string; readonly message: string };

const API_NAME = { eapi: "Arista eAPI", nxapi: "Cisco NX-API" } as const;

export class NetworkFacade {
  constructor(
    private readonly world: WorldPort,
    private readonly profiles: ProfileRegistry,
    private readonly memos: Map<string, Memo>,
  ) {}

  private find(deviceId: string, protocol: "cli" | "eapi" | "nxapi"): Entity {
    const entity = this.world.index.find(deviceId);
    if (!entity || !speaks(entity.kind, "cli"))
      throw new NotFoundError(noService(entity, deviceId, protocol));
    return entity;
  }

  private memo(id: string): Memo {
    const known = this.memos.get(id) ?? new Map<string, string>();
    this.memos.set(id, known);
    return known;
  }

  private view(entity: Entity): SwitchView {
    return switchView(this.world, entity, this.profiles, this.memo(entity.id));
  }

  private session(entity: Entity, mode: Mode): CliSession {
    return new CliSession(this.world, entity, this.profiles, this.memo(entity.id), mode);
  }

  private silent(id: string, what: string): { timeout: true; device: string; message: string } {
    return {
      timeout: true,
      device: id,
      message: `${what} to ${id} timed out: the switch has no power`,
    };
  }

  cli(deviceId: string, request: CliRequest): CliResponse {
    const entity = this.find(deviceId, "cli");
    const v = this.view(entity);
    if (!v.powered) return this.silent(deviceId, "ssh: connect");
    const session = this.session(entity, v.os === "nxos" ? "priv" : "user");
    const lines = request.configure
      ? [...(v.os === "nxos" ? [] : ["enable"]), "configure terminal", ...request.commands]
      : request.commands;
    const steps: CliStepOut[] = [];
    const run = (line: string): void => {
      const { command, prompt, output, ok } = session.exec(line);
      steps.push({ command, prompt, output, ok });
    };
    for (const line of lines) if (!session.closed) run(line);
    // A configuring call leaves configuration mode, unless the commands already did.
    if (request.configure && session.mode.startsWith("config")) run("end");
    return {
      device: deviceId,
      os: v.os,
      steps,
      prompt: session.prompt(),
      ...gapsField(session.gaps),
    };
  }

  private http(deviceId: string, api: "eapi" | "nxapi", body: unknown): HttpApiResponse {
    const entity = this.find(deviceId, api);
    const v = this.view(entity);
    if (v.profile.httpApi !== api)
      throw new NotFoundError(
        `'${deviceId}' runs ${v.profile.product} ${v.profile.release}; ${
          v.profile.httpApi === "none"
            ? "it has no HTTP management API, only the CLI"
            : `its HTTP API is ${API_NAME[v.profile.httpApi]}, not ${API_NAME[api]}`
        }`,
      );
    if (!v.powered) return this.silent(deviceId, "HTTP connection");
    const sessions: CliSession[] = [];
    const open = (mode: Mode): CliSession => {
      const s = this.session(entity, mode);
      sessions.push(s);
      return s;
    };
    const answer = api === "eapi" ? runEapi(body, open("priv")) : runNxapi(body, open);
    return { ...answer, ...gapsField(sessions.flatMap((s) => s.gaps)) };
  }

  eapi(deviceId: string, body: unknown): HttpApiResponse {
    return this.http(deviceId, "eapi", body);
  }

  nxapi(deviceId: string, body: unknown): HttpApiResponse {
    return this.http(deviceId, "nxapi", body);
  }
}
