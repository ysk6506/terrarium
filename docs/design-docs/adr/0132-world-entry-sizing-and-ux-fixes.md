---
title: ADR-0132 세계 만들기의 크기는 서비스 숫자로 세고, 알아서는 숫자의 규칙 표이며, 빌더 카드는 고른 물체 옆에 붙는다
kind: decision
status: active
last_verified: 2026-11-07
enforced_by:
  - packages/core/src/world/service-load.test.ts
  - packages/core/src/sources/worldgen/shaped-sizing.test.ts
  - apps/web/src/logic/world-shape/load-rules.test.ts
  - apps/web/src/logic/world-draft.test.ts
  - apps/web/src/logic/builder/card-place.test.ts
  - apps/server/src/http/service-cards-api.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - harness/config/test-lock.json
amends_tests: []
decision_hash: 3395f03096667108
---
# ADR-0132 베타 피드백 2차: 숫자로 고르고 숫자로 세고, 카드는 물체 옆에

연수 님이 cd3f817에서 일곱 가지를 알려 줬다 (REQ-109). 결정은 다섯이다.

1. **서비스는 숫자를 가진다.** 카드마다 `load`(초당 요청·데이터 GB·동시 사용자·허용 중단 초·GPU 시간)가 있다. `workload`는 이미 일감 종류라 `load`다. 돈은 넣지 않는다(돈은 실험의 "바꾸기"). 내 카드는 숫자를 함께 저장하고 서버가 한도를 확인한다. 옛 스펙·옛 카드는 숫자가 없으면 어림값(`GUESS_LOAD`)으로 열린다.
2. **"알아서"는 숫자의 규칙 표다.** 층마다 "이 숫자면 적어도 이 칩"이고, 원래 고르던 칩과 맞는 규칙 가운데 가장 오른쪽을 가진다(숫자가 커지면 오른쪽으로만 간다). 비용 프리셋은 한 칸 옮기고 전제 규칙이 마지막에 맞춘다. 이유는 숫자를 인용한다. 표는 `world-entry.md`에 같은 줄로 있고 시험이 둘을 맞춰 본다. 한 규칙의 문턱이 틀리면 그 줄 하나만 고치면 된다.
3. **크기는 서버룸·룸당 랙·랙당 서버 셋이다.** 처음 값은 서비스가 필요한 서버(⌈rps÷50⌉+⌈사용자÷100⌉+⌈데이터÷250⌉+⌈GPU시간÷100⌉)의 4배(최소 120)에서 센다. 고른 모양이 더하는 서버는 `planShape`가 얹고 한 줄로 말한다. 스펙은 `rooms`·`racksPerRoom`·`perRack`을 받고 옛 `servers`는 같은 세계로 열린다. 빠른 선택과 화성 실측은 없앴다.
4. **하던 세계는 이어진다.** 서비스·숫자·모양·크기는 임시 보관(메모리 + `sessionStorage`, 막히면 메모리만)에 두고 ①에서 "이어서 할까요?"로 묻는다. "내 카드로 저장"은 서버에 남는다. 요약("이 모양이면")은 사다리에서 빼서 ③ 오른쪽과 완성 카드로 옮긴다.
5. **빌더 카드는 고른 물체 옆에 붙는다.** 순수 함수 `placeCard`가 자리를 정하고(16px 안쪽, 최대 `min(320px, 100vw - 32px)`), 900px보다 좁으면 아래 시트다. 놓기 시트도 같은 체계다. 물체의 화면 위치는 월드 무대가 그릴 때마다 밖의 저장소로 알린다.

세계 카드는 어디를 눌러도 그 세계로 간다(전체가 링크, 안의 좋아요·메뉴는 따로 눌린다).

## 시험과 잠금
새 시험은 모두 `[REQ-109]`를 달았다. 잠긴 시험은 고치지 않고 더하기만 했다(`service-cards-api.test.ts`). `harness/config/test-lock.json`은 더한 시험을 받으려고 다시 잠근다.

## 하지 않은 것
- ②의 머리가 처음부터 서비스 이름이었던 것(코드가 이미 그랬다)은 고치지 않고 시험과 안내 문구만 보탰다.
- 이끼 알약이 빌더 아래 "다음:" 칩과 겹치는 것은 따로 둔다.
