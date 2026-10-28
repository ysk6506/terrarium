---
title: 문서 색인
kind: reference
status: active
last_verified: 2026-10-28
---

# 문서 색인

모든 문서는 여기서 도달 가능해야 한다 (`DOC040`). 새 문서를 만들면 여기에 링크한다.

## 먼저 읽기

- [AGENTS.md](../AGENTS.md) — 에이전트 진입점, 절대 규칙
- [ARCHITECTURE.md](../ARCHITECTURE.md) — 단위와 의존 방향
- [요구사항](product-specs/requirements.md) — `REQ-NNN`의 단일 출처

## 설계와 결정

- [핵심 신념](design-docs/core-beliefs.md)
- [ADR 작성 절차](design-docs/adr-process.md)
- [품질 하네스 사용법](design-docs/harness-guide.md)
- [UX Honeycomb 측정](design-docs/ux-honeycomb.md)
- [시나리오 모델](design-docs/scenario-model.md)

### ADR

- [0001 레이어 아키텍처](design-docs/adr/0001-layered-architecture.md) (대체됨 → 0011)
- [0002 문서 신선도 장치](design-docs/adr/0002-doc-freshness.md)
- [0003 기술 부채 장부와 래칫](design-docs/adr/0003-debt-ledger.md)
- [0004 테스트 잠금](design-docs/adr/0004-test-lock.md)
- [0005 보호 경로](design-docs/adr/0005-protected-paths.md)
- [0006 결정론적 시뮬레이션](design-docs/adr/0006-deterministic-simulation.md)
- [0007 카탈로그·프로파일·파사드 분리](design-docs/adr/0007-catalog-profile-facade.md)
- [0008 독립 공간 모듈과 소스 격리](design-docs/adr/0008-spatial-and-sources.md)
- [0009 읽기 전용 현실 소스 포트](design-docs/adr/0009-readonly-source-port.md)
- [0010 TypeScript 단일 언어 모노레포](design-docs/adr/0010-typescript-monorepo.md)
- [0011 단위 기반 아키텍처](design-docs/adr/0011-units-v2.md)
- [0012 웹 커버리지 분리](design-docs/adr/0012-web-coverage-split.md)
- [0013 TEST003 보정: 같은 호출을 두 번 비교](design-docs/adr/0013-test003-repeated-evaluations.md)
- [0014 커버리지 래칫의 근거 기준](design-docs/adr/0014-coverage-ratchet-evidence.md)
- [0015 테스트 코드의 any 허용](design-docs/adr/0015-tests-may-use-any.md)
- [0016 시나리오 = 흐름 + 채점표](design-docs/adr/0016-scenario-flow-and-scoring.md)
- [0017 에이전트는 센서 값을 본다](design-docs/adr/0017-agents-see-sensor-readings.md)
- [0018 테스트를 어디에 두나](design-docs/adr/0018-test-placement.md)

## 계획과 부채

- [진행 중 계획](exec-plans/active/build-plan.md)
- [기술 부채 장부](exec-plans/tech-debt.yaml) (YAML)
