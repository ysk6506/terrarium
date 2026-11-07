/**
 * Every built-in template and the groups the new-scenario picker shows (REQ-033 to REQ-107): split from library.ts for size.
 * One list per layer of the world they break or change.
 */

import { SCENARIO_TEMPLATES } from "./library";
import { ACCEL_TEMPLATES } from "./library-accel";
import { APP_TEMPLATES } from "./library-app";
import { DB_TEMPLATES } from "./library-db";
import { DOMAIN_TEMPLATES } from "./library-domains";
import { FACILITY_TEMPLATES } from "./library-facility";
import { FIRMWARE_TEMPLATES } from "./library-firmware";
import { K8S_TEMPLATES } from "./library-k8s";
import type { ScenarioTemplate } from "./library-kit";
import { NETWORK_TEMPLATES } from "./library-network";
import { OS_TEMPLATES } from "./library-os";
import { POWER_TEMPLATES } from "./library-power";
import { SDN_TEMPLATES } from "./library-sdn";

/** The groups of built-in templates, one list per layer of the world they break or change (REQ-068 to REQ-097). */
export {
  ACCEL_TEMPLATES,
  APP_TEMPLATES,
  DB_TEMPLATES,
  DOMAIN_TEMPLATES,
  FACILITY_TEMPLATES,
  FIRMWARE_TEMPLATES,
  K8S_TEMPLATES,
  NETWORK_TEMPLATES,
  OS_TEMPLATES,
  POWER_TEMPLATES,
  SCENARIO_TEMPLATES,
  type ScenarioTemplate,
  SDN_TEMPLATES,
};

/** Every built-in template, the facility ones and then the configuration ones last. */
export const ALL_SCENARIO_TEMPLATES: readonly ScenarioTemplate[] = [
  ...SCENARIO_TEMPLATES,
  ...FACILITY_TEMPLATES,
  ...NETWORK_TEMPLATES,
  ...FIRMWARE_TEMPLATES,
  ...OS_TEMPLATES,
  ...[...DB_TEMPLATES, ...SDN_TEMPLATES, ...APP_TEMPLATES, ...K8S_TEMPLATES, ...DOMAIN_TEMPLATES],
  ...ACCEL_TEMPLATES,
  ...POWER_TEMPLATES,
];

/** How the new-scenario picker groups the templates: equipment first, then changes people make to settings. */
export const TEMPLATE_GROUPS: readonly {
  readonly id:
    | "facility"
    | "network"
    | "firmware"
    | "os"
    | "database"
    | "containers"
    | "network_overlay"
    | "application"
    | "accelerator"
    | "power_cooling"
    | "domains";
  readonly label: string;
  readonly templates: readonly ScenarioTemplate[];
}[] = [
  { id: "facility", label: "설비", templates: [...SCENARIO_TEMPLATES, ...FACILITY_TEMPLATES] },
  { id: "network", label: "네트워크·전원 설정", templates: NETWORK_TEMPLATES },
  { id: "firmware", label: "펌웨어 작업", templates: FIRMWARE_TEMPLATES },
  { id: "os", label: "OS 고장", templates: OS_TEMPLATES },
  { id: "database", label: "데이터베이스·스토리지 HA", templates: DB_TEMPLATES },
  { id: "containers", label: "컨테이너(쿠버네티스)", templates: K8S_TEMPLATES },
  { id: "network_overlay", label: "SDN·클라우드 네이티브 네트워크", templates: SDN_TEMPLATES },
  { id: "application", label: "애플리케이션 층(로드 밸런서·메시·리전)", templates: APP_TEMPLATES },
  { id: "accelerator", label: "GPU 가속기 층", templates: ACCEL_TEMPLATES },
  { id: "power_cooling", label: "전원·냉방 사다리(전력 캡 포함)", templates: POWER_TEMPLATES },
  { id: "domains", label: "내 도메인 밖이 원인", templates: DOMAIN_TEMPLATES },
];

export function scenarioTemplate(id: string): ScenarioTemplate | undefined {
  return ALL_SCENARIO_TEMPLATES.find((t) => t.id === id);
}
