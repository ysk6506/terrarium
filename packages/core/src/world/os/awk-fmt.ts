/** `printf`-style formatting and number-to-string conversion for the small `awk`. */

/** A number the way awk prints it (`%.6g`, integers whole). */
export function numToStr(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  if (!Number.isFinite(n)) return Number.isNaN(n) ? "nan" : n > 0 ? "inf" : "-inf";
  return String(Number(n.toPrecision(6)));
}

function pad(text: string, width: number, left: boolean, zero: boolean): string {
  if (text.length >= width) return text;
  if (left) return text.padEnd(width);
  if (zero) {
    const sign = /^[+-]/.test(text) ? text.charAt(0) : "";
    return sign + text.slice(sign.length).padStart(width - sign.length, "0");
  }
  return text.padStart(width);
}

export interface Spec {
  readonly flags: string;
  readonly width: number;
  readonly prec: number | undefined;
  readonly conv: string;
}

type Conv = (spec: Spec, num: number, str: string) => string;

const signed = (spec: Spec, num: number, s: string): string =>
  num >= 0 && spec.flags.includes("+")
    ? `+${s}`
    : num >= 0 && spec.flags.includes(" ")
      ? ` ${s}`
      : s;

const integer: Conv = (spec, num) => signed(spec, num, String(Math.trunc(num)));
const radix =
  (base: number, upper = false): Conv =>
  (_spec, num) => {
    const text = Math.trunc(num).toString(base);
    return upper ? text.toUpperCase() : text;
  };

const CONVERSIONS: Readonly<Record<string, Conv>> = {
  d: integer,
  i: integer,
  f: (spec, num) => signed(spec, num, num.toFixed(spec.prec ?? 6)),
  e: (spec, num) =>
    signed(spec, num, num.toExponential(spec.prec ?? 6).replace(/e([+-])(\d)$/, "e$10$2")),
  g: (spec, num) => signed(spec, num, numToStr(num)),
  x: radix(16),
  X: radix(16, true),
  o: radix(8),
  c: (_spec, num, str) =>
    Number.isNaN(Number(str)) || str === "" ? str.charAt(0) : String.fromCharCode(num),
};

function convert(spec: Spec, num: number, str: string): string {
  const f = CONVERSIONS[spec.conv];
  if (f) return f(spec, num, str);
  return spec.prec === undefined ? str : str.slice(0, spec.prec);
}

/** `sprintf(fmt, args...)`; `toNum` and `toStr` convert the arguments. */
export function sprintf<V>(
  fmt: string,
  args: readonly V[],
  toNum: (v: V) => number,
  toStr: (v: V) => string,
): string {
  let i = 0;
  return fmt.replace(
    /%([-+ 0#]*)(\d*)(?:\.(\d+))?([diouxXeEfgGcs%])/g,
    (_m, flags: string, width: string, prec: string | undefined, conv: string) => {
      if (conv === "%") return "%";
      const a = args[i++];
      const num = a === undefined ? 0 : toNum(a);
      const str = a === undefined ? "" : toStr(a);
      const text = convert(
        {
          flags,
          width: Number(width || 0),
          prec: prec === undefined ? undefined : Number(prec),
          conv: conv === "E" ? "e" : conv === "G" ? "g" : conv,
        },
        num,
        str,
      );
      return pad(
        text,
        Number(width || 0),
        flags.includes("-"),
        flags.includes("0") && conv !== "s" && conv !== "c",
      );
    },
  );
}
