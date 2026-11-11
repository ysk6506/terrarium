---
title: SDN 오버레이와 클라우드 네이티브 네트워크 층 — 리프-스파인 위에 덮는 가상 네트워크와 서비스의 문
kind: spec
status: active
last_verified: 2026-11-11
covers:
  - packages/core/src/world/sdn.ts
  - packages/core/src/world/sdn-act.ts
  - packages/core/src/world/sdn-health.ts
  - packages/core/src/world/sdn-underlay.ts
  - packages/core/src/world/state-sdn.ts
  - packages/core/src/world/faults-sdn.ts
  - packages/core/src/world/ladder.ts
  - packages/core/src/physics/sdn.ts
  - packages/core/src/physics/sdn-alarms.ts
  - packages/core/src/tools/catalog-sdn.ts
  - packages/core/src/tools/handlers-sdn.ts
  - packages/core/src/facades/netos-sdn.ts
  - packages/core/src/scenario/library-sdn.ts
  - packages/core/src/scenario/blocks-sdn.ts
  - packages/core/src/sources/worldgen/shaped-sdn.ts
  - packages/core/src/topology/layer-network.ts
  - packages/core/src/session/probes.ts
  - packages/core/src/session/operation/mtbf.ts
covers_hash: e541507c3c21cf6d
verification_log:
  - "2026-11-07: REQ-106이 layer-network 단계 번호를 밀었다. SDN 서술은 그대로 맞다"
  - "2026-11-07: REQ-107: 가속기 층·전원·냉방 확장이 이 문서의 내용을 바꾸지 않는지 대조했다(층 수·툴 수·칩 수를 세는 문장을 찾아 고쳤고, 나머지는 그대로 맞다)"
  - "2026-11-07: o13 합치기 (GPU·전원·냉방)"
  - "2026-11-07: ADR-0133에 맞춰 대조: 기대 복구 시간(+5분), 손대지 않는 것이 정답인 시트의 만점, 링크 흔들림 서술"
  - "2026-11-11: library-sdn.ts에서 안 쓰는 상수 OWN 한 줄만 지웠다. 동작과 서술은 그대로다"
---
# SDN 오버레이와 클라우드 네이티브 네트워크 층 (REQ-097, [ADR-0107](adr/0107-world-entry-two-doors-ha-ladders.md) 결정 6, [ADR-0115](adr/0115-sdn-network-layer-amend-tests.md))

## 한 문장으로

**리프-스파인(언더레이) 위에 서비스마다 가상 네트워크(오버레이)를 덮고, 그 설정을 미는 컨트롤러·터널의 끝(VTEP)·가상 방화벽과, 노드의 CNI 플러그인·네트워크 정책·인그레스를 코어 모델로 올렸다. 서비스 건강은 이 상태를 그대로 읽고, 컨트롤러와 EVPN 세션은 스스로 돌아오며, 그 복구는 에이전트가 한 복구와 따로 센다.**

비유하면 도시의 지하철과 그 위에 얹은 택배 노선이다. 철도(언더레이)는 한 번 깔고, 택배 회사(컨트롤러)가 노선표(설정)를 역마다 나눠 준다. 역의 접수대(VTEP)는 노선표대로 짐을 터널에 싣는다. 본사가 불타도 이미 나간 노선은 계속 다니고(헤드리스), 새 노선만 못 낸다. 건물 입구(인그레스)가 잠기면 밖에서 오는 손님만 못 들어오고 건물 안의 왕래는 그대로다.

## 한계부터 (정직하게)

- **진짜 VXLAN이 아니다.** 패킷도 MAC 학습도 없다. 터널은 "두 VTEP이 언더레이로 이어지고, 양쪽 세션이 서고, 설정이 최신인가"라는 참·거짓이고, 세그먼트는 그 결과를 모은 것이다.
- **호출 그래프는 애플리케이션 층이 준다.** 서비스끼리 누가 누구를 부르는지는 `calls` 링크([애플리케이션 층](application-layer.md), REQ-100)가 말한다. 네트워크 정책은 이제 한 쌍이 아니라 `calls`를 따라 지키는 서비스를 부르는 서비스 모두에게 닿는다. 호출 선이 없는 세계에서는 지키는 서비스만 느려진다.
- **컨트롤러는 설정의 출처일 뿐이다.** 새 세그먼트를 만들거나 지우는 일은 없다. 컨트롤러가 멈춘 효과는 "설정을 밀지 못한다"(`sdn_sync` 거부)와 "대기가 이어받을 때까지의 시간"이 전부다. 서비스가 스스로 멈추지 않는다.
- **서비스 메시 자체는 [애플리케이션 층](application-layer.md)의 일이다.** 여기서는 파드 네트워크 정책과 인그레스만 다룬다.
- **CNI는 노드마다 한 플러그인이다.** 오버레이 모드·MTU·IP 대역은 없다. 죽으면 그 노드의 파드가 다른 곳과 통신하지 못한다.

## 개체와 상태

일곱 모두 자기 자리(방·랙)가 없는 가상 종류다. 설정은 속성(`props`)에, 연결은 링크에, 지금의 모습은 상태에 있다.

| 개체 | 설정(속성) | 상태 | 링크 |
|---|---|---|---|
| `sdn_controller` SDN 컨트롤러 | 처음 역할(`role`: 액티브·스탠바이), 감지 시간(`detectS`, 기본 30초) | 역할, 상태(`ok`·`down`), 관리하는 스위치 수(`managed`, 스탠바이는 0), 설정 리비전(`revision`, 42), 스탠바이가 본 때(`downSince`) | `hosted_on` 서버·VM, `controls` 스위치 |
| `vtep` VTEP | 없음(리프마다 하나) | EVPN 세션(`established`·`down`), 세션이 올라오는 때(`evpnUpAt`), 설정 리비전, 플랩 횟수, 끊김(`cut`)과 이유, 살아 있는 언더레이 케이블 수(`uplinks`) | `hosted_on` 스위치, `member_of` 세그먼트 |
| `overlay_segment` 오버레이 세그먼트 | VNI(`vni`), 테넌트 이름 | 상태(`ok`·`degraded`·`down`), 끊긴 VTEP 목록, 이유 | 서비스가 `depends_on`, VTEP이 `member_of` |
| `nfv_function` 가상 네트워크 기능 | 없음(서비스 앞의 가상 방화벽) | 상태, 부하(%), 지연(ms) | `hosted_on` VM·서버, 서비스가 `depends_on` |
| `cni` CNI 플러그인 | 플러그인 이름 | 상태(`ok`·`down`) | `hosted_on` 노드(VM 또는 서버) |
| `network_policy` 네트워크 정책 | 이름공간(`ns`), 호출자 서비스(`from`, 없을 수 있다), 처음 규칙 | 지금 규칙(`allow`·`deny`), 바뀌기 전 규칙(`previous`), 바뀐 때 | `applies_to` 서비스 |
| `ingress` 인그레스 | 없음 | 상태(`ok`·`degraded`·`down`), 다시 뜨는 때(`upAt`) | `hosted_on` 노드, 서비스가 `depends_on` |

새 링크 종류는 `controls`(컨트롤러 → 스위치)와 `applies_to`(정책 → 서비스)이고, `hosted_on`(올라간 곳)은 대상에 스위치를, `member_of`는 VTEP → 세그먼트를, `depends_on`은 세그먼트·인그레스·가상 기능을 더했다.

## 서비스 건강이 오버레이를 읽는 법

규칙은 `world/sdn-health.ts`에 있다. 서비스가 기대는 것마다 따로 읽고, 하나라도 멈췄으면 멈추고 하나라도 느리면 느리다(호스트·DB 규칙과 같은 `worse`).

| 지금의 상태 | 요청 처리 서비스 | 상태를 지키는 서비스 | 배치 서비스 |
|---|---|---|---|
| 세그먼트가 `down`(모든 VTEP이 끊김) | 멈춤 | 멈춤 | 멈춤 |
| 노드 일부가 끊긴 VTEP 뒤에 있음 | 느려짐 | 멈춤 | 느려짐 |
| 모든 노드가 끊긴 VTEP 뒤에 있음 | 멈춤 | 멈춤 | 멈춤 |
| 노드의 CNI 플러그인이 죽음 | 그 노드가 끊긴 것으로 위와 같이 | 〃 | 〃 |
| 인그레스가 `down` | 멈춤(밖에서 오는 요청이 닿지 않음) | 느려짐(안의 호출은 그대로) | 느려짐 |
| 인그레스가 다시 뜨는 중(20초) | 느려짐 | 느려짐 | 느려짐 |
| 가상 방화벽이 한계를 넘음(부하 > 100%) | 느려짐(지연 표시) | 느려짐 | 느려짐 |
| 정책이 `deny`로 바뀜 | 그 정책이 지키는 서비스와, `calls`로 그 서비스를 부르는 서비스 모두가 느려짐 | 〃 | 〃 |
| 컨트롤러가 멈춤 | 변화 없음(헤드리스) | 〃 | 〃 |

VTEP이 세그먼트에서 끊기는 때(물리가 매 스텝 정한다): 스위치에 전원이 없음, EVPN 세션이 내려가 있음, `vxlan_tunnel_down` 고장이 있음, 설정이 컨트롤러보다 한 리비전 뒤임, 또는 같은 세그먼트의 멀쩡한 다른 VTEP 어디에도 언더레이로 닿지 않음. 세그먼트에 VTEP이 하나뿐이거나 상대가 모두 스스로 고장이면 남은 하나는 "혼자"일 뿐 끊긴 것이 아니다. 언더레이는 `net-model`의 케이블(링크가 살아 있고 양쪽 스위치에 전원이 있는 것)을 따라 걷는다.

## 고장 일곱과 실수 하나

모두 `FAULT_SPECS`(실수는 `MISTAKE_SPECS`)에 있고 도메인은 `network`, `FAULT_TOOLS`·`FAULT_RESPONSES`·리드타임·제어 가능 요소표의 행이 하나씩 있다.

| 고장 | 대상 | 번짐 | 푸는 길 |
|---|---|---|---|
| `sdn_controller_down` 컨트롤러 다운 | 컨트롤러 | 서비스는 그대로. 새 설정을 못 민다. 스탠바이가 있으면 30초 뒤 스스로 이어받고 설정을 다시 민다 | `sdn_failover`(바로 넘기기). 하나뿐이면 네트워크 팀 |
| `sdn_sync_failed` 설정 동기화 실패 | VTEP | 그 VTEP이 한 리비전 뒤라 뒤의 노드가 세그먼트에서 빠진다 | `sdn_sync(switch)`. 스탠바이가 이어받을 때의 전체 재전송도 푼다 |
| `vxlan_tunnel_down` VXLAN 터널 끊김 | VTEP | 그 VTEP의 터널이 모두 내려가 뒤의 노드가 빠진다(업링크 포트가 막혀 loopback 경로가 사라진 모양) | `overlay_trace`로 막힌 스위치 포트를 찾고 네트워크 팀에 넘긴다 |
| `evpn_session_flap` EVPN 세션 플랩 | VTEP | 주기(`periodS`, 기본 120초)의 절반은 세션이 내려가 뒤의 노드가 빠진다 | `sdn_sync`가 세션을 새로 맺어 멈춘다 |
| `ingress_controller_down` 인그레스 다운 | 인그레스 | 밖에서 오는 요청만 막힌다 | `ingress_restart`(20초) |
| `cni_plugin_failure` CNI 고장 | CNI | 그 노드의 파드가 통신하지 못한다 | 노드에서 `systemctl restart calico-node` |
| `nfv_firewall_overload` 가상 방화벽 과부하 | 가상 기능 | 지연이 크게 늘어 서비스가 느려진다 | 용량은 네트워크 팀의 일(`diagnose`) |
| (실수) `network_policy_deny` 잘못된 정책 배포 | 정책 | 정책이 지키는 서비스와 그것을 부르는 서비스(`calls`)가 느려진다 | `policy_revert` |

실수는 시나리오의 `policy_set` 블록(`policy.set`)이 만들고, 에이전트는 같은 정책을 `policy_revert`(`policy.revert`)로 되돌린다. 에이전트가 정책을 차단으로 배포하는 길은 없다.

## 자동 동작: 원인 `cluster`

| 동작 | 규칙 |
|---|---|
| 컨트롤러 액티브-스탠바이 전환 | 액티브가 `down`이면 `downSince`를 잡고, 스탠바이가 `ok`인 채로 `detectS`(기본 30초)가 지나면 `sdn.failover`(원인 `cluster`). 이어받은 컨트롤러가 모든 VTEP에 설정을 다시 밀어 `sdn_sync_failed`가 사라진다 |
| EVPN 세션 재수립 | 세션을 내린 원인(케이블·전원)이 사라지면 BGP 타이머 90초 뒤에 올라오고 사건 `note`(원인 `cluster`)를 남긴다. 에이전트가 `sdn_sync`로 푼 세션은 10초 뒤에 올라오고 `cluster` 기록을 남기지 않는다(운영자의 일이다) |
| ECMP 경로 재계산 | 리프가 스파인 쪽 케이블 둘 이상에서 하나로 줄면 "스파인 n개 중 m개로 ECMP 경로를 다시 계산했어요"를 `cluster` 원인으로 남긴다. 서비스는 멈추지 않는다 |
| 플랩 | `evpn_session_flap`이 있는 동안은 주기의 앞 절반 올라오고 뒤 절반 내려간다(재수립 대기 없이) |

복구 우선 채점은 서비스가 정상이 된 때가 에이전트의 마지막 조치보다 늦은 이 사건 뒤이면 `byCluster`로 읽고 시간·순서 축에 점수를 주지 않는다([DB 층](db-storage-layers.md#채점-클러스터가-한-복구와-에이전트가-한-복구)과 같다). 컨트롤러 쌍에서 지켜보고 보고하면 보고 30점만 받는다.

## 툴 아홉

모두 다섯 칸(요약·언제 쓰나·언제 안 쓰나·예·비용)을 채웠고 도메인은 네트워크, 카드(`area`)는 네트워크다. `overlay_trace`만 `rare`이고 나머지는 `common`이다(오버레이를 따라 걷는 툴은 몇몇 팀만 갖고 있다).

| 툴 | 하는 일 | 바꾸는가 | realism |
|---|---|---|---|
| `sdn_status(controller?)` | 컨트롤러(역할·상태·관리 스위치·리비전), VTEP(세션·리비전·끊김), 세그먼트, 가상 기능. 컨트롤러가 없으면 `headless`와 이어받기까지 남은 초 | 보기만 | common |
| `sdn_sync(switch)` | 그 스위치의 VTEP에 설정을 다시 밀고 세션을 새로 맺는다. 컨트롤러가 멈춰 있으면 거부 | 바꿈 | common |
| `sdn_failover(controller?)` | 스탠바이를 액티브로. 새 액티브가 모두 다시 민다. 스탠바이가 없으면 거부 | 바꿈 | common |
| `overlay_trace(src, dst)` | 두 호스트·서비스 사이의 VTEP, 터널, 언더레이 스위치와 케이블, 처음 끊긴 곳(`brokenAt`) | 보기만 | rare |
| `evpn_sessions(vtep?)` | 세션 상태, 플랩 횟수, 다시 맺기까지 남은 초, 살아 있는 업링크 수, 리비전 | 보기만 | common |
| `policy_list(ns?)` | 정책 이름공간·지키는 서비스·호출자·규칙·바뀌기 전 규칙·바뀐 뒤 흐른 초 | 보기만 | common |
| `policy_revert(policy)` | 이전 규칙으로 되돌린다. 처음부터 그 규칙이면 거부 | 바꿈 | common |
| `ingress_status(ingress?)` | 상태, 뒤의 서비스, 노드, 다시 뜨기까지 남은 초 | 보기만 | common |
| `ingress_restart(ingress?)` | 다시 시작(20초). 생략하면 닫힌 인그레스 모두 | 바꿈 | common |

`network_cli`는 스위치에서 `show nve peers`(NX-OS·IOS XE), `show vxlan vtep`(EOS), `show nve vni`·`show vxlan vni`, `show bgp l2vpn evpn summary`(EOS는 `show bgp evpn summary`)를 흉내 낸다. 상태는 물리가 쥔 것과 같다: 터널이 끊긴 VTEP은 상대의 피어 목록에서 사라지고, 옛 설정의 VTEP은 VNI가 `Down`/`UC`로 보이며, 세션이 내려가면 EVPN 이웃이 `Active`로 보인다. `systemctl status|restart calico-node`·`nginx-ingress`·`sdn-controller`는 가짜 셸이 호스트의 프로세스로 알고 있다. 규칙(허용 목록, 한 단계 파이프)은 그대로다.

## 사다리와 세계 생성

`net-sdn`과 `net-cloud-native`가 `modeled: true`가 되었다. 클라우드 네이티브는 컴퓨트가 컨테이너 오케스트레이션 이상이어야 골라진다(전제 규칙 `requires`, REQ-102, [사다리 화면](world-entry.md)). `build.overlay`가 컨트롤러 수(둘), 가상 방화벽 여부, 클라우드 네이티브 여부를 말한다. 점선은 이 층에 더는 없다(ADR-0107 결정 5의 점선 목록에서 둘이 빠진다).

| 칩 | 짓는 것 | 멈추는 고장 | 느려지는 고장 |
|---|---|---|---|
| SDN 오버레이 | 컨트롤러 2(액티브·스탠바이, 서로 다른 랙의 서버), 리프마다 VTEP, 서비스마다 세그먼트·가상 방화벽 | 스위치 고장, 터널 끊김 | 링크 다운, 포트 VLAN·꺼짐, 경로 지워짐, 컨트롤러 다운, 설정 동기화 실패, EVPN 플랩, 방화벽 과부하 |
| 클라우드 네이티브 | 위에 더해 서비스 노드마다 CNI, 서비스마다 정책(앞 서비스를 호출자로), 요청 서비스마다 인그레스 | 위 둘과 인그레스 다운 | 위 전부와 CNI 고장, 잘못된 정책 |

`shaped.ts`가 서비스를 다 놓은 뒤 `shaped-sdn.ts`가 오버레이를 깐다. 컨트롤러는 서비스가 쓰지 않는 서버에 서로 다른 랙부터 올라가고(그래서 다른 전원 줄), VTEP은 서버나 스토리지가 꽂힌 모든 리프에 하나씩, 세그먼트는 서비스 노드가 선 리프의 VTEP을 모은다. 같은 구성과 번호면 같은 세계다. 칩 카드의 "생기는 고장"은 칩의 `stops`·`slows`를 고장 이름으로 풀어 쓴 것이라 실제 고장 목록과 같고(시험), "이 모양이면" 카드의 고장·시나리오 수·넘기는 팀도 같은 목록에서 센다(터널 끊김·컨트롤러 다운·가상 방화벽 과부하는 네트워크팀).

## 시나리오 여섯

`scenario/library-sdn.ts`, 모두 복구 우선 채점이다. 정답 조치를 일찍 하면 만점에 가깝고, 같은 조치를 오래 살핀 뒤에 하면 낮고, 아무것도 안 하면 0점이다(시험이 이 순서를 잰다).

| 시나리오 | 고장 | 정답 | 틀린 조치(감점) |
|---|---|---|---|
| SDN 컨트롤러가 멈췄어요 | 컨트롤러 다운 + 그 VTEP의 동기화 실패 | 쌍이면 스탠바이가 30초 뒤 스스로 이어받으니 지켜보고 원인을 보고. 하나뿐이면 설정을 못 밀어 네트워크 팀에 넘긴다 | — |
| 스위치 한 대에 옛 설정이 남았어요 | 설정 동기화 실패 | 그 스위치를 `sdn_sync` | 재부팅(−15) |
| VXLAN 터널이 끊겼어요 | 터널 끊김 | `overlay_trace`로 막힌 스위치 포트를 찾고 네트워크 팀에 넘긴다, 그동안 서비스를 살린다 | 재부팅(−15) |
| 네트워크 정책을 잘못 배포했어요 | (실수) 정책 `deny` | `policy_list`로 찾아 `policy_revert` | 재부팅(−15) |
| 인그레스가 닫혔어요 | 인그레스 다운 | `ingress_restart` | 재부팅(−15) |
| 노드의 CNI 플러그인이 죽었어요 | CNI 고장 | 그 노드에서 `systemctl restart calico-node` | 재부팅(−15) |

쌍으로 이어받는 컨트롤러는 에이전트가 복구 점수를 받을 수 없어 최대 30점이다. 아무것도 모르면 0점, 정답만 알면 30점이다. 흔한 툴만으로(알람 → 서비스 목록 → `sdn_status`·`evpn_sessions`·`policy_list`) 원인 장비에 닿는지 `commonReach`가 여섯 모두 확인하고, `overlay_trace`(rare)가 없어도 닿는다. 변별력 점검의 "서비스를 옮겨서 복구하는 길"은 이제 `sdn_sync`·`sdn_failover`·`policy_revert`·`ingress_restart`·노드 CNI 재시작도 시도하고 어느 것이 돌려놨는지 적는다.

## 토폴로지

네트워크·가상화 층에 단계 넷이 서비스 옆에 붙는다: **인그레스·정책·CNI**, **오버레이 세그먼트**(가상 방화벽 포함), **SDN 컨트롤러**, **VTEP**. 읽는 순서는 서비스 → 인그레스 → 세그먼트 → 컨트롤러 → VTEP → 스위치 → 서버 → VM이다. 영향 범위는 언더레이 스위치 → VTEP → 세그먼트 → 서비스로 번진다: 전원이 없는 스위치의 VTEP은 끊긴 것이고, 세그먼트는 VTEP이 절반 끊기면 범위에 들고 모두 끊기면 멈춘 것으로 센다. 닫힌 인그레스나 죽은 CNI는 그것이 기댄 서비스를 범위에 넣는다.

## 운영 모드

MTBF 표에 일곱 줄이 더해졌다(컨트롤러 4,000, 동기화 실패 3,000, 터널 끊김 8,000, 세션 플랩 5,000, 인그레스 2,400, CNI 3,600, 방화벽 2,000시간). 자세한 값은 [운영 모드](operation-mode.md).

## 하지 않은 것

- 서비스 사이의 호출 그래프와 부하에 따른 방화벽 지연의 변화(부하는 고장이 정한다).
- 컨트롤러가 세그먼트를 새로 만드는 일, VNI 충돌, 멀티 테넌트 라우트 누출.
- 서비스 메시(사이드카·서킷 브레이커)는 애플리케이션 층의 일이다.
- 컨테이너 오케스트레이션(노드·파드 스케줄링)은 컴퓨트 층의 일이다. 여기서 CNI는 "노드마다 있는 플러그인"일 뿐이다.
