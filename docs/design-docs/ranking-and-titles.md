---
title: 세계 인기·좋아요·칭호와 계급 모델
kind: spec
status: active
last_verified: 2026-11-12
covers:
  - packages/core/src/experiments/popularity.ts
  - packages/core/src/experiments/community.ts
  - packages/core/src/experiments/competitions.ts
  - packages/core/src/ranking/medals.ts
  - packages/core/src/ranking/tiers.ts
  - packages/core/src/contract/community.ts
  - packages/core/src/contract/community-routes.ts
  - apps/server/src/runtime/world-board.ts
  - apps/server/src/runtime/titles.ts
  - apps/server/src/runtime/watched-store.ts
  - apps/web/src/logic/world-board.ts
  - apps/web/src/logic/titles.ts
  - apps/web/src/ui/titles.tsx
  - apps/web/src/ui/pages/world-board.tsx
  - apps/web/src/ui/pages/world-card.tsx
verification_log:
  - "2026-11-11: 2026-11-11: ADR-0141 변경(레지스트리 분할, 한 가지 행동, 크기, aria)을 코드와 대조해 이 문서에 반영했다"
  - "2026-11-11: 2026-11-11: 좋아요 수의 title을 더한 것을 코드와 대조해 맞음 (ADR-0141)"
  - "2026-11-11: step 가 (ADR-0174): identity and policy; statements checked against the code"
  - "2026-11-11: step 나 (ADR-0174): visibility scopes; statements checked against runtime/permissions.ts, gate.ts, scoping.ts and the stores"
  - "2026-11-12: step 나 review fixes (ADR-0179): default model is a model made for everyone, one scope route for five kinds; statements checked against the code"
covers_hash: 4e5c3f13610bc471
---
# 세계 인기·좋아요·칭호와 계급 모델 (REQ-101, [ADR-0122](adr/0122-world-popularity-likes-titles.md))

## 한 문장으로

**세계는 인기 순서로 보이고, 카드가 그 근거를 숫자로 말한다. 사람에게는 한 일을 이름으로 하는 칭호가 붙고, 메달과 계급은 모델만 있고 아직 화면에 없다.**

## 인기 점수

```
인기 점수  = 최근 30일 실험 수 + 좋아요 수 + 다른 사람이 이 세계(템플릿)로 시작한 수
이번 주    = 최근 7일의 실험 수 + 최근 7일의 좋아요 + 최근 7일에 다른 사람이 시작한 수
```

| 칸 | 어디서 세나 | 메모 |
|---|---|---|
| 실험 수 | 실험 기록의 `recipe.worldId`와 `createdAt` | 누가 만들었든 센다. 내 실험도 센다 |
| 좋아요 수 | `world_likes` 표 | 사람마다 세계마다 한 줄. 내 세계에 내가 누른 것도 센다 |
| 다른 사람이 시작한 수 | 세계 기록의 `startedFrom` | 시작한 세계의 만든 사람이 출처의 만든 사람과 다를 때만. 출처가 지워졌으면 센 곳이 없다 |

- **정렬 넷:** 인기(점수 큰 순) / 요즘 활발(이번 주 큰 순) / 새로 생김(만든 때 나중 순) / 내 세계(내가 만든 세계만, 고친 때 나중 순). 같은 값은 **만든 때가 나중인 쪽이 앞**, 그래도 같으면 id 순이라 몇 번을 읽어도 순서가 같다.
- **서버가 읽을 때마다 센다.** 점수는 저장하지 않는다. `core.experiments`의 `worldStats`(숫자)와 `sortWorlds`(순서)는 순수 함수이고, `runtime/world-board.ts`가 저장소에서 읽어 먹인다.
- **세계가 어디서 시작했나:** 서비스부터 만든 세계(REQ-094)는 템플릿에서 "그대로 만들기"·"조금 바꿔서"로 시작하면 `startedFrom`에 그 템플릿의 id를 적는다. 없는 id는 조용히 버린다(저장은 막지 않는다). 맨 땅에서 지은 세계, 사업장 생성, 가져온 세계는 출처가 없다.

### 카드가 보여 주는 것

"실험 128번 · 좋아요 24 · 이번 주 +12"

- 실험은 점수에 들어가는 **최근 30일** 수다. 마우스를 올리면 "실험은 최근 30일(128번), 지금까지는 140번이에요".
- 이번 주가 0이면 그 칸을 뺀다. 남이 시작한 수가 있으면 "남이 시작 3번"이 붙는다.
- 아무것도 없으면 "아직 실험이 없어요". 모든 세계가 그러면 목록 위에 "아직 실험이 없어요 — 인기는 실험이 쌓이면 생겨요".
- 하트는 누르는 즉시 개수가 바뀌고 서버의 답으로 바로잡힌다. 이름이 없는 사람이 누르면 이름부터 묻는다.

## 칭호

| 칭호 | 조건 | 얻은 때 | 서버가 읽는 곳 |
|---|---|---|---|
| 첫 세계 | 세계를 하나 만들었다 (템플릿·예시는 아니다) | 첫 세계를 만든 때 | 세계 `owner`, `createdAt` |
| 실험 100번 | 만든 실험 100개 | 100번째 실험을 만든 때 | 실험 `owner`, `createdAt` |
| 실험 1,000번 | 만든 실험 1,000개 | 1,000번째 | 같음 |
| 남이 쓰는 세계 | 다른 사람이 내 세계로 만든 실험 10개 이상 | 10번째 실험이 만들어진 때 | 실험과 세계의 만든 사람 |
| 남이 쓰는 시나리오 | 다른 사람이 내 시나리오로 만든 실험 10개 이상 | 10번째 | 실험과 시나리오의 만든 사람 |
| 첫 복구 | 에이전트가 내 시나리오를 처음 통과했다 | 합격한 실행이 끝난 때 | 실행 `result.score.passed`, `finishedAt` |
| 꼼꼼한 출제자 | 변별력 점검에서 고칠 곳이 없던 내 시나리오 5개 | 5번째가 처음 깨끗하게 통과한 때 | `calibration_marks` |
| 좋아요 10 | 내 세계가 다른 사람에게 좋아요 10번 | 10번째 좋아요가 눌린 때 | `world_likes` |

- **한 번 얻으면 잃지 않는다.** 찾은 칭호는 `title_awards`에 쓰이고, 이미 있는 것은 덮지 않는다. 세계·시나리오를 지우거나 좋아요를 취소해도 남는다.
- **단계도 색도 없다.** 이름에 숫자와 단위가 있고, 숫자가 없는 것은 한 일을 문장으로 말한다. 조건을 말하지 않는 칭호는 만들지 않는다.
- **보이는 곳:** 왼쪽 아래 이름 밑(내 것), 세계 카드(만든 사람), 실험 표의 만든 사람 칸. 이름 옆에 최대 둘(`TITLES`의 차례: 실험 1,000번 → 남이 쓰는 시나리오 → 남이 쓰는 세계 → 꼼꼼한 출제자 → 실험 100번 → 좋아요 10 → 첫 복구 → 첫 세계), 나머지는 눌러서 여는 작은 팝오버에 조건과 날짜와 함께. 홈의 "최근 실험" 표에는 달지 않는다.
- **언제 세나:** `watchStore`가 저장소를 감싸 세계·시나리오·실험·끝난 실행·좋아요·점검 기록의 쓰기를 센다. 센 값이 바뀐 뒤 첫 읽기가 모두의 칭호를 한꺼번에 다시 세고, 그 사이 읽기는 캐시를 쓴다. 실행 중인 실행의 갱신은 세지 않는다.

### 하지 않는 것

- **시운전 10번:** 시나리오 시험 가동은 어디에도 기록되지 않아서 세지 않는다. 기록이 생기면 새 ADR로 더한다.
- 사람이 직접 칭호를 주거나 뺏지 않는다. 이름을 바꾸면 칭호는 새 이름 쪽에서 새로 센다(옛 이름의 awards 줄은 남는다).

## 메달과 계급 (모델만)

| 참가자 | 금 | 은 | 동 |
|---|---|---|---|
| 99명 이하 | 상위 10% | 상위 25% | 상위 50% |
| 100명 이상 | 상위 5% | 상위 15% | 상위 40% |

- 컷 순위 = `내림(참가자 × 퍼센트 ÷ 100)` (정수 계산). **대회마다 금메달은 최소 1개**. 같은 점수는 같은 앞선 순위(1, 2, 2, 4)를 갖고, 그 순위가 컷 안이면 같은 메달을 받는다.
- 한 사람이 에이전트를 여럿 내도 그 사람은 한 번만 순위에 오르고, 가장 좋은 점수로 센다.

| 계급 | 조건 |
|---|---|
| 새싹 | 메달이 없다 |
| 참가자 | 메달 1개 이상 |
| 전문가 | 동메달 이상 2개 또는 은메달 이상 1개 |
| 마스터 | 금메달 1개 이상, 거기에 은메달 이상 2개 더 |
| 그랜드마스터 | 금메달 5개 이상 |

더 좋은 메달은 낮은 요건을 채운다. 금메달 하나는 "은메달 이상 1개"이기도 해서 금 1개가 은 1개보다 낮은 계급이 되는 일이 없다. 계급은 **에이전트를 낸 사람**의 것이다.

- 코드: `core.ranking`(`medals.ts`, `tiers.ts`, 순수 함수)과 `core.experiments`의 `CompetitionsPort`·`MemoryCompetitions`·`resultsOf`·`medalCountsOf`·`tierOfUser`.
- **계급은 아직 어디에도 보이지 않는다. 지금은 모두 새싹이다.** 경로도 화면도 없다. 대회 모드(오픈 뒤 로드맵: 참가 등록·비공개 세트·리더보드 공개 시점)가 와서 대회 기록이 생기면, 그때 프로필과 리더보드에 나온다.

## 솔직한 한계

| 한계 | 왜 / 그래서 |
|---|---|
| 점수가 가볍다 | 세 칸이 모두 1점이다. 실험 한 번과 좋아요 한 번이 같은 무게다. 쓰다 보며 가중치가 필요하면 새 ADR |
| 내가 쌓을 수 있다 | 내 실험도, 내가 누른 좋아요도 센다. 사내 도구라 막지 않았다. 칭호 "좋아요 10"과 "남이 쓰는 …"은 남의 것만 센다 |
| 템플릿의 시작 수는 카드에 안 나온다 | 템플릿은 세계 목록에 없다. 세계에서 시작한 경우만 카드에 보인다 |
| 읽을 때마다 센다 | 세계·실험이 아주 많아지면 캐시를 더해야 한다 |
| 이름이 곧 사람이다 | 칭호는 이름에 붙는다. SSO가 붙으면 사번으로 잇는다 |
| 칭호는 늦게 보일 수 있다 | 쓰기 뒤 첫 읽기에 센다. 실행이 끝나는 순간과 화면 사이에 몇 초 걸릴 수 있다 |
| 날짜는 한국 시간 | 팝오버와 마우스 설명의 날짜는 한국 날짜다 |

## 코드 구조

| 자리 | 하는 일 |
|---|---|
| `core.experiments/popularity.ts` | `worldStats`, `sortWorlds`, 정렬 이름 |
| `core.experiments/community.ts`, `ports.ts`, 두 저장소 | 좋아요·점검 기록·칭호 기록 |
| `core.experiments/competitions.ts` | 대회 포트와 메모리 구현 |
| `core.ranking` | 메달 컷, 순위, 계급 |
| `core.contract/community*.ts` | 정렬 쿼리, 카드·칭호·좋아요 모양, 경로 셋 |
| `server.runtime/world-board.ts` | 목록 + 근거 + 좋아요 |
| `server.runtime/titles.ts`, `watched-store.ts` | 칭호 조건, 기록, 캐시 |
| `web.logic/world-board.ts`, `titles.ts` | 한 줄 근거, 정렬 기억, 낙관적 하트, 칭호 글 |
| `web.ui/pages/world-board.tsx`, `world-card.tsx`, `ui/titles.tsx` | 세계 구역, 카드, 알약과 팝오버 |

## 공개 범위와 셈 (ADR-0174 나 단계)

순위표, 세계 인기·좋아요, 칭호의 근거는 **"모두"인 세계·실험만** 세요. "나만"·"우리 파트"인 것은 만든 사람에게도 이 숫자에 들어가지 않아요(남이 숫자로 존재를 짐작하지 못하게). 셈은 누가 묻든 같아요. 자세한 규칙은 [권한](permissions.md).
