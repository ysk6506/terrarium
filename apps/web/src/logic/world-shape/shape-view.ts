/**
 * "이 모양이면" (ADR-0107 item 3, ADR-0108 item 4): what the eight choices come to, read off the core and not written
 * by hand. The numbers are the plan's (`planShape`, the same count the generator follows); the faults are the union
 * of what each modelled choice stops or slows; the ways to bring it back are the tools of `FAULT_TOOLS`; the
 * scenarios are the library's templates whose problems the shape can have. (Every choice is solid since REQ-106; `dotted` stays and is empty.)
 */
import {
  ALL_SCENARIO_TEMPLATES,
  FAULT_TOOLS,
  problemName,
  type ScopeKey,
} from "@terrarium/core/scenario";
import {
  buildFor,
  buildOf,
  hostsOf,
  layersOf,
  planShape,
  SERVICE_LAYERS,
  type ServiceDraft,
  type ShapeSpec,
} from "@terrarium/core/sources/worldgen";
import {
  drTargets,
  LADDER,
  LAYER_IDS,
  type Layers,
  linkMsOf,
  SITE_MODE_LABELS,
  spanText,
} from "@terrarium/core/world";
import { won } from "../format";
import { cardOf } from "./ladders";

/** Phrases for the tools that bring a problem back, in the words of the person doing it. */
const WAYS: Readonly<Record<string, string>> = {
  power_server: "서버 끄고 켜기",
  redfish_request: "서버 끄고 켜기",
  set_cooling_setpoint: "설정 온도 바꾸기",
  bacnet_request: "냉방 제어",
  reset_breaker: "차단기 올리기",
  run_command: "서비스 다시 띄우기",
  restart_service: "서비스 다시 띄우기",
  failover_service: "예비로 옮기기",
  vcenter_request: "VM 옮기기",
  network_cli: "스위치 설정 고치기",
  eapi_request: "스위치 설정 고치기",
  nxapi_request: "스위치 설정 고치기",
  snmp_request: "스위치 설정 고치기",
  db_promote: "복제본 승격하기",
  db_failover: "페일오버하기",
  db_restore: "백업에서 복원하기",
  storage_path_switch: "스토리지 경로 바꾸기",
  sdn_sync: "스위치 설정 다시 밀기",
  sdn_failover: "컨트롤러 넘기기",
  policy_revert: "정책 되돌리기",
  ingress_restart: "인그레스 다시 시작",
  kubectl_rollout_restart: "롤아웃 재시작하기",
  kubectl_scale: "레플리카 줄이기",
  kubectl_drain: "노드 비우기",
  dr_failover: "사이트 전환하기",
  dr_failback: "본 사이트로 되돌리기",
  volume_promote: "복제 볼륨 승격하기",
  db_node_restart: "DB 노드 다시 띄우기",
  db_transfer_leader: "리더 넘기기",
  db_managed_failover: "관리형 DB 영역 넘기기",
  db_managed_scale_storage: "저장소 늘리기",
  gpu_reset: "GPU 리셋하기",
  job_resume: "잡 이어서 돌리기",
  node_drain: "노드 비우기",
  pool_scale: "풀 크기 바꾸기",
  set_power_cap: "전력 캡 걸기",
  transfer_feed: "수전 줄 옮기기",
  cdu_pump_switch: "예비 펌프 돌리기",
};

export interface ShapeView {
  readonly hosts: number;
  readonly vms: number;
  readonly switches: number;
  /** GPUs and the kilowatts of the whole world (REQ-107): shown when the world has GPUs. */
  readonly gpus: number;
  readonly kw: number;
  readonly costM: number;
  readonly stops: readonly string[];
  readonly slows: readonly string[];
  readonly ways: readonly string[];
  readonly scenarios: number;
  /** The templates those scenarios are made from, for the quick experiment to take its faults from. */
  readonly templateIds: readonly string[];
  /** Scenarios that can only be solved by handing over, by whom. */
  readonly handover: ReadonlyArray<{ readonly team: string; readonly count: number }>;
  /** The faults the shape has, kept for the workload card. */
  readonly problems: readonly ScopeKey[];
  /** Layers whose choice the core cannot imitate. */
  readonly dotted: readonly string[];
  /** The second site, when the world has one: what it is and what it promises (REQ-106). */
  readonly dr?: { readonly label: string; readonly promise: string };
}

const NETWORK_TEAM: ReadonlySet<ScopeKey> = new Set<ScopeKey>([
  "link_down",
  "switch_failure",
  "vxlan_tunnel_down",
  "nfv_firewall_overload",
  "sdn_controller_down",
  "wan_link_down",
  "wan_degraded",
]);

/** Who a problem is handed to when no tool cures it. */
function teamOf(problem: ScopeKey): string {
  if (NETWORK_TEAM.has(problem)) return "네트워크팀";
  if (problem === "ups_battery_degraded" || problem === "cert_expired") return "시설팀";
  if (problem === "storage_node_lost" || problem === "disk_failure") return "스토리지팀";
  if (problem === "db_backup_corrupt") return "서비스/OS팀";
  return "벤더";
}

/** All the problems of the shapes a world holds (the world's, and each service's own): what stops comes first, then what only slows. */
function problemsOf(shapes: readonly Layers[]): { stops: ScopeKey[]; slows: ScopeKey[] } {
  const stops = new Set<ScopeKey>();
  const slows = new Set<ScopeKey>();
  for (const layers of shapes)
    for (const layer of LAYER_IDS) {
      const chip = LADDER[layer].find((c) => c.id === layers[layer]);
      if (!chip?.modeled) continue;
      for (const p of chip.stops) stops.add(p);
      for (const p of chip.slows) slows.add(p);
    }
  for (const p of stops) slows.delete(p);
  return { stops: [...stops], slows: [...slows] };
}

/** The problems by name, all of them: the screen cuts the list to a few and counts the rest itself. */
const names = (list: readonly ScopeKey[]): string[] => list.map(problemName);

/** The scenarios of the library whose problems the shape can have. */
function matching(problems: ReadonlySet<ScopeKey>) {
  return ALL_SCENARIO_TEMPLATES.filter((t) =>
    [...t.faultTypes, ...(t.mistakeTypes ?? [])].some((p) => problems.has(p as ScopeKey)),
  );
}

function handoverOf(
  templates: ReturnType<typeof matching>,
): ReadonlyArray<{ team: string; count: number }> {
  const counts = new Map<string, number>();
  for (const t of templates) {
    const list = [...t.faultTypes, ...(t.mistakeTypes ?? [])] as ScopeKey[];
    if (list.length === 0 || !list.every((p) => FAULT_TOOLS[p].tools.length === 0)) continue;
    const team = teamOf(list[0] as ScopeKey);
    counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  return [...counts].map(([team, count]) => ({ team, count }));
}

function waysOf(problems: readonly ScopeKey[]): string[] {
  const out = new Set<string>();
  for (const p of problems) {
    const need = FAULT_TOOLS[p];
    if (need.tools.length === 0) out.add("넘기기");
    else for (const t of need.tools) if (WAYS[t]) out.add(WAYS[t] as string);
  }
  return [...out].slice(0, 12);
}

const SERVER_COST_M = 15;
const SWITCH_COST_M = 24;

const costOf = (layer: (typeof LAYER_IDS)[number], id: string) =>
  LADDER[layer].find((c) => c.id === id)?.costM ?? 0;

/** "DR 웜 · RTO 15분 · RPO 36초": what the second site is and promises, from the core's numbers. */
function drOf(build: ReturnType<typeof buildOf>): { dr: NonNullable<ShapeView["dr"]> } | object {
  const site = build.site;
  if (!site) return {};
  const t = drTargets(site.mode, linkMsOf(site.distanceKm));
  return {
    dr: {
      label: SITE_MODE_LABELS[site.mode],
      promise: `RTO ${spanText(t.rtoS)} · RPO ${spanText(t.rpoS)}`,
    },
  };
}

export function shapeView(spec: ShapeSpec): ShapeView {
  const build = buildOf(spec.layers);
  const plan = planShape(spec);
  // the world's shape, and the shape of each service that chose its own: all of them are in the world
  const shapes = [
    spec.layers,
    ...spec.services.filter((s) => s.layers).map((s) => layersOf(spec.layers, s)),
  ];
  const { stops, slows } = problemsOf(shapes);
  const set = new Set<ScopeKey>([...stops, ...slows]);
  const templates = matching(set);
  const own = spec.services.reduce((n, s) => n + hostsOf(s, buildFor(spec.layers, s)), 0);
  const switches = Math.max(
    1,
    spec.services.reduce((n, s) => n + s.switches, 0) + ((build.spines ?? 2) - 2),
  );
  const chips =
    LAYER_IDS.reduce((m, l) => m + costOf(l, spec.layers[l]), 0) +
    spec.services.reduce(
      (m, s) => m + SERVICE_LAYERS.reduce((k, l) => k + (s.layers ? costOf(l, s.layers[l]) : 0), 0),
      0,
    );
  return {
    hosts: own + plan.spareHosts,
    vms: spec.services.reduce((n, s) => {
      const build = buildFor(spec.layers, s);
      return n + (build.bare ? 0 : s.nodes * (build.k8s?.clusters ?? 1));
    }, 0),
    switches,
    gpus: plan.gpus,
    kw: plan.kw,
    costM: (own + plan.spareHosts) * SERVER_COST_M + switches * SWITCH_COST_M + chips,
    stops: names(stops),
    slows: names(slows),
    ways: waysOf([...stops, ...slows]),
    scenarios: templates.length,
    templateIds: templates.map((t) => t.id),
    handover: handoverOf(templates),
    problems: [...set],
    ...drOf(build),
    dotted: [
      ...new Set(
        shapes.flatMap((layers) =>
          LAYER_IDS.filter((l) => LADDER[l].find((c) => c.id === layers[l])?.modeled === false).map(
            (l) => cardOf(layers[l])?.label ?? layers[l],
          ),
        ),
      ),
    ],
  };
}

/** "3대" etc. for one service of the shape, for the line under the bar. */
export const hostsText = (d: ServiceDraft, layers: Layers): string =>
  `${hostsOf(d, buildFor(layers, d))}대`;

/** Money the way the screen says it: 억 above a hundred million, 만 below. */
export const costText = (costM: number): string => won(costM);
