---
title: ADR-0186 요구사항 문서는 제품 설계 한 장을 따라가지 않는다 — 따라가기는 목표에서 설계로 한 방향이다
kind: decision
status: active
enforced_by:
  - DOC010
  - PROT001
updates_docs:
  - docs/product-specs/requirements.md
  - docs/design-docs/adr-process.md
amends:
  - adr: "0180"
    what: follows는 문서의 서로 가리킴에서 고른다
touches_protected:
  - docs/product-specs/requirements.md
  - docs/design-docs/adr/0180-docs-follow-decisions-not-only-code.md
amends_tests: []
decision_hash: 4329a8252fc3591b
---
# ADR-0186 요구사항 문서는 제품 설계 한 장을 따라가지 않는다 — 따라가기는 목표에서 설계로 한 방향이다

## 맥락
ADR-0180은 코드를 묘사하지 않는 문서가 다른 문서를 `follows`로 따라가게 했고, 무엇을 따라갈지는 문서가 서로 가리키는 곳에서 골랐다. 그 결과 `requirements.md`와 `product-design.md`가 서로를 따라간다.

- `product-design.md`는 `requirements.md`와 `beta-rounds.md`를 따라간다.
- `requirements.md`는 `product-design.md`를 따라간다.

`requirements.md`는 보호 경로다. 그래서 설계 한 장이나 차수 계획의 본문을 고칠 때마다 요구사항 문서의 확인 기록이 바뀌고, 그 변경에 봉인된 결정 기록이 필요해진다(`PROT001`). 2026-11-12에 차수 계획의 일정 하나를 고치는 문서 변경이 이 때문에 관문에서 막혔다. 계획을 고치는 일마다 결정 기록을 요구하면 계획을 안 고치게 된다.

방향도 거꾸로다. 요구사항 문서는 제품 목표와 요구를 적는 맨 위 문서이고, 설계 한 장은 그것을 어떻게 지킬지 적는다. 설계가 바뀌었다고 요구사항이 낡는 것이 아니다.

## 결정
1. **따라가기는 한 방향이다: 목표 → 요구사항 → 설계 → 계획.** 위에 있는 문서는 아래 문서를 따라가지 않는다. 두 문서가 서로를 따라가게 두지 않는다.
2. **`requirements.md`는 제품 목표의 결정 기록(ADR-0138)만 따라간다.** `product-design.md`를 따라가는 줄은 지운다. `product-design.md`가 `requirements.md`를 따라가는 것은 그대로 둔다.
3. **새 문서의 `follows`를 고를 때**: 그 문서가 틀리게 되는 원인이 되는 문서만 적는다. 그 문서를 인용만 하는 곳은 적지 않는다. `adr-process.md`에 이 줄을 더한다.

## 이유
- 목표가 바뀌면 요구사항을 다시 봐야 한다. 설계나 일정이 바뀌면 요구사항이 아니라 설계와 일정을 다시 보면 된다.
- 보호 경로의 뜻은 "가드레일은 결정으로만 바꾼다"이다. 다른 문서의 일정 한 줄이 가드레일 변경을 일으키면 보호가 잡음이 된다.

## 버린 길
- **요구사항 문서의 확인 기록을 고칠 때마다 결정 기록 쓰기**: 계획 문서를 고치는 값이 너무 커진다.
- **`follows`를 모두 지우기**: ADR-0180이 막으려던 "결정이 바뀌어도 문서가 그대로"로 돌아간다.

## 남은 일
- 보호 문서(`requirements.md`, `AGENTS.md`)의 확인 기록만 바뀐 변경을 가드레일 변경으로 볼지는 여기서 정하지 않는다. 덮는 코드가 바뀌어 `AGENTS.md`를 다시 확인할 때 같은 일이 생기는지 보고 따로 정한다.
- 서로 따라가는 문서가 생기면 알리는 검사.

## 결과
`requirements.md`의 `follows`가 `docs/design-docs/adr/0138-product-goal.md` 하나가 된다. `adr-process.md`에 고르는 기준 한 줄.
