---
title: ADR-0057 설비는 표준이 있으면 그 말로 답한다 — Redfish는 스키마로 대조, UPS는 SNMP, 냉각·발전은 BACnet
kind: decision
status: active
enforced_by:
  - tests/spec/redfish-conformance.test.ts
  - tests/spec/facility-protocols.test.ts
  - tests/spec/bacnet-protocol.test.ts
  - packages/core/src/facades/snmp-core.test.ts
  - ARCH020
touches_protected:
  - package.json
  - harness/config/architecture.yaml
  - docs/product-specs/requirements.md
  - AGENTS.md
amends_tests:
  - packages/core/src/tools/tools.test.ts::=echoFacades
  - tests/spec/facility-protocols.test.ts::<import:f6c50b5a>
test_change_reason: 도구 묶음에 snmp_request와 bacnet_request가 더해져서 Facades 모양이 늘었다. 시험이 쓰는 가짜 파사드 묶음에 snmp와 bacnet 항목을 더했을 뿐이고, 시험이 확인하는 규칙(도구가 파사드의 답을 그대로 돌려주는지)은 그대로다. 같은 변경에서 새로 잠근 설비 프로토콜 시험 파일의 안 쓰는 import 한 줄도 지웠다(시험 내용은 그대로).
decision_hash: 0617451dbff31bbb
---
# ADR-0057 설비는 표준이 있으면 그 말로 답한다

## 맥락
요구는 "데이터센터 설비들 인터페이스도 표준이 있으면 표준에 맞게 에뮬레이트해"였다. 그때까지 서버 BMC만 Redfish로 답했고, PDU·UPS·항온항습기 같은 설비는 표준이 아닌 자체 도구로만 다룰 수 있었다.
에이전트가 시뮬레이터에서 배운 호출이 현실에서도 통하려면 설비가 현실의 말로 답해야 한다.

## 결정
1. **설비마다 쓰는 말을 정한다**(`facades/protocols.ts`). 서버·PDU는 Redfish, 스위치는 SNMP, 분전반은 Redfish와 BACnet, UPS는 SNMP와 BACnet, CDU는 Redfish와 BACnet, 항온항습기·냉동기·발전기는 BACnet이다.
   쓰지 않는 말로 물으면 404로 "어떤 말을 쓰는지" 알려 준다. 현실의 장비도 모르는 서비스에는 답이 없다.
2. **Redfish는 DMTF 스키마로 기계가 대조한다.** PDU·분전반은 `PowerEquipment/PowerDistribution`, CDU는 `ThermalEquipment/CoolingUnit`으로 만들고, DMTF가 공개한 JSON 스키마(BSD-3, 83개 파일 약 116 KiB)를
   저장소에 넣어 두고 Ajv로 모든 연결된 리소스를 대조한다. 스키마 묶음에 없는 종류는 건너뛰지 않고 실패한다. 검사가 실제로 틀린 것을 잡는지도 시험한다.
   차단기 재투입은 표준 동작 `Circuit.BreakerControl`로 월드의 `breaker.reset`을 일으킨다.
3. **UPS는 SNMP의 UPS-MIB(RFC 1628)로 답한다.** Redfish에는 UPS 종류가 없기 때문이다. 스위치는 IF-MIB, 모든 장치는 SNMPv2-MIB 시스템 그룹을 낸다. 에이전트 엔진은 RFC 3416 동작을 따른다
   (`noSuchObject`/`noSuchInstance`/`endOfMibView`, 원자적 Set, 64개 초과 `tooBig`). 커뮤니티는 읽기 `public`, 쓰기 `private`이다.
   `sysObjectID`는 문서용 기업 번호(RFC 5612의 32473) 아래다. 카탈로그의 제조사가 가상이라 진짜 번호를 쓰면 남의 번호를 쓰는 것이다.
4. **냉각·발전·분전반·UPS는 BACnet(ANSI/ASHRAE 135)으로 답한다.** 건물 관리 시스템이 쓰는 서비스(Who-Is, ReadProperty, ReadPropertyMultiple, WriteProperty와 우선순위 배열)를 따른다.
   번호(객체 종류, 속성, 단위, 오류 분류와 코드)는 공개 구현 bacnet-stack의 `bacenum.h`와 같고, 시험이 대조한다. 쓸 수 있는 점은 항온항습기의 설정온도와 켜기/끄기 둘이고, 월드의 `setpoint.set`/`power.set`을 일으킨다.
   `vendorId`는 ASHRAE에 등록된 번호가 없어서 0이다(제조사가 가상이다).
5. **패킷이 아니라 도구로 준다.** 에이전트가 쓰는 길은 도구(`redfish_request`, 새 `snmp_request`, 새 `bacnet_request`)다. 이 시뮬레이터는 네트워크 포트를 열지 않는다. 도구는 표준이 정한 모양의 답을 JSON으로 돌려준다.
   새 두 도구는 `category: "protocol"`이라서 기본 도구 묶음에는 넣지 않는다.
6. **새 개발 의존성 둘**: `ajv` 8.20.0과 `ajv-formats` 3.0.1을 시험 도구(`tests/spec/redfish-schemas/validator.ts`)에서만 쓴다. `harness/config/architecture.yaml`의 `third_party`에 `tests.spec` 단위만 허용하도록 등록한다.
7. **요구사항 REQ-060**을 더한다.

## 버린 대안
- **모드버스도 흉내 내기**: 모드버스는 전송 방식일 뿐 기기마다 레지스터 지도가 다르다. 따를 표준이 없다. 지어내면 에이전트가 가짜 지도를 외우게 된다.
- **진짜 UDP 소켓을 열기**: SNMP 161, BACnet 47808을 열면 에이전트 하네스가 도구 없이 `snmpget`을 쓸 수 있지만, 세션마다 포트를 나눠야 하고 클러스터·샌드박스에서 다루기 어렵다. 지금은 도구로 충분하다고 보고 미뤘다.
- **Redfish에 UPS를 억지로 넣기**: Redfish에 UPS 종류가 없어서 표준을 벗어나야 한다. UPS는 SNMP가 현실의 방식이다.
- **스키마 검사를 직접 짠 규칙으로 하기**: 규칙이 우리 생각을 확인할 뿐이다. 공개된 스키마를 쓰면 틀린 곳을 DMTF가 알려 준다.

## 한계 (솔직하게)
- 도구가 JSON으로 주고받는 것이지 UDP 패킷이 아니다. 진짜 SNMP·BACnet 클라이언트로는 붙을 수 없다.
- SNMP의 카운터, 전압, 전류, 배터리 온도는 월드에 숫자가 없어서 `noSuchInstance`다. UPS와 BACnet 장치의 펌웨어·에이전트 버전 문자열은 자리 채움이다.
- 쓸 수 있는 SNMP 글자(`sysName` 등)는 월드가 아니라 파사드 옆 메모에 남는다.
- PDU 콘센트 제어, CDU·냉동기 쓰기는 하지 않는다.
- DMTF 스키마 대조는 리소스마다 한 버전과 한다(오류 정정판은 같은 것으로 본다).
- 위 표준의 값과 동작은 공개 문서와 공개 구현(bacnet-stack, RFC)을 기억에 의지해 맞춘 것이다. 실제 장비나 진짜 클라이언트로 맞춰 보지는 못했다.
