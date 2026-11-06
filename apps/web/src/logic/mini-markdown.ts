/**
 * A small reader for the guides the app shows (headings, paragraphs, lists, tables, code blocks, `code` and **bold**).
 * The guides are written in this subset on purpose; anything else is shown as plain text, never dropped.
 */
export type Inline = { readonly text: string; readonly code?: boolean; readonly bold?: boolean };

export type Block =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "para"; readonly text: string }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: "code"; readonly text: string }
  | {
      readonly kind: "table";
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

/** The front matter between the first two `---` lines, cut off. */
function body(source: string): string[] {
  const lines = source.split("\n");
  if (lines[0] !== "---") return lines;
  const end = lines.indexOf("---", 1);
  return end < 0 ? lines : lines.slice(end + 1);
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

const isRule = (line: string) => /^\s*\|?\s*:?-{3,}/.test(line);
const isBullet = (line: string) => /^\s*(?:[-*]|\d+\.)\s+/.test(line);

/** One block and the line to read from next. */
type Read = readonly [Block, number];

function readCode(lines: readonly string[], i: number): Read {
  const end = lines.findIndex((l, k) => k > i && l.startsWith("```"));
  const stop = end < 0 ? lines.length : end;
  return [{ kind: "code", text: lines.slice(i + 1, stop).join("\n") }, stop + 1];
}

function readTable(lines: readonly string[], i: number): Read {
  const rows: string[][] = [];
  let k = i + 2;
  while (k < lines.length && (lines[k] as string).trim().startsWith("|")) {
    rows.push(cells(lines[k] as string));
    k++;
  }
  return [{ kind: "table", head: cells(lines[i] as string), rows }, k];
}

function readList(lines: readonly string[], i: number): Read {
  const ordered = /^\s*\d+\./.test(lines[i] as string);
  const items: string[] = [];
  let k = i;
  while (k < lines.length && isBullet(lines[k] as string)) {
    items.push((lines[k] as string).replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
    k++;
  }
  return [{ kind: "list", ordered, items }, k];
}

const endsPara = (line: string) =>
  line.trim() === "" || line.startsWith("```") || /^#{1,4}\s/.test(line) || isBullet(line);

function readPara(lines: readonly string[], i: number): Read {
  const para: string[] = [];
  let k = i;
  while (k < lines.length && !endsPara(lines[k] as string)) {
    para.push((lines[k] as string).trim());
    k++;
  }
  return [{ kind: "para", text: para.join(" ") }, Math.max(k, i + 1)];
}

function readBlock(lines: readonly string[], i: number): Read {
  const line = lines[i] as string;
  const heading = /^(#{1,4})\s+(.*)$/.exec(line);
  if (line.startsWith("```")) return readCode(lines, i);
  if (heading)
    return [
      { kind: "heading", level: (heading[1] as string).length, text: heading[2] as string },
      i + 1,
    ];
  if (line.trim().startsWith("|") && isRule(lines[i + 1] ?? "")) return readTable(lines, i);
  return isBullet(line) ? readList(lines, i) : readPara(lines, i);
}

export function parseMarkdown(source: string): Block[] {
  const lines = body(source);
  const out: Block[] = [];
  for (let i = 0; i < lines.length; ) {
    if ((lines[i] as string).trim() === "") {
      i++;
      continue;
    }
    const [block, next] = readBlock(lines, i);
    out.push(block);
    i = next;
  }
  return out;
}

/** `code` and **bold** runs of a line of text. */
export function inline(text: string): Inline[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter((p) => p !== "")
    .map((p): Inline => {
      if (p.startsWith("`") && p.endsWith("`") && p.length > 2)
        return { text: p.slice(1, -1), code: true };
      if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
        return { text: p.slice(2, -2), bold: true };
      return { text: p };
    });
}

/** The title in the front matter, for the page head. */
export function titleOf(source: string): string | undefined {
  return /^title:\s*(.+)$/m.exec(source.split("\n---")[0] ?? "")?.[1]?.trim();
}
