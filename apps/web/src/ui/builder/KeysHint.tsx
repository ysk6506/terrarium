/**
 * Keys of the builder (ADR-0107 item 8, feedback #23): one overlay the first time the builder opens (remembered in this
 * browser), and a "?" button that opens it again, as does the key itself.
 */
import { useEffect, useState } from "react";

const KEY = "terrarium.builderKeysSeen";

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["R", "고른 것을 돌려요"],
  ["Delete", "고른 것을 지워요"],
  ["Esc", "한 걸음 물러나요 (도구 → 고른 것 → 위 단계)"],
  ["Ctrl+Z", "되돌려요"],
  ["Ctrl+Shift+Z", "다시 해요"],
  ["Ctrl+S", "저장해요"],
  ["두 번 누르기", "건물이나 서버룸 안으로 들어가요"],
  ["?", "이 도움말을 열고 닫아요"],
];

const seen = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

const remember = (): void => {
  try {
    globalThis.localStorage?.setItem(KEY, "1");
  } catch {
    // Without storage it shows again next visit; nothing is lost.
  }
};

export function KeysHint() {
  const [open, setOpen] = useState(() => !seen());
  const close = () => {
    remember();
    setOpen(false);
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)))
        return;
      if (e.key === "?") setOpen((o) => !o);
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
  return (
    <>
      <button
        type="button"
        className="kb-help"
        aria-label="키보드 도움말"
        aria-expanded={open}
        title="키보드 도움말 (?)"
        onClick={() => (open ? close() : setOpen(true))}
      >
        ?
      </button>
      {open && (
        <dialog open className="kb-overlay" aria-label="키보드 도움말">
          <h2>키보드로 이렇게 해요</h2>
          <dl className="kb-list">
            {KEYS.map(([k, what]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="btn btn-primary btn-small" onClick={close}>
            알았어요
          </button>
        </dialog>
      )}
    </>
  );
}
