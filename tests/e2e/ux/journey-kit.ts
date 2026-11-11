/** What every journey is given and the two things nearly all of them start with. */
import type { Browser } from "playwright";
import type { Driver, Visitor } from "./driver";
import { settle } from "./site";

export interface Context {
  readonly browser: Browser;
  readonly base: string;
  readonly v: Visitor;
  readonly d: Driver;
}

export const SECOND = 1000;

export async function home(c: Context): Promise<void> {
  await c.v.page.goto(c.base, { waitUntil: "load" });
  await settle(c.v.page);
}

export async function expectPath(c: Context, pattern: RegExp): Promise<void> {
  await c.v.page.waitForURL((url) => pattern.test(url.pathname), { timeout: 15 * SECOND });
}
