---
title: 구현 계획 — 테라리움 재시작
kind: plan
status: active
last_verified: 2026-10-28
---

# 구현 계획

목표는 [requirements.md](../../product-specs/requirements.md)의 REQ-001~REQ-025를 충족하는 것이다.
순서는 **가드레일 → 아래 레이어 → 위 레이어**이고, 각 단계는 `make check`가 통과해야 끝난다.

## 단계

| # | 단계 | 요구사항 | 상태 |
|---|---|---|---|
| 0 | 하네스: 문서·아키텍처·부채·테스트 잠금·보호 경로·추적 | REQ-020~025 | 완료 |
| 1 | `kernel`: ID, 단위, Clock/Rng, 오류 | REQ-001 | 대기 |
| 2 | `spatial`: 위치 프로퍼티 → 좌표계 | REQ-012, 013 | 대기 |
| 3 | `world`: 엔티티, 이벤트 로그, 스냅샷/리셋 | REQ-001, 014 | 대기 |
| 4 | `catalog`, `profiles` | REQ-004 | 대기 |
| 5 | `physics`: 열·전력·공조 | REQ-005 | 대기 |
| 6 | `facades`: Redfish, vCenter, vROps | REQ-002, 003 | 대기 |
| 7 | `sources`: worldgen, realimport(FalkorDB) | REQ-009~011 | 대기 |
| 8 | `service`: 시나리오, 장애 주입, 진단 기록 | REQ-014, 015 | 대기 |
| 9 | `api` + 웹 UI | REQ-006, 007, 008 | 대기 |

## 결정 로그

결정은 ADR에 있다. 이 계획에는 일정과 상태만 둔다.
