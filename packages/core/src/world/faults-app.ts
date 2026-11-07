/**
 * The eight faults of the application layer (REQ-100, ADR-0121). Physics moves the state along with them
 * (physics/app.ts), the services feel it (app-health.ts, calls-health.ts), and the table in
 * docs/design-docs/application-layer.md says how each one ends. All of them are the service/OS team's.
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

export const APP_FAULT_SPECS: readonly FaultSpec[] = [
  {
    type: "lb_backend_flapping",
    label: "로드 밸런서 백엔드 플래핑",
    description:
      "백엔드 한 대의 헬스 체크가 됐다 안 됐다를 되풀이해요. 밸런서가 그 백엔드를 넣었다 뺐다 하며 요청 일부가 끊겨요. 그 백엔드를 로테이션에서 빼면(drain) 멈춰요",
    targets: ["app_instance"],
    params: [p("periodS", "한 번 오르내리는 주기", 20, 600, 120, "초")],
    status: "supported",
    domain: "os",
  },
  {
    type: "session_store_down",
    label: "세션 저장소 다운",
    description:
      "세션을 따로 두는 저장소(redis)가 멈춰요. 로그인이 풀려 서비스가 느려져요. 저장소를 다시 시작하면 돌아와요",
    targets: ["session_store"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "circuit_breaker_stuck_open",
    label: "서킷 브레이커가 열린 채 굳음",
    description:
      "서킷 브레이커 하나가 열린 채 닫히지 않아요. 부르는 서비스는 상대가 멀쩡해도 대체 응답만 받아요. 브레이커를 리셋하면 돌아와요",
    targets: ["circuit_breaker"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "retry_storm",
    label: "재시도 폭주",
    description:
      "잘못된 메시 설정(재시도 5번, 간격 없음)이 퍼져 호출이 몇 배로 불어나요. 불린 서비스가 느려지고 부르는 서비스도 따라 느려져요. 메시 설정을 되돌리면 멈춰요",
    targets: ["mesh_control"],
    params: [p("multiplier", "불어나는 배수", 2, 10, 5, "배")],
    status: "supported",
    domain: "os",
  },
  {
    type: "sidecar_crash",
    label: "사이드카 죽음",
    description:
      "인스턴스 옆 사이드카(envoy)가 죽어 그 인스턴스로 가는 트래픽이 모두 막혀요. 호스트에서 envoy를 다시 시작하면 돌아와요",
    targets: ["mesh_sidecar"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "mesh_control_down",
    label: "메시 컨트롤 플레인 다운",
    description:
      "메시 컨트롤 플레인(istiod)이 멈춰요. 이미 깔린 트래픽은 그대로 흐르고 새 설정만 못 밀어요. 설정을 되돌릴 수도 없어요. istiod를 다시 시작하면 돌아와요",
    targets: ["mesh_control"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "region_down",
    label: "리전 다운",
    description:
      "리전 하나가 통째로 멈춰요. 글로벌 로드 밸런서가 보고 빼기까지 5분쯤 걸리고, 그 리전의 세션은 사라져요. 지금 바로 다른 리전으로 옮길 수 있어요. 리전은 클라우드 팀이 살려요",
    targets: ["region"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "replication_lag_high",
    label: "리전 간 복제 지연",
    description:
      "리전 사이 복제가 밀려 그 리전에서 읽으면 옛 값이 나와요. 서비스가 느려진 것처럼 보여요. 복제가 밀리지 않은 리전으로 트래픽을 옮겨 피해요",
    targets: ["region"],
    params: [p("lagS", "밀린 시간", 31, 3600, 180, "초")],
    status: "supported",
    domain: "os",
  },
];
