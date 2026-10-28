---
title: Terrarium
kind: guide
status: active
last_verified: 2026-10-28
---

# Terrarium

사내 Agent/Harness 평가용 스테이트풀 IT 인프라 시뮬레이터. 서버(Redfish), 가상화(vCenter/vROps), 데이터센터 시설(냉각·전력·공조·분전반)을 하나의 월드로 시뮬레이션하고, 현실(FalkorDB KG)을 읽어 월드로 가져올 수 있다. 현실을 제어하지는 않는다.

- 기여하는 에이전트는 [AGENTS.md](AGENTS.md)부터 읽는다.
- 요구사항은 [docs/product-specs/requirements.md](docs/product-specs/requirements.md).
- 문서 전체는 [docs/index.md](docs/index.md).

```
make setup
make check
```
