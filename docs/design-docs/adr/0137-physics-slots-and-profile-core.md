---
title: ADR-0137 물리 모델 자리(이음매)와 물리 프로필(숫자·곡선·날씨·지문)의 코어를 만든다
kind: decision
status: active
last_verified: 2026-11-10
enforced_by:
  - tests/spec/physics-golden.test.ts
  - tests/spec/physics-laws.test.ts
  - tests/spec/physics-profile.test.ts
  - tests/spec/physics-determinism.test.ts
  - tests/spec/physics-profile-reference.test.ts
  - packages/core/src/physics/slots/slots.test.ts
  - packages/core/src/physics/laws.test.ts
  - packages/core/src/analysis/physics-board.test.ts
  - apps/server/src/http/physics-api.test.ts
  - ARCH010
touches_protected:
  - docs/product-specs/requirements.md
  - harness/config/architecture.yaml
decision_hash: 609962d55f72c8a5
---
# ADR-0137 물리 모델 자리(이음매)와 물리 프로필(숫자·곡선·날씨·지문)의 코어를 만든다

## 맥락
[ADR-0136](0136-physics-inventory-and-model-slots.md)이 물리가 닿는 열네 자리와 세 깊이(숫자·곡선·모델), 법칙 검사, 프로필 지문, 기본 물리의 판(v1, v2)을 설계했다. 이 결정은 그 순서의 **단계 0(이음매, 동작 변화 없음)** 과 **단계 1의 코어 절반(숫자·곡선·날씨 표·지문·서버 저장)** 을 만든다. 화면, 사이드카(단계 3), 기본 물리 v2(단계 2)는 이 결정 밖이다.

## 결정
1. **슬롯 레지스트리를 코어 단위로 둔다.** `packages/core/src/physics/slots/`가 새 단위 `core.physics.slots`다(kernel만 가져온다). 자리 열세 개(`thermal.room`, `thermal.device`, `cooling.unit`, `cooling.liquid`, `cooling.plant`, `env.weather`, `power.device`, `power.conversion`, `power.protection`, `power.storage`, `reliability.hazard`, `network.link`, `perf.service`)가 열네 곳을 덮는다(방 공기와 랙 흡기는 `thermal.room` 하나). 자리마다 한국어 이름, 바꿀 수 있는 범위 종류(세계·건물·방·랙·모델), 단위가 붙은 입력·출력 계약, v1이 하는 일 한 문장, 이름 붙은 숫자(단위·기본값·허용 범위·한 줄 설명), 이름 붙은 곡선을 가진다. `core.world`·`core.physics`·`core.session`·`core.contract`·`core.experiments`가 이 단위를 가져올 수 있게 `architecture.yaml`을 바꾼다(보호 경로).
2. **엔진은 숫자와 곡선을 레지스트리로 읽는다.** 열·냉방·액체·플랜트·전력·보호·저장·고장률·회선·일의 속도에서 물리 식에 속한 상수가 자리의 숫자가 되었다. 식 자체는 그대로 두고 그 앞에 곡선이 있으면 곡선을 쓴다. 곡선이 없고 숫자가 기본값이면 **비트까지 같은 계산**이다(`physics-golden.test.ts`를 다시 기록하지 않았다). 계산 순서가 같게 만들 수 없는 식은 식을 그대로 두고 상수만 숫자로 뽑았다(같은 문서의 표).
3. **물리 프로필은 세계(청사진)에 붙는다.** `Blueprint.physics`는 `{ base: "v1", params, scoped, curves, weather }`이다. 숫자는 `slot.param`, 곡선은 `slot.curve`로 이름 붙고, 범위(건물·방·랙·모델 id)를 정한 숫자(`scoped`)는 더 좁은 범위가 이긴다. 알 수 없는 이름·허용 범위 밖·x가 늘지 않는 곡선은 한국어 오류로 거절한다(블루프린트 검사 P001, 요청 스키마, 엔진 시작). 구간 선형 보간은 끝에서 평평하고 결정적이다. 날씨 표는 `time_s,outdoor_c[,humidity_pct]` CSV로 읽고 `repeatS`로 하루를 되풀이할 수 있으며, 시나리오가 바꾼 바깥 온도가 표보다 앞선다.
4. **지문.** 프로필의 정규화한 내용(기본값과 같은 세계 숫자는 뺀다)의 해시가 지문이다. 아무것도 안 바꾼 프로필의 지문은 `v1`이다. 청사진 digest는 지문이 `v1`이 아닐 때만 지문을 포함한다(기본 물리의 옛 digest·벤치마크 키가 그대로다). 실험 스냅샷(`Snapshot.physics`)과 실행 결과(`RunResult.digests.physics`)에 지문이 붙는다.
5. **순위와 비교는 지문이 같은 것끼리만 한다.** 벤치마크 키가 `Snapshot.physics`를 (기본이 아니면) 포함하고, 리더보드는 키와 지문으로 묶으며(`Leaderboard.physics`), 포크가 원본과 물리가 다르면 점수 차이를 계산하지 않는다.
6. **법칙 검사.** `LawMonitor`가 세계를 걸음마다 지켜본다. 형식(유한), 범위, 에너지(방: ΔT×열용량 = (들어온 − 뺀 − 벽 손실)×시간, 뺀 열 ≤ 능력, 배터리가 내놓은 에너지 ≤ 부하가 가져간 것), 전력(윗단 부하 = 아랫단 합 ÷ 효율, 장비 전력은 대기~최대), 방향(부하↑ ⇒ 전력 줄지 않음, 냉방 꺼짐 ⇒ 방이 식지 않음). v1이 어기는 것은 조용히 고치지 않는다(전체 기록이 움직인다). `KNOWN_V1_EXCEPTIONS`에 이름과 이유를 적고 v2에서 고친다.
7. **프로필 검증 고리.** 정답 풀이(REQ-110)를 프로필이 든 세계에서 돌려 100점이 아닌 시나리오를 알려 주는 함수(`tests/spec/test-support/reference-profile.ts`)와 명령(`pnpm tsx scripts/validate-physics-profile.ts <파일>`). 정답 풀이는 시험 전용이라 코어에 두지 않는다.
8. **서버.** `GET /api/physics/slots`(자리·숫자·단위·기본값·범위·곡선 이름), `GET`·`PUT /api/worlds/:id/physics`(만든 사람만, digest 확인, 저장하면 세계의 새 버전). 기본 물리를 저장하면 프로필이 지워져 옛 digest로 돌아간다.

## 버린 길
- **프로필을 레시피에 두기**: 세계 digest·웜 스타트 키·벤치마크 키·여러 스레드의 세계 캐시가 모두 청사진을 따른다. 청사진에 두면 이 경로 어디도 고치지 않고 지문이 전파된다.
- **지문을 늘 digest에 넣기**: 옛 세계의 digest와 벤치마크 집합이 모두 달라진다. 기본 물리는 옛 값 그대로다.
- **기본 곡선을 점들로 표현해 늘 곡선을 타기**: 보간 값이 식과 비트까지 같다는 보증이 없다. 곡선이 없으면 식을 그대로 돌린다.
- **고장률을 자리의 곡선으로**: 고장 종류가 90여 개라 종류마다 숫자(평균 고장 간격, 시간)를 두고 전체 배율을 하나 둔다.

## 결과
v1의 법칙 검사 결과와 식을 그대로 두고 상수만 뽑은 곳은 [물리 프로필 참조](../physics-profile.md)에 적는다. 요구사항은 REQ-113이다. 사이드카·파이썬 도구(단계 3), 기본 물리 v2(단계 2), 화면은 별도 결정이다.
