---
title: ADR 작성 절차
kind: guide
status: active
last_verified: 2026-10-28
---

# ADR (Architecture Decision Record)

결정은 저장소에 남아야 한다. 채팅·머릿속의 결정은 다음 에이전트에게 존재하지 않는다.

## 언제 쓰나

- 새 레이어, 새 외부 라이브러리, 의존 규칙 변경
- 하네스(`harness/`), 설정 파일(`package.json`, `vitest.config.ts` 등), 요구사항, AGENTS.md 변경 (보호 경로)
- 요구사항이 바뀌어 잠긴 테스트를 바꿔야 할 때
- 설계에서 여러 길 중 하나를 고를 때

## 만드는 법

1. `docs/design-docs/adr/NNNN-짧은-이름.md` 생성. 다음 번호를 쓴다.
2. 본문은 쉬운 말로 **맥락 → 결정 → 이유 → 대안과 버린 이유 → 결과**.
3. 앞부분(front matter)에 아래를 적는다.

```yaml
title: ...
kind: decision
status: active          # active | superseded
last_verified: 2026-10-28
enforced_by: [ARCH010]  # 규칙 코드 또는 테스트 경로. 못 하면 [none] + no_enforcement_reason
touches_protected: []   # 이 ADR로 바꾸는 보호 경로 (harness/**, package.json ...)
amends_tests: []        # 요구사항 변경으로 바꾸는 잠긴 테스트 키
test_change_reason: ""  # amends_tests를 쓸 때: 왜 요구사항이 바뀌었는지 (40자 이상)
```

4. 봉인: `pnpm tsx harness/src/checks/docs.ts seal-adr docs/design-docs/adr/NNNN-....md`
5. [색인](../index.md)에 링크한다.

## 봉인된 ADR은 수정 금지

본문을 고치면 `DOC070`으로 실패한다. 결정을 바꾸려면 **새 ADR**을 쓰고
이전 ADR의 `status: superseded`, `superseded_by: NNNN-....md`를 설정한다. (front matter는 봉인 대상이 아니다.)

## 결정은 강제 장치와 연결한다

`enforced_by`가 가리키는 규칙 코드나 테스트가 실제로 있어야 한다 (`DOC080`).
기계가 확인할 수 없는 결정은 `[none]`과 사유를 적는다. 그런 결정이 많아지면 방향을 잃은 것이다.
