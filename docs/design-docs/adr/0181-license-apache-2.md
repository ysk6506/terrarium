---
title: ADR-0181 테라리움의 라이선스는 Apache License 2.0이다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - none
no_enforcement_reason: 라이선스 파일과 표기를 두는 결정이다. 들여오는 의존성과 묶어 내는 파일의 라이선스가 이것과 맞는지 보는 검사는 이어지는 변경에서 더한다.
touches_protected:
  - package.json
  - apps/server/package.json
  - apps/web/package.json
  - packages/core/package.json
  - harness/package.json
  - AGENTS.md
decision_hash: 2018ecb30a2d4c19
amended_by:
  - adr: "0185"
    what: 묶을 수 있는 라이선스 목록에 MPL-2.0을 수정 안 한 것만 더함
---
# ADR-0181 테라리움의 라이선스는 Apache License 2.0이다

## 맥락
저장소는 GitHub에 공개돼 있는데 라이선스가 없었다. `LICENSE` 파일도, `package.json`의 표기도 없었다. 라이선스가 없는 공개 저장소는 기본적으로 모든 권리가 보유된 상태라서, 사내 사용자가 내려받아 쓰는 근거가 적혀 있지 않았다. 흉내 OS의 유틸리티를 GPL 프로그램(BusyBox)으로 바꾸는 제안(이슈 #47)을 검토하다가 드러났다.

제품 책임자(연수 님)의 결정: 테라리움은 Apache 2.0으로 한다.

## 결정
1. **라이선스는 Apache License 2.0이다.** 저장소 맨 위에 `LICENSE`(전문)를 두고, 모든 `package.json`에 `"license": "Apache-2.0"`을 적고, README에 한 줄을 둔다.
2. **Apache 2.0과 함께 내보낼 수 없는 것은 묶지 않는다.** 저장소에 넣거나 설치할 때 받아 묶는 코드·바이너리·글꼴·그림은 허용적 라이선스(MIT, BSD, ISC, 0BSD, Apache-2.0, SIL OFL 같은 것)여야 한다. GPL·AGPL 계열은 묶지 않는다. 그래서 이슈 #47의 유틸리티 후보에서 BusyBox(GPL-2.0-only)는 뺀다.
3. **들여온 것의 고지를 정리한다.** 의존성과 묶어 내는 파일(글꼴 포함)의 라이선스 목록과 필요한 고지를 `THIRD_PARTY_NOTICES`로 만든다. 지도에서 옮긴 사업장 외곽선처럼 바깥 자료에서 온 것은 출처와 그 자료의 이용 조건을 함께 확인한다.
4. **저작권자 표기는 제품 책임자가 정해 주면 `NOTICE`에 적는다.** 그전에는 적지 않는다(지어내지 않는다).

## 이유
- Apache 2.0은 사내에서 내려받아 쓰는 데 필요한 권리(사용·수정·재배포)와 특허 조항을 분명히 준다.
- 묶는 것의 라이선스를 정해 두지 않으면 의존성 하나가 저장소 전체의 조건을 바꾼다.

## 버린 길
- **라이선스 없이 두기**: 쓰는 근거가 없다.
- **GPL 계열로 가서 BusyBox를 쓰기**: 유틸리티 몇 개를 위해 제품 전체의 조건을 바꾸는 일이다.

## 남은 일
- 의존성과 묶는 파일의 라이선스 조사와 `THIRD_PARTY_NOTICES`.
- 새 의존성을 들일 때 라이선스를 보는 검사(`ARCH020`의 계약에 라이선스 칸).
- 저작권자 표기.

## 결과
`LICENSE`, 다섯 `package.json`의 표기, README의 "라이선스" 절.
