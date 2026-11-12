---
title: GPU 백엔드 네트워크 — 서버마다 NIC 8개가 rail로 꽂히고, rail 하나를 잃으면 느려진다
kind: spec
status: active
covers:
  - packages/core/src/world/net-topology.ts
  - packages/core/src/world/net-design.ts
  - packages/core/src/world/net-reach.ts
  - packages/core/src/world/net-model.ts
  - packages/core/src/world/net-bgp.ts
  - packages/core/src/physics/net-alarms.ts
  - packages/core/src/facades/netos-bgp.ts
  - packages/core/src/world/test-support/gpu-lab.ts
---
# GPU 백엔드 네트워크 (REQ-067, ADR-0064)

## 한 줄로

GPU 서버 한 대에는 이름표가 붙은 **통신 구멍(NIC)이 GPU마다 하나씩, 보통 8개** 있다. 이 구멍들은 서로 다른 스위치에 꽂힌다. 그래서 구멍 하나가 막혀도 서버는 살아 있는데, 학습은 느려진다.
테라리움은 이 모양을 흉내 내고, **"끊겼다"가 아니라 "몇 번 구멍이 막혀서 느려진다"** 라고 말한다.

## 비유로 이해하기

8차선 고속도로 휴게소를 떠올리자. 서버는 트럭 8대가 한 팀으로 움직이는 물류센터다. 트럭마다 자기 차선이 정해져 있다(1번 트럭은 1차선, 2번 트럭은 2차선…).
모든 물류센터의 1번 트럭이 같은 1차선 톨게이트(leaf 스위치)로 가고, 톨게이트들은 다시 큰 도로(스파인)로 이어진다. 이게 **rail-optimized** 모양이다.

분산 학습은 8대가 한꺼번에 도착해야 다음 일을 시작한다. 그러니 3번 차선이 막히면 물류센터는 멀쩡해도 **모든 팀이 3번 트럭을 기다린다.** 그래서 이 모양의 고장은 "서버 다운"이 아니라 "레일 하나 다운"이다.

## 어느 쪽인지는 누가 정하나

1. 스위치 속성 `fabric: gpu`가 있으면 그 도메인은 GPU 패브릭이다.
2. 속성이 없으면 케이블이 말한다. **한 서버가 같은 도메인의 leaf 4개 이상에 꽂혀 있으면** GPU 패브릭이다(`RAIL_NICS = 4`). 서버 NIC 2개로 이중화한 일반 망은 이 값에 못 미친다.

속성이 있으면 속성이 이긴다. 도메인의 종류는 [다른 문서](network-fabrics.md)와 같이 아이디 순으로 처음 속성이 있는 스위치가 정한다.

## 설계는 클라우드와 같고 VXLAN만 없다

| | 클라우드 | GPU |
|---|---|---|
| leaf의 위쪽 케이블 | 라우팅 포트(/31) | 같음 |
| 게이트웨이 | leaf마다 anycast | 같음 |
| 케이블마다 | eBGP 세션 | 같음 |
| VXLAN·EVPN | 있음 | **없음** (RoCE 이더넷, L3만) |

`show vxlan vni`는 "설정 없음", EVPN 요약은 이웃이 없고, `show running-config`에는 VXLAN 줄이 나오지 않는다(`overlayOn`이 클라우드일 때만 참).

## NIC마다 호스트 계획이 하나다

서버가 GPU 패브릭 leaf 2개 이상에 꽂혀 있으면, 꽂힌 순서대로 rail 1, 2, 3…이다. 각 NIC가 **자기 leaf의 /24**에서 주소를 받고(rail 3의 첫 서버는 `10.0.2.10`, 게이트웨이 `10.0.2.1`) MAC도 NIC마다 다르다.
관리망이나 스토리지망 케이블이 같이 꽂혀 있으면 그것이 서버의 첫 계획이고, 모든 rail은 `<아이디>#r<번호>` 열쇠로 따로 있다. 스토리지 어레이가 rail leaf 하나에만 꽂혀 있으면 그냥 보통 호스트다.

ARP, MAC 표, `ping`은 모두 이 열쇠(NIC)를 단위로 돈다. 같은 서브넷의 NIC들은 `ping` 판정을 한 번만 계산해 나눈다(수천 대에서도 서브넷 수만큼만 계산).

## 알람 `gpu_rail_degraded.<끊긴 rail>`

서버가 **켜져 있고** rail 하나라도 위쪽 스위치에서 `ping`이 닿지 않으면 서버당 하나가 오른다. 이유는 묻지 않는다: 케이블, leaf 전원, BGP 이웃 shutdown, VLAN·SVI 설정 오류 모두 같다.

| 끊긴 rail | 등급 | 메시지 |
|---|---|---|
| 일부 | warning | `<서버>: GPU 레일 2, 7번이 끊겼어요 (8개 중 2개) — 분산 학습이 느려져요` |
| 전부 | critical | `<서버>: GPU 레일 …이 끊겼어요 — 이 서버는 클러스터와 통신할 수 없어요` |

- 알람 엔진은 알람의 처음 메시지를 간직한다. 그래서 끊긴 rail 번호를 **코드에 넣었다**(`gpu_rail_degraded.2-7`). rail이 더 끊기면 새 코드의 알람이 서고 옛 알람은 사라진다.
- `host_unreachable`은 rail NIC에는 올리지 않는다. 서버는 살아 있기 때문이다.
- 스파인 하나가 사라져도 다른 스파인으로 `ping`이 닿으므로 알람이 없다.
- BGP 이웃을 끄면 `bgp_session_down`(스위치 쪽)과 `gpu_rail_degraded`(서버 쪽)가 **둘 다** 선다. 한쪽은 스위치가 한 일, 다른 쪽은 서버가 입은 피해를 말한다.
- 꺼 둔 서버에는 알람이 없다.

## 카탈로그

Arcline 400G 64포트 `al-rail-64x400g`(leaf, 2U, 1,900W)와 `al-rail-spine-64x400g`(스파인), 둘 다 180백만 원(약 13.4만 달러, 추정)이다.
서버의 NIC 속도는 GPU 카탈로그([GPU 카탈로그](gpu-catalog.md))의 `nic`(ConnectX-7 400G, ConnectX-8 800G)에 있다.

## 시험용 월드 (`test-support/gpu-lab.ts`)

rail leaf 8개와 스파인 2개, GPU 서버 3대(모든 leaf에 케이블), 스토리지 하나(rail1에만). `gpuLab(false)`는 `fabric` 속성 없이 케이블만 남겨서 자동 판별을 시험한다.

## 흉내 내지 않는 것 (솔직하게)

- **GPU 클러스터를 만드는 생성기가 없다.** 생성기가 만드는 GPU 서버는 일반 랙의 ToR 하나에만 꽂힌다. GPU 백엔드는 가져온 월드나 손으로 그린 청사진에서 나온다. 빌더(웹)에서 rail을 그리는 화면도 없다.
- **대역폭이 없다.** NIC 속도와 leaf 포트 속도가 맞는지, rail 하나를 잃으면 몇 % 느려지는지는 계산하지 않는다. "느려진다"는 말뿐이다.
- **rail 균형 검사가 없다.** 서버의 NIC 수가 GPU 수와 같은지, 모든 서버가 모든 rail에 꽂혔는지는 보지 않는다.
- PFC, ECN, DCQCN, 혼잡, 패킷 손실이 없다. RoCE의 진짜 고장(PFC 폭풍, ECN 미설정)은 흉내 내지 못한다.
- InfiniBand, 서브넷 매니저(UFM), NCCL, NVLink 통신이 없다.
- 수천 대 월드에서 NIC 계획의 성능은 아직 실측하지 않았다(계획이 서버당 8개로 늘어난다).

## 어떻게 확인하나

`tests/spec/gpu-fabric.test.ts`(14개): NIC 8개와 주소·MAC, 스토리지가 보통 호스트인 것, BGP 세션과 VXLAN 없음, 자동 판별과 이중화는 GPU가 아닌 것, 정상 클러스터에 알람 없음, 케이블·leaf 전원·BGP shutdown·스파인 하나로 인한 알람과 해제, 전부 끊김이 critical인 것, 꺼 둔 서버.
