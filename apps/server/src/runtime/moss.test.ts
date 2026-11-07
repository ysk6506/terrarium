import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { UnavailableError } from "@terrarium/core/contract";
import { type LlmClient, LlmError } from "@terrarium/core/llm";
import { afterEach, describe, expect, test } from "vitest";
import type { Models } from "./models";
import { Moss } from "./moss";
import {
  buildMossIndex,
  chunkMarkdown,
  findDocsDir,
  htmlToMarkdown,
  isRelevant,
  MossIndex,
  mossIndexFor,
  tokenize,
} from "./moss-index";
import {
  firstSentences,
  hasState,
  NOT_IN_DOCS,
  parseReply,
  stateText,
  userPrompt,
} from "./moss-prompt";

const DOC = `---
title: 측정의 신뢰
kind: spec
---
머리말 문단이에요.

# 측정의 신뢰

## 효율 점수
효율 점수는 과제를 푼 만큼만 줘요. 풀지 못하면 빨리 끝내도 0점이에요.

### 기준선 에이전트
시험지는 아무것도 안 하는 에이전트로 점검해요.

\`\`\`
# 코드 안의 줄은 제목이 아니에요
\`\`\`

## 비어 있는 칸
### 소제목
내용
`;

describe("the docs index cuts markdown into chunks by heading [REQ-103]", () => {
  const chunks = chunkMarkdown("docs/design-docs/measurement.md", DOC);

  test("each chunk has a file, a heading path and a stable id; empty headings make no chunk; code fences hide headings", () => {
    expect(chunks.map((c) => c.path)).toEqual([
      ["측정의 신뢰"],
      ["측정의 신뢰", "효율 점수"],
      ["측정의 신뢰", "효율 점수", "기준선 에이전트"],
      ["측정의 신뢰", "비어 있는 칸", "소제목"],
    ]);
    expect(chunks[1]?.id).toBe("docs/design-docs/measurement.md#효율-점수");
    expect(chunks[2]?.text).toContain("코드 안의 줄은 제목이 아니에요");
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  test("a long section is cut at line boundaries into chunks that share one title, with distinct ids", () => {
    const long = `# 문서\n## 긴 칸\n${Array.from({ length: 80 }, (_, i) => `줄 ${i} ${"가나다라마바사 ".repeat(20)}`).join("\n")}\n`;
    const parts = chunkMarkdown("docs/a.md", long).filter((c) => c.title === "긴 칸");
    expect(parts.length).toBeGreaterThan(2);
    expect(new Set(parts.map((c) => c.id)).size).toBe(parts.length);
    expect(parts.every((c) => c.text.length < 2200)).toBe(true);
  });

  test("tokens are Korean words with their two-letter pieces and the stem without a particle, and English words", () => {
    const t = tokenize("테스트를 잠가요, Redfish API");
    expect(t).toEqual(expect.arrayContaining(["테스트를", "테스트", "redfish", "api", "스트"]));
    expect(tokenize("어떻게 뭐예요")).toEqual([]);
  });

  test("search ranks the chunk whose title and text match, and returns nothing for words no chunk has", () => {
    const index = new MossIndex(chunks);
    expect(index.search("효율 점수는 왜 0점이에요?", 2)[0]?.chunk.title).toBe("효율 점수");
    expect(index.search("zzzz qqqq", 3)).toEqual([]);
    expect(index.get(chunks[0]?.id ?? "")?.title).toBe("측정의 신뢰");
  });
});

describe("the docs folder: exec-plans are skipped, a missing folder is an empty index [REQ-103]", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const repo = () => {
    const root = mkdtempSync(path.join(tmpdir(), "moss-"));
    made.push(root);
    mkdirSync(path.join(root, "docs", "exec-plans"), { recursive: true });
    writeFileSync(path.join(root, "docs", "index.md"), "# 색인\n처음이에요.\n");
    writeFileSync(path.join(root, "docs", "exec-plans", "plan.md"), "# 계획\n비밀 계획이에요.\n");
    return root;
  };

  test("only docs outside exec-plans are indexed, with repo-relative file names; the index is shared per folder", () => {
    const root = repo();
    const index = buildMossIndex(path.join(root, "docs"));
    expect(index.chunks.map((c) => c.file)).toEqual(["docs/index.md"]);
    expect(mossIndexFor(path.join(root, "docs"))).toBe(mossIndexFor(path.join(root, "docs")));
    expect(mossIndexFor(undefined).size).toBe(0);
  });

  test("the docs folder comes from TERRARIUM_DOCS_DIR, else from the repo", () => {
    expect(findDocsDir({ TERRARIUM_DOCS_DIR: "/x/docs" })).toBe("/x/docs");
    expect(findDocsDir({})?.endsWith("docs")).toBe(true);
  });
});

describe("the prompt and the reply [REQ-103]", () => {
  const chunk = {
    id: "docs/a.md#가",
    file: "docs/a.md",
    path: ["A", "가"],
    title: "가",
    text: "가는 나예요.",
  };

  test("the prompt carries chunks with their ids, the screen state, the allowed actions and the question", () => {
    const text = userPrompt({
      screen: "run",
      question: "왜 30점이에요?",
      state: { 점수: "30점" },
      chunks: [chunk],
      actions: [{ id: "run-read-scores", label: "점수표 읽어 주기" }],
    });
    expect(text).toContain("[docs/a.md#가] A › 가");
    expect(text).toContain('"점수":"30점"');
    expect(text).toContain("- run-read-scores: 점수표 읽어 주기");
    expect(text).toContain("왜 30점이에요?");
    expect(
      userPrompt({ screen: "home", question: "?", state: {}, chunks: [], actions: [] }),
    ).toContain("찾지 못했어요");
  });

  test("a state that is too long is cut and says so; emptiness is detected", () => {
    expect(stateText({ x: "가".repeat(20_000) })).toContain("줄였어요");
    expect(stateText(undefined)).toBe("{}");
    expect([hasState(undefined), hasState({}), hasState({ a: 1 }), hasState(3)]).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  test("a good JSON reply keeps at most three sentences; made-up sources and actions are dropped; fenced JSON works", () => {
    const reply =
      "```json\n" +
      JSON.stringify({
        answer: "하나예요. 둘이에요. 셋이에요. 넷이에요.",
        sources: ["docs/a.md#가", "docs/zzz.md#없음", "state"],
        suggestedActions: ["run-read-scores", "delete-everything"],
        followUps: ["다음은요?"],
      }) +
      "\n```";
    const parsed = parseReply(reply, [chunk], ["run-read-scores"]);
    expect(parsed.answer).toBe("하나예요. 둘이에요. 셋이에요.");
    expect(parsed.sources).toEqual([
      { kind: "doc", id: "docs/a.md#가", title: "가", file: "docs/a.md", path: ["A", "가"] },
      { kind: "state" },
    ]);
    expect(parsed.suggestedActions).toEqual(["run-read-scores"]);
    expect(parsed.followUps).toEqual(["다음은요?"]);
    expect(parsed.rough).toBe(false);
  });

  test("a reply that is not JSON is cut to three sentences with no sources and flagged rough", () => {
    const parsed = parseReply("그냥 글이에요. 두 번째. 세 번째. 네 번째.", [chunk], []);
    expect(parsed).toMatchObject({
      answer: "그냥 글이에요. 두 번째. 세 번째.",
      sources: [],
      rough: true,
    });
    expect(parseReply("", [], []).answer).toBe(NOT_IN_DOCS);
    expect(firstSentences("끝")).toBe("끝");
  });
});

describe("이끼 asks the default model and never acts [REQ-103]", () => {
  const index = new MossIndex(chunkMarkdown("docs/design-docs/measurement.md", DOC));
  const models = (text: string | Error | undefined, seen: string[] = []): Models =>
    ({
      defaultClient: async () =>
        text === undefined
          ? undefined
          : {
              name: "작은 모델",
              client: {
                complete: async (req: { messages: { content: string }[] }) => {
                  seen.push(req.messages[0]?.content ?? "");
                  if (text instanceof Error) throw text;
                  return { text };
                },
              } as unknown as LlmClient,
            },
    }) as unknown as Models;
  const body = {
    screen: "home",
    question: "효율 점수는 왜 0점이에요?",
    state: {},
    actions: [{ id: "go-home", label: "홈으로 가기" }],
  };

  test("with no default model it says so (503) instead of guessing", async () => {
    await expect(new Moss(models(undefined), { index }).ask(body)).rejects.toBeInstanceOf(
      UnavailableError,
    );
  });

  test("with chunks found the model gets them, and the answer carries its sources", async () => {
    const seen: string[] = [];
    const reply = JSON.stringify({
      answer: "풀지 못하면 0점이에요.",
      sources: [index.chunks[1]?.id],
      suggestedActions: ["go-home"],
      followUps: ["기준선은요?"],
    });
    const view = await new Moss(models(reply, seen), { index }).ask(body);
    expect(seen[0]).toContain("효율 점수는 과제를 푼 만큼만 줘요");
    expect(view).toMatchObject({
      answered: true,
      model: "작은 모델",
      suggestedActions: ["go-home"],
    });
    expect(view.sources[0]).toMatchObject({ kind: "doc", title: "효율 점수" });
  });

  test("when nothing in the docs and nothing on the screen fits, the model is not asked and the answer says 문서에 없어요", async () => {
    const seen: string[] = [];
    const view = await new Moss(models("{}", seen), { index }).ask({
      ...body,
      question: "zzzz qqqq",
    });
    expect(seen).toEqual([]);
    expect(view).toMatchObject({ answered: false, sources: [] });
    expect(view.answer).toContain(NOT_IN_DOCS);
  });

  test("a model that fails is a 503 with its reason; a reply that cites nothing is not counted as answered", async () => {
    await expect(
      new Moss(models(new LlmError("timeout", "시간이 지났어요")), { index }).ask(body),
    ).rejects.toBeInstanceOf(UnavailableError);
    const view = await new Moss(models(JSON.stringify({ answer: "모르겠어요.", sources: [] })), {
      index,
    }).ask(body);
    expect(view.answered).toBe(false);
  });
});

describe("mockup pages are read as text, and off-topic questions are not 'found' [REQ-103]", () => {
  test("html becomes headings and text: title, h1-h3, no scripts or tags", () => {
    const md = htmlToMarkdown(
      "<html><head><title>목업</title><style>a{}</style></head><body><h2>3. 이끼 <b>질문</b></h2><p>작은 &quot;?&quot; 를 누르면</p><script>alert(1)</script></body></html>",
    );
    expect(md).toContain("title: 목업");
    expect(md).toContain("## 3. 이끼 질문");
    expect(md).toContain('작은 "?" 를 누르면');
    expect(md).not.toContain("alert");
    const chunks = chunkMarkdown("docs/design-docs/mockups/m.html", md);
    expect(chunks.some((c) => c.title === "3. 이끼 질문")).toBe(true);
  });

  test("coverage is the share of the question's words a chunk holds; unknown words weigh most", () => {
    const index = new MossIndex(chunkMarkdown("docs/a.md", DOC));
    const on = index.search("효율 점수", 1)[0];
    const off = index.search("효율 점수 김치찌개 양자 컴퓨터", 1)[0];
    expect(on?.coverage).toBeGreaterThan(0.9);
    expect(on && isRelevant({ ...on, score: 20 })).toBe(true);
    expect(off && isRelevant({ ...off, score: 20 })).toBe(false);
    expect(off && off.coverage < (on?.coverage ?? 0)).toBe(true);
  });
});
