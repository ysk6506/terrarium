---
title: ADR-0047 건물은 지도가 부르는 이름과 자리를 따르고, 월드가 만들지 않는 건물도 그 자리에 선다
kind: decision
status: active
enforced_by:
  - packages/core/src/sources/worldgen/site-places.test.ts
  - packages/core/src/sources/worldgen/site-slots.test.ts
  - packages/core/src/sources/worldgen/campus-places.test.ts
  - apps/web/src/logic/world3d/campus-structures.test.ts
  - apps/web/src/logic/world3d/campus-reserved.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - packages/core/src/sources/worldgen/site-places.test.ts::=slot
  - packages/core/src/sources/worldgen/site-places.test.ts::<import:57cc2e2a>
  - packages/core/src/sources/worldgen/campus-places.test.ts::<import:540ca3f3>
  - packages/core/src/sources/worldgen/campus-places.test.ts::every place the map shows for a building stays spoken for [REQ-056] [REQ-048] > a site built in full has no ground left over, one built in part keeps the places it left
  - packages/core/src/sources/worldgen/campus-places.test.ts::every place the map shows for a building stays spoken for [REQ-056] [REQ-048] > buildings with no place of their own are put clear of the places left, and so is the plant
  - "packages/core/src/sources/worldgen/campus-places.test.ts::the server rooms of Hwaseong: the HPC centre, the fabs and the DSR towers [REQ-056] [REQ-043] > a fab keeps one or two small server rooms on one floor, a few dozen containments each"
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > every fab and data-centre place lies inside its site, and no two of them overlap
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > the sites with a map have as many fabs as the blue roofs counted on it; the HPC centre is at Hwaseong's south tip
  - apps/web/src/logic/world3d/campus-reserved.test.ts::a half-built Hwaseong keeps every fab place on its map [REQ-056] [REQ-048] > the six fab places and the two DSR places not built are cleared, and decoration keeps off them
test_change_reason: 사용자가 화성·평택의 배치도와 위성 사진을 주어 건물의 이름과 자리를 정확히 알게 됐다. 화성의 팹은 9곳이 아니라 이름 있는 7곳(12·13라인, S4, 15, 16, 17, S3, V1)이고 나머지 두 곳은 MR2와 UT3라는 지원 건물이었다. 평택은 P3가 빠져 있었고 한 곳은 물류센터였다. 그래서 자리 개수를 세던 시험과 기본 구성의 남은 자리를 세던 시험이 새 개수로 바뀌었고, 예약된 자리에 사무동·유틸리티동 같은 부속 건물이 더해져 비워 둔 자리만 세도록 바뀌었다. 건물이 자리 안에 서고 서로 겹치지 않으며 비워 둔 자리를 덮지 않는 성질은 그대로 확인한다. 같은 날 새로 쓴 자리 시험은 보조 함수의 자료형만 고쳤다(타입 검사가 통과하도록).
decision_hash: bc3ddd843d64831b
---
# ADR-0047 지도가 부르는 이름과 자리

## 맥락
화성과 평택은 이름이 적힌 위성 사진과 조감도를 근거로 다시 읽었다. 이전 자리는 지도의 파란 지붕을 내가 세어 만든 것이라 세 가지가 틀렸다.

- 이름이 없었다. 팹이 `FAB1동`처럼 번호로만 불렸다. 현실에서는 17라인, V1, P3처럼 이름으로 부른다.
- 팹이 아닌 것이 팹이었다. 화성 아홉 곳 중 둘은 MR2(지원동)와 UT3(유틸리티동)이고, 평택 다섯 곳 중 하나는 물류센터였으며 P3는 빠져 있었다.
- 팹 밖의 건물이 없었다. 사무동, 복합동, 변전소, 정수장, 폐수처리장 자리에는 임의의 꾸미기 블록이 들어섰다.

## 결정
1. **자리는 이름을 가진다**(`SiteSlot.name`). 캠퍼스는 자리에 서는 건물을 그 이름으로 짓는다(`17라인`, `V1`, `P1 FAB`, `HPC센터`). 자리가 모자라 조립기가 놓는 건물은 예전처럼 `FAB5동`이다. DSR 세 동은 `DSR동 A타워`를 그대로 쓴다.
2. **부속 건물은 `places`로 둔다**(`SitePlace`: 종류, 이름, 자리). 종류는 `office`, `utility`, `tanks`, `substation`, `warehouse`, `construction`이고 짓지 않은 땅은 `lot`이다. 월드는 이 건물들을 개체로 만들지 않는다(서버룸이 없다).
   모든 캠퍼스가 이 자리를 `ReservedPlot`으로 예약해(`unbuiltPlots`), 조립기는 다른 건물과 설비 마당을 이 밖에 놓는다.
3. **웹은 부속 건물을 그 자리에 그린다.** 예약된 자리가 비워 두는 종류(`fab`, `dc`, `lab`, `lot`: `CLEARED_PLOT_KINDS`)면 포장된 빈 터로 그리고, 아니면 종류별 조각을 자리 안에 놓는다(`campus-structures.ts`). 사무동은 층 있는 동,
   유틸리티동은 지붕 설비가 있는 홀의 줄(복합동처럼 긴 띠는 90 m마다 한 동), 정수장·폐수처리장은 탱크 격자, 변전소는 모선과 변압기, 물류센터는 하역장, 공사장은 골조와 크레인이다.
4. **화성** 팹 순서는 17라인, V1, S3, 15, 16, 12·13라인, S4(기본 구성은 일곱 곳 모두). 지원 건물은 MR2, UT3, 변전소, 사무동 두 곳이고, HPC센터는 V1 앞 잔디밭, DSR 세 동은 북동쪽 끝이다.
   **평택** 팹 순서는 P1~P4(기본 구성), P5와 P6은 아직 비어 있는 자리라 요청이 더 많을 때만 짓는다. P1 GC$, P2 EUV동, 3·4기·5·6기 복합동, 사무동, 그린동, 정수장, 폐수처리장, 린데코리아, 고덕변전소, 물류센터, 사무 3·6동 공사장, 사무 4동 예정지.
   **기흥** 팹은 S1라인, 6라인, NRD-K.
5. **데이터센터 자리는 화성의 HPC센터뿐이다.** 기흥·평택의 데이터센터 한 동은 지도에 없는 내 가정이었으므로 기본 구성에서 뺀다(`buildings: 0`). 요청하면 조립기가 알아서 놓는다.

## 이유
- 사용자가 에이전트에게 "17라인 3층 서버룸"처럼 말하는 시나리오가 이름을 쓴다. 이름이 현실과 같아야 시나리오가 현실에 가깝다.
- 팹이 아닌 건물을 팹으로 세면 서버룸이 있어선 안 될 곳에 생긴다.

## 버린 대안
- 부속 건물을 월드 개체로 만들기: 서버룸이 없는 건물에 층·방을 만들 이유가 없고, 개체가 수십 개 늘어 모든 월드가 무거워진다.
- 부속 건물을 기존 꾸미기 블록에 맡기기: 블록은 96 m 격자라 자리의 크기와 모양(길고 얇은 복합동)을 따르지 못한다.

## 결과
- 한계: 모든 자리는 사진에서 읽은 근사다(중심 20 m, 크기 15 % 안팎). 평택 배치도는 위성 지도와 앵커 두 곳으로 맞췄다.
- 한계: MR2는 용도를 몰라 사무동 모양으로 그렸다. 기흥의 S1·6라인·NRD-K 이름이 어느 파란 지붕인지는 크기로 짐작했고 지도로 확인하지 못했다. P2 EUV동·P1 GC$·그린동은 유틸리티 모양이다.
- 한계: 팹과 유틸리티동을 잇는 파이프랙 다리, 사무동 사이의 유리 보행교는 아직 없다.
- 한계: 평택처럼 넓은 사업장을 한눈에 보면 먼 쪽이 흐려져(미니어처 효과) 북쪽 팹이 잘 안 보인다. 승인된 3D 디자인이라 건드리지 않았다.
