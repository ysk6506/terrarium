---
title: ADR-0044 사용자 식별은 하나의 자리(Authenticator)로 꽂는다 — 지금은 프록시 헤더와 스스로 밝힌 이름, 나중에 사내 SSO
kind: decision
status: active
last_verified: 2026-10-30
enforced_by:
  - apps/server/src/http/identity.test.ts
  - apps/server/src/http/app.test.ts
touches_protected:
  - docs/product-specs/requirements.md
decision_hash: c018fd7bd1b4f378
---
# ADR-0044 식별 자리

## 맥락
ADR-0028은 사내 SSO 프록시의 헤더를 믿거나, 프록시가 없으면 스스로 밝힌 이름을 쓰게 했다. 사용자는 나중에 사내 SSO를 직접 연동해야 할 수도 있으니 **자리를 미리 만들어 두라**고 했다. 지금 실제 SSO를 만들 이유는 없다. 사내 SSO가 OIDC인지 SAML인지, 토큰을 어디서 받는지도 모른다.

## 결정
1. **모든 경로는 `Authenticator` 하나에게 "누구냐"고 묻는다.** `authenticate(req)`는 `Viewer`를 돌려주거나(비동기 가능), 낯선 사람을 받지 않는 방식이면 `UnauthenticatedError`(401), 인증 제공자에 닿지 못하면 `UnavailableError`(503)를 던진다. 방식이 로그인 경로(콜백·로그아웃)를 가지면 `mount(app)`으로 서버에 한 번 더한다.
2. **지금 있는 방식은 둘이다**(`headerAuthenticator`): 설정 `identity.header`가 있으면 프록시 헤더만 믿고(`proxy-header`), 없으면 스스로 밝힌 이름(`self-declared`). 동작은 ADR-0028 그대로다.
3. **새 방식은 클래스 하나와 `authenticatorOf`의 한 줄이다.** 설정 `identity` 아래에 자리를 만들고, 나머지(경로, 권한, 화면)는 바꾸지 않는다. `Viewer.source`에 `"sso"`를 이미 두어 화면이 "프록시"처럼 이름 묻기를 건너뛴다.
4. **`Viewer.name`은 바뀌지 않는 로그인 이름이어야 한다.** 소유권(고치기·지우기)이 이 이름의 일치로 정해진다. SSO 방식은 사번이나 이메일을 여기에 넣고, 바뀔 수 있는 표시 이름을 넣지 않는다.
5. **로그인 밖에 두는 곳**: 실행마다의 도구 엔드포인트(`/mcp/runs/:runId/:token`)와 공유 보고서(`/r/:token`)는 주소에 든 비밀이 열쇠다. 브라우저 세션이 없는 프로그램과 사람이 쓴다.

## 이유
- 자리만 있으면 SSO가 정해졌을 때 바꿀 곳이 한 곳이다. 지금 어림짐작으로 만들면 거의 틀린다.
- 소유권을 표시 이름이 아닌 로그인 이름으로 못 박아 두면, 나중에 SSO로 바꿔도 기존 실험의 주인이 어긋나지 않게 이름 대응표만 만들면 된다.

## 버린 대안
- **OIDC를 지금 만든다**: 제공자·범위·토큰 형식을 모른 채 만들면 버려진다.
- **경로마다 식별 코드를 둔다**: 새 방식마다 모든 경로를 고쳐야 한다.

## 결과
- 한계: 실제 SSO는 구현하지 않았다. 지금 자리에는 헤더와 이름 두 방식만 꽂혀 있다.
- 한계: 스스로 밝힌 이름으로 만든 실험을 나중에 SSO 로그인 이름으로 옮기는 일은 따로 정해야 한다.
