/**
 * The ten faults of a host's operating system (REQ-087, ADR-0091). Physics moves the host's state along with them
 * (os-physics.ts) and the services on the host feel it (service-health.ts); the fake shell shows them as a person
 * on the host would see them. Each can be undone the way an operator would, and the table in
 * docs/design-docs/service-os-layer.md says how.
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

const host = {
  targets: ["server", "vm"],
  status: "supported",
  domain: "os",
} as const;

export const OS_FAULT_SPECS: readonly FaultSpec[] = [
  {
    type: "disk_full",
    label: "디스크 꽉 참",
    description: "디스크가 가득 차서 파일을 더 쓸 수 없어요(오래된 로그가 쌓였어요)",
    params: [],
    ...host,
  },
  {
    type: "log_flood",
    label: "로그 폭주",
    description: "프로세스가 로그를 쏟아내서 디스크가 계속 차올라요",
    params: [p("pctPerMin", "차오르는 속도", 0.5, 20, 3, "%/분")],
    ...host,
  },
  {
    type: "memory_leak",
    label: "메모리 누수",
    description: "프로세스가 메모리를 놓지 않아 쓰는 양이 계속 늘어요. 가득 차면 강제 종료돼요",
    params: [p("pctPerMin", "늘어나는 속도", 0.5, 10, 2, "%/분")],
    ...host,
  },
  {
    type: "process_crashloop",
    label: "프로세스 재시작 반복",
    description: "서비스 프로세스가 뜨자마자 죽기를 반복해요. 다시 시작해도 같아요",
    params: [p("intervalS", "죽는 간격", 10, 120, 30, "초")],
    ...host,
  },
  {
    type: "zombie_pileup",
    label: "좀비 프로세스 누적",
    description:
      "끝난 자식 프로세스를 거두지 않아 좀비가 쌓이고, 너무 많으면 새 프로세스를 못 만들어요",
    params: [p("perMin", "쌓이는 속도", 5, 600, 40, "개/분")],
    ...host,
  },
  {
    type: "fs_readonly",
    label: "파일시스템 읽기 전용",
    description: "디스크 오류로 파일시스템이 읽기 전용으로 바뀌어 아무것도 쓸 수 없어요",
    params: [],
    ...host,
  },
  {
    type: "ntp_drift",
    label: "시간 동기 어긋남",
    description: "시계가 시간 서버와 점점 어긋나요. 5분을 넘으면 인증이 실패해요",
    params: [p("secPerMin", "어긋나는 속도", 5, 600, 90, "초/분")],
    ...host,
  },
  {
    type: "dns_failure",
    label: "DNS 실패",
    description: "이름을 IP로 바꾸지 못해요. 주소로 직접 부르면 되고, 이름으로 부르면 실패해요",
    params: [],
    ...host,
  },
  {
    type: "kernel_panic",
    label: "커널 패닉",
    description: "커널이 멈춰 호스트가 저절로 다시 부팅해요. 그동안 올라간 서비스가 멈춰요",
    params: [p("downSeconds", "내려가 있는 시간", 30, 1800, 240, "초")],
    ...host,
  },
  {
    type: "cert_expired",
    label: "인증서 만료",
    description: "서비스가 쓰는 인증서가 만료돼 TLS 연결이 거부돼요",
    params: [],
    ...host,
  },
];
