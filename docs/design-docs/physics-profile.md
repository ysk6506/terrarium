---
title: 물리 프로필 레퍼런스 — 자리별 숫자·곡선, 지문, 무엇이 자리 뒤로 갔고 무엇이 남았나
kind: reference
status: active
last_verified: 2026-11-10
covers:
  - packages/core/src/physics/slots/registry.ts
  - packages/core/src/physics/slots/profile.ts
  - packages/core/src/physics/slots/resolved.ts
  - packages/core/src/physics/slots/curve.ts
  - packages/core/src/physics/models.ts
  - packages/core/src/physics/laws.ts
verification_log:
  - "2026-11-10: 새 레퍼런스: 자리별 숫자·곡선, 지문, 자리 뒤로 간 것과 남은 것, 법칙 검사 결과(위반 0)"
covers_hash: cc39d131694ee02e
---
# 물리 프로필 레퍼런스

설계는 [physics-laws.md](physics-laws.md), 결정은 [ADR-0137](adr/0137-physics-slots-and-profile-core.md)이에요. 이 문서는 단계 0(이음매)과 단계 1 코어(숫자·곡선·날씨·지문)가 지금 무엇을 하는지 적어요. 화면과 사이드카(단계 3), 기본 물리 v2(단계 2)는 아직 없어요.

## 프로필이 뭐예요

`Blueprint.physics`에 들어가는 `PhysicsProfile` 하나예요.

- `base`: `"v1"` (오늘의 식)
- `params`: `"slot.param": 숫자` (세계 전체)
- `scoped`: 같은 값을 건물·방·랙·모델 한 곳만 바꿔요. 세기는 세계 < 모델 < 건물 < 방 < 랙이에요
- `curves`: `"slot.curve": [[x,y],…]` 조각 선형, 양 끝은 평평, 결정적
- `weather`: 시간별 바깥 온도(와 습도) 표. CSV `time_s,outdoor_c[,humidity_pct]`를 읽는 도우미가 있어요

잘못된 이름, 범위 밖 값, x가 늘지 않는 곡선은 한국어 오류로 거절해요(`P001`, `PUT`은 400). 프로필이 비었거나 기본값만 다시 적었으면 오늘의 식이 그대로 돌아 `physics-golden`과 비트까지 같아요.

## 지문

정규화한 JSON(기본값과 같은 세계 값은 빼고, 범위 목록은 정렬)의 해시예요. 기본은 `v1`, 바꿨으면 `v1+` 뒤에 12자리예요. 세계 스펙(`digests.physics`), 실험 스냅샷, 실행 결과에 남아요. `blueprintDigest`와 벤치마크 키는 지문이 `v1`이 아니면 그것을 넣어서, 옛 키는 그대로예요. 순위와 비교는 같은 지문끼리만 묶어요. 다른 물리의 부모 비교는 점수 차이를 내지 않아요.

## 자리별 숫자와 곡선

| 자리 | 숫자 | 곡선 |
|---|---|---|
| thermal.room | 18 | 없음 |
| thermal.device | 18 | 없음 |
| cooling.unit | 1 | COP vs 바깥 온도 |
| cooling.liquid | 10 | 없음 |
| cooling.plant | 23 | 능력 비율 vs 바깥 온도 3개(칠러·드라이쿨러·냉각탑) |
| env.weather | 1 | 날씨 표 |
| power.device | 2 | 서버 전력 vs 부하, 캡 → 성능 |
| power.conversion | 10 | UPS 효율 vs 부하율 |
| power.protection | 5 | 차단기 동작 시간 vs 부하율 |
| power.storage | 5 | 없음 |
| reliability.hazard | 77 (rateScale + 유형별 MTBF 76) | 없음 |
| network.link | 1 | 없음 |
| perf.service | 1 | 없음 |

이름, 단위, 기본값, 범위, 한국어 설명은 `GET /api/physics/slots`가 그대로 줘요. 곡선이 없으면 원래 식이 같은 연산 순서로 돌아요.

## 자리 뒤로 간 것, 남긴 것

뒤로 간 것: 방·랙 흡기·장비 열의 상수, 냉방기 COP, 액냉(RDHX·탱크)·플랜트(CDU·칠러·발전기·가용 한계) 상수, 전력 변환·보호·저장·시설 확장(변압기·BBU·버스·자동 전환) 상수, 서버 전력과 캡 성능, 고장률 표, 따라잡기 계수. 차단기는 반한시(과부하 열이 쌓이면 동작)를 곡선으로 고를 수 있어요(기본은 오늘처럼 즉시).

남긴 것(상수나 식 그대로): 링크 지연 `linkMsOf`와 `asyncLagS`(`world/site-dr.ts`, 세계를 만들 때 쓰여 세계 접근이 없어요), 사이트 장애 조치 타이머, `os-physics` 누설 속도, RDHX·탱크·변압기 상태 문턱, 하루 부하 곡선 `DAY_PATTERN`, `LEAK_SENSE_S`, `perfUnderCap`(플래너 추정이라 v1 기본값 고정).

## 법칙 검사

`LawMonitor`가 매 걸음 방 에너지 균형과 배터리를, 30걸음마다 형식·범위·장비 전력·전력 사슬을 검사해요. 방향 검사(부하↑ 전력 안 줄기, 곡선 단조)와 변환 검사는 만들 때 한 번 해요. 내장 세계 12개를 v1로 하루(10초 걸음) 돌려 위반 0이에요(`tests/spec/physics-laws.test.ts`). 사고 없는 하루만 돌렸고, 고장을 넣은 날은 `laws.test.ts`의 조작한 걸음으로 검사의 이빨만 확인해요. v1이 어기는 법칙은 지금 찾지 못해 `KNOWN_V1_EXCEPTIONS`는 비어 있어요.

## 프로필 검증

`pnpm tsx scripts/validate-physics-profile.ts <파일>`이 정답 풀이를 그 프로필 위에서 돌려 100점이 아닌 시나리오를 알려줘요. 방이 훨씬 빨리 더워지는 프로필에서 `power-cap-cooling-short`가 걸려요.
