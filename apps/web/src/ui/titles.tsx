/**
 * 칭호 on screen (REQ-101, ADR-0122): up to two quiet pills after a name, and a small popover with all of them and what
 * each one asks for. Pills are `--fill` with plain text, no colours and no levels. Hover or a tap says "실험 100번 ·
 * 2026-11-02에 얻었어요"; the popover lists them all.
 */
import type { TitleView } from "@terrarium/core/contract";
import { useEffect, useId, useRef, useState } from "react";
import { earnedDay, NO_TITLES, titleHint, titleRow } from "../logic";
import { useApp, useAsync } from "./context";

function Popover({
  who,
  titles,
  onClose,
}: {
  readonly who: string;
  readonly titles: readonly TitleView[];
  readonly onClose: () => void;
}) {
  return (
    <div className="title-pop" role="dialog" aria-label={`${who}님의 칭호`}>
      <b className="title-pop-head">{who}님의 칭호</b>
      {titles.length === 0 ? (
        <p className="small muted">{NO_TITLES}</p>
      ) : (
        <ul>
          {titles.map((t) => (
            <li key={t.key} className="title-pop-row">
              <span className="title-pill">{t.label}</span>
              <span className="small muted">
                {t.means} · {earnedDay(t.earnedAt)}에 얻었어요
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="title-pop-close" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}

/**
 * The pills after a name. With no titles it draws nothing, unless `always` (the viewer's own name in the rail), where it
 * leaves a quiet way to open the popover so the empty state can be read.
 */
export function TitlePills({
  who,
  titles,
  always = false,
  side = "below",
}: {
  readonly who: string;
  readonly titles: readonly TitleView[];
  readonly always?: boolean;
  readonly side?: "below" | "beside";
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("keydown", away);
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("keydown", away);
      document.removeEventListener("pointerdown", away);
    };
  }, [open]);
  if (titles.length === 0 && !always) return null;
  const { shown, more } = titleRow(titles);
  return (
    <span className={`title-pills title-${side}`} ref={box}>
      {shown.map((t) => (
        <button
          key={t.key}
          type="button"
          className="title-pill"
          title={titleHint(t)}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {t.label}
        </button>
      ))}
      {(more > 0 || titles.length === 0) && (
        <button
          type="button"
          className="title-pill title-more"
          title={more > 0 ? `칭호 ${more}개 더` : "칭호 보기"}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {more > 0 ? `+${more}` : "칭호"}
        </button>
      )}
      <span id={id}>
        {open && <Popover who={who} titles={titles} onClose={() => setOpen(false)} />}
      </span>
    </span>
  );
}

/** The viewer's own titles, under their name in the rail. */
export function MyTitles({ me }: { readonly me: string }) {
  const { api, page } = useApp();
  const mine = useAsync(
    (signal) => api.call("userTitles", { params: { id: me }, signal }),
    [me, page.name],
  );
  if (!mine.data) return null;
  return <TitlePills who={me} titles={mine.data.titles} always side="beside" />;
}
