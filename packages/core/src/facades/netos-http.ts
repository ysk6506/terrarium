/**
 * The HTTP management APIs of the switch operating systems (REQ-062, ADR-0059): Arista eAPI
 * (`runCmds`, JSON-RPC 2.0) and Cisco NX-API (`ins_api`). Both run CLI commands and wrap what the CLI
 * produced: eAPI hands back JSON per command or the plain text, NX-API an `ins_api` envelope with a code
 * per command. A request is one HTTP body, handed over as a tool call instead of a socket.
 */
import type { CliSession, Mode, Step } from "./netos-cli";

type Json = Record<string, unknown>;

const CODES = { invalid: 1002, unconverted: 1003 } as const;

/** One eAPI command: a string, or `{ cmd, input }`. */
const cmdText = (c: unknown): string =>
  typeof c === "string"
    ? c
    : typeof (c as { cmd?: unknown })?.cmd === "string"
      ? (c as { cmd: string }).cmd
      : "";

function eapiError(code: number, message: string, id: unknown, data: unknown[]): Json {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function eapiResult(step: Step, text: boolean): Json | undefined {
  if (text) return { output: step.result ? `${step.result.text}\n` : "" };
  if (!step.result) return {};
  return step.result.data ? { ...step.result.data } : undefined;
}

/** Arista eAPI: `{ jsonrpc, method: "runCmds", params: { version, cmds, format }, id }`. */
export function runEapi(body: unknown, session: CliSession): Json {
  const req = (body ?? {}) as { id?: unknown; method?: unknown; params?: Record<string, unknown> };
  const id = req.id ?? "";
  if (req.method !== "runCmds")
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  const cmds = req.params?.cmds;
  if (!Array.isArray(cmds) || cmds.length === 0)
    return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params" } };
  const text = req.params?.format === "text";
  const done: unknown[] = [];
  for (const [i, raw] of cmds.entries()) {
    const command = cmdText(raw);
    const step = session.exec(command);
    const where = `CLI command ${i + 1} of ${cmds.length} '${command}' failed`;
    if (!step.ok)
      return eapiError(CODES.invalid, `${where}: invalid command`, id, [
        ...done,
        { errors: [step.output.replace(/^% /, "")] },
      ]);
    const result = eapiResult(step, text);
    if (!result)
      return eapiError(CODES.unconverted, `${where}: unconverted command`, id, [
        ...done,
        { errors: ["Invalid input"] },
      ]);
    done.push(result);
  }
  return { jsonrpc: "2.0", id, result: done };
}

const NXAPI_TYPES = ["cli_show", "cli_show_ascii", "cli_conf"] as const;

function nxapiOutput(step: Step, type: string): Json {
  const base = { input: step.command };
  if (!step.ok)
    return { ...base, msg: "Input CLI command error", code: "400", clierror: `${step.output}\n` };
  if (type === "cli_conf") return { ...base, msg: "Success", code: "200", body: {} };
  if (type === "cli_show_ascii")
    return { ...base, msg: "Success", code: "200", body: `${step.result?.text ?? ""}\n` };
  if (!step.result?.data) return { ...base, msg: "Structured output unsupported", code: "501" };
  return { ...base, msg: "Success", code: "200", body: { ...step.result.data } };
}

function nxapiFailure(type: string, code: string, msg: string): Json {
  return {
    ins_api: { type, version: "1.0", sid: "eoc", outputs: { output: { msg, code, body: "" } } },
  };
}

/** The command lines of an NX-API request, or why it is not one. */
function nxapiInput(body: unknown): { type: string; commands: string[] } | undefined {
  const req = ((body ?? {}) as { ins_api?: Record<string, unknown> }).ins_api;
  const type = String(req?.type ?? "");
  const input = req?.input;
  if (!(NXAPI_TYPES as readonly string[]).includes(type) || typeof input !== "string")
    return undefined;
  const commands = input
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c !== "");
  return commands.length > 0 ? { type, commands } : undefined;
}

const LOOKS = /^\s*(show|dir|ping|traceroute)\b/i;

/** Cisco NX-API: `{ ins_api: { version, type, chunk, sid, input, output_format } }`; commands are separated by ` ;`. */
export function runNxapi(body: unknown, open: (mode: Mode) => CliSession): Json {
  const request = nxapiInput(body);
  if (!request)
    return nxapiFailure(
      "cli_show",
      "400",
      "Invalid ins_api request: type must be cli_show, cli_show_ascii or cli_conf and input a command string",
    );
  const { type, commands } = request;
  const session = open(type === "cli_conf" ? "config" : "priv");
  const outputs: Json[] = [];
  for (const command of commands) {
    // cli_show and cli_show_ascii only take commands that look; a configuration line there is an error.
    const wrongKind = type !== "cli_conf" && !LOOKS.test(command);
    const step: Step = wrongKind
      ? { command, prompt: "", output: "% Invalid command at '^' marker.", ok: false }
      : session.exec(command);
    outputs.push(nxapiOutput(step, type));
    if (!step.ok) break;
  }
  return {
    ins_api: {
      type,
      version: "1.0",
      sid: "eoc",
      outputs: { output: outputs.length === 1 ? outputs[0] : outputs },
    },
  };
}
