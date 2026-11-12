---
title: ADR-0001 레이어 아키텍처
kind: decision
status: superseded
superseded_by: 0011-units-v2.md
enforced_by:
- ARCH001
- ARCH010
- ARCH011
- ARCH030
- ARCH040
touches_protected: []
decision_hash: 16ee1bf3d8812020
---
# ADR-0001 레이어 아키텍처

## 맥락
이전 시도는 에이전트가 코드를 쓰면서 결정이 계속 덧씌워져 방향을 잃었다. 구조가 말로만 있으면 다음 에이전트는 그 말을 모른다.

## 결정
`src/terrarium`을 10개 레이어로 나누고, 위 레이어는 아래 레이어만 쓸 수 있게 한다.
레이어 사이는 `terrarium.<layer>`의 `__all__`에 있는 이름으로만 접근한다. 순환은 금지한다.
규칙의 원본은 `harness/config/architecture.yaml`이고, 검사가 매 `make check`마다 코드를 읽어 확인한다.

## 이유
- 월드(상태)가 중심이고 바깥 세계는 가장자리에서 번역만 하면, 소스가 바뀌어도(Redfish→vCenter, KG→다른 소스) 중심이 흔들리지 않는다.
- 규칙이 파일 하나에 모여 있어 다음 에이전트가 읽기 쉽다.

## 버린 대안
- 사람이 리뷰로 지키기: 이번 프로젝트는 사람이 개입하지 않는다.
- 레이어 없이 도메인별 폴더만: 도메인 간 의존이 순환되기 쉽다.

## 결과
새 레이어는 ADR 없이 만들 수 없다 (`ARCH001`). 규칙이 불편하면 코드를 옮기거나, 규칙을 바꾸는 ADR을 쓴다.
