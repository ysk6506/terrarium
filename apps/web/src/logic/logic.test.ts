import type { ExperimentSummary, RunSummary } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  ApiError,
  applyEvent,
  celsius,
  count,
  createApi,
  dateText,
  formatDuration,
  hrefOf,
  Identity,
  initialLive,
  type KeyValueStore,
  MAX_LIVE_CALLS,
  meanText,
  NETWORK_MESSAGE,
  nameProblem,
  type Page,
  parseEvent,
  parseLocation,
  percent,
  relativeTime,
  SECTIONS,
  STATUS_TONES,
  scoreText,
  sectionOf,
  simTime,
  statusLabel,
  titleOf,
  watts,
  won,
} from ".";

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return respond(url, init);
    },
  };
}

describe("the API client speaks the contract [REQ-030]", () => {
  test("paths, methods, the viewer's name, JSON bodies and document responses", async () => {
    const f = fakeFetch((url) =>
      url.includes("/report") ? new Response("<html>") : Response.json({ ok: true }),
    );
    const api = createApi({ baseUrl: "https://t/", fetch: f.fetch, user: () => "김하늘" });
    await api.call("getExperiment", { params: { id: "e 1" } });
    expect(f.seen[0]?.url).toBe("https://t/api/experiments/e%201");
    expect(f.seen[0]?.init.method).toBe("GET");
    expect((f.seen[0]?.init.headers as Record<string, string>)["x-terrarium-user"]).toBe(
      encodeURIComponent("김하늘"),
    );
    await api.call("cancelExperiment", { params: { id: "e1" } });
    expect(f.seen[1]?.init).toMatchObject({ method: "POST" });
    await api.call("createShare", { params: { id: "e1" }, body: { expiresInDays: 7 } });
    expect(f.seen[2]?.init.body).toBe('{"expiresInDays":7}');
    expect((f.seen[2]?.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(
      await api.call("experimentReport", { params: { id: "e1" }, query: { format: "html" } }),
    ).toBe("<html>");
    expect(f.seen[3]?.url).toBe("https://t/api/experiments/e1/report?format=html");
    expect(api.url("sharedReport", { token: "abc" })).toBe("https://t/r/abc");
    const anonymous = createApi({ fetch: f.fetch });
    await anonymous.call("meta");
    expect((f.seen[4]?.init.headers as Record<string, string>)["x-terrarium-user"]).toBeUndefined();
    expect(f.seen[4]?.url).toBe("/api/meta");
  });

  test("errors carry the server's Korean message and point at fields", async () => {
    const invalid = fakeFetch(() =>
      Response.json(
        {
          error: {
            code: "invalid_input",
            message: "입력값을 확인한다",
            issues: [{ path: "recipe.seeds", message: "같은 시드가 두 번 있다" }],
          },
        },
        { status: 400 },
      ),
    );
    const err = (await createApi({ fetch: invalid.fetch })
      .call("meta")
      .catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "invalid_input", message: "입력값을 확인한다" });
    expect(err.issueFor("recipe")).toBe("같은 시드가 두 번 있다");
    expect(err.issueFor("recipe.seeds")).toBe("같은 시드가 두 번 있다");
    expect(err.issueFor("name")).toBeUndefined();
    const plain = fakeFetch(() => new Response("bad gateway", { status: 502 }));
    await expect(createApi({ fetch: plain.fetch }).call("meta")).rejects.toMatchObject({
      status: 502,
      code: "http_error",
      message: "서버가 502로 답했어요",
    });
    const down = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(createApi({ fetch: down.fetch }).call("meta")).rejects.toMatchObject({
      status: 0,
      message: NETWORK_MESSAGE,
    });
    const aborted = fakeFetch(() => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(createApi({ fetch: aborted.fetch }).call("meta")).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("every screen has an address [REQ-038]", () => {
  const pages: Page[] = [
    { name: "home" },
    { name: "worlds" },
    { name: "world", id: "w-1" },
    { name: "scenarios" },
    { name: "scenarios", worldId: "w-1" },
    { name: "scenario", id: "s-1" },
    { name: "experiments" },
    { name: "experiments", mine: true },
    { name: "newExperiment" },
    { name: "newExperiment", forkOf: "e-1" },
    { name: "newExperiment", scenarioId: "s-1" },
    { name: "experiment", id: "e-1" },
    { name: "run", id: "r-1" },
    { name: "benchmarks" },
    { name: "benchmarks", set: "abc" },
  ];

  test("an address and the screen it opens are one round trip", () => {
    for (const page of pages) {
      const href = hrefOf(page);
      const [path, search] = href.split("?");
      expect(parseLocation(path as string, search ? `?${search}` : ""), href).toEqual(page);
    }
    expect(parseLocation("/nowhere")).toEqual({ name: "notFound", path: "/nowhere" });
    expect(hrefOf({ name: "notFound", path: "/x" })).toBe("/x");
    expect(parseLocation("/worlds/")).toEqual({ name: "worlds" });
  });

  test("the rail knows which section a page is in; tabs say where they are", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual([
      "홈",
      "세계",
      "시나리오",
      "실험",
      "벤치마크",
      "연결",
    ]);
    expect(sectionOf({ name: "run", id: "r" })).toBe("experiments");
    expect(sectionOf({ name: "notFound", path: "/" })).toBeUndefined();
    expect(titleOf({ name: "home" })).toBe("테라리움");
    expect(titleOf({ name: "world", id: "w" }, "샘플 홀")).toBe("샘플 홀 — 세계 — 테라리움");
    expect(titleOf({ name: "newExperiment" })).toBe("새 실험 — 테라리움");
    expect(titleOf({ name: "notFound", path: "/x" })).toBe("없는 화면 — 테라리움");
  });
});

describe("numbers and times read the same everywhere [REQ-041]", () => {
  test("scores, means, percentages, power, money, temperatures", () => {
    expect(scoreText(72.456)).toBe("72.5점");
    expect(scoreText(100)).toBe("100점");
    expect(scoreText(null)).toBe("—");
    expect(meanText({ mean: 72.45, ci95: 4.1, n: 3 }, "점")).toBe("72.5점 ± 4.1");
    expect(meanText({ mean: 70, ci95: 0, n: 1 })).toBe("70.0");
    expect(meanText(undefined)).toBe("—");
    expect(percent(0.6667)).toBe("67%");
    expect(percent(0.6667, 1)).toBe("66.7%");
    expect([watts(850), watts(12_400), watts(1_200_000)]).toEqual(["850 W", "12.4 kW", "1.2 MW"]);
    expect([won(8.5), won(320), won(1500)]).toEqual(["850만 원", "3.2억 원", "15억 원"]);
    expect(celsius(23.456)).toBe("23.5°C");
    expect(count(12345)).toBe("12,345");
    expect(formatDuration(750)).toBe("12분 30초");
    expect(simTime(90)).toBe("+1분 30초");
  });

  test("times: just now, minutes ago, yesterday, then the date", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    const ago = (s: number) => new Date(now - s * 1000).toISOString();
    expect(relativeTime(ago(10), now)).toBe("방금");
    expect(relativeTime(ago(300), now)).toBe("5분 전");
    expect(relativeTime(ago(7200), now)).toBe("2시간 전");
    expect(relativeTime(ago(30 * 3600), now)).toBe("어제");
    expect(relativeTime(ago(3 * 86_400), now)).toBe("3일 전");
    expect(relativeTime(ago(30 * 86_400), now)).toMatch(/^9월 29일 \d\d:\d\d$/);
    expect(dateText("2025-03-01T00:00:00Z", now)).toBe("2025년 3월 1일");
  });

  test("states have a word and a tone", () => {
    expect(statusLabel("running")).toBe("실행 중");
    expect(STATUS_TONES.failed).toBe("bad");
    expect(STATUS_TONES.completed).toBe("good");
  });
});

class MemoryKV implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const broken: KeyValueStore = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceeded");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("the name people give [REQ-033]", () => {
  test("kept in the browser, checked, forgotten on request", () => {
    const kv = new MemoryKV();
    const id = new Identity(kv);
    expect(id.name).toBeUndefined();
    id.set("  김하늘 ");
    expect(id.name).toBe("김하늘");
    expect(new Identity(kv).name).toBe("김하늘");
    id.forget();
    expect(new Identity(kv).name).toBeUndefined();
    expect(() => id.set(" ")).toThrow("이름을 적어 주세요");
    expect(nameProblem("x".repeat(41))).toBe("40자 이하로 적어 주세요");
    expect(nameProblem("a\nb")).toBe("줄바꿈이나 제어 문자는 쓸 수 없어요");
    kv.setItem("terrarium.user", "\u0000bad");
    expect(new Identity(kv).name).toBeUndefined();
  });

  test("without working storage the name lasts the visit", () => {
    const id = new Identity(broken);
    expect(id.name).toBeUndefined();
    id.set("지민");
    expect(id.name).toBe("지민");
    id.forget();
    expect(id.name).toBeUndefined();
    const none = new Identity(undefined);
    none.set("손님");
    expect(none.name).toBe("손님");
  });
});

const run = (id: string, index: number, status: RunSummary["status"] = "queued"): RunSummary => ({
  id,
  index,
  seed: index + 1,
  repeat: 1,
  status,
  queuedAt: "2026-10-29T00:00:00Z",
  score: null,
  passed: false,
});

describe("live progress [REQ-030]", () => {
  test("runs update in place, calls tick by, a finished run asks for a refresh", () => {
    let state = initialLive([run("r0", 0), run("r1", 1)]);
    state = applyEvent(state, { type: "run", run: { ...run("r0", 0, "running") } });
    expect(state.runs.map((r) => r.status)).toEqual(["running", "queued"]);
    expect(state.stale).toBe(false);
    for (let i = 0; i < 12; i++)
      state = applyEvent(state, {
        type: "call",
        runId: "r0",
        t: 900 + i * 30,
        tool: "list_alarms",
        ok: i !== 3,
        ...(i === 3 ? { error: "x" } : {}),
      });
    expect(state.calls.r0).toHaveLength(MAX_LIVE_CALLS);
    expect(state.calls.r0?.at(-1)?.t).toBe(900 + 11 * 30);
    state = applyEvent(state, {
      type: "run",
      run: { ...run("r0", 0, "completed"), score: 100, passed: true },
    });
    expect(state.stale).toBe(true);
    state = applyEvent(state, { type: "run", run: run("r2", 2) });
    expect(state.runs.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
    const summary = { status: "running" } as ExperimentSummary;
    expect(applyEvent(state, { type: "experiment", summary }).summary).toBe(summary);
    expect(initialLive([], summary).summary).toBe(summary);
  });

  test("server-sent event blocks are read, and junk is ignored", () => {
    expect(
      parseEvent('event: run\ndata: {"type":"call","runId":"r","t":1,"tool":"x","ok":true}'),
    ).toMatchObject({
      type: "call",
    });
    expect(parseEvent(": ping")).toBeUndefined();
    expect(parseEvent("data: {nope")).toBeUndefined();
  });
});
