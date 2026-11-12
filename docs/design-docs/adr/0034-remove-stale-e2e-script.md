---
title: ADR-0034 쓰지 않는 e2e 스크립트를 없앤다
kind: decision
status: active
enforced_by:
  - PROT001
touches_protected:
  - package.json
decision_hash: 5ba2b75095faed86
---
# ADR-0034 쓰지 않는 e2e 스크립트 제거

## 맥락
`package.json`의 `e2e` 스크립트는 없는 실행 파일을 가리키고 있었다. 브라우저로 진짜 서버를 띄워 화면 여정을 도는 일은
`pnpm ux`(UX Honeycomb 측정, ADR-0031)가 맡고 있고 `pnpm check`가 그 결과를 확인한다. 실행하면 모듈을 못 찾는다는 오류만 나는 스크립트가 남아 있었다.

## 결정
`e2e` 스크립트를 지운다. 브라우저 여정 시험은 `pnpm ux`로 돌린다.

## 이유
- 돌려 보면 깨지는 명령은 문서와 사람을 속인다.
- 같은 일을 하는 길이 하나(`pnpm ux`)면 설명이 짧다.

## 버린 대안
- `e2e`를 `pnpm ux`의 별칭으로 두기: 이름이 둘이 되고, 둘의 차이를 설명해야 한다.

## 결과
- `pnpm e2e`는 없다. 문서에서 가리키는 곳이 없는지 확인했다.
