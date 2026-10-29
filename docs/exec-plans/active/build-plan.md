---
title: 구현 계획 — 테라리움
kind: plan
status: active
last_verified: 2026-10-29
verification_log:
  - "2026-10-29: 6단계 완료, 7단계 시작"
  - "2026-10-29: 7단계 완료(전 면 100점, 하한 98), 스케일 아웃(REQ-042) 추가·완료, 8단계 시작"
  - "2026-10-29: 8단계: 워밍업 캐시와 용량 측정 반영"
  - "2026-10-29: 8단계 완료"
---
# 구현 계획

목표는 [requirements.md](../../product-specs/requirements.md)의 모든 요구사항을 충족하는 것이다.
순서는 **가드레일 → core → 실험 엔진 → 서버 → 웹 → UX 반복**이고, 각 단계는 `pnpm check`가 통과해야 끝난다.

| # | 단계 | 요구사항 | 상태 |
|---|---|---|---|
| 0 | 하네스 (TS 이식) | REQ-020~025 | 완료 |
| 1 | core: kernel·spatial·catalog·world·profiles·physics | REQ-001, 005, 012~014 | 완료 |
| 2 | core: facades·tools·scenario·oracle·session | REQ-002~004, 007, 008, 034 | 완료 |
| 3 | core: sources(worldgen 사업장 프리셋, realimport) | REQ-009~011, 033, 035 | 완료 |
| 4 | core: experiments·analysis·contract | REQ-015, 030, 031, 037~040 | 완료 |
| 5 | server: 저장소·하네스 어댑터·워커 호스트·스케줄러·MCP·HTTP·ClickStack·FalkorDB | REQ-030~032, 037 | 완료 |
| 6 | web: 타이쿤 빌더·시나리오 편집기·실험·결과·대시보드 | REQ-006, 034~036, 038~040 | 완료 |
| 7 | UX Honeycomb 측정과 개선 반복 | REQ-041 | 완료 |
| 7a | 스케일 아웃·스케일 업 (워커 노드, 클러스터 배치, 자동 확장 지표, 배포 예시) | REQ-042 | 완료 |
| 8 | 용량 측정(워밍업 캐시, 용량 문서)과 최종 검증 | REQ-032, 042 | 완료 |

결정은 ADR에 있다. 이 계획에는 순서와 상태만 둔다.

## 알려진 간극

- **서버 외 장비의 고유 API**: 서버(Redfish BMC), 가상화(vCenter), 운영 도구(vROps)는 실제 API 모양으로 에뮬레이트한다(REQ-002, 003).
  스위치, 스토리지, PDU, UPS, 냉각기, 분전반은 월드 안에 상태로만 있고 서로 영향을 주지만 장비 고유 API(Redfish PowerDistribution, SNMP 등)는 없다.
  에이전트는 중립 툴(`get_entity`, `query_metrics`, `facility_status` 등)로 본다. 요구사항 범위 밖이라 판단해 두었고, 넣게 되면 `core.facades`에
  파사드를 더하면 된다(월드 포트 뒤에서 읽고 쓰는 번역 계층이라 다른 단위는 바뀌지 않는다).
