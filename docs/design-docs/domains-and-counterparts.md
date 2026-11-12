---
title: 도메인과 가상 담당자 — 내 도메인 밖의 고장은 넘기고, 기다리는 동안 다른 일을 한다
kind: spec
status: active
covers:
  - packages/core/src/world/domains.ts
  - packages/core/src/world/lead-times.ts
  - packages/core/src/tools/domains.ts
  - packages/core/src/tools/catalog-ops.ts
  - packages/core/src/tools/handlers-ops.ts
  - packages/core/src/session/counterparts.ts
  - packages/core/src/session/tickets.ts
  - packages/core/src/session/hand-offs.ts
  - packages/core/src/session/ops.ts
  - packages/core/src/oracle/handoff.ts
  - packages/core/src/scenario/library-domains.ts
  - apps/server/src/adapters/harness/scripted-operator.ts
  - apps/web/src/logic/handoffs.ts
  - apps/web/src/ui/pages/run-handoffs.tsx
  - apps/web/src/ui/pages/experiment-domains.tsx
---
# 도메인과 가상 담당자 (REQ-093, [ADR-0098](adr/0098-domains-virtual-counterparts-tickets.md)·[0099](adr/0099-counterparts-deterministic.md)·[0100](adr/0100-escalate-by-domain.md))

## 한 문장으로
IT 운영은 도메인별로 나뉘어 있어서, 실험은 "내 도메인"만 맡고 나머지는 그 도메인 팀에 `escalate(domain)`으로 넘긴다. 넘긴 시점에 그 도메인에 있던 고장은 고장 종류별 리드타임이 지나면 사라지고, 그동안 서비스는 멈춰 있으므로 임시 조치를 했는지, 팀이 끝낸 뒤 되돌렸는지, 기다리는 동안 다른 알람을 봤는지를 잰다.

## 도메인 여섯 (`world/domains.ts`)
| 도메인 (`id`) | 부르는 말 | 넘기는 팀 | 맡는 것 |
|---|---|---|---|
| `service_os` | 서비스/OS | 서비스/OS 팀 | 서비스, 호스트의 운영 체제와 프로세스, 데이터베이스, 쿠버네티스(노드·파드) |
| `virtualization` | 가상화 | 가상화 팀 | VM, 클러스터, 호스트 배치 |
| `server` | 서버 | 서버 팀 | 서버 하드웨어(메모리, 팬, 전원 공급 장치, BMC) |
| `network` | 네트워크 | 네트워크 팀 | 스위치, 링크, VLAN, 라우팅 |
| `storage` | 스토리지 | 스토리지 팀 | 스토리지와 디스크, 컨트롤러와 경로, 분산 스토리지 |
| `facility` | 데이터센터 인프라 | 데이터센터 인프라 팀 | 전원, 냉방, 센서 |

고장 종류 97가지와 사람이 하는 실수 7가지에는 모두 도메인이 하나씩 달려 있다(`FAULT_DOMAIN`, `MISTAKE_DOMAIN`은 빠지면 타입 검사가 실패하고 시험이 한 번 더 센다). 어느 고장이 어느 도메인인지는 "누가 고치나"로 정했다: `cpu_runaway`는 프로세스 정리라 서비스/OS, `disk_failure`는 스토리지, 센서 틀어짐은 시설팀이라 데이터센터 인프라다. 새 고장 `memory_failure`(메모리 불량)는 서버다: 서버가 멈추고, 그 위의 VM과 서비스가 멈추며, 모듈을 바꿔야 돌아온다.

## 도메인 × 툴 (`tools/domains.ts`)
모든 툴에 도메인이 하나 달려 있다(없으면 시험이 실패한다). `common`은 어느 도메인이나 가진 툴이다.

| 도메인 | 툴 |
|---|---|
| common | `list_alarms` `list_entities` `get_entity` `get_topology` `get_impact` `query_metrics` `wait` `submit_diagnosis` `events_since` `escalate` `create_ticket` `update_ticket` `list_tickets` |
| service_os | `list_services` `service_status` `failover_service` `restart_service` `run_command` `db_status` `db_promote` `db_failover` `db_restore` `kubectl_get` `kubectl_describe` `kubectl_logs` `kubectl_rollout_restart` `kubectl_scale` `kubectl_cordon` `kubectl_uncordon` `kubectl_drain` `kubectl_delete_pod` |
| virtualization | `vcenter_request` `vrops_request` `migrate_vm` |
| server | `redfish_request` `power_server` |
| network | `network_cli` `eapi_request` `nxapi_request` `sdn_status` `sdn_sync` `sdn_failover` `overlay_trace` `evpn_sessions` `policy_list` `policy_revert` `ingress_status` `ingress_restart` (REQ-097, [SDN 오버레이와 클라우드 네이티브 네트워크 층](sdn-network-layer.md)). 컨트롤러·VTEP·인그레스·CNI·가상 방화벽의 고장과 잘못된 정책도 이 도메인의 일이다 |
| storage | `storage_status` `storage_path_switch` (REQ-095 이전에는 스토리지 전용 툴이 없어서 이 도메인의 고장은 넘기는 길로만 풀렸다. 디스크 고장은 지금도 넘기는 길뿐이다) |
| facility | `facility_status` `bacnet_request` `snmp_request` `set_cooling_setpoint` `restart_cooling_unit` `reset_breaker` |

## 내 도메인이 툴을 정한다
실험(`Recipe.domains`)이 도메인을 고르면 세션은 고른 툴 가운데 **내 도메인의 툴과 common만** 남기고 `escalate`와 `events_since`를 켠다(`scopeTools`). 다른 도메인의 툴을 부르면 "이 실험에서 쓸 수 없는 툴"로 거절된다. 도메인을 안 고르면 모든 도메인이 내 것이고 지금까지와 같다. 화면은 도메인을 고르는 순간 그 도메인의 툴 묶음을 미리 켜 준다(`experiment.setDomains`), 사람이 켠 선택 툴(티켓)은 그대로 둔다.

## `escalate(domain, note?)` (ADR-0100)
- `domain`은 위 `id` 여섯 가운데 하나이고, 부르는 말("서버", "서버 팀")도 받는다. 아니면 즉시 `가능한 도메인: service_os (서비스/OS), virtualization (가상화), …`로 답한다. 거절도 되묻기도 없다.
- 부른 시점에 그 도메인에 있는 고장마다 `lead-times.md`의 범위에서 대기 시간을 하나씩 뽑는다. 뽑는 난수는 `시드:lead:고장 id`에서 나와 호출 순서와 상관없이 같은 시드면 같은 값이다. 값은 10분 단위로 맞추고, 그 시각에 정확히 사라진다. **넘긴 뒤에 생긴 고장은 들어 있지 않다.** 한 장비의 고장이 여럿이면 한 번에 고치므로 가장 긴 대기를 같이 쓴다.
- 답: `서버 팀에 넘겼어요 · 고장 2개 · 예상 4시간 10분 / 1일 2시간` (고장마다 하나, 같은 순서) 과 고장별 `fault`·`type`·`target`·`who`(`team`/`vendor`)·`eta`·`etaSeconds`. 그 도메인에 고장이 없으면 `… 넘겼어요 · 지금 이 도메인에 고장이 없어요`.
- 끝나면 세계가 바뀐다: 고장이 제거되고(`cause`가 `counterpart:<도메인>`이라 에이전트가 한 조치로 세지 않는다), 부품을 바꾼 장비가 스스로 꺼져(열 보호) 있었다면 다시 켠다. 에이전트가 직접 끈 장비는 켜지 않는다. 그 사이에 에이전트가 이미 고쳤으면 "가 보니 이미 없어졌어요"로 끝난다.
- 시간은 세계 시간이다. 운영 모드(ADR-0094)에서도 같은 값이 그대로 흐른다.

## 사건 (`world/run-events.ts`, `events_since`)
| 사건 | 언제 | 담고 있는 것 |
|---|---|---|
| `counterpart` `handed` | `escalate`를 부른 때 | 도메인, 팀, 메모, 고장마다 예상·끝나는 때·시작하는 때·종류·누가·현장 여부 |
| `counterpart` `started` | 끝나기 전 마지막 구간이 시작될 때(부품 교체 30분, 현장 방문 20분, 원격 작업 10분 전) | 어느 장비에서, 누가, 현장인가 |
| `counterpart` `done` | 고장이 사라진 때 | 같은 고장, 한 줄 요약 |
| `ticket` `created`·`updated` | 티켓이 만들어지거나 바뀔 때 | 그때의 티켓 전체, 저절로인지 |
| 세계의 `fault.remove` | 같은 순간 | `cause`가 `counterpart:…` |

`events_since(cursor)`는 `{ cursor, events }`를 준다. 커서는 기록의 위치라서 지난 호출이 돌려준 값을 그대로 넘기면 새 것만 온다. 에이전트가 보는 사건은 알람이 올라오고 풀린 것(`alarm_raised`·`alarm_cleared`), 열 때문에 꺼진 것(`shutdown`), 넘긴 일의 `handed`·`started`·`done`뿐이다. 고장(`fault.add`)은 세계의 진실이라 보이지 않는다. 일을 맡기 전의 사건도 보이지 않는다.

## 작업 티켓 (ADR-0099 3항)
`create_ticket(title, status?, waitingFor?, dueInSeconds?, note?)`, `update_ticket(id, …)`, `list_tickets(status?)`. 상태는 내가 할 것(`mine`) / 기다리는 중(`waiting`, 누구를·언제까지) / 끝남(`done`). 툴 정의에 `optional: true`와 도움말(`help`)이 있어 기본으로 꺼져 있고, 툴 고르기에는 `bundle`로 "작업 티켓(선택)" 한 줄이 된다. 켜면 `escalate`가 `기다리는 중` 티켓을 저절로 만들고, 팀이 끝내면 `내가 할 것`으로 옮기며 "임시로 해 둔 일이 있으면 되돌려요"를 적는다. 티켓 툴은 세계를 바꾸지 않아 조치(`act`)로 세지 않는다. **측정은 티켓이 있든 없든 사건 기록으로 한다.**

## 측정 (`oracle/handoff.ts`)
넘긴 일마다 사건 기록만 읽어 네 가지를 센다. 순수 함수라 채점 때와 리플레이 때가 같다.
1. **임시 조치**: 넘길 때 멈추거나 느린 서비스가 있었고, 기다리는 동안 에이전트가 무언가를 바꿨고, 팀이 끝내기 전에 서비스가 모두 정상이 된 때(`savedAfterSeconds`). 복구 시간의 점수는 복구 우선 채점이 그대로 낸다: 임시 조치 없이 기다리면 복구 시간이 대기만큼 길어져 시간 점수가 0이다.
2. **마무리**: 기다리는 동안 넘긴 장비 위의 VM을 옮기거나(`migrate_vm`) 서비스를 대기 쪽으로 옮긴(`failover_service`) 것 가운데, 팀이 끝난 뒤 되돌린 것(VM은 원래 서버로, 서비스는 다시 `failover_service`)과 얼마나 늦었는지.
3. **동시 작업**: 기다리는 동안 새로 올라온 알람(넘긴 장비의 것은 뺀다) 가운데 에이전트가 그 장비를 가리키는 호출을 한 것.
4. **넘긴 근거**: 넘긴 고장 가운데 내 도메인에 속하고 그 도메인의 툴로 고칠 수 있는 고장(`FAULT_RESPONSES`의 `fix`)은 **−5점씩, 최대 −15점**. 고장이 하나도 없는데 넘긴 것도 한 건으로 센다. 내 도메인을 안 골랐으면 감점은 없다.
감점만 점수에 들어가고(항목 `handoff-needless`) 나머지 셋은 결과에 말로 적는다. 결과 화면의 "넘긴 일"이 이것이다.

## 화면
- **실행 화면**: 넘긴 일이 하나라도 있으면 "넘긴 일" 표(도메인·고장·예상·진행·끝난 때)와 위의 네 줄, 티켓이 있으면 티켓 보드(내가 할 것 / 기다리는 중 / 끝남)가 나온다. 달리는 중에도 같은 표가 진행을 따라간다. 어느 도메인과 어떤 담당자 설정이었는지는 "넘긴 일" 머리와 실험 요약에 적힌다.
- **새 실험**: 3단계에 "내 도메인"(복수)과 "SLA·예비 부품·팀" 카드가 있다. 카드는 도메인을 고르면 나오고, 바꾼 칸은 "바꿨어요" 표시가 붙으며 "기본값으로 되돌리기"가 있다. 기본값은 `lead-times.md`의 표다.
- **토폴로지·시간 막대**: 담당자가 일하는 동안 그 장비 타일에 보라색 점선 테두리와 "교체 중 · 벤더"(원격이면 "작업 중 · 네트워크 팀")가 나오고 범례에 "다른 팀이 작업 중인 곳"이 있다. 시간 막대에는 팀이 끝낸 때 "벤더: 교체 완료" 표식이 서고, 첫 줄에 "넘긴 일 1건"이 들어간다. 모두 사건에서 읽으므로 리플레이에 남는다.
- **3D**: 현장 작업이면(`onSite`) 기사가 서버룸 문으로 들어와 그 장비 앞까지 걸어가 작업 자세를 취하고(ADR-0078의 길 찾기와 걷는 속도 그대로), 끝나면 문으로 걸어 나간다. 달리는 중인 실험의 활동 스트림(`partner` 사건)이 이것을 전한다. 기사의 말풍선은 "고쳤어요"를 말하지 않는다.
- **시나리오 카드**: "내 도메인 밖이 원인" 묶음의 카드에 "원인은 서버 도메인 · 내 도메인 서비스/OS·가상화 권장"이 한 줄 붙는다.

## 시나리오 템플릿 둘 (`scenario/library-domains.ts`)
| 템플릿 | 일어나는 일 | 풀이 |
|---|---|---|
| `domain-memory-vendor` | 서버 메모리 불량 → 그 위 서비스 알람 | 서버 팀에 넘김 → 벤더 교체(기본 설정에서 보통 1일, 부품이 있으면 4시간~3일) → 그동안 VM을 다른 서버로 옮겨 서비스를 살리고, 끝나면 되돌림 |
| `domain-port-network` | 서버와 스위치를 잇는 포트 불량(`link_down`) → 서비스 알람 | 네트워크 팀에 넘김(보통 3시간) → 그동안 서비스를 대기 쪽으로 옮겨 살림 |
내장 하네스의 기준 에이전트 `operator`(규칙 기반)가 이 둘의 잣대다: 멈춘 서비스를 먼저 옮겨 살리고(VM은 다른 서버로, 아니면 대기 쪽으로), 서비스가 말하는 이유 글에서 원인의 도메인을 읽어 넘기고, `events_since`로 기다리다 끝나면 되돌린다. 메모리 불량에서 서비스 복구 시간 15분 안, 마무리 모두 함이다. 둘 다 복구 우선 채점이고 제한 시간이 4일이다(에이전트 투입 블록의 제한 시간 상한을 24시간에서 4일로 늘렸다, ADR-0106). 변별력 점검의 "서비스를 살리는 길"은 이제 "서비스를 옮기면 되거나, 그 고장의 도메인 팀에 넘겨서 제한 시간 안에 돌아오면 된다"로 읽는다(`recoveryPath`의 마지막 단계 `escalate`). 운영 모드([operation-mode.md](operation-mode.md))에서는 같은 일을 5분마다 되풀이하는 상주 루프가 된다: `events_since`로 보고, 서비스를 먼저 살리고, 원인의 도메인을 한 번 넘기고, 팀이 `done`을 알리면 옮긴 것을 되돌리고, 진단은 내지 않는다.

## 한계
- 사람이 하는 실수(포트 shutdown, VLAN, PDU 콘센트 꺼짐 등 설정 변경)는 세계의 고장 목록에 없어서 넘겨도 풀리지 않는다. 넘길 수 있는 것은 `Fault`로 일으킨 고장뿐이다.
- 팀마다 평일 주간·야간·주말 응답 시간, 고장별 직접 지정 값, 되묻기, 우선순위 경쟁은 모델에 없다(ADR-0100).
- 스토리지 도메인의 툴은 둘뿐이다(상태 보기, 경로 전환). 디스크 고장과 분산 스토리지 노드 상실은 지금도 넘기는 길과 기다림뿐이다.
- 3D는 달리는 중인 실험의 활동 스트림으로 기사를 부른다. `wait` 한 번으로 세계 시간이 몇 시간씩 건너뛰는 실험에서는 기사가 나타났다 사라지는 사이가 짧아 거의 보이지 않는다. 시간이 실제로 흐르는 실시간 실행이나 빨리 감기에서 잘 보인다.
