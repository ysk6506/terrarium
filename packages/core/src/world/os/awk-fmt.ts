/** `printf`-style formatting and number-to-string conversion for the small `awk`. */

const withTwoDigitExponent = (s: string): string => s.replace(/e([+-])(\d)$/, "e$10$2");

/** `%.{prec}g` the way C writes it: the shorter of fixed and exponent form, trailing zeros dropped. */
export function formatG(n: number, prec = 6): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? "nan" : n > 0 ? "inf" : "-inf";
  if (n === 0) return Object.is(n, -0) ? "-0" : "0";
  const digits = Math.max(1, prec);
  const exponent = Number(n.toExponential(digits - 1).split("e")[1]);
  if (exponent < -4 || exponent >= digits) {
    const [mantissa, power] = n.toExponential(digits - 1).split("e");
    const trimmed = (mantissa as string).includes(".")
      ? (mantissa as string).replace(/\.?0+$/, "")
      : (mantissa as string);
    return withTwoDigitExponent(`${trimmed}e${power}`);
  }
  const fixed = n.toFixed(Math.max(0, digits - 1 - exponent));
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

/** A number the way awk prints it (`%.6g`, integers whole). */
export function numToStr(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  return formatG(n, 6);
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
  e: (spec, num) => signed(spec, num, withTwoDigitExponent(num.toExponential(spec.prec ?? 6))),
  E: (spec, num, str) => (CONVERSIONS.e as Conv)(spec, num, str).toUpperCase(),
  g: (spec, num) => signed(spec, num, formatG(num, spec.prec ?? 6)),
  G: (spec, num, str) => (CONVERSIONS.g as Conv)(spec, num, str).toUpperCase(),
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

/** `sprintf(fmt, args...)`; `toNum` and `toStr` convert the arguments. A `*` width or precision takes the next argument. */
export function sprintf<V>(
  fmt: string,
  args: readonly V[],
  toNum: (v: V) => number,
  toStr: (v: V) => string,
): string {
  let i = 0;
  const next = (): V | undefined => args[i++];
  return fmt.replace(
    /%([-+ 0#]*)(\*|\d*)(?:\.(\*|\d+))?([diouxXeEfgGcs%])/g,
    (_m, given: string, w: string, p: string | undefined, conv: string) => {
      if (conv === "%") return "%";
      const star = (x: string | undefined): number | undefined =>
        x === "*" ? toNum(next() as V) : x === undefined ? undefined : Number(x || 0);
      let width = star(w) ?? 0;
      const prec = star(p);
      const flags = width < 0 ? `${given}-` : given;
      width = Math.abs(width);
      const a = next();
      const num = a === undefined ? 0 : toNum(a);
      const str = a === undefined ? "" : toStr(a);
      const text = convert({ flags, width, prec, conv }, num, str);
      return pad(
        text,
        width,
        flags.includes("-"),
        flags.includes("0") && conv !== "s" && conv !== "c",
      );
    },
  );
}
