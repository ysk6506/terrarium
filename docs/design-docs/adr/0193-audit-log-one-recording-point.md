---
title: ADR-0193 감사 기록 — 덧붙이기만 하고, 기록하는 곳은 하나이고, 못 쓰면 바꾸는 일을 하지 않는다
kind: decision
status: active
last_verified: 2026-11-12
enforced_by:
  - packages/core/src/contract/audit-classes.test.ts
  - apps/server/src/http/audit-changes.test.ts
  - apps/server/src/http/audit-refusals.test.ts
  - apps/server/src/http/audit-secrets.test.ts
  - apps/server/src/http/audit-read.test.ts
  - apps/server/src/http/audit-failure.test.ts
  - apps/server/src/runtime/audit.test.ts
  - apps/server/src/adapters/sqlite-audit.test.ts
touches_protected: []
amends_tests: []
updates_docs:
  - docs/design-docs/permissions.md
  - docs/design-docs/http-api.md
  - docs/design-docs/operations.md
decision_hash: dc517d432f850d69
---
# ADR-0193 감사 기록

## 맥락

[ADR-0174](0174-permissions-proxy-identity-three-scopes-audit.md)는 권한을 만드는 순서를 가·나·다·라·마로 정했고, 가(신원·판정 한 곳)와 나(공개 범위)는 만들어졌어요. 다는 감사 기록이에요. 초대한 사용자가 둘 이상이 되면 "누가 무엇을 했나"와 "누가 무엇을 하려다 막혔나"에 답할 수 있어야 해요. 또 앞으로 워크플로의 건과 승인도 같은 기록에 남아야 해서(워크플로 자동화 13절), 사람만 있는 모양으로 굳히면 안 돼요.

이 변경은 요구를 정한 제품 책임자의 결정을 그대로 따라요. 아래 "결정"의 앞 열한 가지가 그 결정이고, 뒤의 "이 변경에서 고른 것"이 구현이 고른 이름과 자리예요.

## 결정

1. **덧붙이기만 해요.** 고치거나 지우는 길이 없어요. 관리자도 못 해요. 보관 기간은 설정(`audit.retentionDays`, 기본 365, 0이면 영구)이고, 하나의 배경 정리가 그보다 오래된 기록을 지우며 정리했다는 기록을 남겨요.
2. **한 기록**은 시각(주입한 시계), 누가(로그인 ID, 그때의 이름, 신원 출처, 관리자 여부), 무엇을(닫힌 목록의 일), 무엇에(종류와 ID, 그때의 주인·범위), 결과(`allowed`·`denied`·`failed`)와 닫힌 목록의 까닭, 요청 ID, 범위·역할·공유가 바뀌면 그 칸들의 앞과 뒤예요.
3. **적는 것**: 바꾸는 길 전부, 어느 길에서든 막힌 시도(401·403·"볼 수 없어서 404"를 구별), 관리자가 남의 "나만"·"우리 파트"를 읽은 일, 프록시 로그인 실패(주소와 함께), 감사 기록 자체를 보거나 내려받은 일.
4. **적지 않는 것**: 비밀 값, 토큰, 프록시 비밀 값, 요청 본문, 세계·시나리오·실행·행의 내용. 칸의 이름은 적을 수 있고 값은 범위·그룹·역할·주인·공유 칸만 적어요. 시험이 모든 길의 입력에 비밀 값을 심고 기록에 없는지 봐요.
5. **기록하는 곳은 하나이고** 길마다 `records: change | read-override | none` 분류가 있어야 해요. `none`은 이유를 적어요. 없으면 시험이 실패해요. 막힘은 판정이 난 자리에서 적어 두고 기록해요.
6. **쓰기가 안 되면** 바꾸는 요청은 실패로 닫혀요(쉬운 한국어로 알려요). 읽기는 답하고 실패를 지표로 세고 로그에 남겨요.
7. **읽기**: 관리자는 목록(시간 범위, 누가, 일, 종류와 ID, 결과로 거르기, 새것부터, 커서 쪽 나눔)과 JSON Lines 파일. 다른 사람은 자기가 만든 것에 있던 일을 누가·언제·무엇을·어떻게 끝났나로만 봐요. 정책 표에 둘 다 있어요.
8. **워크플로를 위한 모양**: 주체는 사람이나 에이전트(나 서버 자신), 선택 칸으로 대신한 사람(`onBehalfOf`)과 건(`caseId`), 대상 종류는 등록부로 검증하는 열린 말이에요.
9. **저장**은 메모리와 SQLite예요. SQLite는 새 표, 스키마 4판, 3판 파일을 여는 시험, 시각·주체·대상 색인이 있어요. 표는 기록자만 써요.
10. **관찰**: 행동과 결과별 개수 하나와 쓰기 실패 개수 하나. 로그에는 행동 이름과 결과만 나가요.
11. **화면은 이 단계에 없어요.** API가 말 열쇠(`labelKey`)와 그때의 대상 이름을 줘요.

## 이 변경에서 고른 것

- **기록자의 자리.** 기록자(`Auditor`)는 `server.runtime`에 있고 `AuditStore`(`core.experiments`의 항구)만 받아요. 실험 쪽 `ExperimentStore`는 감사 항구를 가지지 않아서 실험 코드가 쓸 수 없어요. 요청마다 `AsyncLocalStorage`의 메모(`runtime/audit-context.ts`)에 판정(`may`·`allow`·`mustSee`)과 범위 바꾸기가 막힘·찾은 것·앞뒤를 적어 두고, 모든 길이 지나는 앱의 등록 함수(`http/app.ts`의 `handle`, `http/audit-http.ts`의 `AuditedCall`)가 요청이 끝날 때 한 번 써요. 핸들러에는 감사 코드가 없어요.
- **분류 표**는 계약에 있어요(`core.contract`의 `AUDIT_CLASSES`). `satisfies Record<RouteName, RouteAudit>`라서 길을 더하고 줄을 안 더하면 컴파일이 안 되고, 시험이 또 보아요. `change`는 성공하면 늘 `allowed` 하나를 써요. GET이 아닌 `change` 길만 닫혀서 실패해요(감사 기록 읽기는 GET이라 열려요). `read-override`는 관리자가 역할만으로 본 남의 것에만 써요. 여러 실험을 합쳐 읽어서 한 사람의 것을 가릴 수 없는 길 셋(`twinDiagnoses`, `twinBrief`, `listEscalations`)은 이유를 적은 `none`이에요(알려진 한계).
- **행동의 말**은 `종류.일`(`world.create`, `scope.change`, `model.set_default` …)이고 닫힌 목록(`AUDIT_ACTIONS`)이에요. 로그인 실패는 `auth.sign_in`, 길을 알 수 없는 막힘은 `access.denied`, 관리자가 남의 것을 연 일은 `….read`예요. 기록자는 목록 밖의 말을 던져서 거절해요.
- **까닭의 말**: 막힘은 `unauthenticated`, `proxy_secret_missing`, `proxy_secret_wrong`, `proxy_login_missing`, `not_admin`, `not_owner`, `not_allowed`, `not_visible`. 실패는 `invalid_input`, `not_found`, `conflict`, `unavailable`, `error`. 로그인 실패의 세 가지 까닭은 기록에만 구별되고 호출한 사람에게는 같은 401이에요.
- **ID는 확인된 것만.** 주소의 ID는 조회가 있다고 확인된 뒤에만 기록에 들어가요. 확인 전의 막힘(로그인, 관리자 전용 정책)은 ID가 없어요. 그래서 없는 ID나 토큰이 기록으로 새지 않아요.
- **쓰기가 안 될 때의 구현.** 바꾸는 요청은 하기 전에 `ready()`로 쓸 수 있는지 물어요(SQLite는 `BEGIN IMMEDIATE`를 잡았다 놓아요). 안 되면 하지 않고 503. 확인한 뒤 쓰는 사이에 깨지면 일은 끝났으므로 503과 함께 "일은 끝났지만 감사 기록을 남기지 못했어요"라고 말하고 센다. 이 틈은 같은 트랜잭션으로 닫을 수 없어서(일의 저장소와 감사 저장소가 다른 항구예요) 남겨 두고 문서에 적어요.
- **길**: `GET /api/audit`(관리자), `GET /api/audit/export`(관리자), `GET /api/audit/mine`(로그인한 누구나). 쪽 나눔은 번호 하나를 `cursor`로 돌려주는 방식이에요.
- **요청 ID**는 Fastify의 `genReqId`로 만들고 응답의 `x-request-id`로도 줘요.
- **SQLite**: 같은 파일의 `audit_log` 표와 색인 넷은 `adapters/sqlite-audit.ts`에 있어요(`sqlite-store.ts`가 500줄 한도에 가까워서 나눴어요). 열 때 `CREATE … IF NOT EXISTS`로 3판 파일에 표를 더하고 `user_version`을 4로 올려요.
- **지표**: `terrarium_audit_entries_total{action,outcome}`와 `terrarium_audit_write_failures_total`을 기존 `/metrics` 끝에 붙여요. 라벨은 닫힌 목록의 말뿐이라 사람이 쓴 글이 들어갈 수 없어요.

## 이유

- 길마다 핸들러에 적게 하면 잊혀요. 길 표와 한 등록 함수가 있으면 새 길이 분류 없이 들어올 수 없어요.
- 판정이 막힘을 적어 두면 "어느 막힘이었나"가 기록에 정확히 남아요(상태 코드만 보고는 "볼 수 없어서 404"와 진짜 404를 못 가려요).
- 값을 닫힌 칸에만 두면 비밀 값이 들어갈 자리가 없어요. 걸러 내는 규칙보다 자리가 없는 쪽이 안전해요.
- 쓸 수 없을 때 읽기까지 막으면 서비스가 멈추고, 바꾸는 일까지 열어 두면 기록 없는 변경이 생겨요. 둘을 나누는 것이 가장 덜 나빠요.

## 대안과 버린 이유

- **핸들러마다 `audit.record(...)`**: 하나만 빠져도 모르고, 시험이 길마다 따로 있어야 해요.
- **`ExperimentStore`에 감사 메서드를 더하기**: 실험 코드가 기록을 쓸 수 있게 되고, 파일이 한도를 넘어요.
- **일과 기록을 한 트랜잭션으로**: 저장소가 둘로 나뉜 구조라 못 해요. 대신 먼저 확인하고 틈을 문서로 말해요.
- **읽기도 기록이 안 되면 막기**: 기록 장애가 서비스 장애가 돼요.
- **막힘의 까닭을 호출한 사람에게도 알리기**: 로그인 실패의 까닭을 알리면 비밀 값이 맞는지 알려 주는 셈이에요.

## 결과

- 알려진 한계(권한 문서 9절 참고): 합쳐 읽는 길 셋은 관리자의 남의 것 읽기를 기록하지 않아요. 로그인 실패 기록은 빈도를 제한하지 않아요. `/metrics`는 클러스터 토큰이 있을 때만 열려요. 확인과 쓰기 사이의 틈. `GET /api/audit/mine`은 일과 결과 외에 대상의 종류·ID·이름을 줘요.
- 라 단계(화면)는 `labelKey`와 `label`, `reasonLabel`을 그대로 쓰면 돼요.
- 워크플로의 건과 승인은 종류를 등록부에 더하고 같은 기록자를 써요.
