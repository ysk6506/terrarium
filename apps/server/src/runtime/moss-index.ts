/**
 * 이끼의 리포 문서 색인 (REQ-103, ADR-0124). `docs/**` 의 마크다운(`exec-plans` 제외)을 제목(`#`/`##`/`###`) 단위
 * 조각으로 나누고, 한국어·영어 토큰의 BM25 점수로 찾는다. 임베딩도 네트워크도 없다: 서버가 시작할 때 파일을 읽어
 * 메모리에 올릴 뿐이다.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface MossChunk {
  /** `파일#제목-경로` 모양의 고정된 이름. 답의 출처가 이걸 가리킨다. */
  readonly id: string;
  /** 리포 기준 경로, 예: `docs/design-docs/measurement.md`. */
  readonly file: string;
  /** 제목 경로: 문서 제목부터 이 조각의 제목까지. */
  readonly path: readonly string[];
  readonly title: string;
  readonly text: string;
}

export interface MossHit {
  readonly chunk: MossChunk;
  readonly score: number;
  /** 질문의 말(색인에 없는 말은 가장 무겁게) 가운데 이 조각이 가진 몫, 0~1. 엉뚱한 질문은 점수가 높아도 이 몫이 낮아요. */
  readonly coverage: number;
}

/** 이 점수 아래의 가장 좋은 조각은 "찾았다"고 하지 않는다. */
export const LOW_SCORE = 8;
/** 질문의 말 가운데 이만큼은 조각이 가져야 "찾았다"고 해요. 점수만 높고 말이 맞지 않는 엉뚱한 질문을 거른다. */
export const MIN_COVERAGE = 0.25;

/** 이 조각을 근거로 내세워도 되는가. */
export const isRelevant = (hit: MossHit): boolean =>
  hit.score >= LOW_SCORE && hit.coverage >= MIN_COVERAGE;
const TITLE_WEIGHT = 3;
/** 질문의 이웃한 두 낱말("합격 기준")이 조각 글에 그대로 이어서 나올 때마다 얹는 점수. */
const PHRASE_BONUS = 4;
/** 낱말 점수로 뽑은 위쪽 몇 개만 구절로 다시 매긴다. */
const RERANK = 30;

/** 질문의 이웃한 낱말 쌍("합격 기준" → "합격 기준", "합격기준"): 불용어를 빼고 조사를 뗀 낱말끼리. */
function pairsOf(query: string): string[] {
  const words = [...query.toLowerCase().matchAll(WORD)]
    .map((m) => m[0])
    .filter((w) => !STOP_WORDS.has(w) && w.length >= 2)
    .map((w) => stemOf(w) ?? w);
  return words.slice(1).flatMap((w, i) => [`${words[i]} ${w}`, `${words[i]}${w}`]);
}

/** 질문의 말이 조각 제목의 말을 모두 품으면 얹는 점수: 제목으로 부른 조각이 길이에 묻히지 않게 한다. */
const TITLE_BONUS = 5;
const K1 = 1.2;
const B = 0.75;
const HANGUL = /[ㄱ-ㆎ가-힣]/;
const WORD = /[\p{L}\p{N}]+/gu;
/** 질문마다 들어 있어서 아무것도 가르쳐 주지 않는 말과 말끝. */
const STOP_WORDS: ReadonlySet<string> = new Set(
  "어떻게 어떤 무엇 무슨 뭐예요 뭔가요 알려줘 알려 주세요 있나요 있어요 되나요 하나요 인가요 왜 어디 얼마 그리고 그래서 이게 이건 어떻게요 뭐가 뭐에요".split(
    " ",
  ),
);
const STOP_BIGRAMS: ReadonlySet<string> = new Set(
  "나요 예요 에요 해요 어요 아요 니다 습니 까요 인가 가요 거예 건가 은가 는가 줘요 세요 주세 하나 어떻 떻게 무엇 무슨 뭐예 뭔가".split(
    " ",
  ),
);
/** 한 조각의 길이 위쪽 한계(글자). 긴 칸은 줄 경계에서 잘라 같은 제목의 조각 여럿으로 둔다. */
const MAX_CHUNK = 1600;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

const JOSA2 = /(에서|으로|에게|까지|부터|처럼|보다|이나|라고|이다|입니다)$/;
const JOSA1 = /[이가은는을를의에도만로과와]$/;

/** 조사를 뗀 말(없으면 undefined): "테스트를" → "테스트". 질문과 문서가 다른 조사를 써도 만나게 한다. */
function stemOf(word: string): string | undefined {
  const cut = JOSA2.test(word)
    ? word.replace(JOSA2, "")
    : JOSA1.test(word)
      ? word.slice(0, -1)
      : "";
  return cut.length >= 1 && cut.length < word.length ? cut : undefined;
}

/** 소문자로 낮춘 단어, 그리고 한글 단어는 두 글자씩 겹쳐 자른 토막까지. 조사가 붙어도 걸리게 한다. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(WORD)) {
    const word = m[0];
    if (STOP_WORDS.has(word)) continue;
    if (!HANGUL.test(word)) {
      if (word.length >= 2 || /\d/.test(word)) out.push(word);
      continue;
    }
    if (word.length >= 3 || word.length === 1) out.push(word);
    const stem = stemOf(word);
    if (stem && stem.length >= 2) out.push(stem);
    for (let i = 0; i + 1 < word.length; i++) {
      const gram = word.slice(i, i + 2);
      if (!STOP_BIGRAMS.has(gram)) out.push(gram);
    }
  }
  return out;
}

const plain = (s: string) =>
  s
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();

const slug = (s: string) =>
  plain(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

function stripFrontMatter(lines: string[]): { title?: string; body: string[] } {
  if (lines[0] !== "---") return { body: lines };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { body: lines };
  const title = lines
    .slice(1, end)
    .find((l) => l.startsWith("title:"))
    ?.slice(6)
    .trim();
  return { ...(title ? { title: plain(title) } : {}), body: lines.slice(end + 1) };
}

interface Section {
  readonly level: number;
  readonly title: string;
  readonly lines: string[];
}

function sectionsOf(lines: readonly string[], docTitle: string): Section[] {
  const out: Section[] = [{ level: 0, title: docTitle, lines: [] }];
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    const h = fenced ? null : HEADING.exec(line);
    if (h) out.push({ level: (h[1] as string).length, title: plain(h[2] as string), lines: [] });
    else (out[out.length - 1] as Section).lines.push(line);
  }
  return out;
}

/** 줄 경계에서 `max`자 안팎으로 자른다 (표는 행 단위로 잘려요). */
function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const line of text.split("\n")) {
    if (len + line.length > max && cur.length > 0) {
      out.push(cur.join("\n").trim());
      cur = [];
      len = 0;
    }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length > 0) out.push(cur.join("\n").trim());
  return out.filter((p) => p !== "");
}

/** 한 문서를 조각으로. 첫 제목 앞의 글(머리말 뒤)은 문서 제목(`title:`) 아래의 조각이 된다. */
export function chunkMarkdown(file: string, source: string): MossChunk[] {
  const { title: fm, body } = stripFrontMatter(source.replace(/\r\n/g, "\n").split("\n"));
  const sections = sectionsOf(body, fm ?? path.basename(file, ".md"));
  const stack: { level: number; title: string }[] = [];
  const seen = new Map<string, number>();
  const chunks: MossChunk[] = [];
  for (const s of sections) {
    if (s.level > 0) {
      while (stack.length > 0 && (stack.at(-1) as { level: number }).level >= s.level) stack.pop();
      stack.push({ level: s.level, title: s.title });
    }
    const trail = s.level === 0 ? [s.title] : stack.map((x) => x.title);
    const text = s.lines.join("\n").trim();
    if (text === "") continue; // 제목만 있는 칸(아래 소제목이 내용을 가진다)은 인용할 것이 없어요
    const base = `${file}#${slug(trail.at(-1) as string) || "top"}`;
    for (const piece of splitText(text, MAX_CHUNK)) {
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      chunks.push({
        id: n === 1 ? base : `${base}~${n}`,
        file,
        path: trail,
        title: trail.at(-1) as string,
        text: piece,
      });
    }
  }
  return chunks;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

/** 목업 HTML을 마크다운처럼: `<title>`은 문서 제목, `<h1>`~`<h3>`은 제목 줄, 나머지는 태그를 벗긴 글. */
export function htmlToMarkdown(html: string): string {
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const body = html
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, n: string, t: string) => `\n${"#".repeat(Number(n))} ${t.replace(/<[^>]+>/g, "")}\n`,
    )
    .replace(
      /<\/(p|div|li|tr|section|article|header|footer|ul|ol|table|button)>|<br\s*\/?>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");
  return title ? `---\ntitle: ${title}\n---\n${body}` : body;
}

function markdownFiles(dir: string, skip: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip.has(e.name)) out.push(...markdownFiles(p, skip));
    } else if (e.name.endsWith(".md") || (e.name.endsWith(".html") && dir.endsWith("mockups")))
      out.push(p);
  }
  return out;
}

interface Posting {
  readonly doc: number;
  readonly tf: number;
}

export class MossIndex {
  readonly chunks: readonly MossChunk[];
  private readonly byId = new Map<string, MossChunk>();
  private readonly postings = new Map<string, Posting[]>();
  private readonly lengths: number[] = [];
  private readonly titles: ReadonlySet<string>[] = [];
  private avgLength = 1;

  constructor(chunks: readonly MossChunk[]) {
    this.chunks = chunks;
    chunks.forEach((c, doc) => {
      this.byId.set(c.id, c);
      this.add(doc, c);
    });
    this.avgLength = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length);
  }

  get size(): number {
    return this.chunks.length;
  }

  get(id: string): MossChunk | undefined {
    return this.byId.get(id);
  }

  private add(doc: number, c: MossChunk): void {
    const heading = tokenize(c.path.join(" "));
    this.titles[doc] = new Set(tokenize(c.title));
    const where = tokenize(c.file.replace(/^docs\//, "").replace(/\.md$/, ""));
    const tokens = [
      ...tokenize(c.text),
      ...where,
      ...Array.from({ length: TITLE_WEIGHT }, () => heading).flat(),
    ];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, n] of tf) {
      const list = this.postings.get(term) ?? [];
      list.push({ doc, tf: n });
      this.postings.set(term, list);
    }
    this.lengths[doc] = tokens.length;
  }

  /** 낱말 점수 위쪽 `RERANK`개에, 질문의 이웃한 낱말 쌍이 글에 이어서 나오면 점수를 얹는다. */
  private rerank(scores: Map<number, number>, pairs: readonly string[]): void {
    if (pairs.length === 0) return;
    const top = [...scores].sort((a, b) => b[1] - a[1]).slice(0, RERANK);
    for (const [doc, score] of top) {
      const c = this.chunks[doc] as MossChunk;
      const text = `${c.path.join(" ")} ${c.text}`.toLowerCase();
      const hits = pairs.filter((p) => text.includes(p)).length;
      if (hits > 0) scores.set(doc, score + PHRASE_BONUS * Math.min(hits, 3));
    }
  }

  /** BM25 점수가 높은 조각부터 k개. 점수가 0인 조각은 나오지 않는다. */
  search(query: string, k = 3): MossHit[] {
    const terms = [...new Set(tokenize(query))];
    const n = this.chunks.length;
    const scores = new Map<number, number>();
    const matched = new Map<number, number>();
    const unseen = Math.log(1 + (n + 0.5) / 0.5);
    let total = 0;
    for (const term of terms) {
      const list = this.postings.get(term);
      if (!list) {
        total += unseen;
        continue;
      }
      const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
      total += idf;
      for (const { doc, tf } of list) {
        const len = this.lengths[doc] as number;
        const part = (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / this.avgLength));
        scores.set(doc, (scores.get(doc) ?? 0) + idf * part);
        matched.set(doc, (matched.get(doc) ?? 0) + idf);
      }
    }
    const asked = new Set(terms);
    for (const [doc, score] of scores) {
      const title = this.titles[doc] as ReadonlySet<string>;
      if (title.size > 0 && [...title].every((t) => asked.has(t)))
        scores.set(doc, score + TITLE_BONUS);
    }
    this.rerank(scores, pairsOf(query));
    return [...scores]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, k)
      .map(([doc, score]) => ({
        chunk: this.chunks[doc] as MossChunk,
        score,
        coverage: total === 0 ? 0 : Math.min(1, (matched.get(doc) ?? 0) / total),
      }));
  }
}

const SKIPPED_DIRS: ReadonlySet<string> = new Set(["exec-plans"]);

/** `docsDir`(보통 리포의 `docs`) 아래 마크다운을 모두 읽어 색인한다. 파일 이름은 `repoRoot` 기준으로 적는다. */
export function buildMossIndex(docsDir: string, repoRoot = path.dirname(docsDir)): MossIndex {
  const chunks = markdownFiles(docsDir, SKIPPED_DIRS).flatMap((abs) =>
    chunkMarkdown(
      path.relative(repoRoot, abs).split(path.sep).join("/"),
      abs.endsWith(".html") ? htmlToMarkdown(readFileSync(abs, "utf8")) : readFileSync(abs, "utf8"),
    ),
  );
  return new MossIndex(chunks);
}

/** `TERRARIUM_DOCS_DIR`, 아니면 이 파일에서 위로 올라가며 `docs/index.md`가 있는 곳. 없으면 undefined. */
export function findDocsDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.TERRARIUM_DOCS_DIR) return env.TERRARIUM_DOCS_DIR;
  let dir = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "docs");
    try {
      readFileSync(path.join(candidate, "index.md"));
      return candidate;
    } catch {
      dir = path.dirname(dir);
    }
  }
  return undefined;
}

const cache = new Map<string, MossIndex>();

/** 같은 폴더는 한 번만 읽는다(테스트가 플랫폼을 여러 번 만들어도 색인은 한 번). */
export function mossIndexFor(docsDir: string | undefined): MossIndex {
  if (!docsDir) return new MossIndex([]);
  const hit = cache.get(docsDir);
  if (hit) return hit;
  const built = buildMossIndex(docsDir);
  cache.set(docsDir, built);
  return built;
}
