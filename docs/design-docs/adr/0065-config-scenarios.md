---
title: ADR-0065 설정 변경은 시나리오 블록이고, 블록은 외워 쓰지 않고 장비가 가진 것에서 고른다
kind: decision
status: active
last_verified: 2026-11-04
enforced_by:
  - tests/spec/config-scenarios.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
test_change_reason: 행동 종류 목록에 스위치 설정 변경(config_change)이 늘어서, 모르는 행동을 거절할 때 보여 주는 가능한 행동 목록 문장이 한 항목 길어졌다. 이 시험이 지키는 성질(모르는 행동과 없는 대상은 거절하고 진짜 목록을 알려 준다)은 그대로이고 기대 문장의 끝만 바뀐다.
decision_hash: 2000c3a44dc00202
---
# ADR-0065 설정 변경은 시나리오 블록이고, 블록은 외워 쓰지 않고 장비가 가진 것에서 고른다

## 맥락
연수 님이 "설정 변경이나 뭐 그래도 좀 여러 시나리오 할 수 있게는 해야지"라고 했다. 지금까지 시나리오는 부품이 망가지는 장애(팬, 냉방기, 트립)만 만들었다. 그런데 현장의 사고는 사람이 바꾼 설정에서 더 자주 난다: 포트를 잘못된 VLAN에 꽂고, 점검하다 포트를 끄고 켜는 걸 잊는다. 네트워크 모델(ADR-0061~0064)이 이런 설정이 만드는 단절을 이미 계산하니, 시나리오가 그 설정을 바꿀 수만 있으면 된다.
또 시나리오를 만드는 사람은 네트워크 엔지니어가 아닐 수 있다. 포트 번호나 BGP 이웃 주소를 외워서 입력하라고 하면 틀린 값을 넣고 나중에야 실행에서 안다.

## 결정
1. **조작 블록 여섯 개**를 더한다: `port_admin`, `port_vlan`, `svi_admin`, `bgp_admin`, `route_del`, `outlet_set`. 실행하면 운영자 명령(`link.admin`, `net.set`, `outlet.set`)을 월드에 낸다. 새 월드 명령은 만들지 않는다.
2. **값은 쓰지 않고 고른다.** 새 ParamSpec 종류 `net_pick`(`cabled_peer`, `svi_vlan`, `bgp_peer`, `static_route`, `outlet`)은 위에서 고른 장비(`dependsOn: "target"`)가 가진 것의 목록이다. 목록은 케이블이 설계한 네트워크(`planOf`)에서 나온다. 저장되는 값은 장비 아이디, VLAN 번호, "net/len via 주소", 콘센트 번호이고, 사람이 보는 이름은 라벨이다("srv-a1 (포트 3번)", "1번 — srv-a1").
3. **목록 검증은 블록 전체에서 한다.** 한 값이 다른 값(스위치)에 기대므로 ParamSpec 한 개의 검사로는 못 한다. `netBlockProblem`이 모든 `net_pick`을 `netChoices`와 대조해, 없는 값이면 "고를 수 있는 것"을 보여 주고, 고를 것이 아예 없으면 이유를 말한다.
4. **스위치를 바꾸면 그 스위치에 기댄 선택은 지운다.** 웹 `setParam`이 같은 값으로 다시 고르면 건드리지 않고, 다른 값이면 `dependsOn`이 그 매개변수인 `net_pick`들을 지운다.
5. **블록이 실행될 때는 지금 스위치의 설정을 읽는다.** 앞 블록이나 에이전트가 바꿨을 수 있으니 계획이 아니라 `netModelOf(world)`의 현재 설정으로 명령을 만든다(SVI의 주소를 그대로 두고 `shut`만 바꾼다).
6. **에이전트의 조치로 `config_change`를 더한다.** `network_cli`가 낸 `net.set`은 행동 `config_change`(대상은 스위치)이다. 포트 끄기는 이미 `port_off`/`port_on`이고, 케이블 이름과 함께 스위치 이름으로도 맞는다(`matchesAction`이 `device`를 본다). 알람 조건은 정확한 코드 또는 `코드.` 접두사에 맞아, `link_down.<케이블>`이나 `gpu_rail_degraded.2-7`처럼 뒤에 상세가 붙는 코드도 하나로 센다.
7. **실수에 이름을 붙인다.** `MISTAKE_SPECS`(엉뚱한 VLAN, 꺼진 포트, 꺼진 SVI, 꺼진 BGP 이웃, 지워진 경로, 꺼진 콘센트)는 장애 종류와 같은 진단 정답 자리에 들어간다. 블록 종류가 어떤 실수를 만드는지(`MISTAKE_OF_BLOCK`) 알려 줘서, 정답을 만드는 블록이 없다는 경고(SC021)가 설정 시나리오에서는 나지 않는다.
8. **내장 템플릿 일곱 개**(`NETWORK_TEMPLATES`)를 별도 목록으로 둔다. 기존 시험이 `SCENARIO_TEMPLATES`를 훑으며 장애 종류를 기대하기 때문이다. 템플릿은 중복된 길을 모두 막는다(SVI는 쌍을 모두 끄고, ECMP 경로는 모두 지운다). 하나만 건드리면 아무 일도 안 일어나는 걸 실험으로 확인했다.
9. **요구사항 REQ-068**을 더한다.

## 버린 대안
- **자유 입력(포트 번호, IP, 경로 문자열)**: 틀린 값이 실행까지 가서야 드러난다. 이 도구의 사용자는 네트워크 전문가가 아닐 수 있다.
- **블록마다 월드 명령을 새로 만들기**: 이미 `net.set`이 VLAN·포트·SVI·경로·BGP를 다 받는다.
- **한 블록이 여러 변경을 담기("설정 일괄")**: 무엇이 원인인지 채점과 진단이 흐려진다. 한 블록은 하나만 바꾼다.

## 한계 (정직하게)
- 호스트 이름·배너·설명 같은 통신과 무관한 설정, VLAN 신규 생성, 트렁크 허용 VLAN 목록 변경, 스패닝 트리 설정 블록은 없다.
- 템플릿 일곱 개뿐이다. 두 가지 설정 실수가 겹친 시나리오는 사람이 블록을 이어서 만들어야 한다.
- 편집기의 목록은 내장 카탈로그로 계산한다. 사용자 정의 카탈로그를 쓰는 월드에서는 서버 쪽 검증이 최종이다.
- 이미 올라 있는 `bgp_session_down` 알람은 처음 메시지를 간직해서, 다른 이웃을 더 끄면 메시지가 갱신되지 않는다.
