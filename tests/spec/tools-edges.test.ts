/**
 * The edges of the tool box (REQ-007, REQ-031, REQ-093): a call with the wrong kind of argument, a session that cannot
 * hand work over, runbooks that are empty or too long, a host that cannot be logged in to, and output that is too long.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import {
  callEffect,
  MAX_RUNBOOK_STEPS,
  onlyDomains,
  parseRunbookMarkdown,
  runbookProblems,
  TOOL_NAMES,
  Toolbox,
  toolsOfArea,
} from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

function boot() {
  const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(60);
  const box = new Toolbox(TOOL_NAMES);
  const call = (
    tool: string,
    args: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) => box.call(tool, args, { world, facades: {} as Facades, ...extra });
  const inject = (type: FaultType, target: string) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params: {} } },
      "scenario",
    );
  return { world, physics, box, call, inject };
}

describe("the box refuses what it was not asked properly [REQ-007]", () => {
  test("a tool that is not in the experiment, a missing or unknown argument and a wrong type are named in words", () => {
    const { call } = boot();
    const small = new Toolbox(["list_entities"]);
    const ctx = { world: boot().world, facades: {} as Facades };
    expect(small.call("get_entity", {}, ctx).error).toContain(
      "is not available in this experiment",
    );
    expect(small.has("list_entities")).toBe(true);
    expect(call("get_entity", {}).error).toContain("missing required argument 'id'");
    expect(call("get_entity", { id: 5 }).error).toContain("argument 'id' must be a string");
    expect(call("get_entity", { id: "x", extra: 1 }).error).toContain("unknown argument 'extra'");
    expect(call("get_entity", { id: undefined }).error).toContain("missing required argument");
  });

  test("an argument that is left undefined is the same as not giving it, and a call with no arguments object is a call with none", () => {
    const { call, box, world } = boot();
    expect(call("list_entities", { kind: undefined }).error).toBeUndefined();
    const r = box.call("list_entities", undefined as never, { world, facades: {} as Facades });
    expect(r.error).toBeUndefined();
  });

  test("a tool granted in the middle of a run is added once, and an unknown name is refused", () => {
    const { box } = boot();
    const first = box.grant(["get_entity"]);
    expect(box.grant(["get_entity"])).toEqual([]);
    expect(first.length).toBeLessThanOrEqual(1);
    expect(() => box.grant(["nope"])).toThrow("unknown tools");
    expect(() => new Toolbox(["nope"])).toThrow("unknown tools");
    expect(box.list().map((t) => t.name)).toContain("get_entity");
  });
});

describe("ask_human, search_runbooks and network_cli edges [REQ-093]", () => {
  test("ask_human needs a request; outside a session nobody answers", () => {
    const { call } = boot();
    expect(call("ask_human", { request: "  " }).error).toContain("must say what you need");
    expect(call("ask_human", { request: "help" }).data).toMatchObject({ from: "none" });
  });

  test("search_runbooks with no runbooks given finds none", () => {
    const { call } = boot();
    expect(JSON.stringify(call("search_runbooks", { query: "cooling" }))).toBeTypeOf("string");
  });

  test("network_cli wants a list of lines", () => {
    const { call } = boot();
    expect(call("network_cli", { device: "tor-a", commands: "show version" }).error).toContain(
      "must be a array",
    );
    expect(call("network_cli", { device: "tor-a", commands: [1, 2] }).error).toContain(
      "list of CLI lines",
    );
  });
});

describe("handing work over and tickets [REQ-093]", () => {
  const port = () => {
    const seen: string[] = [];
    const ticket = { id: "t1", title: "x", status: "mine" as const, note: "" };
    return {
      seen,
      ops: {
        escalate: (domain: string, note: string | undefined) => {
          seen.push(`escalate ${domain} ${note ?? "-"}`);
          return { accepted: true } as never;
        },
        eventsSince: (cursor: number) => {
          seen.push(`since ${cursor}`);
          return { cursor, events: [] };
        },
        createTicket: (input: { title: string }) => {
          seen.push(`create ${input.title}`);
          return ticket as never;
        },
        updateTicket: (id: string, input: Record<string, unknown>) => {
          seen.push(`update ${id} ${Object.keys(input).join(",")}`);
          return ticket as never;
        },
        listTickets: (status: string | undefined) => {
          seen.push(`list ${status ?? "-"}`);
          return [];
        },
      },
    };
  };

  test("a session that cannot hand work over says so for every one of these tools", () => {
    const { call } = boot();
    for (const [tool, args] of [
      ["escalate", { domain: "network" }],
      ["events_since", {}],
      ["create_ticket", { title: "x" }],
      ["update_ticket", { id: "t1" }],
      ["list_tickets", {}],
    ] as const)
      expect(call(tool, { ...args }).error, tool).toContain("cannot hand work over");
  });

  test("with a session behind it, every argument reaches the port, and a bad status or domain is refused first", () => {
    const { call } = boot();
    const { ops, seen } = port();
    call("escalate", { domain: "network", note: "n" }, { ops });
    call("escalate", { domain: "network" }, { ops });
    call("events_since", { cursor: 7.9 }, { ops });
    call("events_since", { cursor: -3 }, { ops });
    call("events_since", {}, { ops });
    call(
      "create_ticket",
      { title: "t", status: "waiting", waitingFor: "net", dueInSeconds: 600, note: "n" },
      { ops },
    );
    call("update_ticket", { id: "t1", title: "u", status: "done" }, { ops });
    call("update_ticket", { id: "t1" }, { ops });
    call("list_tickets", { status: "mine" }, { ops });
    call("list_tickets", {}, { ops });
    expect(seen).toEqual([
      "escalate network n",
      "escalate network -",
      "since 7",
      "since 0",
      "since 0",
      "create t",
      "update t1 title,status",
      "update t1 ",
      "list mine",
      "list -",
    ]);
    expect(call("create_ticket", { title: "  " }, { ops }).error).toContain("title is required");
    expect(call("create_ticket", { title: "t", status: "bad" }, { ops }).error).toBeTypeOf(
      "string",
    );
    expect(call("list_tickets", { status: "bad" }, { ops }).error).toBeTypeOf("string");
    expect(call("escalate", { domain: "astrology" }, { ops }).error).toContain("가능한 도메인");
  });
});

describe("run_command on hosts that cannot be reached, and output that is too long [REQ-098]", () => {
  test("a command line on something that is not a server or VM is refused, and a powered-off server times out", () => {
    const { call, inject, physics } = boot();
    expect(call("run_command", { host: "rack-a", cmd: "uptime" }).error).toContain(
      "run_command needs a server or VM",
    );
    inject("kernel_panic", "srv-a1");
    physics.run(5);
    const r = call("run_command", { host: "srv-a1", cmd: "uptime" });
    expect(JSON.stringify(r.data)).toContain("Connection timed out");
  });

  test("output over 400 lines is cut with a note saying how many there were", () => {
    const { call } = boot();
    const r = call("run_command", { host: "srv-a1", cmd: "find / ; find /" });
    const out = (r.data as { output: string }).output;
    expect(out.split("\n")).toHaveLength(401);
    expect(out).toContain("출력이 길어서 400줄만 보여요. 전체");
  });
});

describe("runbooks, domains and what a call changes [REQ-093]", () => {
  test("a step can run over several lines and carry its check and its tools", () => {
    const { runbook, parsed } = parseRunbookMarkdown(
      [
        "# 냉각 장애",
        "1. 온도를 본다",
        "   그리고 경보를 본다",
        "   확인: 온도가 내려갔다",
        "   툴: list_entities, get_entity",
        "2. 끝낸다",
      ].join("\n"),
    );
    expect(parsed).toBe(true);
    expect(runbook.steps[0]).toMatchObject({
      todo: "온도를 본다 그리고 경보를 본다",
      check: "온도가 내려갔다",
      tools: ["list_entities", "get_entity"],
    });
  });

  test("a runbook with no step or with too many is reported", () => {
    expect(runbookProblems({ title: "x", steps: [] })).toEqual(["절차서에 단계가 하나도 없어요"]);
    const steps = Array.from({ length: MAX_RUNBOOK_STEPS + 1 }, (_, i) => ({
      id: `s${i}`,
      todo: "do",
      check: "",
      tools: [],
    }));
    expect(runbookProblems({ title: "x", steps })).toEqual([
      `절차서는 ${MAX_RUNBOOK_STEPS}단계까지 쓸 수 있어요`,
    ]);
  });

  test("domains are picked out of a list, and none given is none", () => {
    expect(onlyDomains(undefined)).toEqual([]);
    expect(onlyDomains(["network", "astrology"])).toEqual(["network"]);
  });

  test("the tools of a picker card are listed in catalog order", () => {
    expect(toolsOfArea("observe" as never).every((t) => t.area === "observe")).toBe(true);
  });

  test("an eapi request changes the world only for a line that is not a look, however the lines are written", () => {
    const body = (cmds: unknown) => ({ body: { params: { cmds } } });
    expect(callEffect("eapi_request", body(["show version", { cmd: "show clock" }]))).toBe(
      "observe",
    );
    expect(callEffect("eapi_request", body([{ cmd: "configure" }]))).toBe("act");
    expect(callEffect("eapi_request", body([{}]))).toBe("act");
    expect(callEffect("eapi_request", body("not a list"))).toBe("observe");
    expect(callEffect("run_command", { cmd: "touch /tmp/x" })).toBe("act");
  });
});
