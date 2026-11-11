/**
 * The faults of the site and DR layer (REQ-106, ADR-0129): a whole site without power, the WAN between the sites out or
 * slow, a copy that stopped, a failover that stalls half-way, two sites that both think they lead, and the stale images
 * of a cold site; plus the two faults of geo-replicated volumes. Physics moves the state along with them
 * (physics/site.ts), the services feel it (site-health.ts), and the table in docs/design-docs/site-dr-layer.md says
 * how each one ends.
 */
import type { FaultParamSpec, FaultSpec } from "./faults";

const p = (
  name: string,
  label: string,
  min: number,
  max: number,
  def: number,
  unit: string,
): FaultParamSpec => ({ name, label, min, max, default: def, unit });

export const SITE_FAULT_SPECS: readonly FaultSpec[] = [
  {
    type: "site_power_loss",
    label: "사이트 전체 정전",
    description:
      "사이트 하나의 전기가 통째로 끊겨요. 그 사이트의 모든 서버실이 함께 꺼져 그 위의 서비스가 멈춰요. 복구 사이트로 넘기거나 전기가 돌아오기를 기다려요",
    targets: ["dr_site"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "wan_link_down",
    label: "사이트 간 회선 끊김",
    description:
      "두 사이트를 잇는 회선이 끊겨요. 복제가 멈추고, 동기 복제는 확인을 못 받아 쓰기가 멈칫해요. 액티브-액티브에서 합의가 없으면 양쪽이 서로 자기가 주인이라고 믿을 수 있어요",
    targets: ["site_link"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "wan_degraded",
    label: "사이트 간 회선 느려짐",
    description:
      "회선이 느려지고 지연이 늘어요. 비동기 복제가 점점 밀리고, 동기 복제는 쓰기마다 느려져요. 회선이 나아지면 밀린 것을 따라잡아요",
    targets: ["site_link"],
    params: [p("factor", "밀리는 배수", 2, 100, 20, "배")],
    status: "supported",
    domain: "network",
  },
  {
    type: "replication_broken",
    label: "사이트 간 복제 끊김",
    description:
      "복제 하나가 멈춰요(오류 상태). 회선은 멀쩡해요. 시간이 갈수록 복구 사이트의 데이터가 낡아요. 복제를 다시 이어 주면 따라잡아요",
    targets: ["replication_stream"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "dr_failover_stuck",
    label: "DR 전환이 중간에 멈춤",
    description:
      "전환 자동화가 첫 단계에서 멈춰요. 서비스는 어느 쪽에서도 안 돌아요. 전환을 사람이 다시 눌러 마저 끝내요",
    targets: ["dr_plan"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "split_brain",
    label: "사이트 스플릿 브레인",
    description:
      "회선이 끊긴 사이에 두 사이트가 모두 자기가 주인이라고 믿고 쓰기를 받았어요. 합의가 없는 DB에서만 일어나요. 남길 사이트를 정해 전환하면 다른 쪽의 쓰기는 버려져요",
    targets: ["dr_plan"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "dr_site_stale",
    label: "콜드 사이트 이미지가 낡음",
    description:
      "꺼져 있는 복구 사이트의 서버 이미지가 오래됐어요. 전환하면 이미지를 먼저 다시 만들어야 해서 복구가 두 시간쯤 더 걸려요",
    targets: ["dr_site"],
    params: [p("staleDays", "이미지 나이", 31, 365, 90, "일")],
    status: "supported",
    domain: "os",
  },
  {
    type: "geo_replication_lag",
    label: "지역 복제 지연",
    description:
      "다른 사이트로 복사하는 볼륨의 복제가 밀려요. 복구 사이트의 복사본이 그만큼 낡아요. 서비스는 그대로지만 지금 전환하면 밀린 만큼 잃어요",
    targets: ["volume"],
    params: [p("lagS", "밀린 시간", 31, 7200, 900, "초")],
    status: "supported",
    domain: "storage",
  },
  {
    type: "geo_replica_broken",
    label: "지역 복제본 깨짐",
    description:
      "다른 사이트의 복사본이 깨졌어요. 복제가 멈추고 복구 사이트로 볼륨을 올릴 수 없어요. 스토리지 팀이 복사본을 다시 만들어요",
    targets: ["volume"],
    params: [],
    status: "supported",
    domain: "storage",
  },
];

/**
 * Faults that leave the services as they are (a copy that trails, a line that is cut under asynchronous copying, a stale
 * image): nothing to move, only something to find and hand over or fix. A sheet about only these has no service to bring back.
 */
export const SILENT_SITE_FAULTS: readonly string[] = [
  "wan_link_down",
  "wan_degraded",
  "replication_broken",
  "dr_site_stale",
  "geo_replication_lag",
  "geo_replica_broken",
];
