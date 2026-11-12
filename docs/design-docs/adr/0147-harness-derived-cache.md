---
title: ADR-0147 구조 검사는 같은 파일에 같은 질문을 두 번 하지 않는다
kind: decision
status: active
enforced_by:
  - harness/src/ts-ast.test.ts
  - harness/src/common.test.ts
touches_protected:
  - harness/src/ts-ast.ts
  - harness/src/ts-ast.test.ts
  - harness/config/test-lock.json
decision_hash: 5fcf14ef3190650b
---
# ADR-0147 구조 검사는 같은 파일에 같은 질문을 두 번 하지 않는다

## 맥락
ADR-0145 뒤에도 `harness/src/common.test.ts`의 "run-all runs every check and prints a verdict"는 CI에서 16.1초(한도 20초)였다. 이 시험은 구조 검사 여덟 개를 저장소 전체에 돌린다. 앞선 두 시험(architecture, docs)이 같은 검사를 이미 돌리는데도 검사마다 같은 파일에 같은 질문(주석, 함수 목록, import 목록, 파일 구조)을 다시 계산했다. 파싱만 파일마다 한 번이었다(ADR-0029).

시간을 재 보니(로컬) run-all 약 10.2초는 검사별로 architecture 1.2초, docs 1.0초, debt 2.2초, test-integrity 2.6초, moss 2.5초였다. debt의 1.0초는 `isFunctionLike`(노드마다 `ts.is*` 일곱 번)였고, moss 2.5초는 별도 프로세스에서 문서 색인 1,386조각을 하나씩 찾아보는 시간이다.

## 결정
`harness/src/ts-ast.ts`만 바꾼다. 검사의 규칙, 메시지, 지문은 그대로다.
1. **파싱된 트리마다 한 번 계산한다.** `comments`, `functions`, `moduleRefs`, `normalized`를 `WeakMap`으로 파싱된 트리에 묶는다. 글이 바뀌면 `parse`가 새 트리를 만들어 새 답이 나온다(낡은 답이 나오지 않는다). 배열은 복사해서 돌려주므로 호출한 쪽이 고쳐도 다음 호출에 새지 않는다.
2. **`isFunctionLike`는 종류 집합 하나로 가른다.** `ts.is*` 일곱 개가 보는 일곱 종류와 같다.
3. **`meaningfulText`도 종류 집합으로 먼저 거른다.** 같은 종류에서 같은 글을 돌려준다. 모든 시험 파일의 구조 지문(`test-lock.json`)이 그대로 맞아야 하므로 `test-integrity`가 이를 확인한다.
4. 새 시험 `harness/src/ts-ast.test.ts`가 같은 글은 같은 트리·같은 답, 바뀐 글은 새 답, 복사본, 일곱 종류, 구조 지문을 확인한다.

## 바뀌지 않는 것
`common.test.ts`와 모든 기존 시험, 제한 시간, 검사하는 사실의 집합. 어떤 검사의 결과도 바뀌지 않는다(구조 지문이 잠금과 같다).

## 버린 길
- 시험 파일을 바꿔 검사를 덜 돌리기: 시험이 보는 사실이 줄어든다.
- 노드마다 `structureOf`를 기억하기: 재 보니 한 번만 불리는 노드가 대부분이라 기억하는 비용이 더 컸다.
- moss의 색인 탐침을 빠르게 하기: `apps/server`의 검색을 건드리는 일이라 이 ADR의 범위 밖이다. run-all의 바닥(약 2.5초)이다.

## 결과
아래 숫자는 같은 기계에서 잰 것이다(PR 본문에 전/후 표가 있다).
