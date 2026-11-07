---
title: 품질 하네스 사용법
kind: guide
status: active
last_verified: 2026-11-07
covers:
  - harness/src/run-all.ts
covers_hash: 551362b453d558a0
verification_log:
  - "2026-10-28: rewritten for TS harness"
  - "2026-11-07: REQ-103 이끼 추가 뒤 다시 읽음: 이끼 버튼 속성과 새 모듈 외에 이 문서의 서술과 어긋난 곳 없음"
---
# 품질 하네스

`harness/`는 저장소가 오래 건강하도록 지키는 검사 모음이다. 각 검사는 자신의 메타 테스트(`harness/src/checks/*.test.ts`)로
"정말 위반을 잡는가"가 검증되어 있다.

| 요구 | 검사 | 코드 | 결정 |
|---|---|---|---|
| 문서 품질 | `harness/src/checks/docs.ts` | `DOC*` | ADR-0002 |
| 아키텍처 강제 | `harness/src/checks/architecture.ts` | `ARCH*` | ADR-0011 |
| 기술 부채 | `harness/src/checks/debt.ts` | `DEBT*` | ADR-0003 |
| 테스트 변조 방지 | `harness/src/checks/testguard.ts` | `TEST*` `TCFG*` `TLOCK*` | ADR-0004 |
| 커버리지 | `harness/src/checks/coverage.ts` | `COV*` | ADR-0004, ADR-0012 |
| 요구사항 추적 | `harness/src/checks/traceability.ts` | `TRACE*` | ADR-0004 |
| 가드레일 보호 | `harness/src/checks/protected.ts` | `PROT*` | ADR-0005 |
| UX Honeycomb | `harness/src/ux/` | `UX*` | [UX 측정](ux-honeycomb.md) |

## 명령

- `pnpm check` — 전부 실행. 끝나기 전에 반드시 통과.
- `pnpm check:pr` — 기준 브랜치(origin/main)와 비교 포함 (CI와 동일).
- `pnpm ratchet` — 커버리지를 올렸을 때 하한을 올리고, 고친 부채 기준선 항목을 지운다.
- `pnpm lock-tests` — 새 테스트를 잠금 파일에 추가한다. 기존 항목은 바꾸지 않는다.

## 저장소 호스트에서 켜야 하는 설정 (저장소 밖)

1. 기본 브랜치 보호: `ci` 워크플로 통과 필수, 직접 push 금지.
2. "코드 소유자 승인 필수"를 켜고 `.github/CODEOWNERS`의 `@terrarium-maintainers`를 실제 사용자나 팀으로 바꾼다.
