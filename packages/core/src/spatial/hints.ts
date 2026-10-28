/**
 * Turn the many location formats found in real inventories into one LocationHint (REQ-013).
 * Nothing here knows a specific database: callers pass plain property records and, optionally,
 * their own LocationKeys.
 */
export type HintKind = "rack" | "device";

export interface FloorInfo {
  readonly site?: string;
  readonly building?: string;
  readonly floor?: string;
  readonly room?: string;
}

export interface LocationHint {
  readonly floorInfo: FloorInfo;
  readonly row?: number;
  readonly column?: number;
  readonly unit?: number;
  readonly unitSpan: number;
  readonly rackRef?: string;
}

export interface LocationKeys {
  readonly floor: readonly string[];
  readonly row: readonly string[];
  readonly column: readonly string[];
  readonly rack: readonly string[];
  readonly unit: readonly string[];
  readonly height: readonly string[];
  readonly name: readonly string[];
}

export const DEFAULT_KEYS: LocationKeys = {
  floor: ["floor_info", "floor", "location", "room_path"],
  row: ["rack_row", "row", "rack_rows"],
  column: ["rack_col", "rack_column", "column", "rack_no", "rack_number"],
  rack: ["rack_name", "rack", "rack_id", "rack_position"],
  unit: ["u_position", "rack_unit", "u", "unit", "slot", "u_start"],
  height: ["u_height", "height_u", "size_u"],
  name: ["name", "hostname"],
};

const FLOOR_RE = /^(B?\d{1,3}F)(?:[_\-\s]+(.+))?$/i;
const SEPARATORS = /\s*[>|]\s*/;
const ROW_COL_RE = /^(?:row)?[\s_-]*(\d+)[\s_-]*(?:rack|col|[rcx/,-])[\s_-]*(\d+)$/i;
const COLUMN_ONLY_RE = /^(?:rack|r)?[\s_-]*(\d+)$/i;
const LETTER_ROW_RE = /^([A-Za-z])[\s_-]*(\d+)$/;
const UNIT_RE = /^u?(\d+)u?(?:\s*[-~:]\s*u?(\d+)u?)?$/i;

export const EMPTY_HINT: LocationHint = { floorInfo: {}, unitSpan: 1 };

/** Stable text key identifying the room, shared by everything inside it. */
export function roomKey(info: FloorInfo): string {
  return [info.site, info.building, info.floor, info.room].map((p) => p ?? "?").join(">");
}

/** Split `H1>DSR동_C타워>3F_A_Datacenter` into site H1, building DSR동_C타워, floor 3F, room A_Datacenter. */
export function parseFloorInfo(text: string): FloorInfo {
  const parts = text.trim().split(SEPARATORS).filter(Boolean);
  const tail = parts.at(-1);
  if (tail === undefined) return {};
  const head = parts.slice(0, -1);
  const match = FLOOR_RE.exec(tail);
  const info: { site?: string; building?: string; floor?: string; room?: string } = {};
  if (head.length >= 2) info.site = head[0];
  if (head.length >= 1) info.building = head.at(-1);
  if (match) {
    info.floor = (match[1] as string).toUpperCase();
    if (match[2]) info.room = match[2];
  } else {
    info.room = tail;
  }
  return info;
}

/** Row and column from names like `A-03`, `1-5`, `ROW3-RACK05`. A bare number (`R12`) gives a column only. */
export function parseRackPosition(text: string): { row?: number; column?: number } {
  const cleaned = text.trim();
  const rowCol = ROW_COL_RE.exec(cleaned);
  if (rowCol) return { row: Number(rowCol[1]), column: Number(rowCol[2]) };
  const only = COLUMN_ONLY_RE.exec(cleaned);
  if (only) return { column: Number(only[1]) };
  const letter = LETTER_ROW_RE.exec(cleaned);
  if (letter)
    return {
      row: (letter[1] as string).toUpperCase().charCodeAt(0) - 64,
      column: Number(letter[2]),
    };
  return {};
}

/** `U12`/`12U`/`12` -> {start 12, span 1}; `U12-U14`/`12~14` -> {start 12, span 3}. */
export function parseUnitSpan(text: string): { start: number; span: number } | undefined {
  const match = UNIT_RE.exec(text.trim());
  if (!match) return undefined;
  const a = Number(match[1]);
  const b = match[2] ? Number(match[2]) : a;
  const low = Math.min(a, b);
  return low >= 1 ? { start: low, span: Math.max(a, b) - low + 1 } : undefined;
}

function lookup(props: Readonly<Record<string, unknown>>, aliases: readonly string[]): unknown {
  const lowered = new Map(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
  for (const alias of aliases) {
    const value = lowered.get(alias);
    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0)
    )
      return value;
  }
  return undefined;
}

export function asInt(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  if (typeof value === "string" && /^\s*\d+\s*$/.test(value)) return Number(value.trim());
  if (Array.isArray(value) && value.length === 1) return asInt(value[0]);
  return undefined;
}

function deviceUnit(
  props: Readonly<Record<string, unknown>>,
  keys: LocationKeys,
): { unit?: number; unitSpan: number } {
  const height = asInt(lookup(props, keys.height)) ?? 1;
  const raw = lookup(props, keys.unit);
  if (raw === undefined) return { unitSpan: height };
  const number = asInt(raw);
  if (number !== undefined)
    return number >= 1 ? { unit: number, unitSpan: height } : { unitSpan: height };
  const parsed = parseUnitSpan(String(raw));
  if (!parsed) return { unitSpan: height };
  return { unit: parsed.start, unitSpan: parsed.span === 1 ? height : parsed.span };
}

/** Copy only the keys whose value is defined (keeps hints free of `undefined` fields). */
function defined<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Row/column for a rack: explicit properties first, then whatever its name says. */
function rackSlot(
  props: Readonly<Record<string, unknown>>,
  keys: LocationKeys,
  rackRef: string | undefined,
): { row?: number; column?: number } {
  const row = asInt(lookup(props, keys.row));
  const column = asInt(lookup(props, keys.column));
  if (row !== undefined && column !== undefined) return { row, column };
  const name = rackRef ?? String(lookup(props, keys.name) ?? "");
  const parsed = name ? parseRackPosition(name) : {};
  return defined({ row: row ?? parsed.row, column: column ?? parsed.column });
}

/** Read whatever location properties a record has; nothing missing is invented. */
export function extractHint(
  props: Readonly<Record<string, unknown>>,
  kind: HintKind,
  keys: LocationKeys = DEFAULT_KEYS,
): LocationHint {
  const floorRaw = lookup(props, keys.floor);
  const floorInfo = typeof floorRaw === "string" ? parseFloorInfo(floorRaw) : {};
  const rackRaw = lookup(props, keys.rack);
  const rackRef = rackRaw === undefined ? undefined : String(rackRaw);
  const slot =
    kind === "rack"
      ? rackSlot(props, keys, rackRef)
      : defined({ row: asInt(lookup(props, keys.row)), column: asInt(lookup(props, keys.column)) });
  const units = kind === "device" ? deviceUnit(props, keys) : { unitSpan: 1 };
  return {
    floorInfo,
    ...slot,
    ...defined({ unit: units.unit }),
    unitSpan: units.unitSpan,
    ...defined({ rackRef }),
  };
}
