/** Browser helpers: every thing a person does goes through the driver so the actions can be counted. */
import { type Browser, type BrowserContext, chromium, type Locator, type Page } from "playwright";

export const VIEWPORT = { width: 1440, height: 900 };
const GPU_FLAGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

export const launch = (): Promise<Browser> => chromium.launch({ args: GPU_FLAGS });

export interface Visitor {
  readonly context: BrowserContext;
  readonly page: Page;
  /** Console errors, uncaught errors and failed requests seen so far. */
  readonly problems: string[];
}

export interface VisitorOptions {
  readonly name?: string | null;
  readonly reducedMotion?: boolean;
  readonly dark?: boolean;
}

/** A person with a fresh browser profile. `name: null` is someone who has never been asked their name. */
export async function visitor(browser: Browser, options: VisitorOptions = {}): Promise<Visitor> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    reducedMotion: options.reducedMotion ? "reduce" : "no-preference",
    colorScheme: options.dark ? "dark" : "light",
  });
  const name = options.name === undefined ? "연수" : options.name;
  if (name !== null)
    await context.addInitScript((who) => {
      try {
        localStorage.setItem("terrarium.user", who);
      } catch {
        // storage can be unavailable; the name dialog then appears
      }
    }, name);
  // A browser that draws with the processor (no graphics card) can ask for the lightest 3D: TERRARIUM_UX_GRAPHICS=min.
  const graphics = process.env.TERRARIUM_UX_GRAPHICS;
  if (graphics)
    await context.addInitScript((choice) => {
      try {
        localStorage.setItem("terrarium.settings", JSON.stringify({ graphics: choice }));
      } catch {
        // storage can be unavailable; the 3D then picks its own level
      }
    }, graphics);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  // On a crowded machine every wait takes longer: TERRARIUM_UX_SLOW=4 gives each wait four times the usual 30 seconds.
  const slow = Number(process.env.TERRARIUM_UX_SLOW);
  if (slow > 1) context.setDefaultTimeout(30_000 * slow);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`error: ${e.message}`));
  page.on("response", async (r) => {
    const url = r.url();
    // A 404 the page asked for on purpose (a missing id) is the page being tested, not a problem.
    if (
      r.status() >= 500 ||
      (r.status() >= 400 && !url.includes("-404") && !url.includes("nope"))
    ) {
      // What the server said, so a refusal can be told from a crash.
      const said = await r.text().catch(() => "");
      problems.push(`http ${r.status()}: ${url} ${said.replace(/\s+/g, " ").slice(0, 160)}`.trim());
    }
  });
  return { context, page, problems };
}

/** Counts what a person does: a click, a field filled, a choice made, a key pressed, a drag. */
export class Driver {
  actions = 0;
  constructor(readonly page: Page) {}

  /** `at` is where in the element to press (the empty part of a canvas, say). */
  async click(target: Locator, at?: { x: number; y: number }): Promise<void> {
    this.actions++;
    await target.click(at ? { position: at } : undefined);
  }

  async fill(target: Locator, text: string): Promise<void> {
    this.actions++;
    await target.fill(text);
  }

  async choose(target: Locator, label: string | RegExp): Promise<void> {
    this.actions++;
    const option = target.locator("option", { hasText: label }).first();
    await target.selectOption({ value: (await option.getAttribute("value")) ?? "" });
  }

  async press(key: string): Promise<void> {
    this.actions++;
    await this.page.keyboard.press(key);
  }

  async drag(from: Locator, to: Locator, at: { x: number; y: number }): Promise<void> {
    this.actions++;
    await from.dragTo(to, { targetPosition: at });
  }

  /** Where the person is, in the address bar (not counted: nobody types it). */
  path(): string {
    return new URL(this.page.url()).pathname;
  }
}

export const nav = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("link", { name, exact: true });
