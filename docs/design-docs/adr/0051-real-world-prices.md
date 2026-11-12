---
title: ADR-0051 가격은 현실의 값을 따르고, 확인한 값과 추정한 값을 나누어 밝힌다
kind: decision
status: active
enforced_by:
  - packages/core/src/world/construction.test.ts
  - apps/web/src/logic/builder/prices.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - packages/core/src/world/construction.test.ts::<import:31561bdf>
  - packages/core/src/world/construction.test.ts::what land costs where it lies [REQ-059] > every campus has its own market, and an unknown place falls back to ordinary factory land
test_change_reason: 같은 날 새로 잠근 시험이 core.world에서 core.sources.worldgen을 불러와 계층 규칙(ARCH010)을 어겼다. 사업장마다 시장이 있다는 확인은 worldgen 계층의 land-markets.test.ts로 옮기고, 이 파일에는 모르는 곳이 일반 공장용지로 돌아간다는 확인만 남겼다. 요구사항의 뜻은 그대로다.
decision_hash: 72b63a6de36b5363
---
# ADR-0051 가격은 현실의 값을 따른다

## 맥락
빌더는 "들인 돈"을 보여 주고, 팔고 있는 땅을 사게 한다(REQ-043). 그런데 돈의 크기가 현실과 달랐다.

- 땅은 어느 사업장에서나 ㎡당 120만 원이었다. 수원과 천안이 같았다.
- 건물은 지어도 0원이었다. 장비 값만 "들인 돈"에 들어갔다.
- 장비 값은 임의로 정한 값이었다. 8-GPU 서버는 실제보다 낮거나 높았고, 500kVA UPS는 3.5억 원이었으나 판매처 값은 배터리 별도 7.2만 달러(약 0.97억 원)였다.

사용자가 "가격도 다 현실 세계의 가격을 최대한 반영해"라고 요구했다(REQ-059).

## 결정
1. **땅은 사업장이 있는 동네의 값을 쓴다.** 사업장 월드는 `props.landMarket`과 `props.landPriceM`(㎡당 백만 원)을 가진다. 시장은 7개(`general`과 사업장 6곳)이고, 새 사업장 만들기 화면에서 고를 수 있다.
   사업장 모양을 따라 하면 그 사업장의 시장이 기본이고, 크기로 정하거나 그리면 `general`이 기본이다. `parcelPriceM(w, d)`의 기본값은 `general`(1.2)이라서 기존 동작과 잠긴 테스트가 그대로다.
2. **건물은 짓는 값이 든다.** 층마다 건물 바닥 넓이 × 용도별 단가(`BUILD_RATE_M_PER_M2`), 방은 용도별 마감(`FIT_OUT_RATE_M_PER_M2`), 컨테인먼트는 틀 값. 장비는 자기 값이 있으므로 중복해서 세지 않는다.
   `structureCostM`이 개체 하나의 구조 값을 돌려주고, 빌더의 층·방 보기는 자기 자신의 값을 포함해서 센다.
3. **장비 값은 판매처 가격에 환율(1,343원)을 곱한다.** 시장 범위 안에 있던 값은 두고, 30% 넘게 벗어난 값만 고쳤다(16개 모델).
4. **값마다 믿을 만한 정도를 밝힌다.** `reported`(확인)와 `estimated`(추정)를 `LandMarket.basis`로 구분하고, 건설 단가와 장비값은 `docs/design-docs/real-prices.md`에 근거와 믿을 정도를 적는다.
   화면에서도 새 사업장 만들기의 "땅값 기준"이 이를 말한다.
5. **현실에서 멀어지지 않게 기계가 범위를 확인한다.** 테스트가 데이터센터 단가(평당 1,000~2,000만 원), GPU당 서버 값, UPS·발전기의 kW당 값, 모든 시장에 근거 글이 있음을 확인한다.

## 이유
- 돈의 단위를 보여 주면서 크기가 틀리면, 잘못된 것을 배운다. 숫자 하나하나는 몰라도 **자릿수**는 현실과 같아야 한다.
- 추정을 확인처럼 보이게 하면 신뢰를 잃는다. 어느 값을 믿어도 되는지 사용자가 알아야 쓸 수 있다.
- 단가의 범위를 테스트로 묶으면, 나중에 누가 값을 바꿔도 터무니없는 값은 들어오지 못한다.

## 버린 대안
- **지도 위 모든 필지에 실제 공시지가**: 국토교통부 실거래가와 개별공시지가를 이 환경에서 읽을 수 없었다. 읽을 수 있게 되면 시장을 필지 단위로 바꿀 수 있는 모양(`landMarket`)은 열어 두었다.
- **건물 값을 MW당으로**: 업계는 MW당으로 말하지만 빌더는 공간을 그리는 도구라서 ㎡로 센다. MW당 값은 단가를 고르는 근거로만 썼다.
- **장비 값을 전부 다시 조사**: 값이 시장 범위 안인 모델까지 건드리면 근거 없는 변경이 늘어난다. 벗어난 것만 고쳤다.

## 결과
- 화성 기본 구성처럼 큰 월드의 "들인 돈"이 조 단위로 커진다. 현실도 그렇다.
- 땅값은 추정이 많다. 문서에서 숨기지 않는다.
