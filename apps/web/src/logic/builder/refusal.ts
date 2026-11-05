/** The refusal that has a way on (REQ-075, REQ-076): the building a room outgrew, the land a building outgrew, the floor with room left. */
import { EditError } from "./edit-error";

export type Way =
  | { readonly kind: "widen-building"; readonly entityId: string }
  | { readonly kind: "buy-land"; readonly entityId: string }
  /** Another storey of the same building that still has bare floor: go there. */
  | { readonly kind: "other-floor"; readonly entityId: string };

export class Refusal extends EditError {
  constructor(
    message: string,
    readonly way: Way,
  ) {
    super(message);
  }
}
