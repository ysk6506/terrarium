---
title: ADR-0059 스위치는 운영 체제의 말로 답한다 — 아리스타 EOS, 시스코 NX-OS·IOS XE의 명령줄과 eAPI·NX-API, 포트 shutdown은 월드를 바꾼다
kind: decision
status: active
last_verified: 2026-11-04
enforced_by:
  - tests/spec/network-os.test.ts
  - tests/spec/facility-protocols.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - packages/core/src/tools/tools.test.ts::=echoFacades
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
test_change_reason: 도구 묶음에 스위치 명령줄과 두 HTTP API가 더해져서 Facades 모양이 늘었다. 시험이 쓰는 가짜 파사드 묶음에 network 항목을 더했을 뿐 도구가 파사드 답을 그대로 돌려주는지 보는 규칙은 같다. 시나리오 행동 종류에 포트 끄기와 포트 켜기가 더해져서 알 수 없는 행동 오류 문구의 가능한 행동 목록이 길어졌고, 시험은 그 문구를 새 목록으로 맞췄다.
decision_hash: e6dbe6a45ddcbfbf
---
# ADR-0059 스위치는 운영 체제의 말로 답한다

## 맥락
요구는 "네트워크 장비는 시스코, 아리스타를 주로 써. 얘네 인터페이스도 에뮬레이션해야 해"였다. 그때까지 스위치는 SNMP(IF-MIB)로만 답했고, 포트를 끄거나 설정을 바꿀 길이 없었다.
현장의 에이전트가 스위치에서 하는 일은 대부분 명령줄이다. 상태를 `show`로 보고, 설정을 바꾸고(`shutdown`), 자동화는 아리스타 eAPI나 시스코 NX-API로 한다.

## 결정
1. **스위치는 세 가지 OS 중 하나를 돌린다.** 프로파일 `eos/4.32`(Arista EOS 4.32.2F), `nxos/10.3`(Cisco NX-OS 10.3(4a)), `ios-xe/17.9`(Cisco IOS XE 17.9.4a).
   스위치의 `nosProfile` 속성이 정하고, 없으면 역할로 정한다(tor → NX-OS, spine → EOS, mgmt → IOS XE). 하드웨어는 가상 제조사 그대로다. OS 이름, 버전, 명령과 출력의 모양만 현실을 따른다.
2. **명령줄(`network_cli`)**: 로그인마다 새 세션이다. 모드(사용자, 특권, 설정, 인터페이스 설정), 줄임말(고유 접두사, 정확히 같은 단어가 더 긴 단어보다 앞선다), 프롬프트, 오류 문구가 OS마다 다르다.
   EOS는 `% Invalid input (at token 1: 'x')`, NX-OS는 캐럿과 `% Invalid command at '^' marker.`, IOS XE는 캐럿과 `% Invalid input detected at '^' marker.`다. EOS는 특권 명령을 사용자 모드에서 치면 그렇다고 말해 준다.
   파이프는 `| include`, `| exclude`, `| begin`, `| section`, `| grep`, `| count`, `| json`이다. 지원 명령은 `show version`, `show interfaces`(status, 포트, description), `show ip interface brief`, `show lldp neighbors`, `show running-config`(포트 지정 가능), `show clock`, `show hostname`과
   `configure terminal`, `interface`, `shutdown`, `no shutdown`, `description`, `hostname`, `end`, `exit`, `write memory`다.
3. **eAPI(`eapi_request`)와 NX-API(`nxapi_request`)**: 명령줄 위에 얹은 포장이다. eAPI는 JSON-RPC `runCmds`(json/text, 오류 코드 1002 invalid command, 1003 unconverted command), NX-API는 `ins_api`(cli_show, cli_show_ascii, cli_conf, 명령마다 코드 200/400/501, 하나면 객체, 여럿이면 목록)다.
   스위치는 자기 OS의 HTTP API만 갖는다(EOS는 eAPI, NX-OS는 NX-API, IOS XE는 없음). 다른 것을 부르면 404로 어느 것이 맞는지 알려 준다.
4. **`shutdown`은 월드를 바꾼다.** 월드 명령 `link.admin`이 링크의 한쪽 끝(`from`/`to`)을 운영자 정지로 표시한다. 링크는 어느 한쪽이 정지이거나 장애가 끊으면 내려간다. 반대편 스위치는 `disabled`가 아니라 `notconnect`로 본다.
   `no shutdown`은 장애로 끊긴 링크를 되살리지 않는다. 케이블이 없는 빈 포트는 끌 수 있고 스위치가 기억만 한다. 시나리오 행동 종류에 `port_shutdown`, `port_enable`이 더해진다. SNMP `ifAdminStatus`를 2로 쓰면 같은 일이 일어난다.
5. **포트 이름과 순서는 한 곳에서 정한다**(`netos-model.ts`). SNMP, 명령줄, HTTP API가 같은 포트를 같은 번호로 본다. 청사진 링크에 포트 이름표가 있으면(가져온 세계) 그 이름을 쓰고, 없으면 OS의 이름(EOS `Ethernet1`, NX-OS `Ethernet1/1`, IOS XE `TwentyFiveGigE1/0/1`처럼 속도에 따라)을 쓴다.
6. **호스트명과 포트 설명은 장비 옆 메모에 둔다.** 명령줄과 SNMP(`sysName`, `ifAlias`)가 같은 메모를 본다. 전원이 없거나 꺼진 스위치는 응답하지 않는다(`timeout`).
7. 새 도구 셋은 `category: "protocol"`이라서 기본 도구 묶음에는 들어가지 않는다. 설정하는 호출(`configure`, 설정 명령, `cli_conf`)은 "행동"으로 센다.
8. **요구사항 REQ-062**를 더한다.

## 버린 대안
- **진짜 SSH 서버를 열기**: 세션마다 포트를 나눠야 하고 샌드박스에서 다루기 어렵다. 도구로 충분하다고 보고 미뤘다(ADR-0057과 같은 이유).
- **OS 하나만 흉내 내기**: 현장은 아리스타와 시스코가 섞여 있고, 에이전트가 틀리기 쉬운 곳이 바로 OS 사이의 차이(프롬프트, 줄임말, 오류 문구, JSON 모양)다.
- **`shutdown`을 출력만 바꾸고 월드는 그대로 두기**: 시나리오가 "누가 포트를 껐다"를 시작 상태로 만들 수도 없고, 고쳤는지 채점할 수도 없다.
- **포트에 스위치마다 따로 번호 붙이기**: SNMP와 명령줄이 어긋난다.

## 한계 (솔직하게)
- 출력은 벤더 문서와 기억에 의지해 손으로 맞췄다. 실제 장비나 진짜 클라이언트(netmiko, pyeapi)로 맞춰 보지는 못했다. 드문 오류 문구(예: `| json`이 안 되는 명령)는 추정이다.
- VLAN, MAC 표, 라우팅, 스패닝 트리, 패킷 카운터, 에러 카운터는 월드에 없어서 명령이 없다(그 명령은 OS의 "잘못된 명령" 답을 받는다). `?` 도움말과 탭 완성도 없다.
- IOS XE의 RESTCONF, NETCONF, gNMI는 하지 않는다. NX-OS의 `| json`과 eAPI의 JSON은 `show version`, `show hostname`, 인터페이스 상태·상세, LLDP 이웃만 있다.
- 로그인은 인증 없이 열린다. 세션은 호출마다 새로 시작하고 모드가 호출 사이에 남지 않는다.
- 스위치 하드웨어(포트 수, 속도)는 카탈로그의 가상 모델이다. `show version`의 제조사와 모델은 가상 이름이다.
