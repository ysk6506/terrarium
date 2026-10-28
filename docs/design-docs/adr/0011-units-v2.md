---
title: ADR-0011 단위 기반 아키텍처 (core / server / web)
kind: decision
status: active
last_verified: 2026-10-28
enforced_by:
  - ARCH001
  - ARCH010
  - ARCH011
  - ARCH012
  - ARCH013
  - ARCH020
  - ARCH021
  - ARCH022
  - ARCH030
  - ARCH040
touches_protected: []
decision_hash: a636b977623ef410
---
# ADR-0011 단위 기반 아키텍처

## 맥락
ADR-0001은 Python 패키지 하나 안의 10개 레이어였다. 이제 실험 플랫폼(시나리오, 오라클, 세션, 실험, 분석)과 서버·웹이 생겼다.

## 결정
- **단위(unit)** 는 폴더 하나다. 파일은 경로가 들어맞는 첫 단위에 속한다. 단위마다 import할 수 있는 단위를 `harness/config/architecture.yaml`에 적는다.
- core: kernel → spatial, catalog → world → profiles, physics → facades → tools → scenario → oracle → experiments → analysis → contract. `session`이 시뮬레이터를 조립한다. `sources/worldgen`과 `sources/realimport`는 형제로 격리된다.
- server: adapters → runtime → mcp → http. web: logic → ui.
- 다른 단위는 `index.ts`(공개 API)로만 접근한다. core 단위는 `@terrarium/core/<경로>` 별칭으로 가져온다.
- core와 web에서는 Node 내장 모듈을 금지해 브라우저에서도 돌게 한다. 외부 패키지는 계약에 선언된 단위에서만 쓴다.

## 이유
- 순수한 core를 브라우저에서도 실행할 수 있어서, 편집기 검증과 3D 미리보기에 서버와 같은 코드를 쓴다.
- 외부 시스템(하네스, ClickStack, FalkorDB, SQLite)은 core가 정의한 포트 뒤에 있다. 바꾸거나 가짜로 테스트하기 쉽다.

## 결과
ADR-0001을 대체한다. 새 단위는 이 계약에 등록해야만 존재할 수 있다(`ARCH001`).
