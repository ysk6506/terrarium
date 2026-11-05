/**
 * The small pieces every screen is made of. Each one carries its accessibility with it: labels tied to
 * controls, errors announced, dialogs that trap nothing but answer Escape.
 */
import type { RunStatus } from "@terrarium/core/experiments";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ApiError, SECTIONS, STATUS_TONES, sectionOf, statusLabel, type Tone } from "../logic";
import { Go, useApp } from "./context";
import { Icon } from "./icons";

export {
  Check,
  Field,
  NumberField,
  type Option,
  Segmented,
  SelectField,
  TextField,
} from "./fields";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly kind?: "primary" | "quiet" | "danger" | "plain";
  readonly size?: "small" | "normal";
  readonly icon?: string;
  readonly busy?: boolean;
  /** What to tell when the button is switched off: shown as a hint and read out by screen readers. */
  readonly why?: string;
};

export function Button({
  kind = "plain",
  size = "normal",
  icon,
  busy,
  why,
  children,
  className,
  disabled,
  title,
  ...rest
}: ButtonProps) {
  const whyId = useId();
  const reason = disabled && !busy ? why : undefined;
  const classes = [
    "btn",
    kind !== "plain" && `btn-${kind}`,
    size === "small" && "btn-small",
    !children && "btn-icon",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <button
        type="button"
        className={classes}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        title={reason ?? title}
        {...rest}
        aria-describedby={reason ? whyId : rest["aria-describedby"]}
      >
        {icon && <Icon name={icon} size={18} />}
        {children}
      </button>
      {reason && (
        <span id={whyId} className="sr-only">
          {reason}
        </span>
      )}
    </>
  );
}

export function Status({ status }: { readonly status: RunStatus }) {
  return <span className={`status status-${STATUS_TONES[status]}`}>{statusLabel(status)}</span>;
}

export function ToneDot({ tone, children }: { readonly tone: Tone; readonly children: ReactNode }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

export function Empty({
  title,
  children,
  action,
}: {
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Note({
  tone,
  children,
}: {
  readonly tone?: "bad" | "warn" | "good";
  readonly children: ReactNode;
}) {
  return (
    <div
      className={`note${tone ? ` note-${tone}` : ""}`}
      role={tone === "bad" ? "alert" : undefined}
    >
      {children}
    </div>
  );
}

/** An error from loading something, with a way to try again. */
/** What went wrong in the server's words, and the ways on: try again (unless it is simply gone) or go to the list. */
export function Failure({ error, retry }: { readonly error: Error; readonly retry?: () => void }) {
  const { page } = useApp();
  const gone = error instanceof ApiError && error.status === 404;
  const section = SECTIONS.find((s) => s.key === sectionOf(page));
  const away = section && section.key !== "home" ? section : undefined;
  return (
    <Note tone="bad">
      <div className="stack">
        <span>{error.message}</span>
        <div className="row">
          {retry && !gone && (
            <Button size="small" onClick={retry}>
              다시 불러오기
            </Button>
          )}
          <Go to={away ? away.page : { name: "home" }} className="btn btn-small">
            {away ? `${away.label} 목록으로` : "홈으로"}
          </Go>
        </div>
      </div>
    </Note>
  );
}

export function Loading({ lines = 3 }: { readonly lines?: number }) {
  const widths = [90, 76, 62, 48, 34].slice(0, lines);
  return (
    <output className="stack loading" aria-busy="true">
      <span className="sr-only">불러오는 중</span>
      {widths.map((w) => (
        <span key={w} className="skeleton" aria-hidden="true" style={{ width: `${w}%` }} />
      ))}
    </output>
  );
}

export function PageHead({
  title,
  lede,
  crumbs,
  actions,
}: {
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  readonly crumbs?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {crumbs && (
          <nav className="crumbs" aria-label="위치">
            {crumbs}
          </nav>
        )}
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function Figures({
  items,
}: {
  readonly items: readonly {
    readonly label: string;
    readonly value: ReactNode;
    readonly hint?: string;
  }[];
}) {
  return (
    <dl
      className="figures"
      style={
        { "--cols": items.length > 5 ? Math.ceil(items.length / 2) : items.length } as CSSProperties
      }
    >
      {items.map((f) => (
        <div className="figure" key={f.label}>
          <dd className="figure-value" style={{ margin: 0 }}>
            {f.value}
          </dd>
          <dt className="figure-label">{f.label}</dt>
          {f.hint && <dd className="figure-hint">{f.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A modal dialog: Escape and the scrim close it; focus starts inside and returns after. */
export function Dialog({
  title,
  onClose,
  children,
  actions,
  wide,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  /** For forms with rows of inputs. */
  readonly wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // a choice list (the chosen card) takes focus before the first field
    const first =
      box.current?.querySelector<HTMLElement>("[role='radio'][tabindex='0']") ??
      box.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [onClose]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it; the scrim click is a convenience
    // biome-ignore lint/a11y/noStaticElementInteractions: the dialog inside is the interactive element
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={wide ? "dialog dialog-wide" : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={box}
      >
        <h2 id={titleId} style={{ marginBottom: 14 }}>
          {title}
        </h2>
        {children}
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** A button that opens a small menu of actions below it. */
export function MenuButton({
  label,
  icon,
  items,
}: {
  readonly label: string;
  readonly icon?: string;
  readonly items: readonly {
    readonly label: string;
    readonly hint?: string;
    readonly onSelect: () => void;
  }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="anchor" ref={ref}>
      <Button
        {...(icon ? { icon } : {})}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </Button>
      {open && (
        <div className="menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
              {item.hint && <small>{item.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Meter({ ratio, label }: { readonly ratio: number; readonly label: string }) {
  const tone = ratio > 1 ? "bad" : ratio > 0.8 ? "warn" : "good";
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <meter> cannot take the tone colours in every browser
    <div
      className={`meter${tone === "good" ? "" : ` meter-${tone}`}`}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
    </div>
  );
}

/** Tabs over one area: arrow keys move between them, the panel is labelled by its tab. */
export function Tabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
  children,
}: {
  readonly label: string;
  readonly value: T;
  readonly tabs: readonly { readonly id: T; readonly label: string }[];
  readonly onChange: (id: T) => void;
  readonly children: ReactNode;
}) {
  const base = useId();
  const move = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.id === value);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = tabs[(at + step + tabs.length) % tabs.length];
    if (next) onChange(next.id);
  };
  return (
    <div>
      <div className="tabs" role="tablist" aria-label={label} onKeyDown={move}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${base}-${t.id}`}
            className="tab"
            aria-selected={t.id === value}
            aria-controls={`${base}-panel`}
            tabIndex={t.id === value ? 0 : -1}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-${value}`}
        style={{ paddingTop: 16 }}
      >
        {children}
      </div>
    </div>
  );
}

/** A titled part of a page; the heading names the region for screen readers. */
export function Section({
  title,
  aside,
  children,
}: {
  readonly title: ReactNode;
  readonly aside?: ReactNode;
  readonly children?: ReactNode;
}) {
  const id = useId();
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-head">
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
