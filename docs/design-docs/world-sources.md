---
title: 세계 소스 — 생성과 가져오기
kind: spec
status: active
last_verified: 2026-11-07
covers:
  - packages/core/src/sources/assembly.ts
  - packages/core/src/sources/assembly-site.ts
  - packages/core/src/spatial/outline.ts
  - packages/core/src/sources/worldgen/spec.ts
  - packages/core/src/sources/worldgen/sites.ts
  - packages/core/src/sources/worldgen/campus.ts
  - packages/core/src/sources/worldgen/campus-plan.ts
  - packages/core/src/sources/worldgen/campus-spec.ts
  - packages/core/src/sources/worldgen/campus-rack.ts
  - packages/core/src/world/bulk.ts
  - packages/core/src/sources/worldgen/shaped.ts
  - packages/core/src/sources/worldgen/shaped-plan.ts
  - packages/core/src/sources/realimport/mapping.ts
  - packages/core/src/sources/realimport/synthesize.ts
covers_hash: 82a205fbf6374c1e
verification_log:
  - "2026-11-06: REQ-096 컨테이너 층: 코드와 대조해 해당 절을 더하거나 고쳤고 나머지는 그대로 맞다"
  - "2026-11-06: o1·o2 합치기"
  - "2026-11-07: REQ-100 애플리케이션 층이 덮는 코드가 바뀐 것을 확인했고 이 문서의 내용은 그대로 맞다"
  - "2026-11-07: o5 합치기 (애플리케이션 층)"
  - "2026-11-07: REQ-107: 가속기 층·전원·냉방 확장 절을 더하거나 고쳤고 나머지는 코드와 대조해 그대로 맞다"
---
# 세계 소스 (REQ-009~013, REQ-035, REQ-043~049)

세계(blueprint)를 만드는 길은 셋이다. 타이쿤 빌더로 직접 짓기(웹), **생성하기**(worldgen), **가져오기**(realimport).
뒤의 둘은 "무엇이 어디 있는지"만 정하고, 실제 좌표는 공용 조립기(`BlueprintAssembler`)가 정한다.

```
worldgen ─┐                       ┌─ core.spatial: 서버룸 안 랙 줄·U 위치·설비 자리
          ├─ BlueprintAssembler ──┤
realimport┘                       └─ 서버룸 → 층 → 건물 → 부지 배치, 검증
```

## 생성하기 (worldgen)

입력은 사업장 프리셋(기흥·화성·온양·천안·수원·평택)과 크기 파라미터(건물·층·서버룸·랙 줄·줄당 랙, 채움 비율, GPU 비율,
컨테인먼트, 냉방 이중화, 전원 계통, 호스트당 VM)와 시드다. 같은 입력이면 늘 같은 세계가 나온다.
프리셋은 이름, 개략 외곽선, 대략의 면적이다. 정밀한 실제 지도가 아니다.

만들어지는 서버룸: 줄의 첫 랙은 인프라 랙(스파인 한 쌍, 스토리지), 나머지는 컴퓨트 랙. 랙마다 ToR과 A/B PDU, 서버룸마다 부하에 맞춘
CRAH와 A/B 분전반, 층마다 A/B UPS, 서버룸마다 vSphere 클러스터. **평상시 알람이 없어야 한다** — 명세 테스트가 확인한다
(N+1 냉방은 한 대가 서도 버티고, A/B 전원은 한쪽 분전반이 트립해도 서버가 꺼지지 않는다).

랙은 한 세계에 2000개까지다(`MAX_RACKS`). 용량 측정(REQ-032)에서 다시 정한다.

**서비스를 까는 일** (REQ-086, [ADR-0091](adr/0091-service-os-layer-recovery-first.md)): `generateWorld`와 `generateCampus`는 만든 뒤 `withServices`(`worldgen/services.ts`)로 건물마다 서비스 묶음을 더한다. HPC센터는 설계 검증 큐(배치)·EDA 라이선스 서버(상태 유지)·스토리지 게이트웨이(상태 유지), 팹은 MES 연동(요청 처리)·설비 로그 수집(배치), 그 밖에는 사내 포털·로그 수집이다. 서비스는 건물의 VM(없으면 서버) 위에서 돌고, 대기 쪽은 다른 랙의 서버 중 같은 전원 공급을 가장 적게 나눠 쓰는 것이다. 시간당 피해는 어림한 값(추정 표시)이다. 서버가 없는 건물(묶음 랙뿐)에는 깔지 않는다. 자세한 표는 [서비스·OS 층](service-os-layer.md#서비스-생성-sourcesworldgenservicests).

### 캠퍼스 생성 (`generateCampus`, REQ-043~048)

위의 생성기는 서버룸 하나를 닮은 방을 찍어 낸다. 캠퍼스 생성기는 **데이터센터 단지**를 만든다. 입력은 사업장, 구성(공랭 전용 / 공랭+수랭 /
AI 수랭·액침 / 동별로 다름), 건물 수, 건물당 데이터 홀 층과 층당 홀 수, 홀당 컨테인먼트 수(보통), 채움 비율, GPU 비율, 전원 계통(N / 2N),
벤더 구성(섞기 / 홀마다 한 곳), 상세 모델링 비율(`detail`)과 시드다. 같은 입력이면 같은 세계가 나온다.

- **홀마다 다르다.** 홀 크기는 보통 크기의 0.5~2배 사이에서 갈리고, 냉각 방식(공랭 / 혼합 / 직접수랭 / 액침), 컨테인먼트(냉복도 밀폐 /
  열복도 밀폐 / 일부만 / 아예 없음), 랙 줄 길이, 가로세로 비율이 홀마다 다르다. 오래된 공랭 홀에는 컨테인먼트가 없을 수 있다. 홀 하나에
  컨테인먼트가 수십~수백 개 들어간다(홀당 컨테인먼트는 보통 크기가 최대 240, 캠퍼스 전체 랙은 2만 개까지).
- **장비는 여러 제조사에서 온다.** 포드(컨테인먼트 한 칸)마다 서버·랙·스위치·PDU·스토리지를 한 제조사 묶음(family)에서 고르고,
  GPU·수랭·액침 서버는 냉각 방식에 맞는 모델만 쓴다.
  묶음은 팟의 **네트워크 모양**도 정한다. 스위치 속성 `fabric`을 generic·cobaltica는 `legacy`, halcyon·hanbit은 `cloud`로 적는다
  (난수를 더 쓰지 않는다). 규칙은 그럴듯하게 정한 것이지 실제 사업장의 구성이 아니다([네트워크의 두 가지 모양](network-fabrics.md), REQ-065, ADR-0062).
  단일 방 생성기(`generateWorld`)는 레거시만 만든다.
- **건물 안**: 1층에 전기실(분전반·ATS), 배터리실(UPS), 통신실(MMR, 코어 스위치), 첫 건물에는 관제실(NOC). 데이터 홀 층마다 기계실(CDU).
  방마다 용도가 있고 스스로 냉방한다.
- **건물 밖(야외)**: 변압기, 발전기(계통마다 예비 한 대), 기계 전원반, 냉수 플랜트(칠러)와 냉각수 플랜트(드라이쿨러·냉각탑).
- **전원 사슬**: 한전 → 변압기 → ATS(+발전기) → UPS → 분전반 → PDU → 장비. 각 단계는 뒤에 매달린 부하에 맞춰 크기를 정한다.
  **평상시 알람이 없어야 한다** — `tests/spec/campus.test.ts`가 구성마다 확인한다.

### 반도체 팹과 데이터센터 건물 (REQ-043, [ADR-0039](adr/0039-fab-buildings.md))

사업장의 서버룸은 대부분 **반도체 팹 안**에 있고, 데이터센터 건물(화성의 HPC센터)과 연구동(화성의 DSR 세 동)이 따로 있다. 캠퍼스 입력에 `fabs`(팹 수, 0~10), `hallsPerFab`(팹당 서버룸, 1~6),
`labs`(연구동 수, 0~3)가 있고 `buildings`(데이터센터 건물)는 0도 된다(셋의 합이 1 이상). 팹은 `purpose: "fab"` 건물이고 층마다 **클린룸**(`cleanroom` 용도)이 있다.
팹마다 서버룸은 **2~4층 중 팹마다 정해진 한 층**에 1~2개 들어가고(3개 이상이면 위층으로 이어진다), 컨테인먼트는 보통 홀의 0.4~0.85배, 한 줄은 5~10랙이다(컨테인먼트당 10~20랙).
맨 윗층은 서버룸 없이 더 깊은 클린룸 하나다. 클린룸 안의 공정 장비는 월드가 모델링하지 않는다(방이 곧 데이터이고, 3D가 장식으로 그린다). 1층의 전기실·통신실과 층마다 기계실(CDU)은 데이터센터와 같다.
연구동은 `purpose: "research"` 건물로 이름이 `DSR동 A타워`·`B타워`·`C타워`이고 지상 27층이다. 서버룸은 팹처럼 작고 동·층별로 있다: A 4층 1개(추정), B 5층 1개, C 3층 2개
(`campus-plan.ts`의 `LAB_ROOM_FLOORS`). 데이터센터의 홀은 서버룸보다 크다. 화성의 HPC센터는 이름이 `HPC센터`이고 데이터 홀 층이 10개(2~11층)다.
사업장마다 기본 구성이 다르다(`SITE_CAMPUS_MIX`, [ADR-0046](adr/0046-site-places-and-server-rooms.md), [ADR-0047](adr/0047-site-names-and-places.md)): 지도에 보이는 가동 중인 팹을 모두 짓고
(기흥 3, 화성 7, 평택 P1~P4 네 곳; P5·P6은 아직 빈 자리), 화성은 HPC센터와 DSR 세 동에 맞춰 홀 크기·층·상세 비율도 정한다. 기흥·평택에는 데이터센터 자리가 없다(지도에 없다). 수원은 데이터센터만, 온양은 팹 하나다.

### HPC센터의 층 구성 (REQ-076, [ADR-0081](adr/0081-real-building-size.md))

지도의 자리(`slot`)로 만든 건물은 `props.sizeLocked`가 `true`다. 그 가운데 데이터센터 건물(화성의 HPC센터)은 자리의 크기 **95 × 72 m**가 곧 건물의 바닥이다(`BlueprintAssembler.building(…, size)`). 방은 모두 타일(0.6 m) 단위라서 빌더가 크기를 바꿀 때 어긋나지 않는다. 팹과 연구동은 크기가 내용에서 나오는 그대로 잠기기만 한다.
HPC센터의 방은 `campus-floor.ts`의 층 평면이 자리를 정한다(조립기의 `RoomSpec.at`: 한 층의 모든 방이 자리를 말하면 쌓는 대신 그 자리에 놓는다).

| 층 | 방 |
|---|---|
| 1층 | 로비·하역장(40.2 × 24 m), 창고(30 × 24 m), 통신실(MMR), 관제실(NOC) |
| 2~11층 | 서버룸 2개(5층만 3개; 폭 66.6 m, 깊이는 층 바닥의 56~60%를 방 수로 나눈 만큼) + 전기실(24 × 39.6 m) + 기계실(24 × 12 m) + 창고(24 × 7.8 m) |

- 서버룸 안의 컨테인먼트는 방이 허락하는 만큼, 입력의 `podsPerHall`개까지 놓는다(`campus-fit.ts`의 `fitPods`가 폭으로 열을, 냉방기 띠를 뺀 깊이로 줄을 센다). 화성 기본 구성은 30이라 방이 먼저 찬다. 한 줄은 12랙, 홀은 공랭 넷에 후면도어+수랭 하나꼴이다(`campus-locked-plan.ts`).
- **전기실은 층마다 있고**, 그 층 홀이 먹는 UPS·수배전반·ATS가 들어 있다(`campus-power.ts`의 `emitFloorRooms`). 다른 건물은 예전처럼 1층에 전기실·배터리실을 둔다. 기계실은 모든 서버 층에 있고, 수랭 랙이 있는 층에만 CDU가 있다.
- 지하 2층은 만들지 않았다(층 번호 0과 음수가 3D 단면에서 비싸다). 연면적은 층마다 같은 바닥으로 75,240 ㎡가 되어 실제 53,508 ㎡보다 크다. 수치와 출처는 [용량](capacity.md)에 있다.
- 사업장은 수전 용량을 가진다(`SiteShape.power`, 화성 108 MW는 공개 수치, 나머지는 추정). 사이트 개체의 `props.powerCapacityMW`와 `powerCapacityEstimated`로 간다.

### 짓지 않은 자리 (REQ-056, [ADR-0046](adr/0046-site-places-and-server-rooms.md))

요청한 건물 수가 지도의 자리보다 적으면 남은 자리가 `ReservedPlot`(종류 `fab`·`dc`·`lab`, 귀퉁이와 크기)으로 사이트 개체의 `props.reserved`에 글(`kind:x,y,w,d;…`)로 남는다
(`encodeReserved`/`parseReserved`, `unbuiltPlots`). 어셈블러(`asm.reserve`)는 자리가 없는 건물과 설비 마당을 이 자리 밖에 놓는다. 3D의 캠퍼스 꾸미기는 이 자리를 짓지 않은 건물로 세어
블록으로 덮지 않고(`Campus.cleared`) 도로·나무도 비켜 가며, 포장된 빈 터로 그린다. 큰 설비 마당(HPC센터의 수백 개)은 건물 너비의 1.5배보다 깊은 띠가 되면 정사각에 가깝게 펴고(`yardWidth`), 개체가 150개를 넘으면 개체 사이를 8 m 대신 3 m로 좁힌다.

### 지도가 부르는 이름과 부속 건물 (REQ-057, [ADR-0047](adr/0047-site-names-and-places.md))

자리(`SiteSlot`)는 이름을 가질 수 있고(`17라인`, `V1`, `P1 FAB`, `HPC센터`) 그 자리에 서는 건물이 이름을 받는다(`campus.ts`의 `addBuilding`). 자리가 모자라 조립기가 놓는 건물만 `FAB5동`처럼 번호로 불린다.
지도가 보여 주지만 월드가 만들지 않는 건물(사무동, 유틸리티동·복합동, 정수장·폐수처리장, 변전소, 물류센터, 공사장)은 `SitePlace`(`places`)로 두고 **모든 캠퍼스가 예약한다**(`unbuiltPlots`가 `preset.places`를 더한다).
예약된 자리의 종류가 `fab`·`dc`·`lab`·`lot`(`CLEARED_PLOT_KINDS`)이면 포장된 빈 터, 그 밖이면 웹이 종류별 조각을 자리 안에 놓는다(`campus-structures.ts`의 `structuresOf`: 긴 변을 따라 줄지어 서고, 90 m보다 긴 띠는 여러 동으로 나눈다).
사진에서 읽은 근사라 중심은 20 m, 크기는 15 % 안팎으로 어긋날 수 있다.

### 큰 홀과 묶음 랙 (REQ-049, [ADR-0038](adr/0038-light-racks.md))

`detail`(0~1)은 홀마다 컨테인먼트 중 서버까지 만들 비율이다. 나머지 컨테인먼트의 랙은 **묶음 랙**이다. 서버를 개체로 만들지 않고 랙의 `props`에 대수·서버 모델·평균 사용률·나머지 전력을 적는다
(`bulkProps`/`bulkOf`, `world/bulk.ts`). 묶음 랙은 분전반 A·B에 직접 전원이 연결되고, 열과 냉각은 상세한 랙과 같은 계산을 거친다. 상세한 컨테인먼트는 홀을 따라 고르게 퍼지고
홀마다 첫 번째는 언제나 상세하다. 기본값 1은 전부 상세(예전 그대로)다. 상세한 랙은 3000개까지다. 서버 단위 API(Redfish 등)와 서버 사이 네트워크는 상세한 서버에만 있다.

### 사업장의 모양 (REQ-048)

사업장은 **지도에서 옮긴 개략 외곽선**(폴리곤)을 가진다(`sites.ts`). 기흥·화성·평택은 사용자가 위성지도에 그려 준 붉은 선을 지도의 축척 막대 기준 미터로 옮겨
5 m 단위로 반올림한 것이고, 수원·천안·온양은 아직 면적 비율만 맞춘 손으로 그린 근사다. 어느 쪽이든 측량값이 아니다. 사업장끼리의 위치도
거리·방향을 그대로 옮기지 않고 대략의 상대 위치(`mapX`, `mapY`, 0~100)만 둔다.

지도가 있는 사업장은 **건물 자리**(`fabs`, `dcs`, `labs`, `places`)도 갖는다. 지도의 파란 지붕이 팹이라서, 파란 지붕의 위치와 크기를 읽어 팹 자리로 두었고(축에 나란히, 기울기는 무시),
이름과 건물 구성은 사용자가 준 배치도·조감도·위성 사진에서 읽었다(화성: HPC센터는 V1 앞 잔디밭, DSR 세 동은 북동쪽 끝; 평택: P1~P6와 복합동·변전소·정수장). 캠퍼스 생성기는 팹을 이 자리에 순서대로 세우고, 자리가 모자란 건물과 지도가 없는 사업장의 건물은 조립기가
외곽선 **안에서** 찾아 세운다(`packSpread`: 땅 가장자리에서 물러나 건물끼리 간격을 두고 고르게 퍼뜨린다. 옛 `packInOutline`은 위쪽 왼쪽부터 첫 빈자리).
건물 옆 설비 마당(변압기·발전기·냉각 플랜트)은 건물과 함께 자리를 잡는다(`assembly-layout.ts`). 외곽선 안의 땅은 사업장 소유라 부지(parcel) 없이도
건물을 세울 수 있고, 외곽선 바깥에 이어진 땅은 부지로 나뉘어 **살 수 있다**(`owned: false`, `priceM`: 사업장의 ㎡당 땅값 × 넓이. 사업장은 `props.landMarket`과 `props.landPriceM`으로 어느 시장의 값인지 기억한다, [현실의 가격](real-prices.md)). 사서 소유가 되면 그 위에도 건물을 세운다(W041).
들어가지 않는 건물은 숨기지 않고 알림(notes)으로 남기며 W041로 지적한다. 실제 외곽선이 생기면 `outlineFromLonLat`(경도·위도 한 고리 → 미터)로
바꿔 `SITE_SHAPES`의 점만 교체하면 된다. 새 사업장은 같은 입력(`raw` 점들과 `areaM2`)으로 만든다.

## 서비스부터 만들기 (shaped, REQ-094)

`generateShaped(spec)`(`worldgen/shaped.ts`)는 서비스·층 아홉 선택·서버 수로 세계를 짓는다. 먼저 `planShape`(`shaped-plan.ts`)가 랙·서버룸·스위치·PDU·냉방기·kW를 센다(서버 ÷ 20이 계산 랙, 줄마다 인프라 랙 하나). 그 계획대로 `generateWorld`가 서버룸을 짓고(기본 서비스는 뺀다), 서비스를 호스트(서로 다른 랙·서버룸)와 VM 위에 얹는다. 레거시 계층형은 서버룸마다 스파인을 하나만 둔다. 사업장 실측(`real`)은 서버 수 대신 `generateCampus`에 서비스를 얹는다. 점선 선택지는 가까운 칸 모양으로 짓는다. 자세한 규칙은 [세계 만들기 입구와 서비스부터](world-entry.md#세계에-서비스가-깔리는-규칙). 템플릿은 세계 기록의 출처 `template`이고 `provenance.shape`에 구성이 든다. 데이터베이스와 스토리지 칸을 고르면 서비스마다 클러스터가 깔리고 스토리지 칸이 풀을 만든다(`shaped-db.ts`, REQ-095). 인스턴스는 서비스가 쓰지 않는 서버를 다른 랙부터 골라 올라가고, 풀의 분산 노드는 서로 다른 랙에 선다. 베어메탈이면 서버 수에 인스턴스 몫이 더해진다(`planShape`의 `dbHosts`). 규칙은 [데이터베이스 층과 스토리지 HA 층](db-storage-layers.md#사다리와-세계-생성). 네트워크 칸이 SDN 오버레이나 클라우드 네이티브이면 서비스를 다 놓은 뒤 `shaped-sdn.ts`가 리프-스파인 위에 컨트롤러 둘, 리프마다 VTEP, 서비스마다 세그먼트·가상 방화벽(클라우드 네이티브는 CNI·정책·인그레스까지)을 깐다(REQ-097, [SDN 오버레이와 클라우드 네이티브 네트워크 층](sdn-network-layer.md#사다리와-세계-생성)).
`generateShaped(spec)`(`worldgen/shaped.ts`)는 서비스·층 아홉 선택·서버 수로 세계를 짓는다. 먼저 `planShape`(`shaped-plan.ts`)가 랙·서버룸·스위치·PDU·냉방기·kW를 센다(서버 ÷ 20이 계산 랙, 줄마다 인프라 랙 하나). 그 계획대로 `generateWorld`가 서버룸을 짓고(기본 서비스는 뺀다), 서비스를 호스트(서로 다른 랙·서버룸)와 VM 위에 얹는다. 레거시 계층형은 서버룸마다 스파인을 하나만 둔다. 사업장 실측(`real`)은 서버 수 대신 `generateCampus`에 서비스를 얹는다. 서비스가 따로 고른 모양(`ServiceDraft.layers`: 컴퓨트·스토리지·데이터베이스·앱)이 있으면 그 서비스만 `buildFor`로 본 모양대로 얹는다(서버째냐 VM이냐, 호스트 수, 서비스마다의 예비 호스트, 공유 스토리지). 네트워크·전원·냉방·사업장은 건물 하나라 세계의 선택을 쓴다. 점선 선택지는 가까운 칸 모양으로 짓는다. 자세한 규칙은 [세계 만들기 입구와 서비스부터](world-entry.md#세계에-서비스가-깔리는-규칙). 템플릿은 세계 기록의 출처 `template`이고 `provenance.shape`에 구성이 든다.

## 가져오기 (realimport)

```
RealitySource(읽기 전용) → classify(매핑으로 역할 판정) → resolve(위치·모델·링크) → 범위 → synthesize(가정) → 조립 → 보고서
```

- **소스**: 읽기 메서드 셋(`summary`, `nodes`, `relationships`)뿐이다. FalkorDB 어댑터(서버)와 메모리 소스(그래프 JSON 덤프, 샘플)가 있다.
- **매핑**(`CLOUD_TOPOLOGY_MAPPING`): KG를 아는 유일한 곳. 노드 규칙은 위에서부터 첫 번째로 맞는 것이 이긴다
  (`role: storage`인 PhysicalServer가 일반 서버보다 먼저). 관계는 (타입, 시작 역할, 끝 역할)로 판정하고, 저장 방향이 불확실하면 `either`.
- **접기**: ESXi → 물리 서버에 합침 / NIC 포트 → 스위치 포트 → 포트 이름이 붙은 네트워크 링크 / 스토리지 볼륨 → 데이터스토어 `backed_by`.
- **배치**: 관계(LOCATED_IN 등)가 먼저, 위치 속성(`floor_info`, `rack_row`, `u_position` …)이 다음, 둘 다 없으면 "미배치" 랙.
- **가정**: 그래프에 없는 전력 계통, 냉방 관계가 없는 랙, 냉방기가 없는 서버룸. 더한 것은 `synthesized`로 표시하고 보고서에 문장으로 남긴다.
  실제 냉방 용량이 부족하면 늘리지 않고 경고한다.
- **보고서**: 소스에 있는 것, 만들어진 것, 모르는 라벨·관계(매핑 갱신 후보), 일부러 무시한 것(VDS, PortGroup, PEERS_WITH),
  필터로 빠진 것, 범위 밖, 추정 개수, 가정, 배치 메모, 검증 결과.

### KG 스키마가 바뀌면

1. 가져오기 보고서의 `unknown`(모르는 라벨·관계)과 `unmatched`를 본다.
2. 매핑에 라벨·관계 이름을 더하거나(변형은 목록에 추가) 새 규칙을 둔다. 코드는 고치지 않는다.
3. `sampleGraph()`에 같은 모양을 넣고 테스트를 추가한다.
