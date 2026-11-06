/**
 * The eight faults of the database and storage-HA layers (REQ-095, ADR-0107 item 6). Physics moves the state along
 * with them (physics/db.ts), the services that lean on the database or the pool feel it (db-health.ts), and the
 * table in docs/design-docs/db-storage-layers.md says how each one is ended. The full disk of a database host and a
 * file system that went read-only are the OS faults of the host (faults-os.ts); the database reads them from there.
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

export const DB_FAULT_SPECS: readonly FaultSpec[] = [
  {
    type: "db_primary_down",
    label: "프라이머리 인스턴스 다운",
    description:
      "프라이머리 인스턴스가 죽었고 다시 시작해도 안 떠요(데이터 파일 손상). 다른 인스턴스를 승격하거나 백업에서 복원해야 해요",
    targets: ["db_instance"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "db_secondary_down",
    label: "세컨더리 인스턴스 다운",
    description:
      "세컨더리 인스턴스가 멈췄어요. 프라이머리는 멀쩡하지만 복제본이 하나 줄어 이중화가 약해져요. 인스턴스를 다시 시작하면 돌아와요",
    targets: ["db_instance"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "db_replication_broken",
    label: "복제 끊김",
    description:
      "세컨더리가 프라이머리를 따라오지 못해 복제 지연이 계속 늘어요. 인스턴스를 다시 시작하면 복제가 다시 이어져요",
    targets: ["db_instance"],
    params: [p("lagPerMin", "늘어나는 속도", 10, 3600, 120, "초/분")],
    status: "supported",
    domain: "os",
  },
  {
    type: "db_split_brain",
    label: "스플릿 브레인",
    description:
      "자동 페일오버가 프라이머리의 상태를 잘못 감지해 두 인스턴스가 모두 프라이머리라고 생각해요. 양쪽에 쓰기가 갈려 데이터가 어긋나요",
    targets: ["db_cluster"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "db_backup_corrupt",
    label: "백업 손상",
    description:
      "가장 최근 백업(들)이 깨져 있어요. 평소엔 모르다가 복원할 때 검사에서 실패해요. 더 오래된 백업을 골라야 해요",
    targets: ["db_cluster"],
    params: [p("bad", "깨진 백업 수(최신부터)", 1, 3, 1, "개")],
    status: "supported",
    domain: "os",
  },
  {
    type: "storage_path_cut",
    label: "스토리지 경로 끊김",
    description:
      "컨트롤러로 가는 경로(케이블·존)가 끊겨요. 컨트롤러는 멀쩡해서 다른 경로로 바꾸면 돼요. 멀티패스면 호스트가 알아서 바꿔요",
    targets: ["storage_controller"],
    params: [],
    status: "supported",
    domain: "storage",
  },
  {
    type: "storage_controller_failure",
    label: "스토리지 컨트롤러 고장",
    description:
      "컨트롤러 하나가 고장 나요. 멀티패스면 남은 컨트롤러로 느려진 채 버티고, 아니면 다른 경로로 직접 바꿔야 해요",
    targets: ["storage_controller"],
    params: [],
    status: "supported",
    domain: "storage",
  },
  {
    type: "storage_node_lost",
    label: "분산 스토리지 노드 상실",
    description:
      "분산 스토리지의 노드 하나를 잃어요. 그 노드에 있던 복제본이 사라져 재복제가 끝날 때까지 느려지고, 하나를 더 잃으면 쓰기가 막혀요",
    targets: ["storage"],
    params: [],
    status: "supported",
    domain: "storage",
  },
];
