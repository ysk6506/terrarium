/** Reading the files a command was given, with the error messages of the real tools. */
import { normalize } from "./fs";
import type { Cmd } from "./types";

export interface Input {
  readonly name: string;
  readonly text: string;
}

export interface Inputs {
  readonly inputs: Input[];
  /** Error lines (without newline) for files that could not be read. */
  readonly errors: string[];
}

/** The text of each file argument, or of stdin when there are none (or the argument is `-`). */
export function readInputs(c: Cmd, files: readonly string[]): Inputs {
  if (files.length === 0) return { inputs: [{ name: "-", text: c.stdin }], errors: [] };
  const inputs: Input[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (f === "-") {
      inputs.push({ name: "-", text: c.stdin });
      continue;
    }
    const path = normalize(c.cwd, f);
    if (c.fs.isDir(path)) errors.push(`${c.name}: ${f}: Is a directory`);
    else {
      const text = c.fs.read(path);
      if (text === undefined) errors.push(`${c.name}: ${f}: No such file or directory`);
      else inputs.push({ name: f, text });
    }
  }
  return { inputs, errors };
}

export const errText = (errors: readonly string[]): string =>
  errors.length === 0 ? "" : `${errors.join("\n")}\n`;
