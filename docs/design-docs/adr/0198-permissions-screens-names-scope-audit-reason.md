---
title: ADR-0198 권한 화면 — 이름으로 보이고, 범위는 한 가지만 묻고, 남의 것을 고칠 때는 이유를 적고, 감사 기록은 Astryx로 시험해 그린다
kind: decision
status: active
enforced_by:
  - apps/web/src/logic/scope.test.ts
  - apps/web/src/logic/audit-screen.test.ts
  - apps/web/src/logic/agent-versions.test.ts
  - apps/server/src/http/audit-reason.test.ts
updates_docs:
  - docs/design-docs/permissions.md
  - docs/design-docs/http-api.md
touches_protected:
  - apps/web/package.json
  - harness/config/architecture.yaml
amends_tests:
  - apps/web/src/logic/agent-versions.test.ts::a version history reads in words [REQ-053] > versions are changed by the one who connected it, or by anyone when the server's file did
test_change_reason: 설정 파일의 연결은 이제 관리자만 버전을 고치고(permissions.md 4절), 관리자는 남이 만든 연결도 고치므로 canEditVersions가 관리자 여부를 받고 기대값이 바뀐다. 예전 기대값은 설정 파일의 연결을 누구나 고치게 했다.
decision_hash: 8ef29f2433491b33
---
# ADR-0198 권한 화면

## 맥락

[ADR-0174](0174-permissions-proxy-identity-three-scopes-audit.md)의 순서에서 가(신원)·나(범위)·다([감사 기록](0193-audit-log-one-recording-point.md))는 서버에 있고, 라는 화면이에요. 서버는 응답마다 `scope`, `group`, `canChangeScope`(연결·모델은 `sharing`)를 이미 주고, 범위 바꾸기 길은 하나(`PUT …/:id/scope`)예요. 화면만 없어서 사용자가 범위를 정하지도, 막힌 까닭을 알지도 못해요. 워크플로 자동화는 [ADR-0192](0192-terrarium-returns-to-its-first-goal.md)가 없앴으므로 이 화면들에 그 자리를 두지 않아요.

## 결정

1. **묻는 것은 하나예요.** 세계·시나리오·실험·연결·모델을 만들 때 "누가 볼 수 있나요": 나만 / 우리 파트 / 모두. 그룹이 없으면 "우리 파트"를 내놓지 않아요. 연결과 모델은 "나만"에서, 나머지는 "모두"에서 시작해요. 만든 뒤 바꾸는 길은 범위 바꾸기 길 하나뿐이고, 화면에서는 "누가 볼 수 있나요" 버튼이 불러요.
2. **목록은 모두가 아닐 때만 범위를 표시하고** 내 것 / 우리 파트 / 모두로 걸러요. 만든 사람은 로그인 ID가 아니라 보이는 이름으로 써요. 서버가 요청마다 이름을 듣고(`People`, 메모리, 500명) `meta.people`으로 내보내요. 다시 시작하면 그 사람이 다시 쓸 때까지 ID로 보여요. 디스크에 쓰지 않아요.
3. **왼쪽 아래**는 프록시 모드에서 프록시가 확인해 준 이름만 보이고 이름 대화상자는 없어요. 직접 적는 이름 방식에서는 이름 옆에 "권한이 없는 방식"이라고 적어요.
4. **403·404**는 까닭과 할 수 있는 일을 말해요. 404는 "없거나 보이지 않는 것"이라서 둘 다 말하고, 만든 사람에게 범위를 바꿔 달라고 하거나 같은 그룹인지 확인하라고 해요.
5. **실험의 공유**는 한 대화상자에 모아요: 링크 만들 때 만료 고르기, 이 실험의 링크 목록, 끊기. 헤더의 따로 있던 "링크 관리" 버튼은 없애요.
6. **감사 기록 화면**(`/audit`): 관리자는 목록·거르기(기간, 결과, 누가, 일, 종류)·조건에 맞는 기록 파일 받기를, 다른 사람은 내 것에 있던 일만 봐요. 읽기만 하고 고치거나 지우는 것은 없어요.
7. **남의 것을 고칠 때의 이유**: 관리자가 남의 범위·연결·모델을 바꾸기 전에 이유를 적어요. 요청 헤더 `x-terrarium-reason`(URL 인코딩)으로 보내고, 서버는 **관리자의 요청일 때만** 감사 기록의 `detail.reason`에 적어요(NFC, 제어 문자 제거, 200자). 다른 사람이 보내면 버려요. 연결 버전 고치기 등은 이 변경에서 묻지 않아요.
8. **알려진 결함 셋**: 같은 이름의 모델은 만든 사람을 옆에 적어요. 기본 모델이 없으면 까닭("모두"가 볼 수 있는 모델만 기본이 돼요)과 고르는 법을 보여요. 설정 파일의 연결은 관리자가 아니면 고치기를 숨겨요(`canEditVersions`).
9. **디자인 시스템 시험(TD-0007)**: Meta의 Astryx(`@astryxdesign/core`·`theme-neutral`, MIT, 0.7.15)를 **감사 기록 화면과 공유 대화상자 두 곳에만** 써요. 첫 화면 꾸러미가 커지지 않게 두 화면 모두 게으르게 불러오고(`React.lazy`), Astryx의 CSS도 그 안에서만 가져와요. 앱의 기존 CSS는 층 밖이라 Astryx(층 안)를 이겨요. 시험 결과와 이 시험을 이어 갈지는 디자인 책임자가 정해요. 이 결정은 시험의 범위를 정할 뿐 Astryx를 앱 전체의 부품으로 고르지 않아요.

## 이유

- 한 가지만 묻고 한 길로 바꾸게 하면, 화면이 서버가 거절할 선택을 내놓지 않고 판정이 한 곳에 남아요.
- 이름은 신원이 아니에요. 소유 견줌은 로그인 ID로 하고 이름은 보여 주기에만 써서, 이름이 바뀌어도 권한은 안 바뀌어요.
- 이유를 관리자만 기록하게 한 것은 감사 기록이 "남의 것을 만진 관리자"를 설명하려는 것이어서예요. 일반 사용자의 헤더는 기록을 부풀리는 길이 돼요.
- 디자인 시스템은 한 번에 갈아엎지 않고 두 화면에서 기준(꾸러미 크기, 밝고 어두운 테마, 접근성, 고치기 쉬움)으로 재어 본 뒤 정해요.

## 버린 길

- 이름을 레코드에 저장: 이름이 바뀌면 낡은 값이 남고 개인정보가 늘어요.
- 이유를 모든 사용자에게 받기: 소유자 자신의 일에 이유를 묻는 것은 마찰이에요.
- Astryx를 첫 화면에 바로 가져오기: 첫 화면이 이미 예산(700 kB, TD-0004)을 넘어요.

## 결과

- 시험 `apps/web/src/logic/scope.test.ts`, `audit-screen.test.ts`, `apps/server/src/http/audit-reason.test.ts`가 말과 규칙을 걸어요. `agent-versions.test.ts`의 한 시험은 기대값이 바뀌어서 `amends_tests`에 적었어요.
- `apps/web/package.json`에 Astryx 둘과 `@stylexjs/stylex`(Astryx의 동료 의존성)가 더해졌고, `harness/config/architecture.yaml`은 두 패키지를 `web.ui` 안에서만 허용해요.
- 알려진 한계: 이름은 다시 시작하면 사라져요. 이유는 일부 길에서만 물어요. 빠른 실험 같은 일부 만들기는 "모두"로 시작해요.
