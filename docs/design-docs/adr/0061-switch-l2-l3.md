---
title: ADR-0061 스위치는 VLAN·MAC 표·ARP·라우팅을 갖고, 설정이 실제로 길을 바꾼다
kind: decision
status: active
enforced_by:
  - tests/spec/switch-l2l3.test.ts
  - packages/core/src/world/net-model.test.ts
  - tests/spec/network-os.test.ts
touches_protected:
  - docs/product-specs/requirements.md
decision_hash: 8357d182707bc893
---
# ADR-0061 스위치는 VLAN·MAC 표·ARP·라우팅을 갖고, 설정이 실제로 길을 바꾼다

## 맥락
ADR-0059에서 스위치가 EOS·NX-OS·IOS XE의 말로 답하게 했다. 그런데 제품 책임자가 짚었다. "VLAN, MAC 표, 라우팅은 없는게 말이되나."
맞는 말이다. 현장의 스위치를 만지는 일의 대부분은 포트 shutdown이 아니라 VLAN을 바꾸고, 트렁크를 고치고, 게이트웨이와 경로를 보는 일이다. 이게 없으면 에이전트가 풀 수 있는 네트워크 문제가 "케이블이 빠졌다"밖에 없다.

## 결정
1. **모양은 케이블에서 정한다(설계).** 사용자가 설정하게 두지 않는다. 월드는 이미 어느 서버가 어느 스위치에 꽂혔는지 안다. 거기서 랙(말단 스위치)마다 VLAN 하나(100번부터)와 /24 하나, 서버 주소, 위쪽 스위치들이 나눠 쓰는 게이트웨이(.1), 스위치끼리 이은 케이블의 /31(172.16.0.0부터), 기본 경로와 코어의 요약 경로를 만든다.
2. **운영자가 바꾼 것만 월드 상태에 둔다.** `netconf[스위치]`에 설계와 다른 부분(VLAN, 포트, VLAN 인터페이스, 경로)만 적는다. 바꾸지 않은 월드는 이 키가 없어서 예전과 같고 비용도 없다. 효력 있는 설정 = 설계 + 이 패치.
3. **월드 명령 `net.set`** 이 유일한 쓰기 길이다. CLI의 `vlan`, `switchport ...`, `interface vlan`, `ip address`, `ip route`와 eAPI·NX-API가 모두 이 명령이 된다. 검증(`checkNetChange`)이 VLAN 범위·포트 번호·주소 모양·호스트 비트를 막는다.
4. **길은 계산해서 얻는다.** (스위치, VLAN)을 점으로 보고 케이블이 포트 모드(access/trunk)와 허용 VLAN에 따라 점을 잇는다. 이은 덩어리가 하나의 브로드캐스트 영역이다. MAC 표, ARP, `ping`, `traceroute`, 라우팅 표가 모두 이 모델 하나를 읽는다. `ping`은 갈 때와 올 때를 둘 다 따라가서 둘 다 되어야 성공이다. 같은 값이 나오는 다음 경로가 여럿이면(ECMP) 하나가 막혀도 다른 쪽으로 돌아간다.
5. **설정 때문에 끊긴 서버만 알람을 올린다.** 모니터링이 서버를 위쪽 스위치에서 `ping`한다. "설계대로면 되는데 지금 설정으로는 안 되는" 서버만 알람 `host_unreachable`을 올리고, 어디서 멈췄는지(요청이 못 갔나, 답이 못 왔나)를 말한다. 케이블이 끊겼거나 전원이 나간 서버는 기존 링크·전원 알람이 말하니 겹쳐 올리지 않는다.
6. **명령은 세 OS의 말로 답한다.** `show vlan`, `show mac address-table`, `show ip route`, `show ip arp`, `show ip interface brief`, `show interfaces trunk`, `ping`, `traceroute`, `show running-config`의 VLAN·포트·경로 줄. EOS·NX-OS는 JSON 모양도 준다.
7. **요구사항 REQ-064**를 더한다.

## 버린 대안
- **설정을 사용자가 처음부터 쓰게 함**: 수천 대 월드에서 불가능하고, 같은 월드를 같은 모양으로 다시 만들 수 없다. 설계는 케이블에서 결정적으로 나와야 재현된다.
- **VLAN마다 서버 연결 여부를 상태로 저장**: 포트 설정이 바뀔 때마다 고칠 곳이 늘고 서로 어긋난다. 계산으로 얻으면 어긋날 곳이 없다.
- **끊긴 서버 알람을 모든 서버에 대해 올림**: 케이블이 빠진 서버에도 중복 알람이 생겨 기존 시나리오의 정답(진단 라벨)이 흔들린다.
- **STP·LACP까지 구현**: 효과가 큰 일이고 지금 에이전트가 만나는 문제의 대부분은 VLAN·트렁크·게이트웨이·경로다. 아래 한계에 적었다.

## 한계 (솔직하게)
- 스패닝 트리, LACP(포트 채널), 패킷 카운터, 동적 라우팅(OSPF·BGP·EVPN), MAC 에이징과 이동, 서버 쪽 설정(서버의 IP를 바꾸는 일), NX-OS의 HSRP 설정 입력은 흉내 내지 않는다.
- MAC 표는 정상 상태의 모습이다. 서버가 켜져 있고 VLAN 안에 있으면 그 서버를 향한 포트에서 배운 것으로 나온다.
- 접근 포트의 VLAN과 트렁크의 상태는 단순화했다(한 포트가 접근과 트렁크를 동시에 갖는 일이 없다).
- `ping` 실패 문구와 `traceroute` 별표(최대 3줄)는 실제 장비와 한 줄씩 대조하지 않고 손으로 맞췄다. 왕복 시간은 홉 수로 만든 값이다.
- 사이트 간 전용선과 패브릭 종류(레거시 VLAN·STP, 클라우드 leaf-spine/VXLAN, GPU InfiniBand/RoCE)는 이번에 없다. 다음 결정(패브릭 종류)에서 다룬다.
- vCenter는 네트워크 설정 때문에 닿지 않는 호스트를 아직 따로 보여 주지 않는다. SNMP는 IP-MIB, Q-BRIDGE-MIB를 아직 주지 않는다.
