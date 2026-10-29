---
title: HTTP API 계약
kind: spec
status: active
last_verified: 2026-10-29
covers:
  - packages/core/src/contract/routes.ts
  - packages/core/src/contract/errors.ts
covers_hash: 08ff421fa8c2d91d
verification_log:
  - "2026-10-29: first version, route table copied from ROUTES; errors checked"
  - "2026-10-29: errors.ts gained InvalidInputError/ForbiddenError/UnavailableError; routes.ts gained parsed types; table unchanged"
---
# HTTP API 계약 (core.contract)

## 한 문장으로

**서버와 웹이 같은 경로 표(`ROUTES`)와 같은 검증 규칙(zod)을 읽는다.** 경로나 필드 이름을 바꾸면 사용자가 버튼을 누를 때가 아니라
타입 검사에서 먼저 깨진다.

## 원칙

- **서버만 아는 것만 API로 준다.** 카탈로그, 툴 목록, 블록 팔레트, worldgen 필드처럼 코드에 정해진 지식은 웹이 core에서 직접 가져온다.
  API는 저장된 기록, 하네스·에이전트, 대기열처럼 서버에만 있는 것을 준다.
- **검증은 두 겹.** 계약의 스키마가 모양(타입·범위·크기)을 보고, 소유 단위의 검증기가 의미(부모가 있나, 시나리오가 끝까지 가나)를 본다.
  worldgen 명세는 worldgen의 규칙을 계약 안에서 바로 적용한다.
- **오류는 한 모양.** `{ error: { code, message, issues? } }`. `message`는 사람이 읽고 바로 고칠 수 있는 한국어,
  `issues`는 `{ path: "recipe.seeds.2", message }` 목록이라 폼이 해당 칸 옆에 띄울 수 있다. core의 오류는 자기 HTTP 상태를 가지고 있고,
  그 밖의 예외는 500으로 바꾸면서 내부 정보(파일 경로, DB 메시지)를 숨긴다.
- **저장은 낙관적 잠금.** 세계·시나리오 저장은 `baseDigest`(편집을 시작한 버전)를 함께 보낸다. 그사이 누가 바꿨으면 409와
  "새로고침한 뒤 다시 시도한다".
- **쿼리 문자열의 빈 값은 "안 줌"이다.** 숫자는 글자에서 읽는다.

## 경로

| 경로 | 하는 일 | |
|---|---|---|
| `GET /api/meta` | 누구인지, 하네스·소스·대기열 상태 | |
| `GET /api/worlds` | 세계 목록 | |
| `GET /api/worlds/:id` | 세계 하나 (blueprint 포함) | |
| `POST /api/worlds` | 빌더에서 지은 세계 저장 | |
| `POST /api/worlds/generate` | 사업장 프리셋으로 세계 생성 | |
| `POST /api/worlds/import` | 현실(KG 등)에서 읽기 전용으로 가져오기 | |
| `PUT /api/worlds/:id` | 세계 고쳐 저장 (버전 확인) | |
| `DELETE /api/worlds/:id` | 세계 숨기기 (실험이 쓴 버전은 남는다) | |
| `GET /api/scenarios` | 시나리오 목록 | |
| `GET /api/scenarios/:id` | 시나리오 하나 | |
| `POST /api/scenarios` | 새 시나리오 (빈 것, 템플릿, 문서) | |
| `PUT /api/scenarios/:id` | 시나리오 고쳐 저장 (버전 확인) | |
| `DELETE /api/scenarios/:id` | 시나리오 숨기기 | |
| `POST /api/scenarios/:id/dry-run` | 에이전트 없이 미리 돌려 보기 | |
| `GET /api/experiments` | 실험 목록 (최신순) | |
| `GET /api/experiments/:id` | 실험 하나: 실행, 분석, 계보 | |
| `POST /api/experiments` | 실험 만들고 대기열에 넣기 | |
| `POST /api/experiments/:id/cancel` | 남은 실행 취소 | |
| `POST /api/experiments/:id/fork` | 조건만 바꿔 다시 실행 | |
| `POST /api/experiments/:id/runs` | 같은 조건으로 실행 추가 | |
| `GET /api/experiments/:id/events` | 진행 상황 실시간 (SSE) | |
| `GET /api/experiments/:id/report` | 보고서 (HTML·Markdown·텍스트) | |
| `GET /api/experiments/:id/diagnoses` | 진단 기록 (JSON Lines) | |
| `POST /api/experiments/:id/shares` | 공유 링크 만들기 | |
| `DELETE /api/shares/:token` | 공유 링크 끊기 | |
| `GET /api/runs/:id` | 실행 하나: 결과, 분석, 타임라인 | |
| `GET /api/runs/:id/telemetry` | 하네스 트레이스·로그·메트릭 (ClickStack) | |
| `GET /api/leaderboards` | 벤치마크 세트별 순위 | |
| `GET /api/twin/diagnoses` | 모든 진단 기록 (JSON Lines) | |
| `GET /api/twin/brief` | 시뮬레이터 모델링 브리프 (Markdown) | |
| `GET /r/:token` | 공유된 보고서 (앱 없이 열림) | 공개 |

하네스가 실행 중에 툴을 부르는 MCP 엔드포인트(실행마다 하나)는 사람용 API가 아니라서 이 표에 없다. 서버의 `server.mcp`가 맡는다.
