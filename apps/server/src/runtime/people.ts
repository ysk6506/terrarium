/**
 * The names people go by, remembered while the server runs (permissions.md section 7). Records hold the login id as `owner`;
 * a list says "김하늘" instead, which only works for someone whose name the server has heard. It hears a name from every
 * request of a signed-in person, keeps no more than `PEOPLE_MAX` of them (the quietest forgotten first), and writes nothing
 * to disk: after a restart a name comes back the next time its person uses the app, and until then the list shows the id.
 */
import type { Viewer } from "./context";
import { isSignedIn } from "./permissions";

export const PEOPLE_MAX = 500;

export class People {
  /** Insertion order is the order of last being heard: a person heard again moves to the end. */
  private readonly names = new Map<string, string>();

  hear(viewer: Viewer): void {
    if (!isSignedIn(viewer) || viewer.source === "anonymous") return;
    this.names.delete(viewer.id);
    this.names.set(viewer.id, viewer.name);
    if (this.names.size > PEOPLE_MAX) {
      const oldest = this.names.keys().next().value;
      if (oldest !== undefined) this.names.delete(oldest);
    }
  }

  /** Whoever has been heard under a name other than their id: a name equal to its id says nothing more. */
  all(): { readonly id: string; readonly name: string }[] {
    return [...this.names].filter(([id, name]) => id !== name).map(([id, name]) => ({ id, name }));
  }
}
