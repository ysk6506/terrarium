---
title: ADR-0010 TypeScript 단일 언어 모노레포
kind: decision
status: active
enforced_by:
  - ARCH020
  - ARCH021
  - TCFG001
touches_protected: []
decision_hash: 2ffcbc022938498c
---
# ADR-0010 TypeScript 단일 언어 모노레포

## 맥락
요구사항에 3D 건설 UI, 드래그 앤 드롭 시나리오 편집기, 다중 사용자 실험 스케줄러, 하네스·ClickStack·FalkorDB·MCP 연동이 추가됐다.
처음에는 Python으로 하네스와 커널을 만들었다. UI가 어차피 TypeScript여서 두 언어를 쓰면 세계 모델과 시나리오 스키마를 두 번 정의하게 된다.

## 결정
- 모든 코드를 TypeScript(strict)로 쓴다. pnpm 워크스페이스: `packages/core`(순수, 브라우저·서버 공용), `apps/server`(Node 22), `apps/web`(React).
- core는 빌드 없이 TS 소스를 그대로 내보낸다. 서버는 tsx로, 웹은 Vite로 실행한다.
- 도구: Vitest(테스트·커버리지), Biome(린트·포맷), TypeScript 5.9 컴파일러 API(하네스 AST 검사), zod(경계 검증).
- 하네스를 TS로 이식하되 **규칙 코드는 그대로 유지**한다. ADR-0002~0009의 결정은 유효하고, 도구 이름만 다음처럼 대응한다:
  pytest → Vitest, `pyproject.toml`/`Makefile` → `package.json`·`vitest.config.ts`·pnpm 스크립트, `make check` → `pnpm check`,
  conftest 훅 → vitest 설정 옵션, Python AST → TypeScript AST, `__init__.py`의 `__all__` → 단위의 `index.ts`.
- 버전은 고정한다. TypeScript 7(Go 포트)은 컴파일러 JS API가 다르므로 하네스가 쓰는 5.9를 쓴다.

## 이유
- 화면과 서버가 같은 타입(세계 모델, 시나리오, 지원 기능 목록, API 계약)을 공유해서, 편집기가 서버와 똑같은 규칙으로 검증한다.
- 실험은 대부분 에이전트 응답을 기다리는 I/O 작업이라 Node 이벤트 루프가 맞고, 계산은 워커 스레드로 나눈다.
- MCP 공식 SDK, FalkorDB, ClickHouse, OpenTelemetry 모두 TS 클라이언트가 있다.
- 언어와 툴체인이 하나면 다음 에이전트가 배울 것이 적다.

## 버린 대안
- Python 백엔드 + TS 프론트엔드: 스키마 이중 정의, 하네스 두 벌.
- TypeScript 7 네이티브 컴파일러: 하네스가 쓰는 컴파일러 API가 안정적이지 않다.
