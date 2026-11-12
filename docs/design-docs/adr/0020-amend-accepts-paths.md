---
title: ADR-0020 테스트 잠금 수정 명령은 ADR 경로도 받는다
kind: decision
status: active
enforced_by:
  - harness/src/checks/testguard.test.ts
touches_protected:
  - harness/src/checks/testguard.ts
  - harness/src/checks/testguard.test.ts
decision_hash: 334be300b9677675
---
# ADR-0020 `lock --amend`는 경로도 받는다

## 맥락
잠긴 테스트를 ADR로 고칠 때의 안내문은 `testguard.ts lock --amend <adr-file>`이다. ADR-0019를 적용하면서
ADR 파일의 저장소 경로(docs/design-docs/adr/ 아래 파일)를 넘겼더니 ADR 폴더 이름이 두 번 붙어 파일을 찾지 못했다. 안내문을
그대로 따른 에이전트가 막히는 것은 하네스의 결함이다(AGENTS.md: "실패 메시지를 믿고 그대로 고친다").

## 결정
`--amend`는 ADR의 파일 이름과 저장소 경로(docs/design-docs/adr/를 앞에 붙인 형태)를 모두 받는다. 잠금 파일에는 늘 파일 이름을 기록한다.

## 이유
안내문을 고치는 것보다 두 형태를 다 받는 쪽이 실수의 여지를 없앤다. 기록 형식은 그대로라 기존 잠금과 호환된다.

## 결과
메타 테스트 "the amendment ADR can be named by file name or by its repository path"가 이 동작을 지킨다.
