/**
 * A service card somebody saved (REQ-104, ADR-0127): a catalog card with the name and damage numbers they kept. The
 * shape is always the built-in card's, so a saved card cannot be one the generator cannot build.
 */
export interface ServiceCardRecord {
  readonly id: string;
  /** Who saved it; only they edit it, share it or delete it. A card is always locked: others copy it (REQ-108, ADR-0131). */
  readonly owner: string;
  readonly name: string;
  /** The built-in card it is made from (`web-api` ...). */
  readonly card: string;
  /** Damage numbers per way of stopping, in the card's order. Absent: the card's own. */
  readonly harm?: readonly { readonly name: string; readonly perHourKrw: number }[];
  /** True: it shows in everybody's catalog. False (default): only the owner sees it. */
  readonly shared: boolean;
  readonly createdAt: string;
  readonly updatedAt?: string;
}
