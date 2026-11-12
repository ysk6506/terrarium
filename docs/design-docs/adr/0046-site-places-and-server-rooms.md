---
title: ADR-0046 사업장의 건물 자리는 모두 정해져 있고, 서버룸은 팹·연구동·HPC센터의 현실 구조를 따른다
kind: decision
status: active
enforced_by:
  - packages/core/src/sources/worldgen/campus-places.test.ts
  - packages/core/src/spatial/outline-reserved.test.ts
  - packages/core/src/sources/worldgen/site-slots.test.ts
  - packages/core/src/sources/worldgen/campus-fab.test.ts
  - apps/web/src/logic/world3d/campus-reserved.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - packages/core/src/sources/worldgen/campus-fab.test.ts::campuses of fabs only, and the mix of each real site [REQ-043] [REQ-048] > every site has a mix, and the line sites are mostly fabs
  - packages/core/src/sources/worldgen/campus-layout.test.ts::=spec
  - packages/core/src/sources/worldgen/campus-layout.test.ts::campuses stand on the land as the maps show it [REQ-048] [REQ-043] > the plant of a building stands beside it on the land, not under it and out past the fence
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > every fab and data-centre place lies inside its site, and no two of them overlap
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > the sites with a map have as many fabs as the blue roofs counted on it; the HPC centre is at Hwaseong's south tip
  - "packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > sites without a map to read have no fixed places: their buildings are spread over the land"
  - packages/core/src/sources/worldgen/site-slots.test.ts::the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043] > every place for a building has a size, and only the three mapped sites have fab places
test_change_reason: 사용자가 알려 준 현실이 두 가지 바뀌었다. 화성의 데이터센터는 HPC센터 하나뿐이고(두 번째 자리는 내가 만든 것이었다), 화성에는 DSR 연구동 세 동이 있어 건물 자리 목록에 연구동이 더해졌다. 또 사업장의 기본 구성은 지도에 보이는 팹을 모두 짓고, 화성은 HPC센터 때문에 홀 크기와 상세 비율이 사업장별로 정해진다. 그래서 자리 개수·종류를 세던 시험과 기본 구성 시험이 새 현실에 맞게 바뀌었고, 기본 구성이 커진 화성에서 시험이 쓰던 상세 비율과 홀 크기도 사업장 구성을 따르게 바뀌었다. 건물이 자리 안에 서고 설비 마당이 부지 안에 놓이는 성질은 그대로 확인한다.
decision_hash: 409770d0dd2e06d5
---
# ADR-0046 건물 자리와 서버룸의 현실 구조

## 맥락
사용자는 두 가지를 지적했다. 하나, 사업장 꾸미기가 "지도에서 읽은 팹 자리"를 모르고 아무 빈 땅이나 채운다. 사업장마다 팹 자리가 정해져 있는데 기본 구성은 그중 일부만 짓고(화성은 파란 지붕 9곳 중 3곳),
짓지 않은 자리에는 사무동·기숙사·주차 건물이 들어섰다. 둘, 서버룸의 모양이 현실과 달랐다.

- HPC센터(화성): 10~11층, 안에 서버룸이 아주 많고 팹이나 DSR의 서버룸보다 훨씬 크다. 기사로 확인한 것: 지하 2층·지상 11층, 연면적 약 5만 3천㎡, 건축면적 약 6,800㎡, 108MW급, 이중 데크.
- 팹: 팹 안의 서버룸은 작고 건물마다 층과 수가 다르다. 가정으로 팹마다 특정 층에 1~2개를 둔다. 컨테인먼트가 수십 개 들어갈 공간, 컨테인먼트당 랙 10~20개.
- 연구동(DSR동): A·B·C 세 동. 서버룸은 높은 건물의 몇몇 층에 동·층별로 두는 것으로 가정하고, 크기는 팹과 비슷하게 둔다. 기사로 확인한 것: 세 동 합쳐 지하 5층·지상 28층, 연면적 약 33만㎡.

## 결정
1. **자리는 모두 정해져 있다.** 사업장은 팹·데이터센터·연구동 자리(`fabs`, `dcs`, `labs`)를 갖고, 기본 구성(`SITE_CAMPUS_MIX`)은 지도에 보이는 팹을 전부 짓는다(기흥 3, 화성 9, 평택 5).
2. **짓지 않은 자리는 비워 둔다.** 요청한 건물 수가 자리보다 적으면 남은 자리가 `ReservedPlot`(종류·귀퉁이·크기)으로 사이트 개체의 `props.reserved`에 글로 남는다. 어셈블러는 자리가 없는 건물과 설비 마당을
   이 자리 밖에 놓고(`asm.reserve`), 웹의 캠퍼스 꾸미기는 이 자리를 짓지 않은 건물로 센다: 블록이 덮지 않고, 가까움 띠의 기준이 되고, 도로와 나무가 비켜 가며, 포장된 빈 터와 모서리 말뚝으로 그린다.
3. **화성은 HPC센터 하나와 DSR 세 동이다.** 데이터센터 자리는 하나(건축면적 약 6,800㎡)고 이름은 `HPC센터`, 층은 10개 홀 층(2F~11F)에 층당 홀 2개다. 화성의 기본 구성은 홀 크기와 상세 비율도 정한다
   (`SITE_CAMPUS_MIX`가 `labs`, `floors`, `hallsPerFloor`, `podsPerHall`, `detail`을 가질 수 있다).
4. **연구동(`labs`, 건물 용도 `research`)을 더한다.** 이름은 `DSR동 A타워`처럼 짓고 지상 27층이다. 서버룸 층은 동마다 정한 예시 값이다(코드의 `LAB_ROOM_FLOORS`).
5. **팹의 서버룸**은 팹마다 정해진 층(2~4층 중 하나)에 1~2개, 컨테인먼트는 보통 홀의 40~85%(기본 구성에서 열 개 남짓~서른 개), 컨테인먼트 한 줄 5~10랙(컨테인먼트당 10~20랙)이다.
6. **큰 설비 마당은 넓게 편다.** HPC센터의 설비 마당은 개체가 수백 개라 건물 너비만큼의 좁고 긴 띠가 되어 어떤 땅에도 들어가지 않았다. 마당이 건물 너비의 1.5배보다 깊어지면 정사각에 가깝게 펴고, 개체가 150개를 넘는 마당은 개체 사이를 8 m 대신 3 m로 좁혀 놓는다(화성 HPC센터의 마당은 약 370개).

## 이유
- 사용자가 준 지도가 현실이다. 자리를 한 번 정해 두면 지도가 더 정확해질 때 점만 바꾸고, 꾸미기·도로·나무가 모두 같은 자리를 따른다.
- 서버룸의 크기와 층은 에이전트가 "어느 건물 몇 층의 어떤 방"을 찾아가는 시나리오에 곧바로 영향을 준다. 현실의 구조가 시나리오의 질이다.

## 버린 대안
- 모든 자리를 항상 짓기: 작은 월드(시험, 시나리오)가 불필요하게 무거워진다. 요청한 만큼 짓고 나머지는 비워 둔다.
- 빈 자리에 공사장을 두기: 지도의 팹 자리가 공사장이라는 사실이 아니라 내 상상이다.
- 마당을 쪼개 여러 군데에 놓기: 어셈블러의 마당 개념을 건물당 여럿으로 바꿔야 해서, 정사각에 가깝게 펴는 것으로 충분했다.

## 결과
- 한계: DSR 세 동의 지도 위 자리는 내 읽기다(기사에는 기흥과 화성 사이라고만 나온다). A동 서버룸의 층, 지상 27층, 한 층 약 3,900㎡도 추정이다.
- 한계: HPC센터는 건물 크기를 방 크기에서 얻어서 지도 자리(약 115×60 m)보다 크다(약 170×140 m). 랙은 약 7천 개로 실제 연면적에 맞췄지만 건물 윤곽은 현실의 6,800㎡보다 넓다.
- 한계: 화성의 기본 구성은 랙 약 1만 4천 개, 개체 약 4만 7천 개로 무겁다. 홀 크기를 더 키우면(`podsPerHall` 40) 설비 마당 일부가 부지 밖에 놓이고 부지가 아래로 자란다(알림에 남는다).
- 기흥·평택의 데이터센터 한 동은 사용자가 말한 적이 없는 내 가정이다.
