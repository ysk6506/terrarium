/** Size and complexity measurements for the debt check (DEBT020-DEBT023). */
import { complexity, functions, parse } from "../ts-ast";

export interface Limits {
  readonly max_file_lines: number;
  readonly max_function_lines: number;
  readonly max_complexity: number;
  readonly max_params: number;
}

export interface Measure {
  /** Stable key used by the ratchet baseline: `file::qualname::kind`. */
  readonly key: string;
  readonly code: string;
  readonly value: number;
  readonly limit: number;
  readonly path: string;
  readonly line: number;
  readonly what: string;
}

/** Every limit a file exceeds. */
export function measureFile(file: string, text: string, limits: Limits): Measure[] {
  const out: Measure[] = [];
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (lines > limits.max_file_lines) {
    out.push({
      key: `${file}::<file>::lines`,
      code: "DEBT020",
      value: lines,
      limit: limits.max_file_lines,
      path: file,
      line: 1,
      what: "file length (lines)",
    });
  }
  for (const fn of functions(parse(file, text))) {
    const checks: Array<[string, string, number, number, string]> = [
      ["DEBT021", "lines", fn.lines, limits.max_function_lines, "function length (lines)"],
      [
        "DEBT022",
        "complexity",
        complexity(fn.node),
        limits.max_complexity,
        "cyclomatic complexity",
      ],
      ["DEBT023", "params", fn.params, limits.max_params, "parameter count"],
    ];
    for (const [code, kind, value, limit, label] of checks) {
      if (value > limit) {
        out.push({
          key: `${file}::${fn.qualname}::${kind}`,
          code,
          value,
          limit,
          path: file,
          line: fn.line,
          what: `${label} of ${fn.qualname}`,
        });
      }
    }
  }
  return out;
}
