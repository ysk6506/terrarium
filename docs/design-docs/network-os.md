---
title: 스위치의 운영 체제 — 아리스타 EOS, 시스코 NX-OS·IOS XE
kind: spec
status: active
last_verified: 2026-11-12
covers:
  - packages/core/src/facades/netos-model.ts
  - packages/core/src/facades/netos-parse.ts
  - packages/core/src/facades/netos-cli.ts
  - packages/core/src/facades/netos-iface.ts
  - packages/core/src/facades/netos-show.ts
  - packages/core/src/facades/netos-http.ts
  - packages/core/src/facades/network.ts
  - packages/core/src/facades/snmp-if.ts
  - packages/core/src/profiles/profiles.ts
verification_log:
  - "2026-11-04: CLI 명령 목록, 모드, 파이프, 오류 문구를 netos-cli/netos-parse와 다시 대조했다. 출력 모양 테스트(network-os-outputs)를 확인 목록에 추가"
  - "2026-11-04: VLAN·MAC 표·라우팅이 없다던 줄을 새 문서(switch-l2l3)로 바꾸고, 명령 목록에 2·3계층 명령을 더했다. netos-cli/show/iface/model의 L2/L3 변경과 대조"
  - "2026-11-04: netos-cli의 모드 확장(config-bgp, config-bgp-nbr), configure 호출 종료 규칙(network.ts), 새 명령 목록을 확인해 명령줄 절에 더했다 (REQ-065)"
  - "2026-11-12: ADR-0184: 흉내의 한계 힌트 변경 뒤에도 내용이 맞는지 다시 봤어요"
  - "2026-11-12: ADR-0184: 한계 출력 모양 변경(terrarium 줄만)이 이 문서 내용과 어긋나지 않음을 대조"
covers_hash: 99419d9b3abf574b
verified_body: 0e1745b3026d9e81
unchanged_reverifies: 1
---
# 스위치의 운영 체제 (REQ-062, ADR-0059)

## 한 줄로

현장의 스위치는 대부분 아리스타(EOS)나 시스코(NX-OS, IOS XE)다. 에이전트는 스위치를 **명령줄**로 보고 만지고, 자동화는 아리스타 eAPI나 시스코 NX-API로 한다.
테라리움의 스위치도 같은 말로 답한다. 포트를 끄면 시뮬레이터 안에서도 실제로 링크가 끊긴다.

## 스위치마다 쓰는 OS

| OS | 프로파일 | 프롬프트 시작 | HTTP API | 기본으로 쓰는 역할 |
|---|---|---|---|---|
| Arista EOS | `eos/4.32` (4.32.2F) | 사용자 `sw>` | eAPI | spine |
| Cisco NX-OS | `nxos/10.3` (10.3(4a)) | 특권 `sw# ` | NX-API | tor |
| Cisco IOS XE | `ios-xe/17.9` (17.9.4a) | 사용자 `sw>` | 없음 | mgmt |

스위치의 `nosProfile` 속성이 있으면 그것이 이긴다. 하드웨어(포트 수, 속도, 제조사)는 카탈로그의 가상 모델이다.

## 에이전트는 어떻게 부르나

- `network_cli {device, commands, configure}` — 로그인해서 줄을 차례로 친다. 호출마다 새 세션이다. `configure`를 켜면 `enable`과 `configure terminal`을 대신 치고 끝에 `end`로 나온다.
- `eapi_request {device, body}` — EOS 스위치의 `runCmds`.
- `nxapi_request {device, body}` — NX-OS 스위치의 `ins_api`.

셋 다 `category: "protocol"`이라서 기본 도구 묶음에는 없다. 스위치가 쓰지 않는 HTTP API를 부르면 404로 어느 것이 맞는지 알려 준다. 전원이 없거나 꺼진 스위치는 `timeout`이다.

## 명령줄

- 모드: 사용자(`>`) → `enable` → 특권(`#`) → `configure terminal` → 설정(`(config)#`) → `interface <포트>` → 인터페이스 설정. NX-OS는 특권 모드로 시작하고 `enable`이 없다.
  설정 모드 아래에는 인터페이스, VLAN, `router bgp`(EOS `(config-router-bgp)#`, 시스코 `(config-router)#`, NX-OS는 `neighbor` 아래 `(config-router-neighbor)#`)가 있다. `configure`를 켠 호출은 어느 설정 모드에 있든 끝에 `end`로 나온다.
- 줄임말: 단어는 고유 접두사로 줄인다(`sh int status`). 정확히 같은 단어가 더 긴 단어보다 앞선다. 접두사가 둘 이상에 맞으면 모호하다고 한다.
- 오류: EOS `% Invalid input (at token 1: 'x')`, `% Incomplete command`, `% Ambiguous command`. NX-OS는 캐럿 줄과 `% Invalid command at '^' marker.`. IOS XE는 캐럿 줄과 `% Invalid input detected at '^' marker.`, 모호하면 `% Ambiguous command:  "..."`.
- 명령: `show version`, `show clock`, `show hostname`(EOS·NX-OS), `show interfaces`(`status`, `<포트>`, `<포트> status`, `description`), `show ip interface brief`, `show lldp neighbors`, `show running-config`(`interface <포트>`), 그리고 [2·3계층 명령](switch-l2l3.md)(`show vlan`, `show mac address-table`, `show ip route`, `show ip arp`, `ping`, `traceroute`, `vlan`, `switchport ...`, `interface vlan`, `ip address`, `ip route`), [BGP·EVPN·스패닝 트리 명령](network-fabrics.md)(`show ip bgp summary`, `show spanning-tree`, `router bgp`, `neighbor … shutdown`),
  `configure terminal`, `interface`, `shutdown`, `no shutdown`, `description`, `no description`, `hostname`, `no hostname`, `end`, `exit`, `logout`, `write memory`, `copy running-config startup-config`, `terminal length`, IOS XE의 `do`.
- 파이프: `include`, `exclude`, `begin`, `section`, `grep`(IOS XE 제외), `count`, `json`(EOS·NX-OS, JSON이 있는 명령만).
- 포트 이름: 청사진 링크에 이름표가 있으면 그것(가져온 세계), 없으면 OS의 이름이다. 입력은 `Et1`, `ethernet 1/1`, `Twe1/0/1`처럼 줄여 써도 된다.

## 포트를 끄면 월드에서 일어나는 일

`shutdown`은 그 포트의 링크 한쪽 끝에 "운영자 정지"를 표시한다(월드 명령 `link.admin`). 링크는 어느 끝이든 정지이거나 장애가 끊으면 내려간다.

- 반대편 장비는 `notconnect`로 본다(케이블이 빠진 것처럼). `disabled`는 끈 쪽만 본다.
- `link_down` 알람이 오른다. LLDP 이웃에서 사라진다. SNMP `ifAdminStatus`는 2, `ifOperStatus`는 2다.
- `no shutdown`은 장애(`link_down` 결함)로 끊긴 링크를 되살리지 않는다.
- SNMP `ifAdminStatus`를 `private` 커뮤니티로 2나 1로 쓰면 같은 일이 일어난다.
- 케이블이 없는 빈 포트는 끌 수 있고, 스위치가 기억만 한다.
- 시나리오는 이 일을 "포트 끄기"/"포트 켜기" 행동으로 센다.

호스트명과 포트 설명은 장비 옆 메모에 남고 SNMP의 `sysName`, `ifAlias`가 같은 값을 본다.

## eAPI와 NX-API

- eAPI: `{"jsonrpc":"2.0","method":"runCmds","params":{"version":1,"cmds":[...],"format":"json"|"text"},"id":"1"}`. 명령은 특권 모드에서 돈다. 결과는 명령마다 JSON(또는 `{"output": 글}`)이고, 설정 명령은 `{}`다.
  읽을 수 없는 명령이 있으면 전체가 오류다(코드 1002 invalid command, JSON이 없는 명령은 1003 unconverted command). 오류의 `data`에는 거기까지 돈 결과가 담긴다.
- NX-API: `{"ins_api":{"version":"1.0","type":"cli_show"|"cli_show_ascii"|"cli_conf","input":"cmd ;cmd","output_format":"json"}}`. 명령마다 `code`가 있다(200 성공, 400 명령 오류와 `clierror`, 501 구조화 출력 없음). 명령이 하나면 `output`이 객체, 여럿이면 목록이다.
  `cli_conf`는 설정 모드에서 돌고 명령 사이에 모드가 이어진다. `cli_show`에 설정 명령을 보내면 400이다.

## 하지 않은 것

- LACP, 패킷·에러 카운터, OSPF: 월드에 없다. 그 명령은 OS의 "잘못된 명령" 답을 받는다. VLAN·MAC 표·ARP·정적 경로·`ping`은 [다른 문서](switch-l2l3.md)(REQ-064, ADR-0061)가, 스패닝 트리·BGP·EVPN·VXLAN은 [또 다른 문서](network-fabrics.md)(REQ-065, ADR-0062)가 다룬다.
- `?` 도움말, 탭 완성, 인증, 세션이 호출 사이에 남는 것.
- IOS XE의 RESTCONF/NETCONF/gNMI, 진짜 SSH 소켓.
- 출력은 벤더 문서와 기억에 의지해 손으로 맞췄다. 실제 장비나 진짜 클라이언트(netmiko, pyeapi)로 맞춰 보지는 못했다.

## 확인

- `tests/spec/network-os.test.ts` — OS 세 가지, 모드와 오류 문구, 줄임말, 파이프, shutdown의 월드 효과(SNMP, 알람, 반대편 스위치, LLDP), eAPI·NX-API 모양.
- `tests/spec/network-os-outputs.test.ts` — `show` 출력의 글자 모양(OS별 표 머리글, 인터페이스 상세, LLDP, running-config), 파이프 가장자리, eAPI·NX-API 오류 경로.
