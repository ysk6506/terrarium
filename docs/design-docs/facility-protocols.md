---
title: 설비의 표준 인터페이스 — Redfish, SNMP, BACnet
kind: spec
status: active
covers:
  - packages/core/src/facades/protocols.ts
  - packages/core/src/facades/redfish-facility.ts
  - packages/core/src/facades/redfish-power.ts
  - packages/core/src/facades/redfish-thermal.ts
  - packages/core/src/facades/redfish-common.ts
  - packages/core/src/facades/redfish-log.ts
  - packages/core/src/facades/snmp.ts
  - packages/core/src/facades/snmp-core.ts
  - packages/core/src/facades/snmp-mibs.ts
  - packages/core/src/facades/snmp-ups.ts
  - packages/core/src/facades/snmp-if.ts
  - packages/core/src/facades/bacnet.ts
  - packages/core/src/facades/bacnet-core.ts
  - packages/core/src/facades/bacnet-points.ts
  - tests/spec/redfish-schemas/validator.ts
---
# 설비의 표준 인터페이스 (REQ-060, ADR-0057)

## 한 줄로

실제 데이터센터에서 PDU, UPS, 항온항습기, 냉동기는 **각자 정해진 말**로 답한다. 서버는 Redfish, UPS는 SNMP, 항온항습기는 BACnet이다.
테라리움의 설비도 같은 말로 답한다. 그래야 에이전트가 시뮬레이터에서 배운 호출이 현실에서도 그대로 통한다.

## 설비마다 쓰는 말

| 설비 | 쓰는 말 | 무엇을 볼 수 있나 |
|---|---|---|
| 서버 | Redfish | BMC: 전원, 온도, 팬, 로그 (기존) |
| 스위치 | SNMP, 명령줄 | 시스템 정보, 포트(IF-MIB). 명령줄·eAPI·NX-API는 [스위치의 운영 체제](network-os.md) |
| PDU | Redfish | 전원 분배 장치, 회로(차단기), 콘센트(`Outlet.PowerControl`로 켜고 끄기), 전력. ORv3 파워 셸프는 `PowerShelf`로 보이고 콘센트가 없다([랙 규격과 PDU 콘센트](rack-standards.md)) |
| 분전반 | Redfish, BACnet | 회로 차단기 상태와 부하 / 전력, 전류, 차단기 |
| UPS | SNMP, BACnet | UPS-MIB(배터리, 입출력, 경보) / 배터리, 부하, 상태 |
| CDU | Redfish, BACnet | 냉각 장치, 1차·2차 냉각수 연결, 펌프 / 온도, 부하, 펌프, 켜고 끄기(쓰기) |
| 항온항습기 | BACnet | 공급·환기 온도, 부하, 외기 온도, 설정온도(쓰기), 켜고 끄기(쓰기) |
| 냉동기 | BACnet | 냉수 온도, 부하, 전력, 외기 온도, 켜고 끄기(쓰기) |
| 발전기 | BACnet | 연료, 출력, 엔진 상태, AUTO/OFF(쓰기) |

설비가 쓰지 않는 말로 물으면 **어떤 말을 쓰는지 알려 준다.** 예: UPS에 Redfish를 보내면 "'ups-1' (ups) has no Redfish service; it speaks SNMP and BACnet"(404)라고 답한다.

## 에이전트는 어떻게 부르나

네트워크 포트를 열지 않는다. 에이전트는 **도구 세 개**로 부른다. 도구는 요청을 받아서 표준이 정한 모양의 답을 JSON으로 돌려준다.

- `redfish_request {server, method, path, body}` — 서버뿐 아니라 PDU·분전반·CDU의 id도 받는다.
- `snmp_request {device, operation, oids, community, ...}` — `get`, `getnext`, `getbulk`, `walk`, `set`.
- `bacnet_request {device, service, objectType, instance, property, ...}` — `who-is`, `read-property`, `read-property-multiple`, `write-property`.

이 세 도구는 `category: "protocol"`이라서 기본 도구 묶음에는 들어 있지 않다. 시나리오가 필요할 때 켠다.

## Redfish: 스키마로 기계가 대조한다

DMTF가 공개한 JSON 스키마(`tests/spec/redfish-schemas/dmtf-schemas.json.gz`, BSD-3)를 저장소에 넣어 두고, 시험이 BMC와 설비의 모든 연결된 리소스를 따라가며 스키마와 맞는지 확인한다
(`tests/spec/redfish-conformance.test.ts`). 열거값이 틀리거나, 필수 속성이 빠지거나, 모르는 속성이 있으면 실패한다. 스키마 묶음에 없는 종류가 나오면 건너뛰지 않고 실패한다.
검사 자체가 틀린 것을 잡는지도 시험한다.

- PDU는 `PowerDistribution`(RackPDU/FloorPDU), 분전반은 `PowerDistribution`(`PowerEquipment` 아래), CDU는 `CoolingUnit`(`ThermalEquipment` 아래)이다.
- 회로의 `BreakerState`는 `Normal`/`Tripped`다. `Actions/Circuit.BreakerControl`로 차단기를 다시 넣으면 월드의 `breaker.reset`이 일어난다.
- 세션 서비스(`/redfish/v1/SessionService`)와 이벤트 로그(`LogServices/EventLog/Entries`)가 있다.

## SNMP: 에이전트가 하는 일을 그대로

SNMPv2c의 동작(RFC 3416)을 따른다. 없는 객체는 `noSuchObject`, 객체는 있는데 인스턴스가 없으면 `noSuchInstance`, 끝에 닿으면 `endOfMibView`를 **변수마다** 돌려준다.
`set`은 한 줄이라도 안 되면 아무것도 바꾸지 않는다. 한 번에 64개를 넘기면 `tooBig`이다. 커뮤니티는 읽기 `public`, 쓰기 `private`이고, 틀리면 응답이 없다(`timeout`).

- UPS는 UPS-MIB(RFC 1628)로 답한다. 정전이 나면 `upsOutputSource`가 `battery(5)`가 되고, `upsEstimatedChargeRemaining`이 줄고, `upsAlarmOnBattery` 행이 생긴다.
- 스위치는 IF-MIB(포트 상태)와 SNMPv2-MIB(시스템 그룹)로 답한다. 포트 이름과 순서는 스위치의 명령줄이 보여 주는 것과 같고, `ifAdminStatus`를 `private` 커뮤니티로 1(켬)이나 2(끔)로 쓰면 포트가 실제로 켜지고 꺼진다 (ADR-0059).
- 쓸 수 있는 글자(`sysName`, `sysContact`, `sysLocation`, `upsIdentName`, `ifAlias`)는 **월드가 아니라 파사드 옆 메모**에 남는다.
- `sysObjectID`는 문서용 기업 번호(RFC 5612의 32473) 아래다. 카탈로그의 제조사가 가상이라 진짜 번호를 쓸 수 없다.

## BACnet: 건물 관리 시스템이 쓰는 서비스

`who-is`(장치 찾기), `read-property`, `read-property-multiple`, `write-property`를 한다. 장치 번호는 1001부터 블루프린트 순서로 붙는다.
객체 종류, 속성, 단위, 오류 분류와 오류 번호는 ANSI/ASHRAE 135의 번호와 같다(공개 구현 bacnet-stack의 `bacenum.h`와 시험이 대조한다).

- 쓸 수 있는 점은 항온항습기의 **설정온도**(analog-value 1)와, 항온항습기·냉동기·CDU·발전기의 **켜기/끄기**(`Unit-Enable`, binary-output 1)다. 켜기/끄기는 운영자의 스위치라서 장애가 아니고(고장 알람이 서지 않는다), 끄면 그 설비가 하던 일이 끊긴다. 발전기는 켜기가 AUTO(정전이면 기동), 끄기가 OFF다. 그 밖의 점에 쓰면 `write-access-denied`다. 어떤 길이 어떤 조작에 닿는지는 [제어 가능 요소표](controllability.md)에 있다.
- 쓰기는 **우선순위 배열**(1이 가장 높고 16이 가장 낮다)을 거친다. 가장 높은 칸의 값이 이긴다. `relinquish`로 한 칸을 비우면 다음 칸 값이, 모두 비면 기본값(설정온도는 설비의 기본 설정온도, 켜기/끄기는 켜짐)이 쓰인다.
- 읽는 점에는 **외기 온도**(`Outdoor-Air-Temperature`, analog-input, 항온항습기는 5번, 냉각 플랜트는 6번)가 있다. 세계의 외기 온도 하나(기본 25°C)를 읽는다. 시나리오의 외기 온도 블록이 바꾸고, 에이전트는 읽기만 한다(REQ-073, ADR-0075).
- 모델이 허용하는 범위 밖의 설정온도는 `value-out-of-range`, 우선순위가 1~16이 아니면 `parameter-out-of-range`다.
- 전원이 없는 설비는 응답하지 않는다(`timeout`). `who-is`에도 나타나지 않는다.

## 하지 않은 것

- **모드버스(Modbus)**: 기기마다 레지스터 지도가 달라서 따를 표준이 없다. 지어내면 에이전트가 가짜 지도를 외운다.
- **진짜 네트워크 패킷**: SNMP는 UDP 161, BACnet은 UDP 47808이지만 여기서는 도구가 JSON으로 주고받는다. 패킷을 만드는 도구(`snmpget`, 진짜 BACnet 클라이언트)는 직접 붙일 수 없다.
- **CDU의 공급 설정온도와 펌프, 냉동기의 설정온도**: 읽기만 한다. 켜기/끄기만 쓸 수 있다.
- SNMP의 카운터, 전압, 전류, 배터리 온도는 월드가 숫자를 갖고 있지 않아서 `noSuchInstance`다.
- UPS와 BACnet 장치의 펌웨어, 에이전트 버전 문자열은 자리 채움이고, BACnet `vendorId`는 ASHRAE(0)다(제조사가 가상이다).
- 스키마 검사는 리소스마다 **한 버전**과 대조한다(오류 정정판은 같은 것으로 본다).

## 확인

- `tests/spec/redfish-conformance.test.ts` — DMTF 스키마 대조.
- `tests/spec/facility-protocols.test.ts` — 어떤 설비가 어떤 말을 하는지, SNMP 동작, 도구 인자.
- `tests/spec/bacnet-protocol.test.ts` — BACnet 서비스, 우선순위 배열, 오류, 표준 번호.
- `packages/core/src/facades/snmp-core.test.ts` — SNMP 엔진.
