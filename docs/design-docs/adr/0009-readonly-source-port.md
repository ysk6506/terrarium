---
title: ADR-0009 읽기 전용 현실 소스 포트
kind: decision
status: active
last_verified: 2026-10-28
enforced_by:
  - ARCH020
touches_protected: []
decision_hash: 700b3f65a478327e
---
# ADR-0009 읽기 전용 현실 소스 포트

## 맥락
그래프(FalkorDB)뿐 아니라 다른 소스에서도 현실을 월드로 가져와야 한다. 그러나 테라리움은 현실을 제어하지 않는다 (REQ-010, REQ-011).

## 결정
- `RealitySource`는 **읽기만** 있는 포트(Protocol)다: 목록/조회 메서드만 있고 쓰기 메서드가 없다.
- `falkordb` 라이브러리는 `sources/realimport`의 FalkorDB 어댑터에서만 import한다 (`ARCH020`).
- FalkorDB 어댑터는 쓰기 Cypher 키워드(`CREATE`, `MERGE`, `SET`, `DELETE`, `REMOVE`, `DROP`)가 든 질의를 거부한다. 읽기 전용 질의 API(`ro_query`)만 사용한다.
- KG 스키마를 아는 곳은 한 파일(매핑 정의)이다. 그래프 스키마가 바뀌면 이 파일만 고친다.

## 이유
쓰기 경로가 구조적으로 존재하지 않으면 실수로 현실을 바꾸는 일이 없다.
