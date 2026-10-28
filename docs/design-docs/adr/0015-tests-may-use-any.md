---
title: ADR-0015 테스트 코드에서는 any를 허용한다
kind: decision
status: active
last_verified: 2026-10-28
enforced_by:
  - none
no_enforcement_reason: Biome 설정(biome.json의 overrides)이 직접 강제한다. 하네스 규칙 코드가 아니다.
touches_protected:
  - biome.json
decision_hash: b05a2cf71b3dce45
---
# ADR-0015 테스트 코드의 any

## 맥락
운영 코드에서 `any`는 금지다(`noExplicitAny`). 테스트는 파사드가 돌려주는 깊은 JSON(Redfish, vROps 응답)을 읽어
기대값과 비교하는데, 응답마다 타입을 다시 정의하면 테스트가 길어지고 실제로 검증하는 내용이 가려진다.

## 결정
`*.test.ts`, `*.test.tsx`, `test-support/`에서는 `noExplicitAny`를 끈다. 운영 코드에서는 그대로 오류다.

## 이유
테스트의 목적은 응답의 "값"을 확인하는 것이다. 타입 안전성은 운영 코드와 타입 검사(tsc)가 맡는다.
