---
title: ADR-0076 운영 채점으로 채점표와 기대값이 달라진 시험 열네 개의 기대값을 고친다
kind: decision
status: active
enforced_by:
  - tests/spec/operation-scoring.test.ts
touches_protected: []
amends_tests:
  - apps/server/src/runtime/hosts.test.ts::session hosts run the same session the same way [REQ-001] [REQ-032] > in-process and worker threads give identical results
  - apps/server/src/runtime/platform.test.ts::an experiment from creation to result [REQ-030] [REQ-037] > the built-in triage agent solves the cooling failure three times out of three
  - "packages/core/src/analysis/analysis.test.ts::one run, analysed [REQ-037] > a correct diagnosis: score, timing, tool use and when the answer was first looked at"
  - packages/core/src/analysis/analysis.test.ts::an experiment across its runs [REQ-037] > pass rate, accuracy and spread over completed runs; failures counted apart
  - "packages/core/src/analysis/share.test.ts::sharing results as text, Markdown and HTML [REQ-038] > text to paste: what ran, the key numbers, findings and the link"
  - "packages/core/src/analysis/share.test.ts::sharing results as text, Markdown and HTML [REQ-038] > Markdown: tables survive names and summaries with pipes in them"
  - "packages/core/src/analysis/share.test.ts::diagnosis records and the modelling brief [REQ-015] > one record per completed run: the truth, the answer, and how it got there"
  - packages/core/src/analysis/share.test.ts::diagnosis records and the modelling brief [REQ-015] > an empty record set still gives a readable brief; easy faults are flagged too
  - packages/core/src/scenario/scenario.test.ts::scenario blocks [REQ-034] > every block explains itself in Korean, and planned blocks say why they are unavailable
  - packages/core/src/scenario/scenario.test.ts::scenario palette [REQ-034] > blocks the simulator does not support yet are shown disabled, with the reason
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > unknown and not-yet-supported blocks are refused with the reason
  - "packages/core/src/session/session.test.ts::session lifecycle [REQ-007] [REQ-030] > a full run: warm-up, scenario, agent calls, diagnosis, scoring"
  - tests/spec/calibration.test.ts::every built-in scenario tells an agent that knows from one that does not [REQ-070] [REQ-007] > the scenarios that give full marks for the answer alone are exactly these (they measure diagnosis, not operation)
  - tests/spec/controllability.test.ts::the list of what can be controlled is made of real things [REQ-069] > every world command is either on the list or named as no operator's
test_change_reason: REQ-073은 내장 시나리오 채점표가 사실만 말하고, 정전·VM 폭주·CDU 정지는 조치와 최종 상태를 채점하라고 한다(ADR-0075). 채점 항목과 점수 합이 달라져 정답만 낸 실행의 점수가 100에서 90.9나 65로 바뀌었고, 블록 목록에 외기 온도가 늘었다. 시험이 확인하는 일은 그대로이고 기대 숫자와 문장만 바꿨다.
decision_hash: edc11d144f5a520c
---
# ADR-0076 운영 채점으로 채점표와 기대값이 달라진 시험 열네 개의 기대값을 고친다

## 맥락
ADR-0075는 내장 시나리오의 채점표를 사실에 맞추고, 정전·발전기 기동 실패, VM CPU 폭주, CDU 정지에 조치와 최종 상태 채점을 넣었다. 냉방기 정지에는 다른 냉방기 설정 온도 낮추기를 필수 조치(10점)로 더했다. 요구사항은 REQ-073이다.
이 변화는 이미 잠긴 시험 열네 개의 기대값을 바꾼다.
- 냉방기 정지의 채점표에 10점짜리 조치가 늘어, 진단만 맞힌 실행의 만점이 100에서 90.9가 된다. 세션, 분석, 공유, 플랫폼, 호스트 시험이 이 숫자와 거기서 나온 문장("평균 점수", "90.9점")을 기대값으로 적어 두었다.
- 변별력 시험(calibration)의 "정답만으로 만점" 목록에서 냉방기 정지가 빠진다. ADR-0075 본문은 이 목록이 넷으로 줄어든다고 적었지만, 냉방기 정지에 필수 조치를 더하면 정답만 낸 실행은 100점이 될 수 없다. 실제로 코드가 내는 목록은 셋(팬 고장, 센서 오차, 냉각 플랜트 정지)이고, 이 글이 그 사실을 적는다.
- `set_outdoor_temp`가 계획에서 지원으로 옮겨져 계획 블록은 `network_degrade` 하나만 남고, 그 사유 문장도 링크 지연·손실 모델이 없다는 말로 바뀐다. 블록 설명·팔레트·검증 시험의 기대 문장이 이에 따라 바뀐다. 제어 가능 요소표에는 `outdoor.set` 줄이 늘어 명령 목록 시험의 기대 배열이 바뀐다.
시험은 잠겨 있어서 요구사항이 바뀐 근거를 ADR로 남겨야 고칠 수 있다.

## 결정
1. 열네 시험의 **기대값만** 새 채점표에 맞춘다. 무엇을 확인하는지, 단언의 개수와 대상은 바꾸지 않는다.
2. 변별력 시험의 "정답만으로 만점" 목록은 `fan-failure-throttle`, `plant-loop-down`, `sensor-drift` 셋으로 고정한다. 냉방기 정지는 90.9점이라 목록에서 빠진다.
3. 조치를 채점하는 새 시험은 `tests/spec/operation-scoring.test.ts`에 새로 적는다(정답만 아는 실행은 70점 아래, 정답과 조치를 함께 한 실행은 90점 이상이고 25점 넘게 높다). 새 시험이라 잠금에는 추가만 된다.
4. 이 ADR이 고치는 시험은 위 목록뿐이다. 목록에 없는 잠긴 시험은 바뀌면 여전히 거부된다.

## 버린 대안
- **냉방기 정지의 필수 조치를 빼서 목록을 넷으로 맞추기**: 그 조치가 물리가 보상하는 유일한 조작이라는 ADR-0075의 판단과 어긋난다. 샘플 캠퍼스에서 차이가 작다는 것은 문서에 적었다.
- **필수 조치에 0점을 주어 합계를 100으로 두기**: 점수가 없는 조치는 채점이 아니다.
- **옛 숫자를 시험에서 지우고 단언을 느슨하게 만들기**: 시험이 지키던 것이 사라진다. 숫자를 새 값으로 바꾸기만 했다.

## 한계
- 열네 시험이 새 숫자를 적고 있으므로, 채점표 무게를 다시 조정하면 같은 시험이 또 바뀐다. 숫자 대신 계산식으로 쓰는 것은 시험을 읽기 어렵게 해서 하지 않았다.
- 이 ADR은 `apps/web/src/logic/app-words.test.ts`의 변경을 다루지 않는다. 그것은 공기 흐름 작업(ADR-0074)에 딸린 것이다.
