/**
 * The scripted agents that need no model and tell recovery-first scoring (REQ-088, ADR-0091) from the other ways of
 * scoring: nine ways of handling a service that has stopped, from doing nothing to fixing it before looking for the
 * cause. The scoring tests and the table in the calibration notes both run them, so the table is what the tests hold.
 */
import type { ScenarioDoc } from "@terrarium/core/scenario";
import { GUESS, IDLE_ROUNDS, IDLE_WAIT_SECONDS, Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import type { Blueprint } from "@terrarium/core/world";

/** The host and the service a recovery-first sheet is about, and the kind of fault, read off its scoring sheet. */
export interface About {
  readonly host: string;
  readonly service: string;
  readonly fault: string;
  readonly id: string;
}

export function aboutOf(scenario: ScenarioDoc): About {
  const d = scenario.expectations.find((e) => e.kind === "diagnosis") as unknown as {
    rootCause: string[];
    faultType: string[];
  };
  let service = "";
  const walk = (c: unknown): void => {
    const n = c as { kind?: string; entity?: string; field?: string; of?: unknown[] };
    if (n.kind === "state" && n.field === "status" && n.entity) service = n.entity;
    for (const inner of n.of ?? []) walk(inner);
  };
  for (const e of scenario.expectations) if (e.kind === "final_state") walk(e.condition);
  return {
    host: d.rootCause[0] as string,
    service,
    fault: d.faultType[0] as string,
    id: scenario.template ?? scenario.id,
  };
}

type Run = Session;

const shell = (run: Run, host: string, cmd: string) => run.call("run_command", { host, cmd });

/** What fixes the machine itself, as the operator would do it (a service move is the other way, for the same fault). */
function fixOnHost(run: Run, a: About): void {
  switch (a.id) {
    case "os-disk-full":
      shell(run, a.host, "rm -f /var/log/*/*.log");
      return;
    case "os-fs-readonly":
      shell(run, a.host, "mount -o remount,rw /");
      return;
    case "os-ntp-drift":
      shell(run, a.host, "systemctl restart chronyd");
      return;
    default:
      run.call("failover_service", { service: a.service });
  }
}

const report = (run: Run, a: About) =>
  run.call("submit_diagnosis", {
    rootCause: a.host,
    faultType: a.fault,
    summary: "원인과 조치 보고",
  });

/** Look around the way an operator does before touching anything: what is down, why, what the machine says. */
function lookAround(run: Run, a: About): void {
  run.call("list_services", {});
  run.call("service_status", { service: a.service });
  shell(run, a.host, "df -h");
}

export interface FakeAgent {
  readonly id: string;
  readonly label: string;
  readonly run: (run: Run, a: About) => void;
}

export const FAKE_AGENTS: readonly FakeAgent[] = [
  {
    id: "idle",
    label: "아무것도 안 함",
    run: (run) => {
      for (let i = 0; i < IDLE_ROUNDS && run.status === "running"; i++)
        run.call("wait", { seconds: IDLE_WAIT_SECONDS });
    },
  },
  {
    id: "guess",
    label: "찍기",
    run: (run) => {
      run.call("submit_diagnosis", { ...GUESS, summary: "x" });
    },
  },
  { id: "knows", label: "정답만 앎", run: (run, a) => void report(run, a) },
  {
    id: "wait-after-diagnosis",
    label: "진단 후 기다리기",
    run: (run, a) => {
      lookAround(run, a);
      run.call("wait", { seconds: 600 });
      report(run, a);
    },
  },
  {
    id: "fix-and-report",
    label: "맞게 고치고 보고",
    run: (run, a) => {
      lookAround(run, a);
      fixOnHost(run, a);
      run.call("wait", { seconds: 60 });
      report(run, a);
    },
  },
  {
    id: "reboot",
    label: "호스트 재부팅",
    run: (run, a) => {
      lookAround(run, a);
      shell(run, a.host, "reboot");
      run.call("wait", { seconds: 300 });
      report(run, a);
    },
  },
  {
    id: "restart-only",
    label: "서비스 재시작만",
    run: (run, a) => {
      lookAround(run, a);
      run.call("restart_service", { service: a.service });
      run.call("wait", { seconds: 60 });
      report(run, a);
    },
  },
  {
    id: "recover-first",
    label: "복구 먼저, 원인은 나중",
    run: (run, a) => {
      run.call("failover_service", { service: a.service });
      run.call("wait", { seconds: 60 });
      lookAround(run, a);
      report(run, a);
    },
  },
  {
    id: "cause-first",
    label: "원인 먼저, 10분 뒤 복구",
    run: (run, a) => {
      lookAround(run, a);
      run.call("wait", { seconds: 600 });
      run.call("failover_service", { service: a.service });
      run.call("wait", { seconds: 60 });
      report(run, a);
    },
  },
];

/** One agent on one sheet in one world: the finished run. */
export function runFake(agent: FakeAgent, blueprint: Blueprint, scenario: ScenarioDoc) {
  const session = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
  session.start();
  agent.run(session, aboutOf(scenario));
  return session.finish();
}
