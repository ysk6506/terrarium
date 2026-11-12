---
title: 랙 규격과 PDU 콘센트 — EIA-310, OCP ORv3, 콘센트 켜고 끄기
kind: spec
status: active
covers:
  - packages/core/src/world/outlets.ts
  - packages/core/src/world/operator.ts
  - packages/core/src/world/geometry.ts
  - packages/core/src/physics/power-plan.ts
  - packages/core/src/physics/power-supply.ts
  - packages/core/src/facades/redfish-outlets.ts
  - packages/core/src/facades/redfish-power.ts
  - packages/core/src/catalog/builtin/orv3.ts
  - packages/core/src/catalog/models.ts
---
# 랙 규격과 PDU 콘센트 (REQ-063, ADR-0060)

## 한 줄로

랙은 두 규격이 있다. 19인치 **EIA-310**(지금까지의 모든 랙)과 **OCP Open Rack v3**(ORv3). 규격이 다르면 장비가 달리지 않는다.
PDU 콘센트는 하나씩 끄고 켤 수 있고, 끈 콘센트에 꽂힌 장비는 그 급전을 잃는다.

## 두 규격이 다른 점

| | EIA-310 (기존) | OCP ORv3 |
|---|---|---|
| 장비 폭 | 19인치 | 21인치(약 537mm) |
| 유닛 | 1U = 44.45mm | 1 OpenU(OU) = 48mm |
| 랙 칸 수 | 모델마다(42U 등) | 48OU |
| 전원 | 장비마다 전원 모듈, 랙 PDU 콘센트 | 파워 셸프가 3상 교류를 받아 48V 버스바에 올리고, 슬레드는 버스바에서 바로 받는다 |
| 카탈로그 | `rack-42u-std` 등 | `orv3-48ou-std`(공랭 36kW), `orv3-48ou-hpr-dlc`(HPR, 수랭 92kW) |

ORv3 부품은 모두 카탈로그에서 **OpenFrame Works**(가상 제조사) 제품이다.

- 파워 셸프 `orv3-shelf-18kw`(3kW 정류기 6개), `orv3-shelf-33kw`(HPR용 5.5kW 6개). 모델은 PDU 종류이고 `shelf: true`, 1 OU를 차지한다.
- 컴퓨트 슬레드 `orv3-cpu-1ou`, GPU 슬레드 `orv3-gpu-2ou`(공랭), `orv3-gpu-2ou-dlc`(수랭), ToR 스위치 `orv3-tor-32x100g`.

장비 모델의 `mount`와 랙 모델의 `standard`가 규격을 정한다. 둘 다 없으면 `eia310`이라서 예전 월드는 그대로다.

## 규칙

- 규격이 다른 장비는 랙에 달리지 않는다. 검증 오류 `W034`(장비를 달았을 때), `W055`(묶음 랙의 서버), 빌더는 달기·모델 바꾸기 때 이유를 말해 준다("OCP ORv3 21인치용이라 EIA-310 19인치 랙에는 달 수 없어요").
  실제로는 어댑터로 19인치 장비를 ORv3 랙에 다는 방법이 있지만 어댑터는 흉내 내지 않는다. 막는 쪽이 에이전트와 사람에게 더 정직하다.
- 같은 칸 번호도 ORv3에서는 더 높다. 3D와 위치 계산은 랙의 규격에서 유닛 높이를 읽는다(44.45mm 또는 48mm).
- 빌더에서 랙의 규격을 바꾸면 랙이 새 모델의 칸 수를 따라간다(42U → 48OU). 장비가 이미 달려 있으면 바꿀 수 없고, 먼저 빼라고 말해 준다.
- 파워 셸프의 용량은 랙의 공급 전력에 더해진다(셸프가 여럿이면 합). 19인치 랙의 A/B PDU는 둘 중 하나가 랙 전체를 감당해야 하는 규칙을 그대로 쓴다.
- 슬레드는 전원 모듈이 없어서 급전 입력이 하나다(`psuCount: 1`). 전원 모듈 N+1은 셸프 안의 일이고 흉내 내지 않는다. 셸프가 꺼지면 그 버스바의 슬레드가 모두 꺼진다.

## PDU 콘센트

콘센트 *n*은 PDU로 들어오는 *n*번째 전원 케이블이다(케이블 순서). 콘센트 수는 모델의 구 수와 꽂힌 장비 수 중 큰 쪽이다.

- 월드 명령 `outlet.set {target: PDU, outlet, on}`(검사는 `command-check.ts`, 상태 바꾸기는 `operator.ts`). PDU의 상태 `outletsOff`에 번호가 남는다(오름차순, 비면 없음). 빈 콘센트도 끌 수 있고 기억만 한다.
- 전원 계산(`SupplyResolver`)은 끈 콘센트의 케이블을 건너뛴다. 장비의 급전이 하나뿐이면 `powered`가 꺼지고 `server_power_lost` 알람이 오른다.
  급전이 둘(A/B)인 장비는 남은 쪽으로 계속 돌고, 끈 PDU의 부하는 줄어든다.
- Redfish: `GET .../RackPDUs/1/Outlets/{n}`은 `ElectricalConsumerNames`(꽂힌 장비), `PowerEnabled`(스위치), `PowerState`(스위치가 켜져 있고 PDU에 전기가 올 때 `On`)를 준다.
  `POST .../Outlets/{n}/Actions/Outlet.PowerControl {"PowerState": "On"|"Off"}`가 `outlet.set`이 된다. `PowerCycle`은 주지 않는다: 호출 안에서 시간을 기다릴 수 없어서 아무것도 바꾸지 못한다.
- 시나리오는 이 일을 **콘센트 끄기/켜기** 행동으로 센다. 행동의 대상은 PDU다.
- ORv3 파워 셸프는 Redfish에서 `PowerEquipment/PowerShelves/1`, `EquipmentType: PowerShelf`이고 `Outlets`가 없다. 셸프에 `outlet.set`을 하면 오류다.

## 하지 않은 것

- 어댑터로 19인치 장비를 ORv3에, 또는 반대로 다는 것. 정류기 하나가 죽는 N+1, BBU(배터리 백업), 버스바 전류 한계, 셸프의 전력 제한(power capping).
- 콘센트별 전력 계량, 콘센트 전원 지연(`PowerOnDelaySeconds` 등), `PowerCycle`, SNMP 기반 PDU 제어(Raritan, APC MIB).
- ORv3의 수치(48OU, 600×1068mm, 18kW·33kW 셸프, 랙 36kW·HPR 92kW)는 공개된 제품 설명에서 가져와 둥글게 잡았다. OCP 규격 문서와 한 줄씩 대조하지는 않았다.
- 장비값은 대부분 추정이다([현실의 가격](real-prices.md)).

## 확인

- `tests/spec/pdu-outlets.test.ts` — 콘센트를 끄면 단일 급전 장비는 꺼지고 이중 급전은 산다, 빈 콘센트, 체크포인트, Redfish `Outlet.PowerControl`, 스키마 적합.
- `tests/spec/orv3-racks.test.ts` — 카탈로그, 규격 불일치 검증, 유닛 높이, 파워 셸프로 전원이 들어옴, `PowerShelf` Redfish 적합.
- `apps/web/src/logic/builder/rack-standard.test.ts` — 빌더가 규격이 다른 장비를 거절하고, 셸프가 랙 전력으로 센다.
