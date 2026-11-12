---
title: ADR-0018 단위 테스트는 단위의 의존 규칙을 따르고, 단위 사이의 약속은 tests/spec에 둔다
kind: decision
status: active
enforced_by:
  - ARCH010
touches_protected: []
decision_hash: cdf371fd3abc3fb5
---
# ADR-0018 테스트를 어디에 두나

## 맥락
툴 테스트를 쓰면서 "PDU 차단기 트립 → 물리 → 알람 → 툴 응답"처럼 여러 단위에 걸친 동작을 단위 테스트에 넣었더니, `core.tools`
테스트가 상위 단위인 `core.physics`와 `core.profiles`를 import해 아키텍처 검사(ARCH010)에 걸렸다. 규칙을 넓힐지, 테스트를 옮길지 정해야 했다.

## 결정
1. 테스트 파일도 운영 코드와 같은 의존 규칙을 따른다(규칙은 그대로 둔다).
2. 단위 테스트에서 상위 단위가 필요하면 상태를 직접 만들거나(`world.patch`, `alarm.raise`) 가짜를 주입한다.
3. 여러 단위에 걸친 약속은 `tests/spec/`에 둔다. 이곳은 core 전체를 쓸 수 있다.
4. 툴은 파사드를 스스로 만들지 않는다. 세션이 실험의 제품 버전으로 `createFacades`를 만들어 `ToolContext.facades`로 준다.

## 이유
- 테스트가 상위 단위에 기대면 하위 단위의 정확성이 상위 단위의 구현에 묶인다. 고칠 곳을 찾기 어려워진다.
- 단위 사이의 약속(예: "get_impact는 물리가 망가뜨리는 것을 빠뜨리지 않는다")은 어느 한 단위의 것이 아니므로 별도 위치가 맞다.
- 툴이 파사드를 직접 만들면 어떤 제품 버전(프로파일)을 쓰는지 숨겨진다.

## 버린 대안
- **테스트에는 core 전체 import 허용**: 간단하지만 위 문제를 그대로 둔다.

## 결과
[ARCHITECTURE.md](../../../ARCHITECTURE.md)의 "테스트는 어디에 두나"에 같은 내용이 있다.
