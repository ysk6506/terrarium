---
title: 구현 계획 — 테라리움
kind: plan
status: active
last_verified: 2026-10-28
---

# 구현 계획

목표는 [requirements.md](../../product-specs/requirements.md)의 모든 요구사항을 충족하는 것이다.
순서는 **가드레일 → core → 실험 엔진 → 서버 → 웹 → UX 반복**이고, 각 단계는 `pnpm check`가 통과해야 끝난다.

| # | 단계 | 요구사항 | 상태 |
|---|---|---|---|
| 0 | 하네스 (TS 이식) | REQ-020~025 | 완료 |
| 1 | core: kernel·spatial·catalog·world·profiles·physics | REQ-001, 005, 012~014 | 완료 |
| 2 | core: facades·tools·scenario·oracle·session | REQ-002~004, 007, 008, 034 | 완료 |
| 3 | core: sources(worldgen 사업장 프리셋, realimport) | REQ-009~011, 033, 035 | 진행 중 |
| 4 | core: experiments·analysis·contract | REQ-030, 031, 037~040 | 대기 |
| 5 | server: 저장소·하네스 어댑터·워커 호스트·스케줄러·MCP·HTTP·ClickStack·FalkorDB | REQ-030~032, 037 | 대기 |
| 6 | web: 타이쿤 빌더·시나리오 편집기·실험·결과·대시보드 | REQ-006, 034~036, 038~040 | 대기 |
| 7 | UX Honeycomb 측정과 개선 반복 | REQ-041 | 대기 |
| 8 | 용량 측정과 최종 검증 | REQ-032 | 대기 |

결정은 ADR에 있다. 이 계획에는 순서와 상태만 둔다.
