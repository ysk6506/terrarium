---
title: AGENTS.md — 에이전트 진입점
kind: guide
status: active
last_verified: 2026-11-12
covers:
  - package.json
  - harness/config/architecture.yaml
  - harness/config/protected-paths.txt
covers_hash: c6dcf01012a84766
verification_log:
  - "2026-11-12: 절대 규칙 표에 라이선스 행(LIC001, LIC002)을 더함. 명령과 보호 경로는 그대로 맞다 (ADR-0185)"
  - "2026-11-12: main 합침: 라이선스 행·링크(ADR-0185)와 내부 사실 줄(ADR-0187)이 함께 있다. 서로 어긋나지 않는다"
  - "2026-11-12: main을 합침: 라이선스 검사 줄(ADR-0185)과 main의 변경(ADR-0175, ADR-0187)이 함께 들어감"
  - "2026-11-12: main을 합침: 넓힌 목표 문장(ADR-0189)과 라이선스 검사 줄(ADR-0185)이 함께 들어감"
  - "2026-11-12: architecture.yaml의 바뀐 줄(tests.spec이 tests.e2e를 씀)은 이 문서의 의존 방향 규칙 줄과 어긋나지 않는다. CI 문단을 커버리지 조각 넷·풀 리퀘스트 자신의 차이·실패 증거 줄에 맞게 고쳤다 (ADR-0195)"
verified_body: 4a61205eabde7ae2
unchanged_reverifies: 0
---
# Terrarium — 코딩 에이전트 안내서

IT 인프라를 운영하는 AI 에이전트와 하네스를, 현실 장비를 건드리지 않고 정확하고 일관되게 평가하고, 평가를 통과한 일만 운영에 나가게 하는 사내 실험장. TypeScript 하나로 만든다. 이 파일은 **지도**다.

## 시작하기 (3분)

0. 제품 설계 한 장: [product-design.md](docs/design-docs/product-design.md) — 제품의 값, 원칙 여섯, 지금 유효한 결정, 순서. 설계와 구현 전에 먼저 읽는다.
1. 요구사항: [requirements.md](docs/product-specs/requirements.md) — 모든 요구사항은 `REQ-NNN`.
2. 구조: [ARCHITECTURE.md](ARCHITECTURE.md) — 단위와 의존 방향.
3. 문서 색인: [docs/index.md](docs/index.md)
4. 지금 하던 일: [진행 중 계획](docs/exec-plans/active/build-plan.md)

```
pnpm install
pnpm dev          # 서버(:8787) + 웹(:5173)
pnpm check        # lint + 타입 + 테스트 + 모든 구조 검사. 이게 통과해야 끝난 것.
```

CI가 합치기 관문이다 ([ADR-0140](docs/design-docs/adr/0140-ci-shards-and-merge-gate.md)): 전체 테스트는 CI가 조각 12개로 나눠 병렬로 돌리고(커버리지 없이), 게이트 작업이 모두 초록일 때만 main에 합친다. 커버리지는 게이트 조각 밖에서 네 조각으로 따로 재고 게이트가 아니다([ADR-0195](docs/design-docs/adr/0195-coverage-apart-failure-evidence-and-own-diff.md)). 문서(`*.md`)만 바꾼 풀 리퀘스트는 가벼운 경로를 타서 구조 검사와 문서를 읽는 시험만 돌린다. 다른 파일이 하나라도 있거나 main의 push면 전체 경로다. 문서만인지는 풀 리퀘스트 자신의 차이(base와 head의 합류점에서 head까지)로 가른다([ADR-0173](docs/design-docs/adr/0173-docs-only-changes-take-a-light-ci-path.md), ADR-0195). 로컬에서는 바뀐 코드의 관련 테스트만 돌린다.

실패 메시지는 `problem`과 `fix`를 알려준다. 메시지를 믿고 그대로 고친다.

## 절대 규칙 (기계가 강제함)

| 하지 말 것 | 강제 장치 |
|---|---|
| 테스트가 실패하는데 테스트를 고치기 | 테스트는 잠겨 있다 (`TLOCK*`). 코드를 고친다. 요구사항이 바뀐 게 확실할 때만 [ADR-0004](docs/design-docs/adr/0004-test-lock.md) 절차 |
| skip/only/삭제/약화, 커버리지 제외 | `TEST*`, `TCFG*`, `COV*` |
| 단위 의존 방향 위반, 다른 단위 내부 import | `ARCH010`, `ARCH011` |
| 선언 안 된 패키지 추가 | `ARCH020` — ADR + 계약 등록 |
| `harness/`, 설정 파일, ADR, 이 파일 수정 | 보호 경로 (`PROT001`) — 같은 변경에 봉인된 ADR 필요 |
| 검사 끄기 주석(`biome-ignore` 등)·건너뛴 테스트·CI `continue-on-error`를 이유와 근거 없이 두기, 그 수를 늘리기 | `IGN001`~`IGN007` — 같은 줄이나 윗줄에 이유와 `TD-NNNN`(열린 부채) 또는 `ADR-NNNN`을 적는다. 수는 늘 수 없다. 원인을 고치는 쪽이 먼저다 ([ADR-0148](docs/design-docs/adr/0148-no-silent-ignores-and-quality-grades.md)) |
| 품질 등급표를 손으로 고치기 | 등급표는 하네스가 만든다. 낡으면 알림 한 줄(`QUAL001`)만 나오고 빨강은 아니다. 정리 작업이 `pnpm quality write`로 새로 만든다 |
| 허용 목록 밖의 라이선스를 가진 의존성·자료를 함께 내보내기, 고지 파일을 손으로 고치기 | `LIC001`, `LIC002` — 의존성을 들이기 전에 라이선스를 본다. 고지 파일은 `pnpm tsx harness/src/checks/licenses.ts write`가 만든다 ([ADR-0185](docs/design-docs/adr/0185-third-party-notices-and-license-check.md)) |
| 추적 없는 `TODO` | `TODO(TD-NNNN)` + [부채 장부](docs/exec-plans/tech-debt.yaml) (`DEBT001`) |
| 내부에서 들은 사실(어느 조직이 무엇을 개발·검증했는지, 내부 시스템의 구조·규모·제조사, 조직과 절차)을 코드·문서·PR·이슈·커밋에 적기 | 저장소는 공개돼 있다. 기계가 못 가리니 쓰는 쪽이 지킨다. 요구로 바꿔 적는다 ([ADR-0187](docs/design-docs/adr/0187-no-internal-facts-in-the-public-repository.md)) |
| `Date.now()`, `Math.random()` 직접 사용 | `kernel`의 `Clock`/`Rng`를 주입받는다 (`ARCH052`) |
| 새 쪽·버튼·문서를 이끼에게 알리지 않기 | `MOSS001`~`MOSS004` — 라우트는 `apps/web/src/moss/registry.ts`에 칸을, 쪽의 버튼은 `data-moss-action`(또는 이유를 적은 `data-moss-skip`)을, 점수·지표 타일은 `MossAsk`를 (REQ-103) |
| 코드만 바꾸고 문서 방치 | 문서가 `covers`한 코드나 `follows`한 문서가 바뀌면 실패 (`DOC010`). 문서가 가리키는 길·명령·코드·숫자가 없으면 실패 (`DOC094`, `DOC095`). 결정이 바꾸는 문서를 같은 변경에서 안 고치면 실패 (`DOC090`) ([ADR-0180](docs/design-docs/adr/0180-docs-follow-decisions-not-only-code.md)) |

## 자주 하는 일

- **`DOC010`** → 문서를 코드와 대조해 고치고 `pnpm tsx harness/src/checks/docs.ts reverify <문서> --note "확인한 것"`.
- **새 테스트 추가** → 제목에 `[REQ-NNN]`을 넣고, 작성 후 `pnpm lock-tests` (새 항목만 추가됨).
- **새 결정** → [ADR 작성 절차](docs/design-docs/adr-process.md). `enforced_by`로 강제 장치에 연결하고, `updates_docs`에 바꾸는 문서를 적어 같은 변경에서 고친다. 앞선 결정의 일부를 바꾸면 `amends`를 적고 `docs.ts link-amends <ADR>`를 돌린다. 색인과 제품 설계 한 장의 표에는 줄을 더하지 않는다.
- **부채를 남겨야 함** → 장부에 항목 등록 후 `TODO(TD-NNNN)`. 기한과 예산이 있다.
- **커버리지를 올렸다** → `pnpm ratchet`으로 하한을 고정. 끄기를 없앴으면 `IGN006` 알림이 나오고 기준선은 정리 작업이 `pnpm ratchet`으로 내린다.
- **정리 작업(5시간마다)** → 첫 단계는 `pnpm quality write`로 [품질 등급표](docs/generated/quality.md)를 새로 만들고, 등급이 가장 낮은 단위부터 고른다. 한 줄의 "이유" 칸이 무엇을 고치면 등급이 오르는지 알려 준다. 고친 뒤 `pnpm ratchet`으로 끄기 기준선을 내리고 등급표를 다시 만들어 올린다. 일반 변경은 등급표를 건드리지 않아도 된다(변경마다의 등급은 CI 요약에 나온다). 웹 화면이 바뀌었으면 `pnpm ux`로 `ux-score.json`을 새로 재서 올리고, 오른 점수는 `pnpm ux ratchet`으로 하한에 반영한다(ADR-0175). 이어서 `pnpm tsx harness/src/checks/docs.ts decisions`로 [결정 목록](docs/generated/decisions.md)을 새로 만든다. 그다음 `pnpm tsx harness/src/checks/docs.ts audit-queue`의 앞 셋을 골라, 각 문서를 그것이 `covers`·`follows`하는 코드와 결정에 대어 독립된 눈으로 읽는다. 틀린 곳은 고치고, 맞으면 `docs.ts audit <문서> --note "한 줄로 본 것"`으로 `last_audited`를 남긴다.
- **웹 화면을 바꿨다** → 여정은 CI의 `ux-journeys`(게이트)가 돌린다. 측정은 CI의 `ux-measure`(게이트 아님)가 조각으로 나눠 돌리고, 이 변경의 점수는 그 작업 요약에 나온다. `ux-score.json`은 변경마다 커밋하지 않는다: 낡으면 알림 한 줄(`UX004`)만 나오고, 정리 작업이 main에서 새로 재서 올린다(`pnpm ux`로 로컬에서 재도 된다). 여정 단계가 실패하면 작업 로그에 `evidence:` 줄(주소, 화면 글, 마지막 API 요청 20개, 콘솔 오류)이 찍히고 스크린샷은 `ux-evidence-*` 아티팩트로 올라간다(ADR-0195). 읽는 법은 [UX 측정](docs/design-docs/ux-honeycomb.md) ([ADR-0175](docs/design-docs/adr/0175-ux-checks-in-smaller-slices-score-file-not-per-change.md)).

## 철학

- 사람이 중간에 개입하지 않는다. 판단이 필요하면 ADR에 이유와 함께 남기고 진행한다.
- 저장소에 없는 지식은 존재하지 않는다.
- 경계는 엄격히, 경계 안의 구현은 자유롭게.
