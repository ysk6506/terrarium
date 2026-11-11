/**
 * The first line of a result (REQ-078 step 2, ADR-0084 item 9): the run in one sentence, each link a button that sends
 * the time bar to that moment.
 */
import type { Story } from "@terrarium/core/topology";

export function StoryLine(props: {
  readonly story: Story;
  readonly origin: number;
  readonly onT: (t: number) => void;
}) {
  const { story } = props;
  if (story.parts.length === 0) return null;
  return (
    <p className="story-line">
      <style>{STORY_CSS}</style>
      <span className="story-parts">
        {story.parts.map((p, i) => (
          <span key={p.kind}>
            {i > 0 && <span aria-hidden="true"> → </span>}
            <button
              type="button"
              className={`story-part story-${p.kind}`}
              onClick={() => props.onT(Math.max(0, p.t - props.origin))}
            >
              {p.text}
            </button>
          </span>
        ))}
      </span>
      <small>{story.tail}</small>
    </p>
  );
}

const STORY_CSS = `
.story-line {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 12px;
  margin: 0 0 12px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--good-soft);
  color: var(--good);
  font-weight: 600;
}

.story-line small {
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 500;
}

.story-part {
  display: inline-flex;
  align-items: center;
  min-width: 32px;
  min-height: 32px;
  padding: 0 6px;
  border-radius: 8px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-decoration: underline transparent;
}

.story-part:hover,
.story-part:focus-visible {
  background: var(--surface);
  text-decoration-color: currentColor;
}
`;
