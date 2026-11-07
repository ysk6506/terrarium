---
title: 툴 범위, 에스컬레이션, 절차서 — 실험 설계자가 정하는 세 가지 변수
kind: spec
status: active
last_verified: 2026-11-07
covers:
  - packages/core/src/tools/docs.ts
  - packages/core/src/tools/runbook.ts
  - packages/core/src/scenario/tool-scope.ts
  - packages/core/src/scenario/sop.ts
  - packages/core/src/session/human.ts
  - packages/core/src/session/human-line.ts
  - packages/core/src/session/tool-pick.ts
  - apps/server/src/runtime/escalations.ts
verification_log:
  - "2026-11-06: run_command의 툴 설명(tools/docs.ts)이 깊은 OS 흉내로 바뀐 것을 확인했다. 표의 필요한 툴은 그대로다 (REQ-098)"
  - "2026-11-06: o3 합치기 (깊은 OS 흉내)"
  - "2026-11-07: REQ-100 애플리케이션 층: 코드와 대조해 해당 절을 더하거나 고쳤고 나머지는 그대로 맞다"
  - "2026-11-07: o5 합치기 (애플리케이션 층)"
  - "2026-11-07: REQ-106 고장 열다섯의 필요한 툴과 툴 80개로 고쳤다"
covers_hash: e80cc210383c53ef
---
# 툴 범위, 에스컬레이션, 절차서 (REQ-080~082, ADR-0087, ADR-0105)

## 한 줄로

테라리움은 "우리가 주는 툴 안에서 에이전트가 운영을 얼마나 잘 하나"를 잰다. 그래서 **어떤 툴을 줄지, 모르면 사람에게 물을 수 있는지, 팀의 절차서를 줄지**는 우리 취향이 아니라 **실험 설계자가 정하는 변수**다. 세 가지 모두 실험 만들기 화면에서 고르고, 결과에는 점수와 따로 적힌다.

## 쉬운 비유

신입 엔지니어를 평가한다고 하자. 어떤 열쇠를 줄지(툴), 막히면 선배에게 전화해도 되는지(에스컬레이션), 인수인계 문서를 줄지(절차서)를 먼저 정한다. 열쇠가 없는 문을 열라고 시키면 실력이 아니라 열쇠를 재는 것이다. 선배에게 전화해도 되는데 전화를 안 하고 끙끙대면 그것도 결과다. 문서를 줬는데 안 따랐으면 그것도 결과다. 이 문서는 그 세 가지를 코드가 어떻게 다루는지 적는다.

## 1. 툴 고르기

### 영역 카드와 현실 수준 꼬리표

툴 80개는 일곱 영역 카드에 나뉜다(`TOOL_DOCS`의 `area`). 카드는 접혀 있고 펼치면 세부 툴이 나온다. 맨 위에 검색 한 칸이 있다(툴 이름, 제목, 영역, 흔함·드묾·없음으로 찾는다).

| 영역 | 툴 |
|---|---|
| 서버 | `redfish_request`, `power_server`, `run_command` |
| 전원 | `reset_breaker`, `snmp_request` |
| 냉방 | `bacnet_request`, `set_cooling_setpoint`, `restart_cooling_unit` |
| 네트워크 | `network_cli`, `eapi_request`, `nxapi_request`, `sdn_status`, `sdn_sync`, `sdn_failover`, `overlay_trace`, `evpn_sessions`, `policy_list`, `policy_revert`, `ingress_status`, `ingress_restart` |
| 가상화 | `vcenter_request`, `vrops_request`, `migrate_vm`, `failover_service`, `restart_service` |
| 관측 | `list_alarms`, `list_entities`, `get_entity`, `get_topology`, `get_impact`, `query_metrics`, `facility_status`, `list_services`, `service_status`, `db_status`, `storage_status`, `kubectl_get`, `kubectl_describe`, `kubectl_logs`, `events_since` |
| 조치 | `wait`, `submit_diagnosis`, `ask_human`, `search_runbooks`, `escalate`, `db_promote`, `db_failover`, `db_restore`, `storage_path_switch`, `kubectl_rollout_restart`, `kubectl_scale`, `kubectl_cordon`, `kubectl_uncordon`, `kubectl_drain`, `kubectl_delete_pod`, 작업 티켓 셋 |

툴마다 **현실 수준 꼬리표**가 작은 칩으로 붙는다: **흔함**(현실의 운영팀이 오늘 가진 것: 장비 API, 알람, 메트릭, 서비스 상태), **드묾**(몇 곳에만 있는 것: 토폴로지, 절차서 찾기), **없음**(현실에 없는 것: 영향 범위 분석). 드묾·없음 툴을 켜면 그 아래에 "현실엔 거의 없는 툴이에요 — 이 툴의 가치를 재는 실험이 돼요"가 한 줄 나온다. 영향 범위는 툴이 아니라 **채점 기준**(세계가 아는 정답)으로 쓴다.

### 기본 묶음 = 흔함만

`DEFAULT_TOOLSET`은 꼬리표가 흔함인 툴 가운데, 날것의 프로토콜 요청(Redfish, vCenter, vROps, SNMP, BACnet, 스위치 CLI·eAPI·NX-API)을 빼고 `run_command`는 넣은 것이다. `get_topology`(드묾)와 `get_impact`(없음)는 빠졌다. `ask_human`과 `search_runbooks`는 흔함·드묾이지만 **설계자가 일부러 켜야** 한다(`OPT_IN_TOOLS`): 답할 사람을 정해야 하고, 절차서는 실험 변수이기 때문이다.

### "이 시나리오에 필요한 툴"

시나리오의 고장(아래 5절 표)에서 계산한다. 고장마다 그 고장을 풀거나 피해를 줄이는 툴 목록의 **첫 번째**를 고르고, 늘 필요한 `list_alarms`와 `submit_diagnosis`를 더한다. 화면 맨 위에 "이 시나리오에 필요한 툴 n개"와 아직 꺼 둔 툴이 있으면 알려 주고, **필요한 것만 켜기** 버튼이 그 툴만 남기고 나머지를 끈다. 이미 그대로면 버튼이 꺼진다.

### 툴 묶음 저장해 두기

툴 묶음은 이름을 붙여 저장하고 불러오고(같은 이름으로 다시 저장하면 바뀐다) 지울 수 있다. 지우면 7일 안에는 "되돌리기"가 나온다(ADR-0092 3번의 저장해 두기 패턴). 보관은 **서버**다: 만든 사람의 것이고 세계·시나리오와 무관하며, 지시문·툴 묶음·절차서가 한 곳(`PresetRecord`, 종류 `instruction`·`toolset`·`runbook`)에 있다. 이름을 바꿀 수 있다. 이 브라우저에 있던 옛 저장분은 처음 열 때 서버로 한 번 옮기고 지운다(ADR-0112, 지운 것은 옮기지 않는다).

## 2. 툴 설명 표준

모든 툴 설명은 `TOOL_DOCS`의 같은 다섯 칸에서 나오고, 에이전트가 읽는 MCP `description`은 이 칸들을 같은 순서로 이어 붙여 만든다(`standardDescription`). 사람이 카탈로그에서 보는 것과 에이전트가 읽는 것이 같다.

| 칸 | 예: `reset_breaker` |
|---|---|
| 한 줄 요약 | Reset a tripped breaker on a power panel or PDU. |
| 언제 쓰나 | Use when: a breaker fell and the cause (overload) is gone or reduced. |
| 언제 쓰지 않나 (대신 무엇을) | Don't use when: you do not yet know which breaker fell (use facility_status first) or the load is still over capacity (it trips again; shed load first). |
| 입력 예 하나 | Example: {"id":"pdu-a"} |
| 읽기/쓰기 | Access: changes the world. |
| 비용 | Cost: low (one change). |

`tests/spec/tool-scope.test.ts`가 강제한다: 모든 툴이 다섯 칸을 채웠고(빈 칸·너무 짧은 칸 없음), 영역과 현실 수준이 있고, **입력 예가 그 툴의 입력 스키마에 맞는 JSON 하나**이고, "대신 무엇을" 칸에 쓴 `(use X)`의 X가 실제 툴이고, 에이전트가 읽는 설명이 칸 순서 그대로다.

### 툴 고르기 점검

변별력 점검(편집기 옆 패널)에 "툴 고르기 점검"이 더해진다. **툴 설명만 읽는 기준 에이전트**(모델 없음)가 상황 열 가지에서 어느 툴을 고르는지 표로 보인다.

- 상황은 알람이 에이전트를 두는 자리다: 방 온도가 올라요, 전원이 끊겼어요, 서비스가 멈추거나 느려요, 서버 안에서 디스크·메모리·프로세스가 이상해요, 스위치 포트·VLAN·경로가 이상해요, VM이 있는 서버가 뜨겁거나 망가졌어요, 알람이 울렸어요(무엇인지 몰라요), 조치했어요(좋아졌는지 보고 싶어요), 권한이나 툴이 모자라요, 평소 절차를 몰라요(`PICK_SITUATIONS`).
- 기준 에이전트는 툴마다 "한 줄 요약"과 "언제 쓰나"에 상황의 낱말이 몇 개 나오는지 센다. 가장 많이 나온 툴(동점은 모두)이 그 상황의 선택이다.
- 표는 행이 상황, 열이 툴이다. ● 맞게 골랐어요(사람이 받아들일 툴), ○ 기대한 툴인데 못 골랐어요, 골랐지만 기대한 툴이 아니면 다른 색의 ●.
- **모호한 쌍**: 같은 상황에서 둘 다 골랐고 어느 쪽의 "언제 쓰지 않나"도 다른 쪽을 가리키지 않으면 그 쌍을 화면에 보인다("설비 현황과 차단기 리셋이 '전원이 끊겼어요'에서 둘 다 골라져요. 한쪽 설명에 '대신 무엇을 쓰나'를 적어 주세요"). 경고는 점검 결과 목록에도 들어간다.
- 처음 돌렸을 때 나온 쌍은 하나였다: `facility_status`와 `reset_breaker`(전원이 끊겼어요). `reset_breaker`의 "언제 쓰지 않나"에 "어느 차단기가 떨어졌는지 모르면 `facility_status`를 먼저"를 더해 풀었다. 지금 기본 묶음에서는 쌍이 없다.

기준 에이전트는 낱말을 세는 읽기 시험이지 모델이 아니다. 모델은 다르게 고를 수 있다. 하지만 두 설명이 낱말까지 같으면 누구도 못 가린다.

## 3. 에스컬레이션 `ask_human`

### 실험 설정: 에스컬레이션 처리

| 처리 | 부르면 |
|---|---|
| 사람 기다림 | 실행이 "사람 기다리는 중"으로 멈춘다. 카드가 뜬다. |
| 정해 둔 답으로 자동 응답 (기본) | 설정에 적은 글(답 한 칸)을 바로 돌려주고 실행은 이어진다. |
| 실패로 끝냄 | 실행이 끝난다(끝난 이유: "사람에게 넘기다 끝남"). |

`ask_human`을 켜야 이 설정을 고를 수 있다(안 켜면 칸이 꺼져 있고 이유가 적힌다). 자동 응답의 기본 글은 "지금은 사람이 도와줄 수 없어요. 가진 툴로 할 수 있는 만큼 하고 진단을 제출하세요."다.

### 상태 흐름

```
에이전트가 ask_human { request } 를 부른다
 ├ 처리 = 실패로 끝냄  → 부른 기록을 남기고 실행 끝 (escalated)
 ├ 처리 = 자동 응답    → 정해 둔 글이 툴 결과로 돌아가고 실행은 이어진다
 └ 처리 = 사람 기다림  → [사람 기다리는 중]
        세계 시간이 멈춘다 · 다른 툴 호출은 거절된다 · 실제 시간은 잰다
        ├ 답만 하기        → 글이 툴 결과(reply)로 돌아간다 ──────────────┐
        ├ 대신 조치하기    → 사람이 한 변경(0개 이상)을 요약해서 돌려준다 ──┤→ [실행 이어짐]
        ├ 툴 더 주고 계속  → 고른 툴이 에이전트 목록에 더해진다 ───────────┘
        └ 끝내기 / 실험을 멈춤 → 실행이 끝난다 (escalated / cancelled)
```

- 세계 시간은 툴을 부를 때만 가는 기본 방식에서는 원래 멈춰 있고, 실제 시간 방식에서는 기다리는 동안 흐르지 않으며 기다린 시간은 그 뒤에도 세지 않는다. 에이전트의 실제 시간 제한(기본 30분)에도 기다린 시간은 들어가지 않는다.
- **대신 조치하기**: 사람은 에이전트가 가진 것과 같은 조작(서버 전원, 차단기 리셋, 냉방기 다시 시작·설정 온도, 서비스 옮기기·다시 시작)을 카드에서 한다. 이 변경은 세계의 기록에 원인 `human`으로 남아서 **에이전트의 조치로 채점되지 않는다**. 돌려주는 글은 "사람이 직접 조치했어요"와 변경 목록이다.
- 사건 기록에는 `human` 사건이 남는다: 물은 것(요청문과 최근 툴 호출 5개), 사람이 한 조치, 답한 것(누가: 사람·설정·아무도 아님, 어떻게, 기다린 실제 초).
- 카드는 홈, 그 실험, 그 실행에 뜬다(2초마다 새로 읽는다). 답할 수 있는 사람은 그 실험을 돌린 사람이다.

### 점수표에 따로

결과 화면에 "사람에게 넘긴 것" 블록이 따로 선다: **에스컬레이션 n회**, **기다린 시간**(실제 시간), **사람이 한 조치 n개**. 점수에는 섞이지 않는다.

## 4. 고장 범위

### 고장마다 풀려면 필요한 툴 (코어의 `FAULT_TOOLS`)

고장 82가지와 설정 실수 7가지가 모두 풀거나 피해를 줄이는 툴을 적었다(없는 고장은 시험이 실패한다). 목록의 아무 툴 하나면 되고 첫 번째가 "필요한 것만 켜기"가 고르는 툴이다. 표는 `controls.ts`의 `FAULT_RESPONSES`와 제어 가능 요소표에서 나온 것과 시험으로 맞춰 둔다.

| 고장 | 에이전트가 | 필요한 툴 (아무거나 하나) |
|---|---|---|
| 냉방기 정지 (`cooling_unit_failure`) | 피해를 줄여요 | `set_cooling_setpoint`, `bacnet_request`, `power_server`, `redfish_request` |
| 냉방 능력 저하 (`cooling_unit_degraded`) | 피해를 줄여요 | `set_cooling_setpoint`, `bacnet_request`, `power_server`, `redfish_request` |
| 설정 온도 틀어짐 (`setpoint_drift`) | 피해를 줄여요 | `set_cooling_setpoint`, `bacnet_request` |
| 차단기 트립 (`breaker_trip`) | 고쳐요 | `reset_breaker`, `redfish_request` |
| 한전 정전 (`grid_outage`) | 피해를 줄여요 | `power_server`, `redfish_request` |
| UPS 배터리 열화 (`ups_battery_degraded`) | 진단하고 사람을 불러요 | — |
| 수전 중단 (`utility_outage`) | 피해를 줄여요 | `bacnet_request`, `power_server`, `redfish_request` |
| 냉각 플랜트 정지 (`chiller_failure`) | 피해를 줄여요 | `set_cooling_setpoint`, `bacnet_request`, `power_server`, `redfish_request` |
| 냉각 플랜트 능력 저하 (`chiller_degraded`) | 피해를 줄여요 | `power_server`, `redfish_request` |
| CDU 정지 (`cdu_failure`) | 피해를 줄여요 | `power_server`, `redfish_request` |
| CDU 펌프 고장 (`cdu_pump_failure`) | 피해를 줄여요 | `power_server`, `redfish_request` |
| 냉각수 누설 (`coolant_leak`) | 피해를 줄여요 | `power_server`, `redfish_request` |
| 액침 순환 정지 (`immersion_circulation_failure`) | 피해를 줄여요 | `power_server`, `redfish_request` |
| 발전기 기동 실패 (`generator_start_failure`) | 피해를 줄여요 | `power_server`, `redfish_request` |
| 자동절체반 고착 (`ats_stuck`) | 피해를 줄여요 | `power_server`, `redfish_request` |
| 서버 팬 고장 (`fan_failure`) | 피해를 줄여요 | `power_server`, `redfish_request` |
| PSU 고장 (`psu_failure`) | 진단하고 사람을 불러요 | — |
| 온도 센서 오차 (`sensor_drift`) | 진단하고 사람을 불러요 | — |
| CPU 폭주 (`cpu_runaway`) | 피해를 줄여요 | `power_server`, `redfish_request` |
| BMC 무응답 (`bmc_unresponsive`) | 진단하고 사람을 불러요 | — |
| 펌웨어 올리기 실패 (`firmware_update_failure`) | 고쳐요 | `redfish_request` |
| 네트워크 링크 다운 (`link_down`) | 진단하고 사람을 불러요 | — |
| 스위치 고장 (`switch_failure`) | 진단하고 사람을 불러요 | — |
| 디스크 고장 (`disk_failure`) | 진단하고 사람을 불러요 | — |
| VM CPU 급증 (`vm_cpu_spike`) | 피해를 줄여요 | `vcenter_request` |
| 디스크 꽉 참 (`disk_full`) | 고쳐요 | `run_command` |
| 로그 폭주 (`log_flood`) | 고쳐요 | `run_command`, `restart_service` |
| 메모리 누수 (`memory_leak`) | 피해를 줄여요 | `run_command`, `restart_service`, `failover_service` |
| 프로세스 재시작 반복 (`process_crashloop`) | 피해를 줄여요 | `failover_service` |
| 좀비 프로세스 누적 (`zombie_pileup`) | 고쳐요 | `run_command`, `restart_service` |
| 파일시스템 읽기 전용 (`fs_readonly`) | 고쳐요 | `run_command` |
| 시간 동기 어긋남 (`ntp_drift`) | 고쳐요 | `run_command`, `restart_service` |
| DNS 실패 (`dns_failure`) | 고쳐요 | `run_command`, `restart_service` |
| 커널 패닉 (`kernel_panic`) | 피해를 줄여요 | `failover_service` |
| 인증서 만료 (`cert_expired`) | 진단하고 사람을 불러요 | — |
| 프라이머리 인스턴스 다운 (`db_primary_down`) | 피해를 줄여요 | `db_promote`, `db_failover`, `db_restore` |
| 세컨더리 인스턴스 다운 (`db_secondary_down`) | 고쳐요 | `run_command` |
| 복제 끊김 (`db_replication_broken`) | 고쳐요 | `run_command` |
| 스플릿 브레인 (`db_split_brain`) | 고쳐요 | `db_promote` |
| 백업 손상 (`db_backup_corrupt`) | 진단하고 사람을 불러요 | — |
| 스토리지 경로 끊김 (`storage_path_cut`) | 피해를 줄여요 | `storage_path_switch` |
| 스토리지 컨트롤러 고장 (`storage_controller_failure`) | 피해를 줄여요 | `storage_path_switch` |
| 분산 스토리지 노드 상실 (`storage_node_lost`) | 진단하고 사람을 불러요 | — |
| SDN 컨트롤러 다운 (`sdn_controller_down`) | 피해를 줄여요 | `sdn_failover` |
| 컨트롤러 설정 동기화 실패 (`sdn_sync_failed`) | 고쳐요 | `sdn_sync` |
| VXLAN 터널 끊김 (`vxlan_tunnel_down`) | 진단하고 사람을 불러요 | — |
| EVPN 세션 플랩 (`evpn_session_flap`) | 고쳐요 | `sdn_sync` |
| 인그레스 컨트롤러 다운 (`ingress_controller_down`) | 고쳐요 | `ingress_restart` |
| CNI 플러그인 고장 (`cni_plugin_failure`) | 고쳐요 | `run_command` |
| 가상 방화벽 과부하 (`nfv_firewall_overload`) | 진단하고 사람을 불러요 | — |
| 워커 NotReady (`k8s_node_notready`), 컨트롤 플레인 다운 (`k8s_control_plane_down`), CNI 고장 (`k8s_cni_failure`) | 고쳐요 | `run_command` (kubelet·containerd 다시 시작) |
| etcd 쿼럼 상실 (`k8s_etcd_quorum_lost`), 이미지 풀 실패 (`k8s_image_pull_failure`) | 진단하고 사람을 불러요 | — |
| 파드 CrashLoopBackOff (`k8s_pod_crashloop`) | 고쳐요 | `kubectl_rollout_restart` |
| 자원 부족 (`k8s_resource_exhausted`) | 피해를 줄여요 | `kubectl_scale` |
| kubelet 디스크 압박 (`k8s_disk_pressure`) | 고쳐요 | `run_command` (디스크 비우기) |
| 백엔드 플래핑 (`lb_backend_flapping`) | 피해를 줄여요 | `lb_drain` |
| 세션 저장소 다운 (`session_store_down`), 사이드카 죽음 (`sidecar_crash`), 메시 컨트롤 플레인 다운 (`mesh_control_down`) | 고쳐요 | `run_command` (redis·envoy·istiod 다시 시작) |
| 서킷 브레이커 굳음 (`circuit_breaker_stuck_open`) | 고쳐요 | `breaker_reset` |
| 재시도 폭주 (`retry_storm`) | 고쳐요 | `mesh_rollback` |
| 리전 다운 (`region_down`), 복제 지연 (`replication_lag_high`) | 피해를 줄여요 | `region_failover` |
| 사이트 정전 (`site_power_loss`) | 피해를 줄여요 | `dr_failover` |
| 복제 스트림 깨짐 (`replication_broken`) | 고쳐요 | `run_command` |
| 전환 멈춤 (`dr_failover_stuck`), 스플릿 브레인 (`split_brain`) | 고쳐요 | `dr_failover` |
| 회선 끊김·느림 (`wan_link_down`, `wan_degraded`), 콜드 이미지 낡음 (`dr_site_stale`), 지역 복제 지연·깨짐 (`geo_replication_lag`, `geo_replica_broken`) | 진단하고 사람을 불러요 | 없음 |
| 합의 DB 리더·과반 상실 (`db_leader_lost`, `db_quorum_lost`) | 고쳐요 | `db_node_restart` |
| 합의 DB 노드 지연 (`db_node_lagging`) | 고쳐요 | `db_node_restart`, `db_transfer_leader` |
| 관리형 DB 영역 장애·오락가락 (`db_az_failure`, `db_failover_flapping`) | 피해를 줄여요 | `db_managed_failover` |
| 관리형 DB 저장소 가득 (`db_storage_full`) | 고쳐요 | `db_managed_scale_storage` |
| 포트 VLAN 오설정 (`port_vlan_mismatch`) | 고쳐요 | `network_cli`, `eapi_request`, `nxapi_request` |
| 포트 꺼짐 (`port_shutdown`) | 고쳐요 | `network_cli`, `eapi_request`, `nxapi_request`, `snmp_request` |
| VLAN 인터페이스 꺼짐 (`svi_shutdown`) | 고쳐요 | `network_cli`, `eapi_request`, `nxapi_request` |
| BGP 이웃 꺼짐 (`bgp_neighbor_shutdown`) | 고쳐요 | `network_cli`, `eapi_request`, `nxapi_request` |
| 경로 지워짐 (`route_missing`) | 고쳐요 | `network_cli`, `eapi_request`, `nxapi_request` |
| PDU 콘센트 꺼짐 (`outlet_off`) | 고쳐요 | `redfish_request` |
| 잘못된 네트워크 정책 배포 (`network_policy_deny`) | 고쳐요 | `policy_revert` |

"진단하고 사람을 불러요"는 원격 툴로 고칠 수 없는 고장이다. 필요한 툴이 없으므로 어떤 묶음에서도 범위 안이다(진단하고 사람을 부르는 길은 `escalate`가 맡는다, ADR-0098·0100).

### 실험 설정: 고장 범위

"준 툴 안에서만 / 전부" (기본: 전부).

- **준 툴 안에서만**: 시나리오의 **주 고장**(진단 정답이 가리키는 고장)을 풀 툴이 하나도 없으면 시나리오 목록에서 그 시나리오가 **회색**이 되고 이유가 붙는다("`restart_cooling_unit`이 없어서 풀 수 없어요"). 고를 수 없고, 서버도 이 조합으로 만든 실험을 거절한다. 진단 정답에 안 나오는 **배경 고장**은 시나리오에 있어도 준 툴이 못 닿으면 **일어나지 않는다**(실행 기록에 "일어나지 않음"으로 남는다).
- **전부**: 범위 밖 시나리오도 고를 수 있고, 목록에 "준 툴로는 풀 수 없어요. 에스컬레이션을 재는 실험이 돼요"가 붙는다. 일부러 범위 밖을 켜면 에스컬레이션 자체를 재는 실험이다.

고장 범위는 벤치마크 키(같은 세트로 묶는 기준)에 들어간다("준 툴 안에서만"일 때만). 에스컬레이션 처리와 절차서는 툴처럼 **에이전트 쪽 조건**이라 키에 넣지 않는다.

## 5. 절차서(SOP)

### 실험 변수: 안 줌 / 줌 / 찾게 함

| 방식 | 에이전트가 받는 것 |
|---|---|
| 안 줌 (기본) | 아무것도. (그래도 결과에는 절차서를 얼마나 따랐는지가 적힌다) |
| 줌 | 일을 맡을 때 받는 글 끝에 "팀 절차서 '이름'를 따라 일하라: 1. 할 일 (확인: …) [툴: …] …"이 붙는다. |
| 찾게 함 | 글에는 없고, `search_runbooks` 툴이 같이 켜져서 그 툴로 찾는다(질문 낱말에 맞는 절차서, 없으면 전부). |

"찾게 함"을 고르면 절차서 찾기 툴이 켜지고, 다른 것을 고르면 꺼진다. 툴을 직접 켜고 끄면 방식이 따라온다(한 선택을 두 군데서 보는 것이다). 서버는 "찾게 함"이 아닌데 찾기 툴만 켠 실험을 거절한다.

### 시나리오 편집기의 절차서 탭

시나리오 문서가 `runbook`을 가진다(제목과 단계, 단계는 할 일·확인할 것·쓰는 툴). 절차서가 바뀌면 시나리오의 버전(해시)도 바뀐다. 탭에서:

- 단계 더하기·고치기·위아래 옮기기·지우기, 단계마다 툴을 칩으로 더하고 뺀다(30단계까지). 툴이 없는 단계는 생각일 뿐이라 점수를 세지 않는다고 적혀 있다.
- **최고 궤적에서 초안 만들기**: 이 시나리오로 끝난 모든 실행 가운데 점수가 가장 높은 것(같으면 먼저 한 것)의 성공한 툴 호출을 순서대로 단계로 만든다. 연속해서 같은 툴은 한 단계로 합치고, 기다리기·진단 제출·사람에게 묻기는 뺀다. 최대 12단계. 초안이 어느 실험의 몇 점짜리 실행에서 나왔는지 적어 준다. 끝난 실행이 없으면 그렇게 말한다.
- **팀 SOP 붙여 넣기**: 마크다운을 단계로 나눈다. `# 제목`은 이름이 되고, 번호나 `-` 목록의 한 줄이 한 단계다. 그 아래 줄 가운데 `확인: …`은 확인할 것, `툴: …`은 쓰는 툴이다. 따로 쓰지 않아도 단계 글에 툴 이름이 있으면 쓰는 툴로 잡는다. 목록을 못 찾으면 글 전체를 **한 단계**로 넣고 그렇게 알려 준다. 붙여 넣기는 실패하지 않는다.
- 절차서도 이름을 붙여 저장해 두고 불러올 수 있다("내 절차서").

### SOP 준수 채점 규칙 (`scoreSop`)

복구 우선 채점과 **별도 블록**이다. 총점에 섞이지 않고, 시험이 확인한다(절차서를 줘도 안 줘도 같은 행동의 점수는 같다).

- **했나**: 단계에 적힌 툴 중 하나를 **성공적으로** 한 번이라도 부르면 그 단계를 한 것이다. 실패한 호출은 안 친다.
- **순서**: 한 단계들을 절차서 순서대로 훑어, 그 단계를 처음 한 호출이 앞서 한 단계들의 처음 호출보다 뒤이면 순서대로다. 뒷 단계를 먼저 했으면 순서가 달랐다.
- **건너뜀**: 툴이 적힌 단계인데 한 번도 안 한 단계.
- 툴이 없는 단계는 센 단계에서 뺀다.
- 숫자: **단계 수행**(한/센), **순서**(순서대로 한 단계/한 단계, 두 단계 미만이면 100%), **건너뜀**(단계 수), **절차서 준수** = 순서대로 한 단계 / 센 단계(%).
- 절차서에 없는 쓰기 툴을 쓰면 이름을 적어 알려 줄 뿐 감점은 없다.
- 절차서가 있는 시나리오라면 "안 줌"으로 돌려도 준수가 계산된다. 안 줘도 따랐는지 보는 기준선이다.

## 정직한 한계

- 저장해 두기(지시문·툴 묶음·절차서)는 서버에 있지만 만든 사람만 본다. 팀에 공개는 아직 없다.
- "대신 조치하기"는 카드 안에서 한다. 3D 세계 화면을 열어 놓고 거기서 직접 바꾸는 것은 아니다. 카드가 보여 주는 조작은 일곱 가지다.
- 사람을 기다리는 호출은 서버 메모리에 있다. 서버가 다시 시작되면 그 실행은 "서버가 다시 시작되어 실행이 중단됐어요"로 실패한다.
- 툴 고르기 점검의 기준 에이전트는 낱말을 세는 읽기 시험이고 상황은 열 가지다. 새 툴을 더하면 상황 표에 그 툴이 기대되는 자리도 같이 적어야 한다.
- SOP 준수는 툴 이름만 본다. 같은 툴을 다른 대상에 불렀는지, 확인한 내용이 맞는지는 보지 않는다.
- 고장 범위의 기본은 "전부"다. "준 툴 안에서만"을 기본으로 하면 기본 묶음에 없는 네트워크 툴 때문에 스위치 시나리오가 처음부터 회색이 된다.
- 기본 묶음에서 `get_topology`와 `get_impact`가 빠졌다. 내장 대본 에이전트(`triage`)는 영향 범위 없이 알람만으로 풀어 냉방기 시나리오 점수가 그대로다.
