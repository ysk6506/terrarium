---
title: 네트워크의 두 가지 모양 — 레거시(VLAN·스패닝 트리)와 클라우드(leaf-spine·BGP)
kind: spec
status: active
last_verified: 2026-11-04
covers:
  - packages/core/src/world/net-bgp.ts
  - packages/core/src/world/net-stp.ts
  - packages/core/src/facades/netos-bgp.ts
  - packages/core/src/facades/netos-bgp-config.ts
  - packages/core/src/facades/netos-stp.ts
  - packages/core/src/facades/netos-routes.ts
  - packages/core/src/sources/worldgen/campus-families.ts
verification_log:
  - "2026-11-04: net-bgp·net-stp·netos-bgp·bgp-config·stp·routes와 campus-families를 문서와 대조"
  - "2026-11-04: 최종 코드와 대조"
  - "2026-11-04: net-stp의 함수 분리(동작 동일)를 확인"
  - "2026-11-04: fabric gpu 값과 GPU 백엔드 문서 링크를 net-bgp(레거시만 건너뜀)·netos-bgp(overlayOn)와 대조"
  - "2026-11-04: net-design의 함수 분리(동작 동일)를 확인"
covers_hash: ad1366d1c19b4e7b
---
# 네트워크의 두 가지 모양 (REQ-065, ADR-0062)

## 한 줄로

같은 서버들을 이어도 **망을 짓는 방식은 두 가지**다. 오래된 방식(레거시)은 "한 건물 안의 한 동네"처럼 VLAN으로 칸을 나누고, 클라우드 방식은 "고속도로 톨게이트 망"처럼 모든 길을 라우팅하고 BGP로 서로 길을 알려 준다.
테라리움은 둘 다 흉내 낸다. 어느 쪽이냐에 따라 **망가지는 방법과 고치는 방법이 다르다.**

## 비유로 이해하기

- **레거시**는 한 지역 우체국이다. 모든 우체통(서버)이 한 건물 안 칸막이(VLAN)에 있고, 칸막이를 잇는 복도(트렁크)가 두 개씩 있다. 복도가 둘이면 빙글빙글 돌 수 있어서(루프) **한 복도에는 일부러 문을 잠가 둔다.** 이게 스패닝 트리다. 복도 하나가 막히면 잠가 둔 문이 열린다.
- **클라우드**는 도시를 잇는 고속도로다. 각 동네(랙)는 위쪽 고속도로(스파인)마다 도로를 하나씩 갖고, 도로마다 양쪽 톨게이트가 "나는 이 동네들로 갈 수 있어요"라고 서로 알려 준다(BGP). **도로를 닫으면 그 도로로 알려 준 길이 지도에서 사라진다.** 남은 도로로 돌아가거나, 다 닫으면 그 동네는 섬이 된다.

## 어느 쪽인지는 누가 정하나

스위치 속성 `fabric`이다. `legacy`(기본), `cloud`, `gpu`([GPU 백엔드](gpu-fabric.md)). 같은 도메인(말단 스위치와 그 위쪽 스위치 묶음)에서는 아이디 순으로 처음 값이 있는 스위치가 도메인의 종류를 정한다. 속성이 없으면 [ADR-0061의 모양](switch-l2l3.md) 그대로다.

월드 생성기(`generateCampus`)는 장비 묶음(family)으로 팟마다 정한다. generic·cobaltica는 레거시, halcyon·hanbit은 클라우드다. **이건 그럴듯한 규칙이지 실제 사업장의 구성이 아니다.** 실제 구성을 가져올 때는 `fabric`을 직접 쓰면 된다. 단일 방 생성기(`generateWorld`)는 레거시만 만든다.

## 클라우드의 모양 (케이블에서 정해진다)

| 레거시 | 클라우드 |
|---|---|
| 말단의 위쪽 케이블은 트렁크 | 말단의 위쪽 케이블은 **라우팅 포트(/31)** |
| 게이트웨이는 위쪽 스위치들이 함께 쓰는 주소 | 모든 말단이 **같은 주소(anycast, .1)** 를 갖는다 |
| 위쪽 스위치가 VLAN 인터페이스를 가짐 | 말단이 VLAN 인터페이스를 가짐 |
| 스패닝 트리가 루프를 막음 | **케이블마다 eBGP 세션**, 스패닝 트리 없음 |

- **AS 번호**(사설 4바이트): 한 도메인의 스파인은 `4200000000+도메인` 하나를 같이 쓰고, 말단은 `4210000000+도메인×10000+순번`을 하나씩 갖는다. 라우터 ID는 `10.255.x.y`.
- 말단의 기본 경로는 위쪽 이웃마다 하나(ECMP). 스파인은 말단의 /24로 가는 경로를 갖는다. 이 경로들에 `bgp` 표시가 붙는다.
- 정적 경로가 BGP 경로를 이긴다. 배운 경로는 `no ip route`로 못 지운다.

## 세션이 서는 조건

| 상태 | 언제 | 화면 |
|---|---|---|
| established | 케이블이 살아 있고 양쪽 전원이 있고 양쪽 모두 `shutdown` 안 함 | EOS `Estab`, NX-OS·IOS XE 받은 경로 수 |
| shutdown | **내 쪽에서** 껐음 | EOS `Idle`, 시스코 `Idle (Admin)` |
| down | 케이블·전원·**상대가 껐음** | `Active` |

세션이 established일 때만 그 세션으로 배운 경로가 경로표에 있다. `ping`, `traceroute`, `show ip route`는 모두 같은 경로표를 읽는다.

## 끄면 무슨 일이 생기나

1. 이웃 하나를 끈다(`neighbor <ip> shutdown`). 그 세션과 거기서 온 경로가 사라진다. 다른 스파인으로 돌아서 서버는 계속 닿는다. 끈 스위치에 알람 `bgp_session_down`(경고)이 선다.
2. 이웃을 모두 끈다. 그 랙으로 가는 길이 없어서 서버가 끊기고, 알람 `host_unreachable`이 서버를 이름으로 말한다.
3. `no neighbor … shutdown`으로 되살리면 알람이 사라진다.
4. **케이블을 뽑거나 스파인 전원을 내려서** 세션이 끊기면 `bgp_session_down`은 없다. 기존 링크·전원 알람이 말한다. 같은 일을 두 번 말하지 않는다.

알람은 (장비, 코드)당 하나라서 한 스위치에서 여러 이웃을 껐으면 한 알람에 모아서 이웃을 이름과 주소로 적는다.

## 명령

| 하고 싶은 일 | EOS | NX-OS | IOS XE |
|---|---|---|---|
| BGP 요약 | `show ip bgp summary` | 같음 | 같음 |
| EVPN 요약 | `show bgp evpn summary` | `show bgp l2vpn evpn summary` | 같음 |
| VNI 표 | `show vxlan vni` | `show nve vni` | 같음 |
| BGP 들어가기 | `router bgp <AS>` | 같음 | 같음 |
| 이웃 끄기 | `neighbor <ip> shutdown` | `neighbor <ip>` 다음 줄에 `shutdown` | `neighbor <ip> shutdown` |
| 이웃 켜기 | `no neighbor <ip> shutdown` | `neighbor <ip>` 다음 줄에 `no shutdown` | `no neighbor <ip> shutdown` |
| 스패닝 트리 | `show spanning-tree` | `show spanning-tree [vlan N]` | 같음 |

프롬프트는 OS의 것을 따른다. EOS `(config-router-bgp)#`, NX-OS `(config-router)#`와 `(config-router-neighbor)#`, IOS XE `(config-router)#`.
`router bgp`의 AS가 틀리면 "BGP is already running; AS is …"로 거절한다. 없는 이웃, 다른 AS를 쓰는 `remote-as`도 거절한다(이웃과 AS는 케이블이 정한다). 클라우드가 아닌 스위치에서는 `show ip bgp summary`가 그 OS의 "BGP 꺼져 있음" 답이고 `router bgp`는 거절된다.
eAPI(EOS)와 NX-API(NX-OS)는 `show ip bgp summary`를 JSON으로도 준다.

`show running-config`에는 `router bgp` 구역(이웃, 끈 이웃의 `shutdown`), 말단의 anycast 게이트웨이(EOS `ip address virtual …`, NX-OS `fabric forwarding mode anycast-gateway`), VXLAN 매핑(EOS `interface Vxlan1`, NX-OS `interface nve1`, IOS XE `l2vpn evpn`)이 나온다.

## 레거시의 스패닝 트리

"지금 트래픽을 나르는 케이블"만으로 계산한다. 그래서 케이블을 뽑거나 루트 스위치 전원을 내리면 **트리가 다시 선다.**

- 위쪽 스위치(게이트웨이)가 가장 좋은 브리지(우선순위 4096, 8192, …), 말단은 기본 32768. 우선순위가 같으면 MAC이 작은 쪽.
- 각 스위치는 루트까지 홉이 가장 적은 케이블이 **root 포트**, 케이블의 다른 쪽보다 루트에 가까운 쪽이 **designated**, 나머지가 **alternate(막힘)** 이다.
- EOS는 MSTP 인스턴스 하나, NX-OS·IOS XE는 VLAN마다 Rapid-PVST 구역을 보여 준다. 비용은 홉당 상수를 OS의 10G 값(EOS 2000, 시스코 2)으로 환산했다.
- **보여 주기만 한다.** 막힌 포트가 `ping`의 길을 바꾸지는 않는다(도달성은 같다).
- 클라우드 도메인에는 스패닝 트리가 없다("No spanning tree instance exists").

## 흉내 내지 않는 것

- 세션 협상과 타이머, 경로 속성(MED, 커뮤니티, AS-path), 경로 필터, 시간에 따른 수렴. 세션은 즉시 서고 즉시 끊긴다.
- `no router bgp`, 새 이웃 추가. 이웃과 AS는 케이블에서 정해진다.
- EVPN 경로 교환. 경로 수는 서버 수에서 센 추정값이고 VNI는 10000+VLAN으로 정했다.
- VLAN별로 다른 STP 루트, 루트 가드, BPDU 가드, 포트패스트. 메시지 수와 가동 시간은 이름에서 만든 값이다.
- InfiniBand와 사이트 사이 전용선은 아직 없다. GPU 백엔드(RoCE 이더넷)는 [다른 문서](gpu-fabric.md)(REQ-067, ADR-0064)가 다룬다. 클라우드와 같은 설계에서 VXLAN만 뺀 모양이다.

## 어떻게 확인하나

- `tests/spec/network-fabrics.test.ts`: 세 OS에서 세션·경로·ping·알람(하나 끄기, 모두 끄기, 되살리기), 케이블과 전원 고장, 명령줄의 프롬프트와 거절, JSON, 스패닝 트리 루트와 재계산, 생성기의 패브릭.
- `tests/spec/switch-l2l3*.test.ts`, `network-os*.test.ts`: 레거시와 이전 명령이 그대로임.
