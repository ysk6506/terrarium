/**
 * What a failed journey step leaves behind (ADR-0195), so an intermittent failure on a runner can be read afterwards: the
 * page address, the words on the screen, the last API requests with their status codes, the browser's console errors and a
 * screenshot. It records no request or response body and no header, and it removes anything that looks like a secret
 * before a line is printed. Nothing here may throw into the run: a dump that cannot be made is a line saying so.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

/** How many API requests are kept, how long the page text and one console line may be. */
export const KEPT_REQUESTS = 20;
export const KEPT_ERRORS = 20;
export const TEXT_LIMIT = 3000;
const LINE_LIMIT = 300;
/** The prefix of every printed line: the runner passes these on to the job log. */
export const PREFIX = "evidence: ";

/** Names of environment variables whose values are secrets (the server's admin token and proxy secret among them). */
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|COOKIE|CREDENTIAL|AUTH|API_?KEY|PRIVATE/i;
const MIN_SECRET_LENGTH = 6;

/** Every secret value this process knows about, longest first so a long one is not cut by a short one inside it. */
export function secretsOf(env: NodeJS.ProcessEnv = process.env): string[] {
  const values = Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && (value?.length ?? 0) >= MIN_SECRET_LENGTH)
    .map(([, value]) => value as string);
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

/** Text with known secrets, bearer credentials, share-link and tool-link tokens and long opaque strings taken out. */
export function scrub(text: string, secrets: readonly string[] = secretsOf()): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/(\/r\/)[^/\s?#]+/g, "$1[redacted]")
    .replace(/(\/mcp\/runs\/[^/\s?#]+\/)[^/\s?#]+/g, "$1[redacted]")
    .replace(/[A-Za-z0-9+/_=-]{40,}/g, "[redacted]");
}

/** An address as the log shows it: the path, and only the names of the query fields (their values can carry a token). */
export function addressOf(raw: string, withOrigin = false): string {
  try {
    const url = new URL(raw);
    const keys = [...new Set(url.searchParams.keys())];
    const query = keys.length > 0 ? `?${keys.map((k) => `${k}=…`).join("&")}` : "";
    return `${withOrigin ? url.origin : ""}${url.pathname}${query}`;
  } catch {
    return "(address unreadable)";
  }
}

export interface Watcher {
  /** The last API requests, oldest first, each `+seconds METHOD /path status`. */
  requests(): readonly string[];
  /** Console errors and uncaught errors, oldest first. */
  errors(): readonly string[];
}

const pushLimited = (list: string[], line: string, limit: number): void => {
  list.push(line);
  if (list.length > limit) list.shift();
};

/** Start remembering API requests (path and status only) and console errors of a page. */
export function watch(page: Page, now: () => number = Date.now): Watcher {
  const began = now();
  const requests: string[] = [];
  const errors: string[] = [];
  const since = () => `+${((now() - began) / 1000).toFixed(1)}s`;
  const isApi = (raw: string) => addressOf(raw).startsWith("/api/");
  page.on("response", (r) => {
    if (isApi(r.url()))
      pushLimited(
        requests,
        `${since()} ${r.request().method()} ${addressOf(r.url())} ${r.status()}`,
        KEPT_REQUESTS,
      );
  });
  page.on("requestfailed", (r) => {
    if (isApi(r.url()))
      pushLimited(requests, `${since()} ${r.method()} ${addressOf(r.url())} failed`, KEPT_REQUESTS);
  });
  page.on("console", (m) => {
    if (m.type() === "error")
      pushLimited(errors, `${since()} ${m.text().slice(0, LINE_LIMIT)}`, KEPT_ERRORS);
  });
  page.on("pageerror", (e) =>
    pushLimited(errors, `${since()} uncaught: ${e.message.slice(0, LINE_LIMIT)}`, KEPT_ERRORS),
  );
  return { requests: () => requests, errors: () => errors };
}

/** The words a person sees, in a few kilobytes: runs of blanks and blank lines folded, the end cut off. */
export function trimText(text: string, limit = TEXT_LIMIT): string {
  const folded = text
    .replace(/[ \t\r]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return folded.length > limit
    ? `${folded.slice(0, limit)}\n(cut: ${folded.length} characters in all)`
    : folded;
}

export interface DumpOptions {
  /** The journey that failed, and the first line of the error. */
  readonly id: string;
  readonly note: string;
  /** Where the screenshot goes; none, no screenshot. */
  readonly dir?: string | undefined;
  readonly secrets?: readonly string[];
}

const attempt = async <T>(work: () => Promise<T>, what: string): Promise<T | string> =>
  work().catch((err) => `(${what} unavailable: ${String(err?.message ?? err).split("\n")[0]})`);

/** The screenshot's file name from the journey id: letters, digits and dashes only. */
const fileName = (id: string, at: number): string =>
  `${id.replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 60)}-${at}.png`;

async function shoot(page: Page, options: DumpOptions, at: number): Promise<string> {
  if (!options.dir) return "no screenshot (TERRARIUM_UX_EVIDENCE_DIR is not set)";
  const file = path.join(options.dir, fileName(options.id, at));
  mkdirSync(options.dir, { recursive: true });
  await page.screenshot({ path: file, timeout: 10_000 });
  return `screenshot: ${file}`;
}

/** The lines to print for one failure. Never throws; each part that cannot be had says so. */
export async function dump(
  page: Page,
  watcher: Watcher,
  options: DumpOptions,
  at = Date.now(),
): Promise<string[]> {
  const secrets = options.secrets ?? secretsOf();
  const text = await attempt(() => page.innerText("body", { timeout: 5000 }), "page text");
  const shot = await attempt(() => shoot(page, options, at), "screenshot");
  const requests = watcher.requests();
  const errors = watcher.errors();
  const lines = [
    `---- journey ${options.id} failed: ${options.note.slice(0, LINE_LIMIT)}`,
    `url: ${addressOf(page.url(), true)}`,
    `page text:`,
    ...trimText(text)
      .split("\n")
      .map((l) => `  | ${l}`),
    `last ${requests.length} API requests (method, path, status):`,
    ...(requests.length > 0 ? requests.map((r) => `  ${r}`) : ["  (none)"]),
    `console errors (${errors.length}):`,
    ...(errors.length > 0 ? errors.map((e) => `  ${e}`) : ["  (none)"]),
    shot,
    `----`,
  ];
  // The screenshot line is made here from the folder the operator named and a file name of letters, digits and dashes;
  // scrubbing would take a long journey name for an opaque string. A failure message in its place is scrubbed.
  return lines.map(
    (l) => `${PREFIX}${l === shot && shot.startsWith("screenshot: ") ? l : scrub(l, secrets)}`,
  );
}
