---
title: 품질 하네스 사용법
kind: guide
status: active
covers:
  - harness/src/run-all.ts
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
| 제3자 라이선스 (함께 나가는 npm 패키지와 자료는 허용 목록 안의 라이선스여야 한다. `THIRD_PARTY_NOTICES.md`는 하네스가 만들고, 낡으면 알림 한 줄) | `harness/src/checks/licenses.ts` | `LIC*` | ADR-0185 |
| 가드레일 보호 | `harness/src/checks/protected.ts` | `PROT*` | ADR-0005 |
| UX Honeycomb (여정은 CI 게이트 `ux-journeys`, 측정은 게이트 아닌 `ux-measure`) | `harness/src/ux/` | `UX*` | [UX 측정](ux-honeycomb.md), ADR-0141 |

## 명령

- `pnpm check` — 전부 실행. 끝나기 전에 반드시 통과.
- `pnpm check:pr` — 기준 브랜치(origin/main)와 비교 포함 (CI와 동일).
- `pnpm ratchet` — 커버리지를 올렸을 때 하한을 올리고, 고친 부채 기준선 항목을 지우고, 줄어든 끄기 수의 기준선을 낮춘다(줄면 `IGN006` 알림만 나온다).
- `pnpm tsx harness/src/run-all.ts --timing` — 검사마다 걸린 시간을 보여 준다. 구조 검사 전체는 이 컴퓨터에서 10초 안쪽이어야 하고, 문서 검사는 파일마다 지문을 한 번만 뜨고(`doc-targets.ts`) 확인 기록을 한 번만 읽는다(ADR-0194).
- `pnpm tsx harness/src/run-all.ts --timing` — 검사마다 걸린 시간을 `TIME` 줄로 보여 준다. 문서 검사는 파일마다 지문을 한 번만 뜨고(`doc-targets.ts`) 확인 기록을 한 번만 읽어서 1~2초 안쪽이어야 한다 (ADR-0194).
- `pnpm quality write` — 품질 등급표(`docs/generated/quality.md`)를 새로 만든다(정리 작업의 첫 단계). 손으로 고치지 않는다. 커버리지 값은 CI가 찍는 기록을 읽는다(`pnpm tsx harness/src/checks/quality.ts record`).
- `pnpm tsx harness/src/checks/docs.ts decisions` — [결정 목록](../generated/decisions.md)을 ADR 앞부분에서 새로 만든다(ADR-0180). 낡으면 `DOC098` 알림만 나온다.
- `pnpm tsx harness/src/checks/docs.ts generate` — 결정 목록과 [색인](../index.md)의 문서 목록(문서 `title`에서 만든다)을 한 번에 새로 만든다(정리 작업의 둘째 단계, ADR-0194). 변경은 이 파일들을 커밋하지 않는다: 낡으면 `DOC098`·`DOC102` 알림만 나오고, 손으로 고치면 `DOC099`로 실패한다.
- `pnpm tsx harness/src/checks/docs.ts reverify <문서> --note "…"` — 문서가 낡은 대상 모두에 `docs/verified/` 기록을 쓴다. `--target <경로>`는 한 대상만 쓴다. 확인 상태는 문서 앞부분이 아니라 (문서, 대상) 기록 파일에 있어서, 서로 다른 대상을 다시 확인한 두 변경은 충돌하지 않는다 (`DOC010`, `DOC011`, ADR-0194).
- `pnpm tsx harness/src/checks/docs.ts migrate` — 옛 형식의 문서(앞부분에 `last_verified`, `covers_hash` 등)를 기록으로 옮기고 앞부분에서 그 키를 지운다. 여러 번 돌려도 같다. 옛 형식이 남으면 `DOC100`이 이 명령을 알려 준다.
- `pnpm tsx harness/src/checks/docs.ts link-amends <ADR>` — 새 ADR의 `amends`가 가리키는 ADR에 `amended_by`를 남긴다 (`DOC091`).
- `pnpm tsx harness/src/checks/docs.ts audit-queue` — 본문이 그대로인 채 다시 확인만 된 기록(`text_changed: false`)이 마지막 감사보다 새로운 문서를 오래 감사 못 받은 순으로 보여 준다. 읽은 뒤 `docs.ts audit <문서> --note "한 줄"`로 감사 날짜를 남긴다 (정리 작업의 셋째 단계).
- `pnpm tsx harness/src/checks/licenses.ts write` — 제3자 고지 파일(`THIRD_PARTY_NOTICES.md`)을 설치된 의존성과 `harness/config/third-party-assets.yaml`에서 새로 만든다. 손으로 고치지 않는다. 낡으면 `LIC003` 알림만 나오고, 정리 작업이 다시 만든다. 허용 목록 밖의 라이선스는 `LIC001`, 정할 수 없는 라이선스는 `LIC002`, 자료 목록이 깨지면 `LIC004`로 실패한다 (ADR-0185).
- `pnpm lock-tests` — 새 테스트를 잠금 파일에 추가한다. 기존 항목은 바꾸지 않는다.

## 저장소 호스트에서 켜야 하는 설정 (저장소 밖)

1. 기본 브랜치 보호: `ci` 워크플로 통과 필수, 직접 push 금지.
2. "코드 소유자 승인 필수"를 켜고 `.github/CODEOWNERS`의 `@terrarium-maintainers`를 실제 사용자나 팀으로 바꾼다.

CI는 이 검사들을 `structure` 작업으로 따로 돌리고, 테스트는 조각 12개로 나눠 병렬로 돌린다(커버리지 없이). 조각 합계 검사는 `harness/src/ci/shard-sum.ts` ([ADR-0140](adr/0140-ci-shards-and-merge-gate.md)). 커버리지는 게이트 조각이 함께 재지 않는다: 계측하면 가장 느린 조각이 두 배 넘게 느려지고 시험 몇 건이 시간 제한을 넘기 때문이다. 그래서 `coverage` 작업 넷이 열두 조각을 셋씩 차례로 계측해 블롭을 올리고, `coverage-floors`가 합쳐 단위별 하한을 본다. 둘 다 게이트가 아니고, 시험 조각이 모두 끝난 뒤에 시작해 게이트 작업이 러너를 먼저 받게 한다 ([ADR-0195](adr/0195-coverage-apart-failure-evidence-and-own-diff.md)). 문서(`*.md`)만 바뀐 풀 리퀘스트는 `changes` 작업이 풀 리퀘스트 자신의 차이(base와 head의 합류점에서 head까지)로 가려 가벼운 경로를 탄다: 테스트 조각·커버리지·UX 작업은 건너뛰고 `structure`와 문서를 읽는 시험(`docs-tests`)만 돌며, `gate`가 어느 경로를 탔는지와 작업별 기대 결과를 비교한다 ([ADR-0173](adr/0173-docs-only-changes-take-a-light-ci-path.md)). UX 여정 단계가 실패하면 그 실패의 증거를 남긴다: 작업 로그에 `evidence:` 줄, 스크린샷은 `ux-evidence-*` 아티팩트(올리기가 실패해도 작업은 실패하지 않는다). 코드는 `tests/e2e/ux/evidence.ts`, 시험은 `tests/spec/ux-evidence.test.ts`다.
