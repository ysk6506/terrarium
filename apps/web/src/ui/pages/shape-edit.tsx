/**
 * A word or a number on a card that is pressed to be changed (ADR-0108 item 1): it reads as text, becomes a box when
 * pressed, and keeps what was typed when the box loses focus or Enter is pressed. Escape puts the old value back.
 */
import { useEffect, useRef, useState } from "react";

export function Editable({
  value,
  onCommit,
  label,
  numeric = false,
  min = 0,
  max = 1_000_000_000,
}: {
  readonly value: string | number;
  readonly onCommit: (v: string | number) => void;
  /** What the box is for, for people who cannot see the card. */
  readonly label: string;
  readonly numeric?: boolean;
  readonly min?: number;
  readonly max?: number;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(value));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.select();
  }, [open]);
  const done = (keep: boolean) => {
    setOpen(false);
    if (!keep) return setText(String(value));
    if (!numeric) {
      const t = text.trim();
      return t === "" ? setText(String(value)) : onCommit(t);
    }
    const n = Number(text.replace(/,/g, ""));
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, Math.round(n))));
    else setText(String(value));
  };
  if (!open)
    return (
      <button
        type="button"
        className="we-edit"
        aria-label={`${label} ${value} (눌러서 바꿔요)`}
        onClick={() => {
          setText(String(value));
          setOpen(true);
        }}
      >
        {numeric ? Number(value).toLocaleString("ko-KR") : value}
      </button>
    );
  return (
    <input
      ref={input}
      className="we-edit-input"
      aria-label={label}
      inputMode={numeric ? "numeric" : "text"}
      size={Math.max(3, text.length + 1)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
      }}
    />
  );
}
