/** Line icons drawn for Terrarium (24px grid, 1.6px stroke). Decorative unless given a label. */
import type { ReactNode } from "react";

const PATHS: Readonly<Record<string, ReactNode>> = {
  home: <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
  world: (
    <>
      <path d="M3 18h18" />
      <path d="M5 18V9l4-2v11M9 11l5-2v9M14 9l5 2v7" />
    </>
  ),
  scenario: (
    <>
      <rect x="3" y="4" width="7" height="5" rx="1" />
      <rect x="14" y="15" width="7" height="5" rx="1" />
      <path d="M6.5 9v4a2 2 0 0 0 2 2H14" />
    </>
  ),
  experiment: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  benchmark: (
    <>
      <path d="M4 20V11M10 20V5M16 20v-6M22 20H2" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  undo: <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" />,
  redo: <path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h2" />,
  rotate: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  play: <path d="M8 5l11 7-11 7z" />,
  share: (
    <>
      <path d="M12 4v11M8 8l4-4 4 4" />
      <path d="M5 13v6h14v-6" />
    </>
  ),
  fork: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="5" r="2" />
      <circle cx="12" cy="19" r="2" />
      <path d="M6 7v2a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7M12 13v4" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  up: <path d="M6 15l6-6 6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  forward: <path d="M9 6l6 6-6 6" />,
  cable: <path d="M4 7h4a4 4 0 0 1 4 4v2a4 4 0 0 0 4 4h4M2 7h2M20 17h2" />,
  wand: <path d="M4 20L16 8M14 4v3M18 6h3M19 10v3M11 5H8" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  download: <path d="M12 4v11M8 11l4 4 4-4M5 19h14" />,
};

export function Icon({
  name,
  size = 20,
  label,
}: {
  readonly name: keyof typeof PATHS | string;
  readonly size?: number;
  readonly label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The mark: a glass case with three racks inside. */
export function Mark({ size = 34 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="5" width="26" height="22" rx="3" fill="var(--ink)" />
      <path
        d="M8 21h16M8 21V11h4v10M14 21V9h4v12M20 21V13h4v8"
        stroke="var(--paper)"
        strokeWidth="1.6"
        fill="none"
      />
      <path d="M3 9h26" stroke="var(--cobalt)" strokeWidth="1.4" />
    </svg>
  );
}
