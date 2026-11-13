/**
 * A world as a card (REQ-101, ADR-0122): its name, the evidence for its place in the order ("실험 128번 · 좋아요 24 · 이번 주
 * +12"), how it was made, who made it with their titles, and a heart. The heart toggles at once and the server settles it.
 */
import type { WorldCardView } from "@terrarium/core/contract";
import type { WorldOrigin } from "@terrarium/core/experiments";
import { count, evidenceHint, evidenceLine, likeLabel, relativeTime } from "../../logic";
import { Go, useApp, useNow } from "../context";
import { TitlePills } from "../titles";

export const ORIGIN_LABELS: Readonly<Record<WorldOrigin, string>> = {
  builder: "직접 지음",
  worldgen: "생성",
  import: "밖에서 받음",
  sample: "예시",
  template: "템플릿",
};

function scale(w: WorldCardView): string {
  const racks = w.counts.rack ?? 0;
  const servers = w.counts.server ?? 0;
  if (racks === 0 && servers === 0) return "비어 있음";
  return `랙 ${count(racks)}대 · 서버 ${count(servers)}대`;
}

function Heart({ filled }: { readonly filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="like-heart">
      <path
        d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LikeButton({
  card,
  onToggle,
}: {
  readonly card: WorldCardView;
  readonly onToggle: (card: WorldCardView) => void;
}) {
  return (
    <button
      type="button"
      className="like"
      aria-pressed={card.likedByMe}
      // the name holds the visible number as a word of its own (a screen reader's "label in name" rule); the tooltip says it in full
      aria-label={`${card.name} 좋아요${card.likedByMe ? " 취소" : ""} ${count(card.likes)}`}
      title={likeLabel(card)}
      onClick={() => onToggle(card)}
    >
      <Heart filled={card.likedByMe} />
      <span className="num" title={likeLabel(card)}>
        {count(card.likes)}
      </span>
    </button>
  );
}

export function WorldCard({
  card,
  onToggle,
  compact = false,
}: {
  readonly card: WorldCardView;
  readonly onToggle: (card: WorldCardView) => void;
  readonly compact?: boolean;
}) {
  const now = useNow();
  const { navigate } = useApp();
  // The whole card opens the world (REQ-109): a press on a link, a button or a field keeps its own meaning.
  const open = (e: React.MouseEvent) => {
    if ((e.target as Element).closest("a, button, input, textarea, select, label")) return;
    if (window.getSelection()?.toString()) return;
    navigate({ name: "world", id: card.id });
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the name inside is the real link for keyboards; the card is only a larger target for the same link
    <article className="world-card" data-open="world" onClick={open}>
      <div className="wc-head">
        <Go to={{ name: "world", id: card.id }} className="wc-name">
          {card.name}
        </Go>
        <LikeButton card={card} onToggle={onToggle} />
      </div>
      <p className="wc-evidence" title={evidenceHint(card)}>
        {evidenceLine(card)}
      </p>
      <p className="small muted wc-meta">
        {ORIGIN_LABELS[card.origin]} · {scale(card)}
      </p>
      <div className="wc-foot">
        <span className="small">{card.owner}</span>
        <TitlePills who={card.owner} titles={card.ownerTitles} />
        {!compact && (
          <span className="small muted">고친 때 {relativeTime(card.updatedAt, now)}</span>
        )}
        <span className="we-spacer" />
        <Go to={{ name: "scenarios", worldId: card.id }} className="small">
          시나리오<span className="sr-only"> ({card.name})</span>
        </Go>
      </div>
    </article>
  );
}
