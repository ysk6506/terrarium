---
title: ADR-0101 랙 실장 장면, 컨테인먼트 안, 펌웨어 올리기 — 시험 세 개의 기대값을 고친다
kind: decision
status: active
enforced_by:
  - apps/web/src/logic/world3d/rack-front.test.ts
  - apps/web/src/logic/world3d/aisle.test.ts
  - apps/web/src/ui/world3d/rack-layer.test.ts
  - tests/spec/firmware.test.ts
  - tests/spec/firmware-scenarios.test.ts
  - tests/spec/controllability.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
  - tests/spec/controllability.test.ts::the list of what can be controlled is made of real things [REQ-069] > every world command is either on the list or named as no operator's
  - tests/spec/controllability.test.ts::=DRIVES
test_change_reason: 서버 펌웨어 올리기가 운영자가 바꿀 수 있는 것에 더해졌다. 그래서 행동 종류 목록에 "펌웨어 올리기"가 들어가 행동 조건의 오류 문장이 한 항목 길어지고, 제어 가능 요소표의 운영자 명령 목록에 firmware.update가 들어가고, 에이전트의 길마다 실제 호출로 시험하는 표(DRIVES)에 Redfish UpdateService 호출 한 줄이 더해진다. 재는 성질(표의 모든 길이 월드를 바꾸고 채점에 그 행동으로 잡힌다)은 그대로다.
decision_hash: 8eefdf5167de8085
---
# ADR-0101 랙 실장 장면, 컨테인먼트 안, 펌웨어 올리기

## 맥락
클로즈 베타 피드백 6·8·9(제품 책임자).
- **6**: 랙을 눌렀을 때 실장 보기가 "허접"하다. 서버가 평평한 상자로 나열돼 있고, 무슨 장비인지·비어 있는지·뒤가 어떤지 알 수 없다.
- **8**: 컨테인먼트 안을 들여다볼 수 없다. 지붕과 문이 가린다. 사람도 그 안을 걷지 않는다(ADR-0078은 "컨테인먼트 안은 걷지 않는다"고 정했다).
- **9**: 서버 펌웨어 작업을 시험하는 시나리오 템플릿이 없다. 월드에는 서버의 펌웨어 버전도, 올리는 길(Redfish UpdateService)도 없었다.

## 결정
1. **랙 실장 장면을 다시 만든다.** 42U 눈금(5U마다 굵게), 종류별 전면(1U·2U·GPU 서버, 스토리지, 스위치: 베젤 색, 드라이브 베이 열, 전원 LED, 활동이 있을 때만 깜빡이는 네트워크 LED), 빈 U의 블랭크 패널과 맨 위 ToR 자리, 뒤쪽 좌우 수직 트레이에 묶인 케이블(네트워크 파랑, 전원 빨강·검정). 서버를 누르면 서버가 살짝 나오고 랙이 0.6초 돌아 뒷면(PSU·팬·포트·전원선)이 보이며, 다시 누르면 앞면, Esc는 서버를 넣는다. 모든 것은 재질별로 합쳐 그려서 42U가 다 찬 랙이 그리기 호출 60회(그림자 포함) 이하이고, 줄이기 단계가 1 이상이면 LED는 깜빡이지 않는다. 장면의 모양을 정하는 수는 `logic/world3d/rack-front.ts`에, 그리는 코드는 `ui/world3d/rack-*.ts`에 둔다.
2. **컨테인먼트 안을 들여다본다.** 컨테인먼트를 누르면 그 컨테인먼트의 지붕과 문이 0.6초 동안 투명해지고(움직임 줄이기에서는 바로) 카메라가 복도 끝에서 눈높이로 들어간다. 안에서는 양쪽 랙 전면이 보이고, 찬 복도와 더운 복도는 바닥 색으로 옅게 나뉜다. 나가기는 Esc나 "복도 나가기" 버튼이고, 경로 줄에 "컨테인먼트 … 안"이 붙는다. **이 모드에서는 사람이 그 복도를 걷는다.** `crew-route.ts`의 막힌 칸에서 들여다보는 컨테인먼트만 빼고(`podBlocks(scene, except)`), 첫 엔지니어가 그 복도 가운데선을 순찰한다. 그 밖에는 ADR-0078 그대로 컨테인먼트 안을 걷지 않는다.
3. **서버에 펌웨어 버전과 올리는 길을 둔다.** 서버 상태에 `bmcVersion`, `biosVersion`(블루프린트의 서버 속성으로 정할 수 있고, 정하지 않으면 BMC는 프로파일의 자기 버전, BIOS는 1.0.0), `rebooting`; 랙 상태에 `rebootPeak`(한 랙에서 동시에 재부팅한 서버 수의 최대). Redfish `UpdateService`의 `SimpleUpdate`(`ImageURI`의 파일 이름이 `bmc-8.40.bin`, `bios-2.4.1.bin`)가 월드 명령 `firmware.update`가 되고, 2분 뒤 서버가 꺼지고(`firmware.reboot`) BIOS는 4분, BMC는 2분 뒤 끝난다(`firmware.finish` 또는 `firmware.fail`). 시간이 가는 일은 물리 엔진이 하고 모두 사건으로 남아 채점이 읽는다. 재부팅 중에는 서버가 꺼진 것으로 보이고 그 서버의 가상 머신이 멈추며, BMC를 올리는 동안은 BMC가 503으로 답한다. 툴은 기존 `redfish_request`로 충분하다. 실패는 고장 종류 "펌웨어 올리기 실패"(`firmware_update_failure`, 실패하는 횟수 1~3)로 시나리오가 정한다. 실패한 서버는 이전 버전으로 돌아와 경고 알람을 달고, 다시 올리거나 이전 이미지로 되돌려 성공하면 알람이 풀린다.
4. **채점에 "작업 보고"를 더한다.** 올리기에는 찾을 고장이 없으므로 진단의 고장 종류에 일 종류 `firmware_update`(펌웨어 올리기)를 쓸 수 있다. 행동 종류에 `firmware_update`, 사건 네 개, 조건 필드(서버의 BMC·BIOS 버전과 재부팅 중, 랙의 동시 재부팅 최대)를 더한다.
5. **템플릿 묶음 "펌웨어 작업" 셋.** (a) 서버 한 대 올리기: 서비스(가상 머신)가 없는 서버를 골라 BMC와 BIOS를 올리고 돌아올 때까지 확인한다. 서비스가 도는 서버에 올리면 1회 −40점. (b) 랙 단위 차례로 올리기: 서버를 한 대씩, 한 랙에서 둘 이상이 동시에 재부팅하면 그 점수를 못 받는다. (c) 올리다 실패했을 때: 한 대가 한 번 실패하고, 다시 올리거나 되돌리고 나머지는 계속한다. 셋 모두 기준 에이전트(아무것도 안 함, 찍기, 정답만 앎)가 아무것도 못 받고 정답만 알면 40~50점이어야 한다.

## 이유
- 실장 장면은 "어떤 장비가 어디에 얼마나 꽂혀 있나"가 한눈에 읽혀야 하고, 뒷면이 보여야 전원·네트워크 선이 이야기가 된다. 그리기 호출을 60회로 묶는 것은 건물 하나에 랙이 수백 대 있는 장면과 한 화면에 있기 때문이다.
- 컨테인먼트 안은 데이터센터에서 가장 자주 들어가 보는 곳이다. 들어가 봤는데 사람이 없으면 이상하다. 그래서 보는 동안만 막힌 칸을 푼다.
- 펌웨어 올리기는 서버 운영자가 하는 가장 흔한 계획 작업이고, "서비스를 건드리지 않았나", "동시에 내리지 않았나"처럼 고장이 없어도 운영 능력이 갈린다. 채점이 읽을 수 있게 시간이 가는 일을 사건으로 남긴다.

## 버린 대안
- **펌웨어 올리기 전용 툴**: 사람이 BMC로 하는 일이고 에이전트도 같은 길(Redfish)로 해야 비교가 공정하다.
- **채점에 "동시 재부팅" 조건 종류를 새로 두기**: 조건 종류는 편집기·계약·문서 일곱 곳을 건드린다. 랙 상태에 숫자 하나를 두면 기존 상태 조건으로 말할 수 있고, 편집기에서도 고를 수 있다.
- **올리기를 즉시 끝내기**: 재부팅 중 서버가 꺼져 있고 서비스가 멈춘다는 것이 작업의 위험이다.
- **랙 장면의 케이블을 하나씩 그리기**: 수백 개라 예산을 넘고, 읽히지도 않는다.
- **컨테인먼트 지붕 전체를 늘 투명하게**: 건물 단면에서 컨테인먼트가 보이지 않으면 어느 방이 닫힌 복도인지 알 수 없다.

## 결과
- 고쳐진 시험: `actions.test.ts`의 행동 목록 문장에 "펌웨어 올리기"가 더해졌다. `controllability.test.ts`는 운영자 명령 목록에 `firmware.update`를, 에이전트의 길 표(DRIVES)에 Redfish 호출 한 줄을 더했다. 다른 줄은 그대로다. 물리 정답 기록(`physics-golden.json`)은 서버·랙 상태에 필드가 늘어 다시 기록했다(재는 값은 같은 엔진의 같은 입력이다).
- 새 시험: `rack-front.test.ts`, `aisle.test.ts`, `rack-layer.test.ts`(그리기 호출 예산), `firmware.test.ts`(Redfish, 재부팅, 실패, 동시 재부팅, 스키마 대조), `firmware-scenarios.test.ts`(기준 에이전트와 일하는 에이전트 점수).
- 한계: 펌웨어 버전 비교는 글자 비교(`==`)뿐이고, 버전이 낮아지는 올리기(되돌리기)와 같은 버전 올리기도 막지 않는다. 이미지 이름은 `bmc-버전.bin`, `bios-버전.bin`만 안다. BMC 업데이트도 서버를 재부팅하는 것으로 줄였다(실제로는 BMC만 다시 뜬다).
- 한계: 브라우저(소프트웨어 렌더링)에서 본 그리기 호출과 모양은 이 환경의 것이다. 그래픽 카드가 있는 PC에서는 사람이 다시 본다.
