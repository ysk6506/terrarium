---
title: 품질 하네스 사용법
kind: guide
status: active
last_verified: 2026-11-11
covers:
  - harness/src/run-all.ts
covers_hash: 4b59b7b947e93828
verification_log:
  - "2026-11-10: run-all이 예정 요구를 따로 출력하게 된 것을 반영 (ADR-0140)"
  - "2026-11-11: 2026-11-11: UX 검사를 여정(게이트)과 측정(게이트 아님)으로 나눔, REQ-114 (ADR-0141)"
  - "2026-11-11: 검사 끄기 금지(IGN*)와 품질 등급표(QUAL*) 두 검사, pnpm quality write와 ratchet의 끄기 기준선을 적었다 (ADR-0148)"
  - "2026-11-11: 품질 등급표는 낡으면 알림만, 끄기 감소도 알림만 나오는 것으로 고쳐 적었다 (ADR-0148)"
  - "2026-11-11: decisions, link-amends, audit-queue 명령을 명령 목록에 더함 (ADR-0180)"
verified_body: da92eed094149b72
unchanged_reverifies: 0
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
| 요구사항 추적 (`**예정(ADR-NNNN)**` 요구는 따로 나열) | `harness/src/checks/traceability.ts` | `TRACE*` | ADR-0004, ADR-0140 |
| 검사 끄기 금지 (끄기 주석·건너뛴 시험·CI `continue-on-error`는 이유와 `TD-NNNN`/`ADR-NNNN`이 있어야 하고 수는 늘 수 없다) | `harness/src/checks/ignores.ts` | `IGN*` | ADR-0148 |
| 품질 등급표 (단위별 등급 A~D, 하네스가 만드는 생성물이다. 만들 수 없으면 실패하고, 낡았으면 알림 한 줄) | `harness/src/checks/quality.ts` | `QUAL*` | ADR-0148 |
| 가드레일 보호 | `harness/src/checks/protected.ts` | `PROT*` | ADR-0005 |
| UX Honeycomb (여정은 CI 게이트 `ux-journeys`, 측정은 게이트 아닌 `ux-measure`) | `harness/src/ux/` | `UX*` | [UX 측정](ux-honeycomb.md), ADR-0141 |

## 명령

- `pnpm check` — 전부 실행. 끝나기 전에 반드시 통과.
- `pnpm check:pr` — 기준 브랜치(origin/main)와 비교 포함 (CI와 동일).
- `pnpm ratchet` — 커버리지를 올렸을 때 하한을 올리고, 고친 부채 기준선 항목을 지우고, 줄어든 끄기 수의 기준선을 낮춘다(줄면 `IGN006` 알림만 나온다).
- `pnpm quality write` — 품질 등급표(`docs/generated/quality.md`)를 새로 만든다(정리 작업의 첫 단계). 손으로 고치지 않는다. 커버리지 값은 CI가 찍는 기록을 읽는다(`pnpm tsx harness/src/checks/quality.ts record`).
- `pnpm tsx harness/src/checks/docs.ts decisions` — [결정 목록](../generated/decisions.md)을 ADR 앞부분에서 새로 만든다(정리 작업의 둘째 단계, ADR-0180). 낡으면 `DOC098` 알림만 나온다.
- `pnpm tsx harness/src/checks/docs.ts link-amends <ADR>` — 새 ADR의 `amends`가 가리키는 ADR에 `amended_by`를 남긴다 (`DOC091`).
- `pnpm tsx harness/src/checks/docs.ts audit-queue` — 본문이 그대로인 채 다시 확인만 된 문서를 오래 감사 못 받은 순으로 보여 준다. 읽은 뒤 `docs.ts audit <문서> --note "한 줄"`로 `last_audited`를 남긴다 (정리 작업의 셋째 단계).
- `pnpm lock-tests` — 새 테스트를 잠금 파일에 추가한다. 기존 항목은 바꾸지 않는다.

## 저장소 호스트에서 켜야 하는 설정 (저장소 밖)

1. 기본 브랜치 보호: `ci` 워크플로 통과 필수, 직접 push 금지.
2. "코드 소유자 승인 필수"를 켜고 `.github/CODEOWNERS`의 `@terrarium-maintainers`를 실제 사용자나 팀으로 바꾼다.

CI는 이 검사들을 `structure` 작업으로 따로 돌리고, 테스트는 조각으로 나눠 병렬로 돌린다. 조각 합계 검사는 `harness/src/ci/shard-sum.ts` ([ADR-0140](adr/0140-ci-shards-and-merge-gate.md)).
