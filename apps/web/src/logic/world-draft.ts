/**
 * The world being shaped in "서비스부터" (REQ-109, ADR-0132): kept outside the screen so that going to another menu and
 * coming back finds it as it was. It lives in memory for the session and in `sessionStorage` (this tab only, gone with
 * the tab) for a reload; both are optional, so a browser without storage still keeps it until the page is reloaded.
 * What is saved here is what the person did, not what was worked out: the services, the layers they pressed, the numbers
 * of the size they typed.
 */
import type { ServiceCardView } from "@terrarium/core/contract";
import type { ServiceDraft } from "@terrarium/core/sources/worldgen";
import type { Layers } from "@terrarium/core/world";

/** Where the card of each added service came from, by key (the first one is IAP, "기본 제공"). */
export interface RowMeta {
  readonly owner: string;
  readonly titles: ServiceCardView["ownerTitles"];
  readonly locked: boolean;
  readonly shared: boolean;
  readonly line: string;
  /** The saved copy of this card on the server, once "내 카드로 저장" has been pressed on this row. */
  readonly savedId?: string;
}

export type DraftStep = "services" | "ladders" | "size";

export interface WorldDraft {
  readonly v: 1;
  readonly services: readonly ServiceDraft[];
  readonly manual: Partial<Layers>;
  readonly apart: Readonly<Record<string, Partial<Layers>>>;
  /** The size numbers the person typed; the rest follow the services. */
  readonly size: Readonly<Partial<Record<"rooms" | "racksPerRoom" | "perRack", number>>>;
  readonly name: string;
  readonly step: DraftStep;
  readonly ladder: number;
  readonly metas: Readonly<Record<string, RowMeta>>;
  readonly cost: -1 | 0 | 1;
}

const KEY = "terrarium.worldDraft";
let kept: WorldDraft | undefined;

function stored(): WorldDraft | undefined {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as WorldDraft;
    return parsed?.v === 1 && Array.isArray(parsed.services) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export const worldDraft = {
  /** The draft of this session, if there is one. */
  read(): WorldDraft | undefined {
    kept ??= stored();
    return kept;
  },
  write(draft: WorldDraft): void {
    kept = draft;
    try {
      globalThis.sessionStorage?.setItem(KEY, JSON.stringify(draft));
    } catch {
      // Without storage the draft lasts until the page is reloaded.
    }
  },
  clear(): void {
    kept = undefined;
    try {
      globalThis.sessionStorage?.removeItem(KEY);
    } catch {
      // nothing to remove
    }
  },
};

/** Whether the person has done anything worth coming back to: a service added, a layer pressed, a number typed. */
export function worthKeeping(draft: WorldDraft, first: ServiceDraft, defaultName: string): boolean {
  return (
    draft.services.length > 1 ||
    draft.services[0]?.key !== first.key ||
    JSON.stringify(draft.services[0]?.load) !== JSON.stringify(first.load) ||
    Object.keys(draft.manual).length > 0 ||
    Object.keys(draft.apart).length > 0 ||
    Object.keys(draft.size).length > 0 ||
    draft.name !== defaultName ||
    draft.cost !== 0
  );
}
