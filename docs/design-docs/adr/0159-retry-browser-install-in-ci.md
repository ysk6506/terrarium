---
title: ADR-0159 관문의 브라우저 설치는 세 번까지 다시 해 본다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - none
no_enforcement_reason: CI 작업 흐름의 한 걸음이다. 저장소의 시험으로는 러너의 네트워크 실패를 만들 수 없다. 걸음의 이름에 이 ADR을 적어 지워지지 않게 한다.
touches_protected:
  - .github/workflows/ci.yml
decision_hash: 615733d30391d6c2
---
# ADR-0159 관문의 브라우저 설치는 세 번까지 다시 해 본다

## 맥락
`ux-journeys`는 관문(`gate`)에 걸려 있고(ADR-0141), 실행마다 브라우저와 시스템 꾸러미를 내려받아 깐다(`playwright install --with-deps chromium`). 2026-11-11에 문서만 바꾼 PR 둘(#20, #21)이 같은 시각에 같은 이유로 떨어졌다: 러너에서 꾸러미 저장소의 이름을 찾지 못했다("Temporary failure resolving 'security.ubuntu.com'", 설치가 100으로 끝남). 코드와 상관없는 실패가 머지를 막았다. main은 관문이 초록이어야 머지된다.

## 결정
1. 브라우저를 까는 걸음은 세 번까지 다시 해 본다(20초, 40초를 쉬고). `ux-journeys`와 `ux-measure` 둘 다.
2. 다시 해 보는 것은 설치뿐이다. 여정과 시험은 다시 돌리지 않는다. 떨어진 시험을 다시 돌려 초록을 만드는 것은 결함을 가린다.

## 버린 길
- **꾸러미를 캐시에 넣기**: 시스템 꾸러미는 러너 이미지에 따라 달라져 캐시가 낡는다. 다시 해 보기가 더 단순하다. 그래도 자주 떨어지면 그때 한다.
- **`ux-journeys`를 관문에서 빼기**: 화면의 결함을 막는 관문이다(ADR-0141).

## 결과
`.github/workflows/ci.yml`의 두 걸음.
