---
title: 스위치의 VLAN·MAC 표·ARP·라우팅 — 설정이 실제로 길을 바꾼다
kind: spec
status: active
last_verified: 2026-11-04
covers:
  - packages/core/src/world/net-addr.ts
  - packages/core/src/world/net-config.ts
  - packages/core/src/world/net-check.ts
  - packages/core/src/world/net-topology.ts
  - packages/core/src/world/net-design.ts
  - packages/core/src/world/net-plan.ts
  - packages/core/src/world/net-model.ts
  - packages/core/src/world/net-trace.ts
  - packages/core/src/world/net-reach.ts
  - packages/core/src/physics/net-alarms.ts
  - packages/core/src/facades/netos-l2.ts
  - packages/core/src/facades/netos-l3.ts
  - packages/core/src/facades/netos-ping.ts
  - packages/core/src/facades/netos-l23-config.ts
verification_log:
  - "2026-11-04: 처음 썼다: 설계 도출, netconf 패치, 덩어리 계산, trace/ping, 설정 때문에 끊긴 서버 알람, 세 OS 명령과 한계를 world/net-*.ts, physics/net-alarms.ts, facades/netos-l2·l3·ping·l23-config와 대조 (REQ-064, ADR-0061)"
  - "2026-11-04: net-design·net-check·net-model·net-trace·net-plan·net-config·net-topology·net-alarms의 클라우드 분기를 확인했다. 이 문서는 레거시 모양을 말한다고 밝히고 STP·BGP는 새 문서로 보냈다 (REQ-065)"
  - "2026-11-04: 호스트 계획의 key·rail, NIC별 MAC, net-topology·net-design 변경을 대조하고 GPU 문서 링크를 더함"
  - "2026-11-04: net-design의 함수 분리(동작 동일)를 확인"
  - "2026-11-04: 2026-11-04: ADR-0073. 덮는 코드에서 사람이 읽는 말(알람 해요체, 에이전트 지시문 한다체, 툴·멈춤·상한 등)만 바뀌었고 문서가 말하는 구조와 규칙은 그대로다"
covers_hash: c28e5ab94ea8fd44
---
# 스위치의 VLAN·MAC 표·ARP·라우팅 (REQ-064, ADR-0061)

## 한 줄로

스위치는 포트를 켜고 끄는 상자가 아니라 **누구와 누구를 이어 줄지 정하는 상자**다. 어느 포트가 어느 VLAN인지, 어느 주소는 어느 쪽으로 보낼지가 설정이고, 그걸 틀리면 케이블은 멀쩡해도 서버가 안 보인다.
테라리움의 스위치도 그렇게 동작한다. 설정을 바꾸면 시뮬레이터 안에서 길이 실제로 바뀌고, `ping`이 실패하고, 알람이 그 서버를 이름으로 말한다.

## 비유로 이해하기

택배 분류센터를 떠올리자.

- **VLAN**은 분류센터 안의 **색깔 칸막이**다. 파란 칸막이 안의 사람끼리만 서로 소리쳐서 부를 수 있다.
- **접근(access) 포트**는 한 가지 색깔만 넘겨주는 문이고, **트렁크 포트**는 여러 색깔을 이름표를 붙여 한 복도로 같이 나르는 문이다.
- **MAC 표**는 "이 사람은 어느 문으로 나가면 있다"를 적어 둔 장부다.
- **VLAN 인터페이스(SVI)와 게이트웨이**는 **다른 칸막이로 가는 우체국 창구**다. 다른 색깔의 사람에게 말하려면 창구에 맡겨야 한다.
- **경로(route)** 는 창구 뒤의 이정표다. "10.0.1.x로 가는 건 저 복도로" 같은 한 줄이다.

사람이 문에 다른 색을 붙이면(포트를 다른 VLAN에 넣으면) 그 사람은 다른 칸막이에 갇혀서 아무도 못 부른다. 이정표 한 줄을 지우면 편지가 가다가 길을 잃는다. 이걸 그대로 흉내 낸다.

## 처음 모양은 어디서 오나

여기 적은 것은 **레거시** 모양(스위치 속성 `fabric`이 없거나 `legacy`)이다. 클라우드 모양은 [다른 문서](network-fabrics.md)에, GPU 백엔드 모양(서버 NIC마다 호스트 계획이 하나)은 [GPU 백엔드 문서](gpu-fabric.md)에 있다.

설정을 사용자가 쓰게 하지 않는다. 월드가 이미 아는 **케이블**에서 결정적으로 만든다.

- 말단 스위치(서버가 꽂힌 스위치)마다 VLAN 하나(100번부터)와 /24 하나. 서버는 .10부터 주소를 받는다.
- 그 위의 스위치들이 게이트웨이(.1)를 **함께** 쓴다. 각자 실제 주소(.2, .3)도 갖는다. 하나가 죽어도 게이트웨이는 산다.
- 스위치끼리 이은 케이블은 /31(172.16.0.0부터)을 하나씩 받는다.
- 위쪽 스위치는 기본 경로를 코어로, 코어는 아래쪽 서브넷 묶음을 위쪽 스위치들로 보낸다.

같은 월드는 항상 같은 모양이다.

## 바꾼 것만 적는다

`netconf[스위치]`에 **설계와 다른 부분만** 적는다(VLAN, 포트, VLAN 인터페이스, 경로). 아무도 안 바꾼 월드에는 이 키가 없다. 그래서 수천 대 월드도 처음엔 추가 비용이 0이다.
쓰는 길은 월드 명령 `net.set` 하나다. 명령줄과 eAPI·NX-API는 모두 이 명령을 부른다. `checkNetChange`가 VLAN 범위(1–4094), VLAN 1 삭제, 이름 길이, 포트 번호, 주소와 경로의 호스트 비트를 거른다.

## 길은 계산해서 얻는다

1. **덩어리(segment).** (스위치, VLAN)을 점으로 보고, 켜진 케이블이 두 끝 포트의 모드에 따라 점을 잇는다. 접근-접근은 두 VLAN을 잇고, 트렁크-트렁크는 둘 다 허용하는 VLAN마다 잇고, 접근-트렁크는 접근 VLAN과 트렁크의 네이티브 VLAN을 잇는다. 스위치가 VLAN을 모르면(VLAN 데이터베이스에 없으면) 그 포트는 그 VLAN을 나르지 않는다. 이어진 점들이 하나의 브로드캐스트 영역이다.
2. **인터페이스.** 켜진 VLAN 인터페이스와 라우팅 포트가 주소를 가진다. 같은 덩어리 안의 주소는 서로 직접 닿는다.
3. **따라가기(`trace`).** 서버는 같은 서브넷이면 곧바로, 아니면 게이트웨이로 보낸다. 스위치는 붙어 있는 서브넷이면 전달하고, 아니면 가장 길게 맞는 정적 경로의 다음 칸으로 간다. 다음 칸이 여럿이면(같은 비용) 하나가 막혔을 때 다른 쪽으로 돌아간다. 같은 스위치를 두 번 지나면 루프다.
4. **`ping`.** 갈 때와 올 때를 둘 다 따라간다. 둘 다 닿아야 성공이다. 그래서 "가는 길은 있는데 답이 못 돌아오는" 일방통행 고장이 그대로 나온다.

## 설정 때문에 끊긴 서버

모니터링은 서버를 위쪽 스위치에서 `ping`한다. **"설계대로면 닿는데 지금 설정으로는 안 닿는" 서버만** 알람 `host_unreachable`을 올린다. 알람은 요청이 못 갔는지, 답이 못 왔는지, 어느 장비에서 멈췄는지를 말한다. 케이블이 끊겼거나 전원이 나가서 안 닿는 서버는 기존 링크·전원 알람이 말하니 겹쳐 올리지 않는다.
설계와 비교하려고 설계만으로 만든 쌍둥이 모델을 하나 더 쓴다. 아무도 스위치를 안 건드렸으면 비교하지 않는다.

## 명령

| 하고 싶은 일 | EOS | NX-OS | IOS XE |
|---|---|---|---|
| VLAN 보기 | `show vlan` | `show vlan` | `show vlan brief` |
| 장부(MAC 표) | `show mac address-table` | 같음 | 같음 |
| 경로 | `show ip route` | 같음 | 같음 |
| ARP | `show ip arp` | 같음 | 같음 |
| 트렁크 | `show interfaces trunk` | 같음 | 같음 |
| 닿는지 | `ping <ip>`, `traceroute <ip>` | 같음 | 같음 |
| VLAN 만들기 | `vlan 101` | 같음 | 같음 |
| 포트 | `switchport mode access`, `switchport access vlan 101` | 같음 | 같음 (없는 VLAN은 만들어 준다) |
| 트렁크 | `switchport trunk allowed vlan add 101` | 같음 | 같음 |
| 주소 | `interface vlan 100`, `ip address 10.0.0.2/24` | 같음 | `ip address 10.0.0.2 255.255.255.0` |
| 경로 | `ip route 10.0.1.0/24 172.16.0.1` | 같음 | `ip route 10.0.1.0 255.255.255.0 172.16.0.1` |

설정은 바로 효력이 난다. 장비에서도 그렇다. 커밋 단계는 없고 `write memory`도 이전과 같이 아무것도 더 저장하지 않는다.
출력의 열 모양, 줄임말, 오류 문구는 각 OS의 것을 따랐다.

## 흉내 내지 않는 것

LACP(포트 채널), 패킷 카운터, OSPF, MAC 에이징과 이동, 서버 쪽 설정, NX-OS의 HSRP 설정 입력은 없다. 스패닝 트리와 BGP·EVPN은 [네트워크의 두 가지 모양](network-fabrics.md)(REQ-065, ADR-0062)이 다룬다. MAC 표는 정상 상태의 모습이다. 한 포트가 접근과 트렁크를 동시에 갖는 일은 없다.
`ping` 실패 문구와 `traceroute`의 별표(3줄)는 실제 장비와 한 줄씩 대조하지 않았다. 왕복 시간은 홉 수로 만든 값이다.
SNMP의 IP-MIB, Q-BRIDGE-MIB와 vCenter의 호스트 연결 상태는 이 설정을 아직 읽지 않는다.

## 어떻게 확인하나

- `tests/spec/switch-l2l3.test.ts`: 명령줄과 월드. 포트를 다른 VLAN에 넣으면 `ping`이 실패하고 알람이 서버를 말하고, 되돌리면 낫는 흐름까지.
- `packages/core/src/world/net-model.test.ts`: 설계의 모양과 끊김의 종류(포트, 트렁크, VLAN 인터페이스, 경로, 전원).
- `tests/spec/network-os*.test.ts`: 예전 명령이 그대로임.
