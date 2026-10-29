/**
 * Request validation that speaks to people (REQ-041 usable): every problem comes back in Korean,
 * with the path of the field that is wrong, so a form can put the message right next to it.
 */
import { josa } from "@terrarium/core/kernel";
import {
  type output,
  type ZodErrorMap,
  type ZodIssue,
  ZodIssueCode,
  type ZodIssueOptionalMessage,
  type ZodTypeAny,
} from "zod";

const TYPE_NAMES: Readonly<Record<string, string>> = {
  string: "문자열",
  number: "숫자",
  integer: "정수",
  float: "소수",
  boolean: "참/거짓",
  object: "객체",
  array: "목록",
  null: "null",
  undefined: "값 없음",
  nan: "NaN",
  bigint: "큰 정수",
  date: "날짜",
  symbol: "심볼",
  function: "함수",
};

const typeName = (t: string) => TYPE_NAMES[t] ?? t;
/** "문자열이어야" / "숫자여야". */
const mustBe = (word: string) => `${word}${josa(word, "이다") === "이다" ? "이어야" : "여야"}`;
const list = (xs: readonly unknown[]) => xs.map((x) => `'${String(x)}'`).join(", ");

type SizedIssue = Extract<ZodIssueOptionalMessage, { code: "too_small" | "too_big" }>;

const SIZE_UNITS: Readonly<Record<string, string>> = { string: "자", array: "개", set: "개" };
/** [inclusive, exclusive] wording for each direction. */
const SIZE_RULES = {
  too_small: [` ${mustBe("이상")} 한다`, "보다 커야 한다"],
  too_big: [` ${mustBe("이하")} 한다`, "보다 작아야 한다"],
} as const;

function sizeMessage(issue: SizedIssue): string {
  const small = issue.code === ZodIssueCode.too_small;
  const limit = Number(small ? issue.minimum : issue.maximum);
  if (issue.type === "string" && small && limit === 1 && issue.inclusive)
    return "비어 있으면 안 된다";
  const [inclusive, exclusive] = SIZE_RULES[issue.code];
  return `${limit}${SIZE_UNITS[issue.type] ?? ""}${issue.inclusive ? inclusive : exclusive}`;
}

function typeMessage(issue: Extract<ZodIssueOptionalMessage, { code: "invalid_type" }>): string {
  if (issue.received === "undefined") return "필요한 값이 없다";
  const received = typeName(issue.received);
  return `${mustBe(typeName(issue.expected))} 하는데 ${received}${josa(received, "이다")}`;
}

/** Korean messages for every issue zod can raise. */
export const koreanErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      return { message: typeMessage(issue) };
    case ZodIssueCode.too_small:
    case ZodIssueCode.too_big:
      return { message: sizeMessage(issue) };
    case ZodIssueCode.invalid_enum_value:
      return {
        message: `${list(issue.options)} 중 하나여야 한다 ('${String(issue.received)}'${josa(String(issue.received), "은")} 없다)`,
      };
    case ZodIssueCode.invalid_union_discriminator:
      return { message: `종류는 ${list(issue.options)} 중 하나여야 한다` };
    case ZodIssueCode.invalid_literal:
      return { message: `'${String(issue.expected)}'만 쓸 수 있다` };
    case ZodIssueCode.unrecognized_keys:
      return { message: `모르는 항목이 있다: ${list(issue.keys)}` };
    case ZodIssueCode.invalid_string:
      return { message: "형식이 맞지 않는다" };
    case ZodIssueCode.not_finite:
      return { message: "유한한 숫자여야 한다" };
    case ZodIssueCode.not_multiple_of:
      return { message: `${String(issue.multipleOf)}의 배수여야 한다` };
    case ZodIssueCode.invalid_union:
      return { message: "어느 형식에도 맞지 않는다" };
    default:
      return { message: ctx.defaultError };
  }
};

export interface ApiIssue {
  /** Dotted path of the field, e.g. "recipe.seeds.2"; empty for the whole body. */
  readonly path: string;
  readonly message: string;
}

export const pathOf = (path: readonly (string | number)[]): string => path.join(".");

export function issuesOf(issues: readonly ZodIssue[]): ApiIssue[] {
  return issues.map((i) => ({ path: pathOf(i.path), message: i.message }));
}

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ApiIssue[] };

/** Parse with Korean messages; never throws. */
export function parseWith<S extends ZodTypeAny>(schema: S, data: unknown): Parsed<output<S>> {
  const r = schema.safeParse(data, { errorMap: koreanErrorMap });
  return r.success ? { ok: true, value: r.data } : { ok: false, issues: issuesOf(r.error.issues) };
}
