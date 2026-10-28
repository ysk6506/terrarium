---
title: 품질 하네스 사용법
kind: guide
status: active
last_verified: 2026-10-28
covers:
- harness/run_all.py
- Makefile
covers_hash: d1d35033d630f710
verification_log:
- '2026-10-28: initial'
---
# 품질 하네스

`harness/`는 저장소가 장기간 건강하도록 지키는 검사 모음이다. 각 검사는 자신의 메타 테스트(`tests/harness/`)로 검증된다. 즉 "검사가 정말 위반을 잡는가"가 테스트되어 있다.

## 한눈에

| 요구 | 검사 | 코드 | 결정 |
|---|---|---|---|
| 문서 품질 | `harness/checks/docs.py` | `DOC*` | ADR-0002 |
| 아키텍처 강제 | `harness/checks/architecture.py` | `ARCH*` | ADR-0001 |
| 기술 부채 | `harness/checks/debt.py` | `DEBT*` | ADR-0003 |
| 테스트 변조 방지 | `harness/checks/testguard.py` | `TEST*` `TCFG*` `TLOCK*` | ADR-0004 |
| 커버리지 | `harness/checks/coverage.py` | `COV*` | ADR-0004 |
| 요구사항 추적 | `harness/checks/traceability.py` | `TRACE*` | ADR-0004 |
| 가드레일 보호 | `harness/checks/protected.py` | `PROT*` | ADR-0005 |

## 명령

- `make check` — 전부 실행. 끝나기 전에 반드시 통과.
- `make check-pr` — 기준 브랜치와 비교 포함 (CI와 동일). 보호 경로, 테스트 잠금, 부채 기준선, 커버리지 하한이 느슨해졌는지 본다.
- `make ratchet` — 커버리지를 올렸을 때 하한을 올리고, 고친 부채 기준선 항목을 지운다.

## 저장소 호스트에서 켜야 하는 설정 (이 저장소 밖)

마지막 고리는 호스트 설정이다. 켜지 않으면 `harness/`를 고친 변경도 승인 없이 합쳐질 수 있다.

1. 기본 브랜치 보호: `ci` 워크플로 통과 필수, 직접 push 금지.
2. "코드 소유자 승인 필수" 켜기, `.github/CODEOWNERS`의 `@terrarium-maintainers`를 실제 사용자나 팀으로 교체.
3. 워크플로 변경 권한은 같은 소유자에게만.
