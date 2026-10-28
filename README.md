---
title: Terrarium
kind: guide
status: active
last_verified: 2026-10-28
---

# Terrarium

사내 Agent/Harness 평가용 스테이트풀 IT 인프라 시뮬레이터이자 실험 플랫폼.

- **세계 짓기**: 타이쿤 게임처럼 부지 → 건물 → 층 → 서버룸 → 컨테인먼트 → 랙 → 장비, 설비·전원·케이블을 3D로 짓거나 FalkorDB KG에서 가져온다.
- **시나리오 설계**: 장애 주입, 부하 변화, 에이전트 과업, 채점 기준을 드래그 앤 드롭 워크플로로 만든다.
- **실험**: 하네스 × 에이전트 × 툴 조합을 여러 사람이 동시에 돌린다. 공정 스케줄러가 자원을 나눈다.
- **결과**: 오라클 점수, 하네스 트레이스·메트릭·로그(ClickStack), 툴 호출을 종합해 분석하고 링크·HTML·텍스트로 공유한다. 벤치마크 대시보드에서 비교하고, 조건만 바꿔 바로 다시 돌린다.

기여하는 에이전트는 [AGENTS.md](AGENTS.md)부터 읽는다. 요구사항은 [requirements.md](docs/product-specs/requirements.md), 문서 전체는 [docs/index.md](docs/index.md).

```
pnpm install
pnpm dev     # 개발 서버
pnpm check   # 모든 검사
```
