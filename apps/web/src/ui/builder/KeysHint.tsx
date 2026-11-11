/**
 * Keys of the builder (ADR-0107 item 8, feedback #23, ADR-0123: four lines): one overlay the first time the builder opens (remembered in this
 * browser), and a "?" button that opens it again, as does the key itself.
 */
import { useEffect, useState } from "react";

const KEY = "terrarium.builderKeysSeen";

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["R", "돌리기"],
  ["Delete", "지우기"],
  ["Ctrl+Z", "되돌리기"],
  ["두 번 누르기", "안으로"],
];

/** The width the builder turns into a bottom sheet at; a phone has no keyboard to teach (REQ-111). */
const WIDE = "(min-width: 900px)";

const isWide = (): boolean => globalThis.matchMedia?.(WIDE).matches ?? true;

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

export function KeysHint({ picked }: { readonly picked: boolean }) {
  const [wide, setWide] = useState(isWide);
  const [open, setOpen] = useState(() => !seen() && isWide());
  useEffect(() => {
    const query = globalThis.matchMedia?.(WIDE);
    if (!query) return;
    const change = () => {
      setWide(query.matches);
      if (!query.matches) setOpen(false);
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  // 무언가를 고르면 그 카드가 자리를 쓰니, 처음 한 번의 안내는 거기서 접어요
  useEffect(() => {
    if (picked) setOpen(false);
  }, [picked]);
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
  if (!wide) return null;
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
          <button
            type="button"
            className="btn btn-small"
            data-moss-skip="안내를 닫을 뿐 아무것도 바꾸지 않아요"
            onClick={close}
          >
            알았어요
          </button>
        </dialog>
      )}
    </>
  );
}
