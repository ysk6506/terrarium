/**
 * Faults of a host's operating system (REQ-087, ADR-0091): five sheets, each a service that slows or stops because of
 * one thing on the machine it runs on. They are scored recovery first (REQ-088): the points go to the service being
 * well again soon, to acting before finding out everything, to doing no harm on the way, and to saying what broke;
 * a reboot of the host (which takes down everything else on it) takes points back. Fixes are the ones an operator
 * really has: free the disk, remount, restart the clock daemon, move the service to its standby (which also works
 * when the machine cannot be fixed, so every sheet has a way to recover, and the calibration checks it).
 *
 *   os-disk-full         디스크 꽉 참        → 요청 처리 서비스가 느려져요        → 로그를 지워요
 *   os-memory-leak       메모리 누수         → 서비스가 느려지다 죽고 다시 떠요   → 다시 시작은 잠깐, 대기 쪽으로 옮겨야 오래가요
 *   os-process-crashloop 프로세스 재시작 반복 → 서비스가 멈춰요                  → 다시 시작해도 같아요, 대기 쪽으로 옮겨요
 *   os-fs-readonly       파일시스템 읽기 전용 → 쓰는 서비스가 멈춰요              → 다시 마운트해요
 *   os-ntp-drift         시간 동기 어긋남    → 인증이 실패해 서비스가 멈춰요      → 시간 동기 데몬을 다시 시작해요
 *
 * The sheets read the world, not the tool: the same fix counts whether the agent used a dedicated tool or typed the
 * commands a person would in the host's fake Linux (ADR-0117): `df`, `du` and `find` to see the disk and `rm` to free it,
 * `mount` and `mount -o remount,rw /`, `timedatectl` and `systemctl restart chronyd`, `journalctl` and `ps` for the rest.
 * The calibration checks that those common commands show the cause (session/shell-reach.ts).
 *
 * An agent that does nothing earns nothing; an agent that only knows what to report earns the report's 30 points.
 */
import type { BlueprintIndex, Entity, FaultType } from "@terrarium/core/world";
import { agent, allOf, doc, Flow, type ScenarioTemplate, SUBMIT } from "./library-kit";
import type { Condition, Expectation } from "./model";

interface Pick {
  readonly service: Entity;
  /** The VM or server the service runs on now; the fault lands here. */
  readonly host: Entity;
  readonly hasStandby: boolean;
}

const PLACES = ["vm", "server"];

const roleOf = (props: Record<string, unknown>) => props.role;

/** A standby that can take the service now: its machine is not one of the switched-off servers of a cold DR site. */
function standbyReady(index: BlueprintIndex, place: string): boolean {
  const e = index.find(place);
  const machine = e?.kind === "vm" ? index.find(index.outgoing(e.id, "runs_on")[0]?.to ?? "") : e;
  return machine?.props.adminOff !== true;
}

/**
 * The services of the world that run on a VM or a server. Those with a standby come first (there is always a way to
 * move them, even when the machine cannot be fixed), then the preferred kinds, then by id.
 */
function candidates(index: BlueprintIndex, prefer: readonly string[]): Pick[] {
  const rank = (e: Entity) => {
    const i = prefer.indexOf(String(e.props.serviceKind));
    return i < 0 ? prefer.length : i;
  };
  const picks = [...index.ofKind("service")].flatMap((service): Pick[] => {
    const links = index.outgoing(service.id, "service_on");
    const host = links
      .filter((l) => roleOf(l.props) === "active")
      .map((l) => index.find(l.to))
      .find((e): e is Entity => e !== undefined && PLACES.includes(e.kind));
    const hasStandby = links.some((l) => roleOf(l.props) === "standby" && standbyReady(index, l.to));
    return host ? [{ service, host, hasStandby }] : [];
  });
  return picks.sort(
    (a, b) =>
      Number(b.hasStandby) - Number(a.hasStandby) ||
      rank(a.service) - rank(b.service) ||
      a.service.id.localeCompare(b.service.id),
  );
}

const is = (entity: string, field: string, value: string | number): Condition => ({
  kind: "state",
  entity,
  field,
  op: field === "failovers" ? ">=" : "==",
  value,
});

interface Plan {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly difficulty: "쉬움" | "보통" | "어려움";
  readonly fault: FaultType;
  readonly faultParams?: Readonly<Record<string, number>>;
  /** The kinds of service that show the trouble best, in order. */
  readonly prefer: readonly string[];
  /** Whether the fix is moving the service, which needs a standby. */
  readonly needsStandby: boolean;
  /** Seconds the fault runs before the agent is told. */
  readonly waitS: number;
  /** What was reported, without saying what is wrong. */
  readonly report: (service: Entity, host: Entity) => string;
  /** A fix that lasts: the service is moved off the broken host (only where the broken host stays broken). */
  readonly durable?: boolean;
}

const BUDGET = 25;
const TIME_S = 900;

/**
 * The sheet of a recovery-first scenario (ADR-0091 item 3): the score comes from the services' recovery, so the sheet
 * holds only what the axes cannot know: the diagnosis for the report, the prohibition on rebooting the host, and the
 * conditions that make the recovery last (the service is well at the end, and for a leak that a restart only pauses,
 * it was moved to its standby). Their weights are not summed; the axes carry the points.
 */
function sheet(plan: Plan, p: Pick): Expectation[] {
  const healthy = is(p.service.id, "status", "healthy");
  const diagnosis: Expectation = {
    id: "diagnosis",
    kind: "diagnosis",
    label: "고장 난 호스트와 고장 종류를 말해요",
    rootCause: [p.host.id],
    faultType: [plan.fault],
    weight: 30,
  };
  const noReboot: Expectation = {
    id: "no-reboot",
    kind: "forbidden_action",
    label: `${p.host.name} 재부팅 (그 위의 서비스가 모두 멈춰요)`,
    action: "restart",
    target: p.host.id,
    penalty: 15,
  };
  const lasting: Expectation[] = [
    {
      id: "recovered",
      kind: "final_state",
      label: `${p.service.name}가 끝났을 때 정상이에요`,
      condition: healthy,
      weight: 25,
    },
    ...(plan.durable
      ? [
          {
            id: "durable",
            kind: "final_state" as const,
            label: `${p.service.name}를 대기 쪽으로 옮겨 오래 가는 복구를 했어요`,
            condition: allOf([healthy, is(p.service.id, "failovers", 1)]),
            weight: 25,
          },
        ]
      : []),
  ];
  return [diagnosis, ...lasting, noReboot];
}

function template(plan: Plan): ScenarioTemplate {
  const pick = (index: BlueprintIndex): Pick | undefined =>
    candidates(index, plan.prefer).find((c) => c.hasStandby || !plan.needsStandby);
  return {
    id: plan.id,
    name: plan.name,
    summary: plan.summary,
    difficulty: plan.difficulty,
    faultTypes: [plan.fault],
    scoring: "recovery",
    unavailable: (index) =>
      pick(index)
        ? undefined
        : plan.needsStandby
          ? "켜져 있는 대기 쪽이 있는 서비스가 이 세계에 없어요 (꺼져 있는 DR 사이트로는 서비스를 옮겨도 살아나지 못해요)"
          : "VM이나 서버 위에서 도는 서비스가 이 세계에 없어요",
    build(index, worldId) {
      const p = pick(index) as Pick;
      const flow = new Flow();
      const start = flow.add("start", "start", {});
      const fault = flow.add(
        "fault",
        "inject_fault",
        {
          faultType: plan.fault,
          target: p.host.id,
          faultParams: { ...(plan.faultParams ?? {}) },
          durationSeconds: 0,
        },
        start,
      );
      const wait = flow.add("wait", "wait", { seconds: plan.waitS }, fault);
      flow.add(
        "agent",
        "agent_task",
        agent(`${plan.report(p.service, p.host)} ${SUBMIT}`, BUDGET, TIME_S * 2),
        wait,
      );
      return doc(
        this,
        worldId,
        `${p.service.name}가 도는 ${p.host.name}에서 일어나요. 장비는 멀쩡하고 운영체제 안의 일이에요.`,
        flow,
        sheet(plan, p),
      );
    },
  };
}

const diskFull = template({
  id: "os-disk-full",
  name: "디스크가 꽉 찼어요",
  summary:
    "오래된 로그가 디스크를 채워 서비스가 느려져요. 장비는 멀쩡하니 호스트 안에서 찾아야 해요.",
  difficulty: "쉬움",
  fault: "disk_full",
  prefer: ["request", "batch", "stateful"],
  needsStandby: false,
  waitS: 120,
  report: (s) => `${s.name}의 응답이 느리고 쓰기 오류가 난다는 알림이 왔다.`,
});

const memoryLeak = template({
  id: "os-memory-leak",
  name: "메모리가 계속 새요",
  summary:
    "프로세스가 메모리를 놓지 않아 서비스가 느려지다가 죽고 다시 떠요. 다시 시작은 잠깐뿐이라 서비스를 대기 쪽으로 옮겨야 오래 가요.",
  difficulty: "보통",
  fault: "memory_leak",
  faultParams: { pctPerMin: 7 },
  prefer: ["request", "batch", "stateful"],
  needsStandby: true,
  waitS: 660,
  report: (s) => `${s.name}가 점점 느려지다가 가끔 응답이 끊긴다는 알림이 왔다.`,
  durable: true,
});

const crashLoop = template({
  id: "os-process-crashloop",
  name: "프로세스가 죽고 또 죽어요",
  summary:
    "서비스 프로세스가 뜨자마자 죽기를 반복해요. 다시 시작해도 같으니, 호스트를 고치기 전에 서비스를 대기 쪽으로 옮겨야 해요.",
  difficulty: "보통",
  fault: "process_crashloop",
  prefer: ["request", "stateful", "batch"],
  needsStandby: true,
  waitS: 120,
  report: (s) => `${s.name}가 멈췄다는 알림이 왔다.`,
});

const fsReadonly = template({
  id: "os-fs-readonly",
  name: "파일시스템이 읽기 전용이 됐어요",
  summary:
    "디스크 오류로 파일시스템이 읽기 전용으로 바뀌어 쓰는 서비스가 멈춰요. 다시 마운트하면 풀려요.",
  difficulty: "보통",
  fault: "fs_readonly",
  prefer: ["stateful", "batch", "request"],
  needsStandby: false,
  waitS: 120,
  report: (s) => `${s.name}가 멈췄고 쓰기가 모두 실패한다는 알림이 왔다.`,
});

const ntpDrift = template({
  id: "os-ntp-drift",
  name: "시계가 어긋나 인증이 실패해요",
  summary:
    "호스트의 시계가 시간 서버와 5분 넘게 어긋나 인증이 실패하고 서비스가 멈춰요. 시간 동기 데몬을 다시 시작하면 돌아와요.",
  difficulty: "어려움",
  fault: "ntp_drift",
  faultParams: { secPerMin: 120 },
  prefer: ["request", "stateful", "batch"],
  needsStandby: false,
  waitS: 420,
  report: (s) => `${s.name}에 로그인과 토큰 확인이 실패한다는 알림이 왔다.`,
});

export const OS_TEMPLATES: readonly ScenarioTemplate[] = [
  diskFull,
  memoryLeak,
  crashLoop,
  fsReadonly,
  ntpDrift,
];
