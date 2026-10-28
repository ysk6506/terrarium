---
title: ADR-0008 독립 공간 모듈과 소스 격리
kind: decision
status: active
last_verified: 2026-10-28
enforced_by:
- ARCH010
- ARCH012
touches_protected: []
decision_hash: 3a265dd887895a4b
---
# ADR-0008 독립 공간 모듈과 소스 격리

## 맥락
이전 구현은 공간 계산이 worldgen 안에 있고 realimport가 시나리오 패키지를 직접 import했다. 도면이 없으므로 좌표계는 위치 프로퍼티(타입별 형식이 다름)에서 도출해야 한다 (REQ-012, REQ-013).

## 결정
- 공간 계산은 `spatial` 레이어의 순수 모듈이다. 월드·소스를 모르고, 입력은 단순한 값(위치 프로퍼티 문자열/숫자)이다.
- `worldgen`과 `realimport`는 `spatial`을 함께 쓰고 서로를 import하지 않는다 (`ARCH012`).
- 두 소스가 공유해야 하는 월드 조립 코드는 `sources` 바로 아래의 공용 모듈(`sources/assembly.py`)에 둔다.

## 이유
좌표 도출 규칙은 한 곳에서 테스트되고, 어느 소스에서 오든 같은 규칙을 적용한다.
