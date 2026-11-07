import { describe, expect, it } from "vitest";
import { BAR_VAR, barHeight, launcherBottom } from "./bar-offset";

interface Glob {
  glob(
    patterns: string[],
    options: { query: string; import: string; eager: true },
  ): Record<string, string>;
}

/** The source of the files the layout depends on (vite hands them over as text). */
const FILES = (import.meta as unknown as Glob).glob(
  [
    "../styles.css",
    "../ui/pages/shape-screen.tsx",
    "../ui/builder/StepBar.tsx",
    "../ui/pages/new-experiment.tsx",
    "./ask.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);
interface Fs {
  readFileSync(path: URL, encoding: "utf8"): string;
}
/** vitest blanks every `.css` module, even with ?raw, so the style sheet is read from disk. */
const readCss = (): string => {
  const proc = process as unknown as { getBuiltinModule(name: string): Fs };
  return proc
    .getBuiltinModule("node:fs")
    .readFileSync(new URL("../styles.css", import.meta.url), "utf8");
};
const src = (rel: string) => FILES[`../${rel}`] ?? FILES[`./${rel.replace("moss/", "")}`] ?? "";

describe("이끼 버튼과 아래 막대 [REQ-104]", () => {
  it("[REQ-104] 막대가 없으면 제자리(22px), 있으면 막대 높이 + 16px 위에 선다", () => {
    expect(launcherBottom(0)).toBe(22);
    expect(launcherBottom(68)).toBe(84);
    expect(launcherBottom(56)).toBe(72);
  });

  it("[REQ-104] 막대가 둘이면 가장 높은 것을 따른다", () => {
    expect(barHeight([])).toBe(0);
    expect(barHeight([56.4, 68.2])).toBe(68);
  });

  it("[REQ-104] CSS가 변수를 읽고, 세 막대가 모두 data-bottom-bar를 단다", () => {
    const css = readCss();
    expect(css).toContain(`calc(var(${BAR_VAR}, 0px) + 16px)`);
    expect(css).toMatch(/\.moss-launch\s*\{[^}]*bottom: max\(22px/);
    expect(src("ui/pages/shape-screen.tsx")).toContain("data-bottom-bar");
    expect(src("ui/builder/StepBar.tsx")).toContain("data-bottom-bar");
    expect(src("ui/pages/new-experiment.tsx")).toContain("data-bottom-bar");
  });

  it("[REQ-104] 물음표는 올려 보거나 초점이 갈 때만 보이고, 화면 읽기 이름은 남는다", () => {
    const css = readCss();
    expect(css).toMatch(/\.moss-q\s*\{\s*opacity: 0;/);
    expect(css).toContain(".moss-ask:hover .moss-q");
    expect(css).toContain(".moss-ask:focus-within .moss-q");
    expect(css).toContain(".moss-q:focus-visible");
    expect(src("moss/ask.tsx")).toContain("aria-label={`이끼에게 묻기");
  });
});
