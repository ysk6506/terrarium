---
title: AGENTS.md — 에이전트 진입점
kind: guide
status: active
last_verified: 2026-11-11
covers:
  - package.json
  - harness/config/architecture.yaml
  - harness/config/protected-paths.txt
covers_hash: 5bd9f8d3b3a3248d
verification_log:
  - "2026-11-06: 세계 인기·좋아요·칭호·계급 모델 (REQ-101, ADR-0122)"
  - "2026-11-07: REQ-103 이끼 추가 뒤 다시 읽음: 이끼 버튼 속성과 새 모듈 외에 이 문서의 서술과 어긋난 곳 없음"
  - "2026-11-10: 단위 표 변화 없음, physics.slots 단위 추가를 확인"
  - "2026-11-10: CI가 합치기 관문이 되었다는 한 줄을 더함 (ADR-0140). 명령 목록과 보호 경로 표는 그대로 맞다"
  - "2026-11-11: 검사 끄기 금지(IGN*)·품질 등급표(QUAL001) 행과 정리 작업 안내를 더했다. package.json은 quality 스크립트와 ratchet만 바뀌었다 (ADR-0148)"
---
# Terrarium — 코딩 에이전트 안내서

사내 Agent/Harness 평가용 스테이트풀 IT 인프라 시뮬레이터이자 실험 플랫폼. TypeScript 하나로 만든다. 이 파일은 **지도**다.

## 시작하기 (3분)

1. 요구사항: [requirements.md](docs/product-specs/requirements.md) — 모든 요구사항은 `REQ-NNN`.
2. 구조: [ARCHITECTURE.md](ARCHITECTURE.md) — 단위와 의존 방향.
3. 문서 색인: [docs/index.md](docs/index.md)
4. 지금 하던 일: [진행 중 계획](docs/exec-plans/active/build-plan.md)

```
pnpm install
pnpm dev          # 서버(:8787) + 웹(:5173)
pnpm check        # lint + 타입 + 테스트 + 모든 구조 검사. 이게 통과해야 끝난 것.
```

CI가 합치기 관문이다 ([ADR-0140](docs/design-docs/adr/0140-ci-shards-and-merge-gate.md)): 전체 테스트는 CI가 조각 12개로 나눠 병렬로 돌리고(커버리지 없이), 게이트 작업이 모두 초록일 때만 main에 합친다. 로컬에서는 바뀐 코드의 관련 테스트만 돌린다.

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
| 품질 등급표를 손으로 고치기, 낡게 두기 | `QUAL001` — 등급표는 하네스가 만든다. `pnpm quality write`로 다시 만들어 올린다 |
| 추적 없는 `TODO` | `TODO(TD-NNNN)` + [부채 장부](docs/exec-plans/tech-debt.yaml) (`DEBT001`) |
| `Date.now()`, `Math.random()` 직접 사용 | `kernel`의 `Clock`/`Rng`를 주입받는다 (`ARCH052`) |
| 새 쪽·버튼·문서를 이끼에게 알리지 않기 | `MOSS001`~`MOSS004` — 라우트는 `apps/web/src/moss/registry.ts`에 칸을, 쪽의 버튼은 `data-moss-action`(또는 이유를 적은 `data-moss-skip`)을, 점수·지표 타일은 `MossAsk`를 (REQ-103) |
| 코드만 바꾸고 문서 방치 | 문서가 `covers`한 코드가 바뀌면 실패 (`DOC010`) |

## 자주 하는 일

- **`DOC010`** → 문서를 코드와 대조해 고치고 `pnpm tsx harness/src/checks/docs.ts reverify <문서> --note "확인한 것"`.
- **새 테스트 추가** → 제목에 `[REQ-NNN]`을 넣고, 작성 후 `pnpm lock-tests` (새 항목만 추가됨).
- **새 결정** → [ADR 작성 절차](docs/design-docs/adr-process.md). `enforced_by`로 강제 장치에 연결한다.
- **부채를 남겨야 함** → 장부에 항목 등록 후 `TODO(TD-NNNN)`. 기한과 예산이 있다.
- **커버리지를 올렸다** → `pnpm ratchet`으로 하한을 고정. 끄기를 없앴을 때도 `pnpm ratchet`(`IGN006`).
- **정리 작업(5시간마다)** → [품질 등급표](docs/generated/quality.md)를 읽고 등급이 가장 낮은 단위부터 시작한다. 한 줄의 "이유" 칸이 무엇을 고치면 등급이 오르는지 알려 준다. 고친 뒤 `pnpm quality write`.
- **웹 화면을 바꿨다** → 여정은 CI의 `ux-journeys`(게이트)가 돌린다. 측정은 CI의 `ux-measure`(게이트 아님)가 돌리니 그 `ux-score.json`(아티팩트 또는 작업 로그)을 마지막 커밋으로 올린다(`pnpm ux`로 로컬에서 재도 된다. 낡으면 `UX004`). 점수가 올랐으면 `pnpm ux ratchet`으로 하한을 고정한다. 읽는 법은 [UX 측정](docs/design-docs/ux-honeycomb.md).

## 철학

- 사람이 중간에 개입하지 않는다. 판단이 필요하면 ADR에 이유와 함께 남기고 진행한다.
- 저장소에 없는 지식은 존재하지 않는다.
- 경계는 엄격히, 경계 안의 구현은 자유롭게.
