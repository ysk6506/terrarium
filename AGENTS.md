---
title: AGENTS.md — 에이전트 진입점
kind: guide
status: active
last_verified: 2026-10-28
covers:
- Makefile
- harness/config/architecture.yaml
- harness/config/protected-paths.txt
covers_hash: 1d2f10e6d368e911
verification_log:
- '2026-10-28: initial'
---
# Terrarium — 코딩 에이전트 안내서

사내 Agent/Harness 평가용 스테이트풀 IT 인프라 시뮬레이터. 이 파일은 **지도**다. 자세한 내용은 링크를 따라간다.

## 시작하기 (3분)

1. 요구사항: [requirements.md](docs/product-specs/requirements.md) — 모든 요구사항은 `REQ-NNN`.
2. 구조: [ARCHITECTURE.md](ARCHITECTURE.md) — 레이어와 의존 방향.
3. 문서 색인: [docs/index.md](docs/index.md)
4. 지금 하던 일: [docs/exec-plans/active/](docs/exec-plans/active/) 의 계획 문서.

## 끝내기 전에 반드시

```
make check        # lint + 타입 + 테스트 + 모든 구조 검사. 이게 통과해야 끝난 것.
```

실패 메시지는 `problem`과 `fix`를 알려준다. 메시지를 믿고 그대로 고친다.

## 절대 규칙 (기계가 강제함)

| 하지 말 것 | 이유 / 강제 장치 |
|---|---|
| 테스트가 실패하는데 테스트를 고치기 | 테스트는 잠겨 있다 (`TLOCK*`). 코드를 고친다. 요구사항이 바뀐 게 확실할 때만 [ADR-0004](docs/design-docs/adr/0004-test-lock.md) 절차 |
| 테스트 skip/삭제/약화, 커버리지 제외 | `TEST*`, `TCFG*`, `COV*` |
| 레이어 의존 방향 위반, 다른 레이어 내부 import | `ARCH010`, `ARCH011` |
| `harness/`, 설정, ADR, 이 파일 수정 | 보호 경로 (`PROT001`) — 새 ADR이 같은 변경에 있어야 한다 |
| 추적 없는 `TODO` | `TODO(TD-NNNN)` 형식 + [부채 장부](docs/exec-plans/tech-debt.yaml) (`DEBT001`) |
| 시계/난수를 직접 사용 | `kernel`의 Clock/Rng를 주입받는다 (`ARCH052`) |
| 코드만 바꾸고 문서 방치 | 문서가 `covers`한 코드가 바뀌면 낡은 문서로 실패 (`DOC010`) |

## 자주 하는 일

- **코드를 바꿨는데 `DOC010`** → 해당 문서를 코드와 대조해 고치고
  `python -m harness.checks.docs reverify <문서> --note "무엇을 확인/수정했는지"`.
- **새 테스트 추가** → 작성 후 `python -m harness.checks.testguard lock` (새 항목만 추가됨).
- **새 결정이 필요** → [ADR 작성법](docs/design-docs/adr-process.md). 결정은 `enforced_by`로 강제 장치에 연결한다.
- **부채를 남겨야 함** → 장부에 항목 등록 후 `TODO(TD-NNNN)`. 기한과 예산이 있다.
- **커버리지를 올렸다** → `make ratchet`으로 하한을 올려 고정.

## 이 프로젝트의 철학

- 사람이 중간에 개입하지 않는다. 판단이 필요하면 ADR에 이유와 함께 남기고 진행한다.
- 저장소에 없는 지식은 존재하지 않는다. 결정은 반드시 문서(ADR)로.
- 경계는 엄격히, 경계 안의 구현은 자유롭게.
