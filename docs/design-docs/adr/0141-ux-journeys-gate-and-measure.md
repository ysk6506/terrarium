---
title: ADR-0141 UX 검사를 게이트인 여정과 게이트 아닌 측정으로 나누고, 러너에서 안 되던 화면을 고친다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - .github/workflows/ci.yml
  - harness/src/ux/run.ts
  - harness/src/ux/run.test.ts
  - harness/src/checks/moss.ts
  - harness/src/checks/moss.test.ts
touches_protected:
  - .github/workflows/ci.yml
  - harness/src/ux/run.ts
  - harness/src/ux/run.test.ts
  - harness/src/ux/score.ts
  - harness/src/checks/moss.ts
  - harness/src/checks/moss.test.ts
  - docs/product-specs/requirements.md
  - AGENTS.md
amends_tests:
  - harness/src/ux/run.test.ts::<import:268837c3>
test_change_reason: 테스트 파일의 import 한 줄에 새로 만든 `journeys`를 더했다. 단언은 하나도 바꾸지 않았고 지우지 않았다. 새 단언([REQ-114])만 더했다.
decision_hash: 07e89bb36a2f4632
---
# ADR-0141 UX 검사를 게이트인 여정과 게이트 아닌 측정으로 나누고, 러너에서 안 되던 화면을 고친다

## 맥락
ADR-0140은 UX 측정을 "여정과 측정을 나누기 전까지" 기록만 남기기로 했다(TD-0004). 하나로 묶인 `ux` 작업은 이 러너(그래픽 가속 없음)에서 topology 여정이 53초 걸려 실패했고, 속도·크기·접근성 점수는 하한(98)에 못 미쳤다. 게이트로 만들 수도, 영원히 빨간 채로 둘 수도 없었다. 아울러 측정이 실제로 찾아낸 결함(누르는 크기, 첫 화면 크기, axe, 한 가지 행동 등)이 그대로 남아 있었다.

## 결정
1. **검사를 둘로 나눈다.** 같은 여정 코드(`tests/e2e/ux/journeys.ts`)를 두 방식으로 쓴다. 여정을 복제하지 않는다.
   - `ux-journeys`(게이트): "사람이 끝낼 수 있는가"만 본다. `pnpm ux journeys [--group flow|build|own] [--only id]`가 여정을 돌려 `note: 여정 <id> ok|실패 …` 줄과 `journeys: 모두 끝냈다`를 찍고, 하나라도 못 끝내면 0이 아닌 코드로 끝난다. 시간·크기·접근성 탐침은 돌지 않고 측정 파일도 쓰지 않는다. 앞 여정이 만든 것을 뒤 여정이 쓰므로 세 묶음(flow, build, own)으로 나누어 CI에서 병렬로 돌리고, 묶음마다 서버를 따로 띄운다. 묶음이 `build`로 시작하지 않으면 세계 하나를 API로 먼저 만든다(사람이 지금 세계가 있는 상태에서 시작하는 것과 같다).
   - `ux-measure`(게이트 아님, TD-0004): 지금까지의 전체 측정. 로그와 `ux-score.json`을 `ux-measure` 아티팩트로 올린다. `continue-on-error`이고 `gate`의 `needs`에 없다. PR에서는 `apps/web/`, `tests/e2e/ux/`, `harness/src/ux/`를 건드렸을 때만 돈다.
2. **기록 파일은 이렇게 신선하게 둔다.** 기록(`docs/generated/ux-score.json`)의 원본은 러너의 측정이다. 웹 화면을 바꾼 PR은 `ux-measure` 아티팩트의 `ux-score.json`을 PR의 마지막 커밋으로 올린다(기록은 `webHash`가 보는 경로 밖이라 그 커밋이 해시를 바꾸지 않는다). `ux-measure`는 측정 전에 저장소의 기록이 아직 신선한지(`UX004`), 측정 뒤에 새 점수가 하한을 넘는지(`UX001`)를 `pnpm ux check`로 알려 준다. 알리기만 하고 게이트로 막지 않는다. 하한은 낮추지 않는다. 하한에 못 미치는 면은 감추지 않고 TD-0004의 제목에 남은 것을 적는다.
3. **영원히 빨갛거나 영원히 무시되는 검사를 만들지 않는다.** 게이트인 `ux-journeys`는 여정이 모두 끝나야 초록이다. 게이트가 아닌 `ux-measure`는 점수를 보고하는 일이 목적이고, TD-0004가 기한(2026-11-24)과 남은 것을 들고 있다.
4. **러너에서 안 되던 두 여정을 앱에서 고친다.**
   - 화면 코드를 필요할 때 내려받으므로, 내려받지 못하면(서버가 죽었거나 네트워크가 끊겼으면) 빈 화면이 되지 않도록 `ScreenBoundary`가 이유와 "다시 불러오기"를 보여 준다. 세계가 하나도 없는 목록은 "세계 만들기"로 가는 길을 준다.
   - 첫 화면이 시뮬레이션 엔진까지 내려받았다: 시나리오·실험·세계 목록 화면을 `lazy`로 나누고, `packages/core`·`logic`·`moss`는 부수 효과 없는 모듈로 보아(자기 등록이 필요한 `shell-layers`만 예외) 쓰이지 않는 것을 뺐다(`vite.config.ts`). 첫 화면 스크립트는 1.56 MB에서 695 kB로 줄었다.
   - topology 여정: 3D 장면을 닫을 때 WebGL 컨텍스트가 부서지는 비용이 수 초 걸려 화면 스레드와 GPU 프로세스를 막았다. 3D 장면을 부수지 않고 숨긴 채 그리기만 멈춘다(`Engine.setPaused`, `WorldStage`의 `paused`). 보기를 바꿀 때 컨텍스트가 파괴되지 않는다. 세계 화면을 완전히 떠날 때의 파괴 비용은 앱에서 없애지 못했다. 탐침은 화면마다 새 방문자를 써서 그 비용이 다음 화면을 막지 않게 한다(`eachPage`).
5. **측정이 찾은 결함을 고친다.**
   - 누르는 크기: 컨트롤은 높이 32 px 이상·너비 24 px 이상, 레일 제목 칩 포함.
   - 한 가지 행동: 세계 화면의 주된 버튼은 "그 순간의 주된 일"(놓기 또는 카드의 주된 버튼) 하나다. "다 지었어요"는 떠나는 길이라 주된 버튼이 아닌 보통 버튼으로 낮춘다. 여럿 가운데 고른 것은 주된 버튼이 아니라 `chosen`(`aria-pressed`와 테두리)으로 보인다(새 실험의 운영 시간, 층, 서버 찍기). 꺼진 버튼은 이유를 말하고 포인터를 올리면 눈에 보이게 바뀐다.
   - axe 치명·심각: 이끼 표시 글자색 토큰, 좋아요 버튼 이름에 보이는 글자 포함, 노드의 `aria-selected` 제거, 이끼 영역 표시, 사람 설정의 꺼진 이유 연결.
6. **손 수 예산을 올린다.** 여정에서 지울 수 있는 걸음을 찾았지만 없었고, 필요한 걸음이라 명시적으로 올린다.
   - `build` 8 → 10, `site` 6 → 8. 둘 다 "새 세계 → 직접 지어요 → 작은 사업장 만들기"(ADR-0107의 두 문)를 거치는데, 그 입구가 홈에서 "세계" 메뉴까지 네 번의 누름이다. 이 입구는 앞 여정이 세계를 만들어 두는 방식으로 줄일 수 없다(여정이 곧 "처음 한 번"이다). 입구를 합치는 것은 제품 결정이라 이 ADR에서 하지 않는다. 예산은 사람이 거치는 최소 길이에 맞추고, 두 배면 0점이라는 규칙은 그대로다.
7. **이끼 등록부를 영역별 파일로 나눈다.** `apps/web/src/moss/registry.ts`가 500줄 한도를 넘었다. `registry-global|world|scenario|experiment|other.ts`와 `registry-kit.ts`로 나누고 `registry.ts`는 모으는 일만 한다. `moss` 검사는 `registry*.ts`를 모두 읽어 하나로 본다. 별칭 "운영 모드 안내"를 되살렸고, 시나리오 처리 화면의 주된 버튼(`process-add-step`, `process-save`, `process-experiment`)에 이끼 동작을 붙여 `data-moss-skip`을 뺐다.

8. **측정 쪽도 러너에서 믿을 수 있게 고친다.** 점수를 깎지 않고 재는 방법만 바로잡는다. 첫 화면 크기·시간은 앞 탐침의 WebGL 정리가 끝나길 기다리지 않도록 새 브라우저에서 잰다. 결과 화면의 "합격률이 첫 화면에 있는가"는 값이 그려진 뒤에 본다(위치를 재지 도착 속도를 재지 않는다). `cancel` 여정은 지우기 전에 끝나 버리는 작은 세계 대신 느린 연습 세계를 이름으로 골라 쓰고 끝나면 지운다. 여정 묶음이 하나도 빠지거나 겹치지 않는 것은 `harness/src/ux/groups.test.ts`가 지킨다.

## 이유
측정 한 번이 15분 넘게 걸리고 러너에서 점수가 깎이면 게이트로 둘 수 없다. 그러나 "사람이 끝낼 수 있는가"는 느린 그래픽에서도 변하지 않는 사실이라 게이트가 될 수 있다. 같은 코드를 두 방식으로 쓰면 둘이 어긋나지 않는다.

## 버린 길
- 측정을 게이트로 만들기: 그래픽 가속이 없는 러너에서 점수가 깎여 영원히 빨갛다. 하한을 낮추는 길은 막혀 있다.
- 측정을 그냥 두고 무시하기: 아무도 보지 않는 검사가 된다.
- 기록을 CI가 main에 직접 쓰기: main은 보호되어 있다.
- 3D 장면을 보기마다 다시 만들기: 컨텍스트 파괴가 화면 스레드를 막는다.

## 결과
`gate`는 `ux-journeys` 셋을 포함한다. TD-0004는 `ux-measure`가 러너에서 모든 면의 하한을 넘는 경우에만 닫는다. 넘지 못하면 제목을 남은 것으로 다시 쓰고 기한을 그대로 둔다.
