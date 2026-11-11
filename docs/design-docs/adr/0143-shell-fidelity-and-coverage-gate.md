---
title: ADR-0143 깊은 OS 흉내를 GNU에 더 가깝게 하고 커버리지 하한을 채운다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - tests/spec/deep-os-links.test.ts
  - tests/spec/deep-os-text-gnu.test.ts
amends_tests:
  - tests/spec/deep-os-text-gnu.test.ts::awk [REQ-098] > [REQ-098] a record separator other than newline is refused, wherever it is set
  - tests/spec/deep-os-option-sweep.test.ts::<import:cf479f8d>
  - tests/spec/deep-os-option-sweep.test.ts::an option the fake does not have is named and sent outside the simulation [REQ-098] > =names
test_change_reason: awk의 RS를 거절하던 시험은 RS를 실제로 구현하면서 반대 동작을 확인하는 시험으로 바뀐다. 거절은 GNU와 다른 점이었고, 같은 시험 파일의 새 시험이 문자·문단·정규식 RS를 진짜 awk 출력과 맞춰 본다. 옵션 쓸어보기 시험은 명령 표를 코어 안쪽에서 끌어오던 것을 명령 이름 목록으로 바꿔 구조 검사(ARCH011)를 지키고, 확인하는 동작은 같다.
touches_protected:
  - harness/config/test-lock.json
decision_hash: cf9b5d0af7da9ba6
---
# ADR-0143 깊은 OS 흉내를 GNU에 더 가깝게 하고 커버리지 하한을 채운다

## 맥락
ADR-0117 결정 4는 GNU와 다른 동작을 거절하거나 문서에 적도록 했다. `find /`·`du /`가 스택을 넘치고, `echo a ; ; echo b`가 오류가 아니며, `mkdir`·`ln`·`readlink`가 없고, `grep`·`sed`·`awk`·`sort`가 여러 곳에서 GNU와 달랐다.

## 결정
1. **트리 순회를 반복문으로 한다.** `find /`·`du /`는 링크로 들어가지 않고 앞순서로 걷는다. 출력은 `tools/shell.ts`의 400줄 자르기로 묶인다.
2. **빈 명령은 문법 오류다.** `;` 바로 앞의 빈 명령은 `syntax error near unexpected token ';'`.
3. **`mkdir`·`ln -s`·`readlink`는 세계 명령(`host.act`)으로 한다.** `mkdir`·`symlink` 동작이 `os.files` 겹침에 쓰이므로 재생이 같다. 하드 링크(`ln` 기호 없이)는 `command not found`가 아니라 거절한다.
4. **텍스트 명령을 GNU에 맞춘다.** 진짜 도구 출력과 맞춰 본 값으로 `grep -e/-f/-o`, `sed -z/-f/-e 여러 번`, `sort -k`/`-h`/`-V`, `awk`의 `RS`·`do-while`·`printf`·`substr`·`length(배열)`·미설정 변수를 고친다. 남은 차이는 `service-os-layer.md`의 "GNU와 다른 곳"에 적는다.
5. **시험 둘을 바꾼다.** 옵션 쓸어보기 시험은 코어 내부 import(ARCH011)를 없애려고 명령 이름을 시험 안에 적는다(확인 내용은 같다).
    `awk`가 `RS`를 거절한다는 시험은 `RS`를 구현했으므로 반대 동작을 확인하는 시험으로 바뀐다(`amends_tests`).
6. **죽은 코드.** `worldgen`의 가중 선택 반복은 마지막 항목으로 떨어지는 길이 닿지 않아 마지막 항목을 제외하고 돈다(결과 같음).

## 결과
- 새 시험은 모두 REQ-098·REQ-111 등 제목을 달고 잠금에 올린다.
