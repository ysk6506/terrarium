/**
 * The world events a condition can ask about (`event` condition, ADR-0075): what each is called in the editor, the
 * clause that reads in a sentence ("열 보호로 꺼진 적이 있어요"), and which entity or link an event is about.
 */
import type { WorldCommand, WorldEvent } from "@terrarium/core/world";

export type EventType = WorldCommand["type"];

/** The events worth asking about. `note` only goes into the log, so it is not among them. */
export const EVENT_LABELS: Readonly<Record<Exclude<EventType, "note">, string>> = {
  "thermal.shutdown": "열 보호로 꺼진 적",
  "fault.add": "고장이 난 적",
  "fault.remove": "고장이 풀린 적",
  "alarm.raise": "알람이 울린 적",
  "alarm.clear": "알람이 풀린 적",
  "power.set": "전원이 바뀐 적",
  "load.set": "부하가 바뀐 적",
  "setpoint.set": "냉방 설정 온도가 바뀐 적",
  "breaker.reset": "차단기를 리셋한 적",
  "link.admin": "포트를 끄거나 켠 적",
  "outlet.set": "콘센트를 끄거나 켠 적",
  "net.set": "스위치 설정이 바뀐 적",
  "outdoor.set": "외기 온도가 바뀐 적",
  "firmware.update": "펌웨어 올리기를 시작한 적",
  "firmware.reboot": "펌웨어 때문에 재부팅한 적",
  "firmware.finish": "펌웨어 올리기를 마친 적",
  "firmware.fail": "펌웨어 올리기에 실패한 적",
  "host.act": "호스트에서 조치한 적",
  "service.failover": "서비스를 대기 쪽으로 옮긴 적",
  "service.restart": "서비스를 다시 시작한 적",
  "vm.migrate": "VM을 다른 서버로 옮긴 적",
  "db.promote": "인스턴스를 승격한 적",
  "db.failover": "클러스터를 페일오버한 적",
  "db.restore": "백업에서 복원을 시작한 적",
  "storage.path_switch": "스토리지 경로를 바꾼 적",
  "sdn.sync": "스위치 설정을 다시 동기화한 적",
  "sdn.failover": "SDN 컨트롤러를 전환한 적",
  "policy.set": "네트워크 정책을 배포한 적",
  "policy.revert": "네트워크 정책을 되돌린 적",
  "ingress.restart": "인그레스를 다시 시작한 적",
};

export const EVENT_TYPES = Object.keys(EVENT_LABELS) as (keyof typeof EVENT_LABELS)[];

export const isEventType = (type: string): type is keyof typeof EVENT_LABELS =>
  Object.hasOwn(EVENT_LABELS, type);

/** The entity or link an event is about; undefined when it is about none (outdoor air, a log note). */
export function eventTarget(e: WorldEvent): string | undefined {
  switch (e.type) {
    case "fault.add":
      return e.fault.target;
    case "alarm.raise":
      return e.alarm.entityId;
    case "fault.remove":
    case "alarm.clear":
    case "outdoor.set":
    case "note":
      return undefined;
    default:
      return e.target;
  }
}
