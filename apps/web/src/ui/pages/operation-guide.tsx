/**
 * The guide for people who build an agent for operation mode (REQ-090, ADR-0094 item 6): the same text as
 * `docs/guides/operation-agent-guide.md`, shown inside the app so the connection screen can lead straight to it.
 */

import { Fragment } from "react";
import { miniMarkdown } from "../../logic";
import { Go, useAsync, usePageTitle } from "../context";
import { Failure, Loading, PageHead } from "../kit";

const { inline, parseMarkdown, titleOf } = miniMarkdown;
type Block = miniMarkdown.Block;
const TITLE = "운영 에이전트 설계 가이드";
/** The guide is the markdown file in docs/guides, served as a static file (a link in the web app's public folder). */
const GUIDE_URL = "/operation-agent-guide.md";

function Text({ text }: { readonly text: string }) {
  return (
    <>
      {inline(text).map((p, i) => (
        // the runs of one line never reorder, so the position is the identity
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed text
        <Fragment key={i}>
          {p.code ? <code>{p.text}</code> : p.bold ? <b>{p.text}</b> : p.text}
        </Fragment>
      ))}
    </>
  );
}

function Part({ block }: { readonly block: Block }) {
  switch (block.kind) {
    case "heading":
      return block.level === 1 ? null : block.level === 2 ? (
        <h2 style={{ marginTop: 28 }}>{block.text}</h2>
      ) : (
        <h3 style={{ marginTop: 18 }}>{block.text}</h3>
      );
    case "para":
      return (
        <p>
          <Text text={block.text} />
        </p>
      );
    case "code":
      return (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            margin: 0,
            padding: "12px 14px",
            borderRadius: 12,
            background: "var(--surface-2, var(--line))",
            fontSize: 13,
          }}
        >
          <code>{block.text}</code>
        </pre>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="small" style={{ paddingLeft: 20, display: "grid", gap: 4 }}>
          {block.items.map((item) => (
            <li key={item}>
              <Text text={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {block.head.map((h) => (
                  <th key={h}>
                    <Text text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell) => (
                    <td key={cell}>
                      <Text text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function OperationGuidePage() {
  const guide = useAsync(async (signal) => {
    const r = await fetch(GUIDE_URL, { signal });
    if (!r.ok) throw new Error(`가이드를 불러오지 못했어요 (${r.status})`);
    return r.text();
  }, []);
  const title = (guide.data && titleOf(guide.data)) ?? TITLE;
  usePageTitle(title);
  const blocks = guide.data ? parseMarkdown(guide.data) : [];
  return (
    <div className="page" data-testid="operation-guide">
      <PageHead
        crumbs={<Go to={{ name: "connections" }}>연결</Go>}
        title={title}
        lede="운영 모드에 내보낼 에이전트를 만드는 사람을 위한 규정집이에요. 동작, 툴, 점수, 상주 루프 순서로 읽어요."
      />
      {guide.error && <Failure error={guide.error} retry={guide.reload} />}
      {!guide.data && !guide.error && <Loading lines={6} />}
      <article className="stack" style={{ gap: 12, maxWidth: 820 }}>
        {blocks.map((b, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed text
          <Part key={i} block={b} />
        ))}
      </article>
    </div>
  );
}
