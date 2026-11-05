---
title: ADR-0060 랙은 두 규격(EIA-310, OCP ORv3)을 다루고, PDU 콘센트는 하나씩 끌 수 있다
kind: decision
status: active
last_verified: 2026-11-04
enforced_by:
  - tests/spec/pdu-outlets.test.ts
  - tests/spec/orv3-racks.test.ts
  - apps/web/src/logic/builder/rack-standard.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
test_change_reason: 시나리오 행동 종류에 콘센트 끄기와 콘센트 켜기가 더해져서 알 수 없는 행동 오류 문구의 가능한 행동 목록이 길어졌다. 시험은 그 문구를 새 목록으로 맞췄을 뿐, 알 수 없는 행동을 거절하고 없는 대상을 거절하는 규칙은 같다.
decision_hash: df374cfc5a05bb5b
---
# ADR-0060 랙은 두 규격을 다루고, PDU 콘센트는 하나씩 끌 수 있다

## 맥락
요구는 두 가지였다. "PDU, CDU(액체냉각)도 표준 인터페이스 있으면 에뮬레이트하고, 랙은 종류가 엄청 다양한데 지금은 약간 OCP RACK V3를 표준으로 검토 중이야."
PDU(Redfish `PowerDistribution`과 `Outlet`)와 CDU(Redfish `CoolingUnit`, BACnet)는 ADR-0057에서 이미 있었다. 빠져 있던 것은 PDU의 **콘센트 제어**와 **ORv3 랙**이다.

## 결정
1. **콘센트는 월드 명령 `outlet.set`으로 끄고 켠다.** 상태는 PDU의 `outletsOff`(번호 목록)에 둔다. 전원 계산이 끈 콘센트의 케이블을 건너뛴다. 급전이 하나뿐인 장비는 꺼지고 둘인 장비는 산다.
   `link.admin`(포트 shutdown)과 달리 별도 명령으로 둔 이유: 케이블이 없는 빈 콘센트도 기억해야 하고, 시나리오 행동의 대상을 PDU로 통일하려면 명령이 PDU를 가리켜야 한다.
2. **Redfish `Outlet.PowerControl`(On/Off)** 로 부른다. `PowerCycle`은 주지 않는다(호출 안에서 시간을 기다릴 수 없어 효과가 없다).
3. **시나리오 행동 `outlet_off`, `outlet_on`** 을 더한다. 대상은 PDU다.
4. **랙에 규격이 있다.** `RackStandard = "eia310" | "orv3"`. 랙 모델의 `standard`, 장비 모델의 `mount`가 정하고, 없으면 `eia310`이라 예전 월드는 그대로다.
   규격이 다르면 달리지 않는다(검증 `W034`, 묶음 랙 `W055`, 빌더 거절). 어댑터는 흉내 내지 않는다. ORv3의 한 칸(OU)은 48mm라서 위치 계산과 3D가 랙의 규격에서 유닛 높이를 읽는다.
5. **ORv3 부품 8종**을 카탈로그에 더한다(랙 2, 파워 셸프 2, 슬레드 3, ToR 1). 파워 셸프는 PDU 종류의 모델(`shelf: true`)이고 Redfish에서 `PowerShelf`로 `PowerEquipment/PowerShelves`에 보이며 콘센트가 없다.
6. **요구사항 REQ-063**을 더한다.

## 버린 대안
- **19인치 장비를 ORv3 랙에 어댑터로 허용**: 어댑터의 높이·값·고정 방식을 정해야 한다. 이번에는 막고 이유를 말해 주는 쪽이 정직하다.
- **콘센트를 `link.admin`으로**: 빈 콘센트를 기억할 곳이 없고, 행동의 대상이 케이블 id가 되어 에이전트의 눈에는 PDU가 보이지 않는다.
- **`PowerCycle`을 끄기+켜기로 구현**: 둘 사이에 시간이 흐르지 않으면 장비는 아무 일도 겪지 않는다. 효과 없는 성공 응답은 거짓말이다.
- **ORv3를 새 종류(kind)의 랙으로**: 모든 코드가 `rack`을 안다. 규격 필드가 작고 안전하다.

## 한계 (솔직하게)
- ORv3의 수치는 공개 제품 설명에서 둥글게 가져왔다. OCP 규격 문서와 한 줄씩 대조하지 않았다. 정류기 N+1, BBU, 버스바 전류, 전력 제한은 흉내 내지 않는다.
- 콘센트별 계량과 SNMP PDU 제어는 없다.
- ORv3 장비값은 대부분 추정이다(랙은 CDW의 Rittal 판매가에서 가져왔다). [현실의 가격](../real-prices.md)에 근거와 정도를 적었다.
- 스토리지 같은 다른 ORv3 장비는 카탈로그에 없다. 슬레드 3종과 ToR 1종만 있다.
