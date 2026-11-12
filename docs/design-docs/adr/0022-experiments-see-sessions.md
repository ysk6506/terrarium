---
title: ADR-0022 실험·분석·계약 단위는 세션(과 세계 소스)을 쓸 수 있다
kind: decision
status: active
enforced_by:
  - ARCH010
touches_protected:
  - harness/config/architecture.yaml
  - AGENTS.md
decision_hash: d4ad42a51ba00b25
---
# ADR-0022 실험은 실행 결과를 안다

## 맥락
ADR-0011의 단위 표에서 `experiments`·`analysis`·`contract`는 `session`을 쓸 수 없었다. 그런데 실험은 실행(run)들의 묶음이고,
실행 결과(`RunResult`: 점수, 툴 호출, 타임라인, 메트릭 시계열)와 시간 정책(`TimePolicy`)은 `session`에 있다. 분석과 공유 렌더링도
이 결과를 읽어야 하고, 계약(HTTP 스키마)은 실험 생성 요청에 worldgen 명세와 가져오기 옵션을 담아야 한다.

## 결정
- `core.experiments`, `core.analysis`, `core.contract`는 `core.session`을 쓸 수 있다.
- `core.contract`는 `core.sources`(worldgen 명세, 가져오기 옵션의 타입)도 쓸 수 있다.
- `session`은 이 셋 중 무엇도 쓰지 않는다(순환 없음). 실험 엔진은 세션을 직접 돌리지 않고, 결과 타입과 정책만 다룬다.
  세션을 실제로 돌리는 것은 서버(`server.runtime`)다.

## 이유
결과 타입을 아래 단위로 쪼개 내리면 점수(oracle)·타임라인·시계열(session)이 흩어져 오히려 이해하기 어렵다. 의존을 한 방향으로
더하는 쪽이 단순하다. 웹 번들은 타입만 쓰는 import를 남기지 않고, 쓰지 않는 코드는 tree-shaking으로 빠지므로 가벼움(REQ-036)을 해치지 않는다.

## 버린 대안
- **결과 타입을 kernel이나 새 단위로 이동**: 결과의 각 부분이 소유 단위를 잃는다.
- **contract가 결과 스키마를 따로 정의**: 두 정의가 어긋날 수 있다.
