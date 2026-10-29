---
title: 세계 소스 — 생성과 가져오기
kind: spec
status: active
last_verified: 2026-10-29
covers:
  - packages/core/src/sources/assembly.ts
  - packages/core/src/sources/worldgen/spec.ts
  - packages/core/src/sources/realimport/mapping.ts
  - packages/core/src/sources/realimport/synthesize.ts
verification_log:
  - "2026-10-29: first version"
  - "2026-10-29: first version, checked against assembly, worldgen spec, mapping, synthesize"
  - "2026-10-29: refactor only (split helpers); behaviour and text unchanged"
covers_hash: 4264bc2a9b508f1a
---
# 세계 소스 (REQ-009~013, REQ-035)

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
프리셋은 이름과 대략의 부지 크기뿐이다. 실제 지도가 아니다.

만들어지는 서버룸: 줄의 첫 랙은 인프라 랙(스파인 한 쌍, 스토리지), 나머지는 컴퓨트 랙. 랙마다 ToR과 A/B PDU, 서버룸마다 부하에 맞춘
CRAH와 A/B 분전반, 층마다 A/B UPS, 서버룸마다 vSphere 클러스터. **평상시 알람이 없어야 한다** — 명세 테스트가 확인한다
(N+1 냉방은 한 대가 서도 버티고, A/B 전원은 한쪽 분전반이 트립해도 서버가 꺼지지 않는다).

랙은 한 세계에 2000개까지다(`MAX_RACKS`). 용량 측정(REQ-032)에서 다시 정한다.

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
