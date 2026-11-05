/**
 * Checks Redfish payloads against the DMTF JSON schemas (REQ-002, REQ-003, REQ-008).
 *
 * `dmtf-schemas.json.gz` holds the schemas the facades emit, from DMTF/Redfish-Publications (BSD-3-Clause,
 * see LICENSE-DMTF.md and README.md). A payload's `@odata.type` picks its schema; a schema the bundle does
 * not hold is reported, never skipped, so a new resource type cannot slip through unchecked.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

interface Bundle {
  readonly source: string;
  readonly commit: string;
  readonly files: Readonly<Record<string, object>>;
}

const BASE = "http://redfish.dmtf.org/schemas/v1/";

const bundle = JSON.parse(
  gunzipSync(readFileSync(new URL("./dmtf-schemas.json.gz", import.meta.url))).toString("utf8"),
) as Bundle;

/**
 * References to schemas the bundle does not hold. Another version of a resource the bundle holds (the plain
 * `Sensor.json` lists every version in an `anyOf`) is a stub nothing matches, so a payload has to fit the
 * version the bundle holds; a resource the bundle does not hold at all is a permissive stub.
 */
function stubsFor(files: Readonly<Record<string, object>>): object[] {
  const wanted = new Map<string, Set<string>>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        const [url = "", fragment = ""] = value.split("#");
        const name = url.slice(url.lastIndexOf("/") + 1);
        if (url && !(url.startsWith(BASE) && name in files)) {
          const defs = wanted.get(url) ?? new Set<string>();
          const def = /^\/definitions\/(.+)$/.exec(fragment)?.[1];
          if (def) defs.add(def);
          wanted.set(url, defs);
        }
      } else walk(value);
    }
  };
  for (const schema of Object.values(files)) walk(schema);
  const held = new Set(Object.keys(files).map(baseName));
  return [...wanted].map(([url, defs]) => {
    const alias = sameMinorAs(url, files);
    if (alias) return alias;
    const otherVersion =
      /\.v\d+_\d+_\d+\.json$/.test(url) && held.has(baseName(url.slice(url.lastIndexOf("/") + 1)));
    return {
      $id: url,
      definitions: Object.fromEntries([...defs].map((d) => [d, otherVersion ? false : {}])),
    };
  });
}

/**
 * The held schema standing in for a reference to another erratum of the same version: `LogEntry.v1_15_2`
 * is `LogEntry.v1_15_0` with corrected descriptions, and the plain `LogEntry.json` lists only the latest
 * erratum of each version, so a payload that says `v1_15_0` must be checked against the same schema.
 */
function sameMinorAs(url: string, files: Readonly<Record<string, object>>): object | undefined {
  const m = /\/([A-Za-z0-9]+)\.v(\d+)_(\d+)_\d+\.json$/.exec(url);
  if (!m) return undefined;
  const held = Object.keys(files).find((f) => f.startsWith(`${m[1]}.v${m[2]}_${m[3]}_`));
  return held ? { ...files[held], $id: url } : undefined;
}

/** `Circuit.v1_10_0.json` → `Circuit`. */
const baseName = (file: string): string => file.replace(/(\.v\d+_\d+_\d+)?\.json$/, "");

function build(): Ajv {
  const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
  addFormats(ajv);
  for (const [file, schema] of Object.entries(bundle.files)) {
    // Some files carry another $id than their name (odata-v4.json is odata.v4_0_5.json); references use the file name.
    const key = `${BASE}${file}`;
    if ((schema as { $id?: string }).$id === key) ajv.addSchema(schema);
    else ajv.addSchema(schema, key);
  }
  for (const stub of stubsFor(bundle.files)) ajv.addSchema(stub);
  return ajv;
}

const ajv = build();
const compiled = new Map<string, ValidateFunction | undefined>();

/** `#Circuit.v1_10_0.Circuit` → the schema file and definition to check it against. */
function schemaOf(odataType: string): { file: string; definition: string } | undefined {
  const m = /^#([A-Za-z0-9]+)\.(v\d+_\d+_\d+\.)?([A-Za-z0-9]+)$/.exec(odataType);
  if (!m) return undefined;
  const [, name = "", version = "", definition = ""] = m;
  return { file: `${name}.${version}json`.replace("..", "."), definition };
}

function validatorFor(odataType: string): ValidateFunction | undefined {
  if (compiled.has(odataType)) return compiled.get(odataType);
  const found = schemaOf(odataType);
  const fn =
    found && found.file in bundle.files
      ? ajv.getSchema(`${BASE}${found.file}#/definitions/${found.definition}`)
      : undefined;
  compiled.set(odataType, fn);
  return fn;
}

/** Every way a Redfish payload departs from its schema; empty when it conforms. */
export function schemaErrors(doc: unknown): string[] {
  const type = (doc as { "@odata.type"?: unknown } | null)?.["@odata.type"];
  if (typeof type !== "string") return ["no @odata.type"];
  const validate = validatorFor(type);
  if (!validate) return [`no schema for ${type} in the bundle (add it to dmtf-schemas.json.gz)`];
  if (validate(doc)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

export interface Crawl {
  readonly visited: string[];
  /** Resources that do not match their schema, by path. */
  readonly invalid: Record<string, string[]>;
  /** Links that did not answer 200, by path. */
  readonly broken: Record<string, number>;
}

/** The `@odata.id` of every link in a payload (not the resource's own id, not fragments of itself). */
function linksIn(doc: unknown, self: string): string[] {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "@odata.id" && typeof value === "string") {
        const path = value.split("#")[0] ?? "";
        if (path && path !== self && path.startsWith("/redfish/")) out.add(path);
      } else walk(value);
    }
  };
  walk(doc);
  return [...out];
}

/** Follow every link from `root`, check each resource against its schema, and note links that do not answer. */
export function crawl(get: (path: string) => Reply, root = "/redfish/v1"): Crawl {
  const visited: string[] = [];
  const invalid: Record<string, string[]> = {};
  const broken: Record<string, number> = {};
  const queue = [root];
  const seen = new Set(queue);
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    const reply = get(path);
    if (reply.status !== 200) {
      broken[path] = reply.status;
      continue;
    }
    visited.push(path);
    const errors = schemaErrors(reply.body);
    if (errors.length > 0) invalid[path] = errors;
    for (const link of linksIn(reply.body, path)) {
      if (seen.has(link)) continue;
      seen.add(link);
      queue.push(link);
    }
  }
  return { visited, invalid, broken };
}
