---
title: 세계 소스 — 생성과 가져오기
kind: spec
status: active
last_verified: 2026-10-29
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
  - packages/core/src/sources/realimport/mapping.ts
  - packages/core/src/sources/realimport/synthesize.ts
verification_log:
  - "2026-10-29: first version, checked against assembly, worldgen spec, mapping, synthesize"
  - "2026-10-29: refactor only (split helpers); behaviour and text unchanged"
  - "2026-10-29: 캠퍼스 생성기, 사업장 외곽선, 외곽선 안 건물 배치를 코드와 대조해 본문에 더했다 (ADR-0035, ADR-0036)"
  - "2026-10-29: 린트 정리(반복문 변환) 후 코드와 다시 대조했다. 내용 변화 없음"
  - "2026-10-29: 캠퍼스 생성 입력에 상세 모델링 비율을, 묶음 랙 절을 더했다. 코드와 대조했다 (ADR-0038)"
covers_hash: 4cc6da50e887b464
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

### 캠퍼스 생성 (`generateCampus`, REQ-043~048)

위의 생성기는 서버룸 하나를 닮은 방을 찍어 낸다. 캠퍼스 생성기는 **데이터센터 단지**를 만든다. 입력은 사업장, 구성(공랭 전용 / 공랭+수랭 /
AI 수랭·액침 / 동별로 다름), 건물 수, 건물당 데이터 홀 층과 층당 홀 수, 홀당 컨테인먼트 수(보통), 채움 비율, GPU 비율, 전원 계통(N / 2N),
벤더 구성(섞기 / 홀마다 한 곳), 상세 모델링 비율(`detail`)과 시드다. 같은 입력이면 같은 세계가 나온다.

- **홀마다 다르다.** 홀 크기는 보통 크기의 0.5~2배 사이에서 갈리고, 냉각 방식(공랭 / 혼합 / 직접수랭 / 액침), 컨테인먼트(냉복도 밀폐 /
  열복도 밀폐 / 일부만 / 아예 없음), 랙 줄 길이, 가로세로 비율이 홀마다 다르다. 오래된 공랭 홀에는 컨테인먼트가 없을 수 있다. 홀 하나에
  컨테인먼트가 수십~수백 개 들어간다(홀당 컨테인먼트는 보통 크기가 최대 240, 캠퍼스 전체 랙은 2만 개까지).
- **장비는 여러 제조사에서 온다.** 포드(컨테인먼트 한 칸)마다 서버·랙·스위치·PDU·스토리지를 한 제조사 묶음(family)에서 고르고,
  GPU·수랭·액침 서버는 냉각 방식에 맞는 모델만 쓴다.
- **건물 안**: 1층에 전기실(분전반·ATS), 배터리실(UPS), 통신실(MMR, 코어 스위치), 첫 건물에는 관제실(NOC). 데이터 홀 층마다 기계실(CDU).
  방마다 용도가 있고 스스로 냉방한다.
- **건물 밖(야외)**: 변압기, 발전기(계통마다 예비 한 대), 기계 전원반, 냉수 플랜트(칠러)와 냉각수 플랜트(드라이쿨러·냉각탑).
- **전원 사슬**: 한전 → 변압기 → ATS(+발전기) → UPS → 분전반 → PDU → 장비. 각 단계는 뒤에 매달린 부하에 맞춰 크기를 정한다.
  **평상시 알람이 없어야 한다** — `tests/spec/campus.test.ts`가 구성마다 확인한다.

### 큰 홀과 묶음 랙 (REQ-049, [ADR-0038](adr/0038-light-racks.md))

`detail`(0~1)은 홀마다 컨테인먼트 중 서버까지 만들 비율이다. 나머지 컨테인먼트의 랙은 **묶음 랙**이다. 서버를 개체로 만들지 않고 랙의 `props`에 대수·서버 모델·평균 사용률·나머지 전력을 적는다
(`bulkProps`/`bulkOf`, `world/bulk.ts`). 묶음 랙은 분전반 A·B에 직접 전원이 연결되고, 열과 냉각은 상세한 랙과 같은 계산을 거친다. 상세한 컨테인먼트는 홀을 따라 고르게 퍼지고
홀마다 첫 번째는 언제나 상세하다. 기본값 1은 전부 상세(예전 그대로)다. 상세한 랙은 3000개까지다. 서버 단위 API(Redfish 등)와 서버 사이 네트워크는 상세한 서버에만 있다.

### 사업장의 모양 (REQ-048)

사업장은 **지도에서 옮긴 개략 외곽선**(폴리곤)을 가진다(`sites.ts`). 면적의 비율과 대략의 생김새만 맞추고, 측량값이 아니다. 사업장끼리의 위치도
거리·방향을 그대로 옮기지 않고 대략의 상대 위치(`mapX`, `mapY`, 0~100)만 둔다. 건물은 조립기가 외곽선 **안에서** 찾아 세운다
(`packInOutline`: 큰 건물부터, 위쪽 왼쪽부터 첫 빈자리, 사이 간격 유지). 외곽선 안의 땅은 사업장 소유라 부지(parcel) 없이도 건물을 세울 수 있고,
외곽선 바깥에 이어진 땅은 부지로 나뉘어 **살 수 있다**(`owned: false`, 가격). 사서 소유가 되면 그 위에도 건물을 세운다(W041).
들어가지 않는 건물은 숨기지 않고 알림(notes)으로 남기며 W041로 지적한다. 실제 외곽선이 생기면 `outlineFromLonLat`(경도·위도 한 고리 → 미터)로
바꿔 `SITE_SHAPES`의 점만 교체하면 된다.

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
