---
title: ADR-0127 서비스부터는 질문 셋과 "실험 시작"(클릭 넷), 서비스는 카탈로그에서 고르고 내 카드로 저장·공유한다, 입구 그림은 비운다
kind: decision
status: active
enforced_by:
  - apps/web/src/logic/world-shape/short-flow.test.ts
  - apps/web/src/logic/quick-draft.test.ts
  - apps/web/src/logic/quick-harm.test.ts
  - apps/web/src/moss/bar-offset.test.ts
  - packages/core/src/sources/worldgen/service-card.test.ts
  - apps/server/src/http/service-cards-api.test.ts
  - apps/web/src/logic/world-words.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - apps/web/src/logic/world-words.test.ts::=SCREENS
  - apps/web/src/logic/world-words.test.ts::=SOURCES
  - apps/web/src/moss/bar-offset.test.ts::이끼 버튼과 아래 막대 [REQ-104] > [REQ-104] CSS가 변수를 읽고, 세 막대가 모두 data-bottom-bar를 단다
  - apps/web/src/moss/bar-offset.test.ts::이끼 버튼과 아래 막대 [REQ-104] > [REQ-104] 물음표는 올려 보거나 초점이 갈 때만 보이고, 화면 읽기 이름은 남는다
test_change_reason: 일감 화면(shape-workload.tsx)이 없어져 글 잣대 시험의 화면 목록에서 빠지고, 새 화면(service-sheet.tsx, quick-harm-panel.tsx)이 더해진다. 시험이 지키는 성질(해요체, 숫자와 단위, 시스템 말 금지)은 그대로다. 이끼 막대 시험은 같은 날 새로 만든 것인데, 화면 읽기 이름을 확인하는 줄을 템플릿 문자열 리터럴 대신 앞부분 글자로 읽게 고쳤다(린트 경고를 없애려고, 지키는 성질은 같다). 두 시험 모두 스타일 시트를 vite의 ?raw로 읽으면 vitest가 .css를 비워 버려서(빈 글자), 디스크에서 직접 읽도록 고쳤다. 지키는 성질은 같다.
decision_hash: a821407383bca0f2
---
# ADR-0127 서비스부터는 질문 셋과 "실험 시작"(클릭 넷), 서비스는 카탈로그에서 고르고 내 카드로 저장·공유한다, 입구 그림은 비운다

## 맥락
제품 책임자 피드백(2026-11-07): "실험할 인프라가 필요해요" 길이 너무 길다(시나리오와 실험 설정을 계속 묻는다). 서비스 카드는 아무거나 타이핑할 수 있다. 입구 그림이 별로다. 카탈로그는 돈이 아니라 누가 만든 카드인지, 잠겼는지, 공유됐는지를 보여야 한다. 같은 날 그림은 모두 빼기로 정했다(글뿐인 카드, 나중에 3D 렌더).

## 결정
1. **서비스부터는 화면 셋이다**: ① 무엇을 떠받치나 ② 어떻게 돌리나(사다리) ③ 서버 몇 대. 일감 화면과 "멈추면 시간당 피해" 칸은 없앤다(일감은 카드의 기본, 피해는 실험의 "바꾸기").
2. **③의 주된 버튼은 "실험 시작"이다.** 세계를 짓고 곧바로 `POST /api/worlds/:id/quick-experiment`를 부른다. 옆의 "세계만 만들기"는 "세계를 다 지었어요" 카드(사실 한 줄 · 권장 줄과 "바꾸기" · 실험 시작 · 세계 둘러보기 · 템플릿 저장)로 간다. **클릭은 넷이다**(입구의 문 1 · ①다음 2 · ②다음 3 · ③실험 시작 4). 처음 그림은 "서버 수 다음 → 지었어요 카드 → 실험 시작"으로 다섯이어서 ③에 합쳤다. 서비스를 더하면 ②를 서비스마다 한 번씩 지나 하나씩 는다. 시험이 화면 이동 함수로 센다.
3. **빠른 실험은 새 개념이 아니다.** 서버가 사람이 폼에 채웠을 레시피(운영 실험의 시나리오 세트: 그 세계에서 만들 수 있고 화면이 센 "맞는 시나리오"의 고장 · 기본 툴 + `events_since` · 5번 · 실제 시간 한 번에 1시간 · 마지막으로 쓴 에이전트, 없으면 내장 operator)를 만들어 `Experiments.create`에 넘긴다. "바꾸기"는 새 실험 폼을 같은 값으로 채워 연다.
4. **서비스는 카탈로그에서 고른다.** 기본 제공 카드 열 장(코어 `SERVICE_CATALOG`, 모양이 정해져 있다)과 공유된 카드. 행에는 이름 · 한 줄 · 만든 사람(칭호) · 잠김/공유됨만 있고 돈과 그림이 없다. 고칠 수 있는 것은 이름뿐이다.
5. **내 카드** (`service_cards`, SQLite와 메모리): `owner` · `locked`(기본 true) · `shared`(기본 false). 고치기·지우기는 만든 사람, 단 잠금을 푼 카드는 누구나 이름·피해 숫자를 고친다(공유·잠금은 만든 사람만). 카탈로그에는 기본 제공과 공유된 카드가 만든 사람·칭호와 함께 보인다.
6. **입구 문은 글뿐인 카드다.** 그림은 비워 두고 3D 렌더가 생기면 채운다.
7. **이끼 흠 둘**: "?"는 올려 보거나 포커스할 때만 보이고, 떠 있는 이끼 버튼과 첫 인사는 아래 막대 위로 올라선다(`data-bottom-bar` + `--bottom-bar-h`).

## 시험을 고친 이유
위 `test_change_reason`.

## 하지 않은 것
카드 설계 편집기, 카드 버전·검색, 한 번에 1시간보다 짧은 권장 실험, 권장 실험의 시나리오를 화면이 아니라 서버가 `shape`로 세는 것(지금은 화면이 센 템플릿 id를 보낸다).
