---
title: ADR-0102 서비스·OS 층을 구현하면서 시험 다섯 개의 기대값을 고친다
kind: decision
status: active
enforced_by:
  - packages/core/src/physics/service-os.test.ts
  - tests/spec/service-tools.test.ts
  - tests/spec/os-scenarios.test.ts
  - tests/spec/controllability.test.ts
  - apps/web/src/logic/builder/service-edit.test.ts
touches_protected:
  - docs/design-docs/adr/0091-service-os-layer-recovery-first.md
amends_tests:
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
  - packages/core/src/world/world-edges.test.ts::lookups and labels at the edges [REQ-001] > only the four virtual kinds are virtual
  - packages/core/src/world/test-support/sample-campus.ts::=campusBlueprint
  - tests/spec/controllability.test.ts::the list of what can be controlled is made of real things [REQ-069] > every world command is either on the list or named as no operator's
  - tests/spec/controllability.test.ts::=DRIVES
test_change_reason: 세계에 서비스 종류가 더해져 "가상 종류"가 다섯이 되고, 운영자가 바꿀 수 있는 것에 서비스 옮기기·VM 옮기기·호스트 조치가 더해졌다. 그래서 행동 종류 목록 문장이 여섯 항목 길어지고, 운영자 명령 목록에 host.act·service.failover·vm.migrate가 들어가고, 에이전트의 길마다 실제 호출로 시험하는 표(DRIVES)에 일곱 줄이 더해지고, 모든 종류를 쓰는 캠퍼스 표본에 서비스가 하나 더해졌다. 재는 성질(표의 모든 길이 월드를 바꾸고 채점에 그 행동으로 잡힌다)은 그대로다.
decision_hash: 1eef0f0b808fb5b6
---
# ADR-0102 서비스·OS 층을 구현하면서 시험 다섯 개의 기대값을 고친다

## 맥락
ADR-0091의 결정 1·2(서비스 층, OS 층 1차)를 구현했다. 구현이 세계의 종류, 운영자의 명령, 행동 종류를 늘리므로 그 목록을 세던 시험 몇 개의 기대값이 달라진다. 시험의 성질은 그대로이고 세는 대상이 늘었다.

## 결정
1. 엔티티 종류 `service`를 더한다. 가상 종류(자기 자리가 없는 것)가 넷에서 다섯이 된다(`world-edges.test.ts`).
2. 행동 종류 여섯(서비스를 대기 쪽으로 옮기기, 서비스 다시 시작, 프로세스 다시 시작, 디스크 비우기, 파일시스템 다시 마운트, VM 다른 서버로 옮기기)을 더한다. 행동 조건의 오류 문장이 이를 나열한다(`actions.test.ts`).
3. 제어 가능 요소표에 일곱 줄(호스트 프로세스·디스크·마운트·재부팅, 서비스 대기 쪽으로 옮기기, VM 옮기기)을 더한다. 운영자 명령은 `host.act`, `service.failover`, `vm.migrate`가 더해지고, 에이전트의 길 표(DRIVES)에 일곱 줄이 더해진다(`controllability.test.ts`).
4. 모든 종류를 쓰는 캠퍼스 표본(`sample-campus.ts`)에 서비스 하나(사내 포털, VM 위, 대기는 다른 서버)를 더한다. "표본이 모든 종류를 쓴다"는 시험을 지키기 위해서다.
5. 물리 정답 기록(`physics-golden.json`)을 다시 기록했다. 표본 방은 기존 44개 해시가 하나도 바뀌지 않았고 새 고장 열 개의 20줄만 늘었다. 생성된 세계 세 개의 해시는 생성기가 서비스를 깔아 상태에 서비스가 들어갔기 때문에 바뀌었다(엔진의 같은 입력, 늘어난 세계).
6. ADR-0091의 앞부분(front matter)에서 `enforced_by`를 이 구현의 시험으로 바꾸고 `no_enforcement_reason`을 지운다. 본문은 그대로다.

## 이유
- 목록을 세는 시험은 목록이 늘 때마다 고치게 되어 있다. 시험이 지키려는 것(목록의 모든 줄이 실제 툴·블록·행동이고 모든 길이 세계를 바꾼다)은 새 줄에도 같은 방식으로 적용된다.
- 캠퍼스 표본에 서비스를 넣는 쪽이 "모든 종류를 쓰는가" 시험을 느슨하게 하는 것보다 낫다.

## 버린 대안
- **서비스를 가상 종류로 두지 않기**: 서비스는 자기 자리(방·랙)가 없고 건강이 아래 장비에서 계산된다. 가상 종류가 맞다.
- **물리 정답 기록을 건드리지 않기**: 생성된 세계에 서비스가 깔리는 것이 이 변경의 일부라 해시가 달라지는 것이 맞다. 표본 방이 그대로라는 것으로 엔진 자체가 같다는 것을 확인했다.

## 결과
- 새 시험: `service-os.test.ts`(건강 규칙·고장 열 가지·번짐), `service-tools.test.ts`(툴 설명 표준·서비스 툴·가짜 셸), `os-scenarios.test.ts`(OS 고장 템플릿 다섯과 기준 에이전트), `service-edit.test.ts`(빌더).
- 한계: 가짜 셸은 허용 명령 목록뿐이고 진짜 OS가 아니다. 컨테이너(kubectl)는 2차다. 시간당 피해 기본값은 추정이다.
