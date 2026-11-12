---
title: ADR-0183 화면의 모든 글은 한 가지 말을 쓰고, 옛 말이 돌아오지 못하게 검사한다
kind: decision
status: active
last_verified: 2026-11-12
enforced_by:
  - WORD001
  - harness/src/checks/ui-words.test.ts
touches_protected:
  - harness/config/ui-words.yaml
  - harness/config/test-lock.json
  - harness/src/checks/ui-words.ts
  - harness/src/checks/ui-words.test.ts
  - harness/src/run-all.ts
  - harness/src/common.test.ts
  - docs/design-docs/adr/0171-result-page-answers-three-questions.md
amends_tests:
  - apps/server/src/runtime/platform.test.ts::forks, more runs and lineage [REQ-040] > more runs continue the seeds; repeating a seed or someone else's experiment is refused
  - apps/server/src/runtime/repeats.test.ts::repeats of a seed [REQ-118] > adding a repeat gives every seed one more run; adding seeds gives them the repeats it has now
  - apps/web/src/logic/editor-units.test.ts::durations are minutes wherever people read them [REQ-071] > canvas summaries and dry-run lines say minutes
  - apps/web/src/logic/editors.test.ts::the scenario canvas [REQ-034] > a template becomes nodes and wires, each node saying what it does and what is wrong with it
  - apps/web/src/logic/editors.test.ts::the scoring sheet [REQ-034] > add, change and remove items; the total aims at 100
  - "apps/web/src/logic/human-talk.test.ts::escalation and runbook compliance on a result [REQ-081] [REQ-082] > three figures: how often it asked, how long a person kept it waiting, what people did"
  - apps/web/src/logic/operation-text.test.ts::the operation screens word each measure by what is known of it [REQ-090] > the pace note says whether the score is official, and a run stopped by the call limit says which limit
  - apps/web/src/logic/operation-text.test.ts::the operation screens word each measure by what is known of it [REQ-090] > tokens and calls per incident appear only when the harness told them
  - apps/web/src/logic/progress-words.test.ts::how far an experiment got reads as stopped when a person stopped it [REQ-030] > a stopped experiment says what it planned beside what ended
  - apps/web/src/logic/progress-words.test.ts::how far an experiment got reads as stopped when a person stopped it [REQ-030] > the other states say it as before
  - harness/src/common.test.ts::check entry points [REQ-024] > run-all runs every check and prints a verdict
  - packages/core/src/analysis/share.test.ts::diagnosis records and the modelling brief [REQ-015] > the brief hands the simulator developer where the world is thin
  - "packages/core/src/analysis/share.test.ts::sharing results as text, Markdown and HTML [REQ-038] > Markdown: tables survive names and summaries with pipes in them"
  - "packages/core/src/contract/contract.test.ts::experiments: create, fork, add runs [REQ-030] [REQ-040] > a fork changes only what it names; adding runs says how many or which seeds"
  - "packages/core/src/contract/contract.test.ts::experiments: create, fork, add runs [REQ-030] [REQ-040] > a recipe takes seeds or a run count, not both; seeds are unique"
  - packages/core/src/experiments/experiments.test.ts::recipes [REQ-030] [REQ-031] > a sound recipe has no problems; every problem is named in Korean
  - packages/core/src/oracle/end-label.test.ts::how an operation says it ended [REQ-090] > the hours used up, a person's stop and the call limit are told in an operation's own words
  - "packages/core/src/oracle/oracle.test.ts::oracle: state, actions and efficiency [REQ-007] [REQ-037] > required and forbidden actions are judged by effect, whichever tool caused them"
  - "packages/core/src/oracle/oracle.test.ts::oracle: state, actions and efficiency [REQ-007] [REQ-037] > time and tool budget count only when a diagnosis was submitted"
  - packages/core/src/sources/worldgen/worldgen.test.ts::worldgen limits [REQ-009] > a spec outside the limits is refused with every reason in Korean
  - apps/server/src/http/scoring-unchanged.test.ts::=SCORE_FINGERPRINTS
  - tests/spec/golden-scenario-campus.test.ts::=EXPECTED
  - tests/spec/golden-scenario-fabric.test.ts::=EXPECTED
  - tests/spec/golden-scenario-iap.test.ts::=EXPECTED
  - tests/spec/golden-scenario-sdn.test.ts::=EXPECTED
  - tests/spec/golden-scenario-train.test.ts::=EXPECTED
updates_docs:
  - docs/design-docs/glossary.md
  - docs/design-docs/glossary-data.md
  - docs/design-docs/web-ui.md
  - docs/design-docs/process-compare.md
  - docs/design-docs/tool-scope-and-sop.md
  - docs/design-docs/experiments-and-analysis.md
  - docs/design-docs/operation-mode.md
  - docs/design-docs/world-sources.md
  - docs/design-docs/http-api.md
  - docs/design-docs/ranking-and-titles.md
  - docs/guides/operation-agent-guide.md
amends:
  - adr: "0171"
    what: 목록과 홈은 아직 회라는 말(5번)
test_change_reason: 제품 책임자가 화면의 말이 화면마다 달라 어지럽다고 지적했다. 세는 말을 "번" 하나로, 시드를 "상황"으로, 에스컬레이션을 "넘기기"로 맞추면서 이 시험들이 단정하던 문장(3회, 시드 1는 이미 있어요 같은 것)이 바뀌었다. 시험이 확인하는 성질(숫자가 맞게 세어지고 같은 사실을 말한다)은 그대로이고 문장의 말만 바뀌었다. common.test.ts는 구조 검사가 하나 늘어서 검사 이름 목록이 바뀌었다.
decision_hash: 4aa71f3d4649f88c
---
# ADR-0183 화면의 모든 글은 한 가지 말을 쓰고, 옛 말이 돌아오지 못하게 검사한다

## 맥락
제품 책임자의 지적: 화면마다 말이 달라 어지럽다. 실험 목록은 "1회"라고 하는데 결과 쪽은 "1번"이라고 한다. 결과 쪽은 [ADR-0171](0171-result-page-answers-three-questions.md)로 한 가지 말로 다시 썼지만 목록, 홈, 시나리오 편집기, 서버 메시지, 보고서는 옛 말 그대로였다. 용어집도 서로 어긋난 데가 있었다(만들기 요약은 "5회 실행"이라고 적고, 결과는 "번으로 센다"고 적었다).

글 잣대 시험(`app-words.test.ts`, `world-words.test.ts`)은 화면 몇 곳만 본다. 새 화면과 서버 메시지는 그 밖이어서 옛 말이 계속 들어왔다.

## 결정
1. **말은 하나다.** 읽는 사람이 쓰는 말만 바꾸고, 코드 이름·API 필드·저장된 데이터는 그대로 둔다.
   - 계층은 **실험 › 상황 › 실행**이다. 코드의 `seed`는 사용자에게 "상황"이다. 세계를 다시 만드는 번호만 "다시 만들기 번호"다.
   - 세는 말은 **번** 하나다: "15번 중 7번", "툴 호출 3번", "3번째". "회", "회차", "횟수"를 쓰지 않는다. 횟수가 필요하면 "몇 번"이나 "부른 수"로 풀어 쓴다.
   - 결과는 **합격 / 불합격**과 **점수**다.
   - 세계 모델의 말은 **객체**와 **링크**다(개체, 관계가 아니다). 종류를 말할 때는 용어집(`glossary-data.md`)의 "객체 타입", "링크 타입"이다. 보통 글의 "관계없이" 같은 말은 그대로다.
   - 도메인 팀과 사람에게 일을 넘기는 것은 **넘기기**, 결과는 "넘긴 일"이다(용어집이 이미 정한 말). 툴 이름 `escalate`는 그대로다.
   - 용어집이 말을 이미 주었으면 그것을 쓴다([ADR-0167](0167-data-pipeline-words-from-practice.md)). 용어집끼리, 또는 용어집과 ADR-0170·0171이 어긋나면 ADR이 이긴다.
   - 문장은 해요체, 쉬운 말, 사용자가 다음에 할 수 있는 일을 말한다. 우리말이 용어집에 있는 자리에 영어를 쓰지 않는다(옛 "E2E로 가려면"은 "세계 범위" 탭과 "이 세계에 필요한 액션"이 되었다).
2. **옛 말 목록과 검사.** `harness/config/ui-words.yaml`이 규칙(찾을 말의 패턴, 대신 쓸 말)과 예외(정확한 구절 또는 경로 glob, 둘 다 이유를 적는다)를 가진다. 구조 검사 `harness/src/checks/ui-words.ts`가 `apps/web/src`, `apps/server/src`, `packages/core/src`의 시험 아닌 파일에서 문자열 리터럴, 템플릿 글, JSX 글, 이끼가 읽는 한글 필드 이름을 훑고, 걸리면 `WORD001`로 파일·줄·찾은 말·대신 쓸 말을 알려 준다. 주석, import 경로, 영어 글은 보지 않는다. 목록이나 예외가 잘못되면 `WORD002`다.
3. **오탐은 0에 가깝게.** 규칙은 숫자 뒤나 낱말 단독의 "회"(앞뒤에 한글이 있으면 회사·회색 같은 다른 낱말이다), "회차", "횟수", "시드", "개체", "에스컬레이션", 모델 명사구("관계 종류", "관계 잇기", "라벨·관계")만 잡는다. "관계" 한 낱말은 잡지 않는다. 예외는 하나다: 이끼가 사람이 친 옛 말("횟수 5번으로 정해 줘")을 알아듣는 별칭이다. 화면에 보이지 않는다.
4. **한 가지 말이 된 곳.** 실험 목록·홈·만들기의 진행과 대기 문장, 툴 호출과 상한 문장, 시나리오 편집기의 단위와 문장, 운영 결과의 숫자 카드, 서버의 검증 메시지, 채점 이유, 알람·토폴로지 줄, 보고서(Markdown·HTML)의 열 이름, 이끼에게 주는 상태의 필드 이름, 용어집과 웹 화면 문서. 문장이 단어 하나로 어색해지면 문장을 다시 썼다.
5. **잠긴 시험.** 위 문장을 단정하던 시험은 `amends_tests`에 적고 말만 바꿨다. UX 여정(`tests/e2e/ux`)에서 글로 고르는 곳도 바꿨다.
6. **채점의 골든은 글자만 바뀌었다.** 점수 설명 문장("툴 호출 3번 (상한 3번)")과 알람 문장이 지문(해시)에 들어 있어서, 말을 바꾸면 채점 골든(`golden-scenario-*`)과 `scoring-unchanged`의 지문, `physics-golden.json`의 해시가 바뀐다. 다시 만들기 전에 옛 코드와 새 코드로 같은 실행을 돌려, 한글이 든 글자 값만 지우고 나머지를 견주었다. 골든 시나리오 132건은 총점, 항목별 id·판정·점수·배점, 합격 여부, 풀이 뒤 세계 상태가 모두 같았다(다른 건수 0). 물리 골든은 13개 세계의 1,176 단계가 모두 같았고, 채점 지문의 두 실행(`triage`, `guess`)도 같았다. 달라진 글자는 점수 설명 문장 두 가지("툴 호출 N번 (상한 M번)"과 그 뒤에 "— 과제를 푼 만큼(60%)만 인정해요"가 붙은 것)와 알람 문장의 "재시작 N번째", "플랩 N번"뿐이다. 그래서 새 지문은 이 증명 뒤에 다시 만들었다.
7. **저장된 글자는 고치지 않는다.** 점수 항목의 설명 문장은 실험 결과 기록에 글자로 저장된다. 옛 실험은 옛 말, 새 실험은 새 말로 보인다. 저장된 기록을 고쳐 쓰는 이행은 하지 않는다.

## 이유
- 한 사람이 목록에서 결과로 넘어갈 때 같은 것이 다른 이름이면 읽는 일이 한 번 더 든다.
- 화면 몇 곳만 보는 시험은 새 글이 들어오는 길을 막지 못한다. 글이 만들어지는 소스 전체를 한 목록으로 보면 새 화면도 같은 말을 쓴다.

## 대안과 버린 이유
- **용어집만 고치고 시험은 두기**: 용어집만 고쳤을 때 옛 말이 돌아왔다.
- **"관계"를 통째로 금지하기**: "관계없이", "냉방 관계가 없는 랙" 같은 보통 글을 틀리게 만든다. 모델 명사구만 잡는다.
- **모든 용어집 "쓰지 않는 말"을 한꺼번에 검사하기**: 많은 말이 자리에 따라 맞기도 하다("대기", "작업", "서버"). 뜻이 하나로 정해진 말만 규칙으로 올리고, 나머지는 용어집에 두고 고칠 때 한 번씩 본다.

## 범위 밖
- 실제 장비의 CLI를 흉내 내는 툴 출력(영어), 코드 식별자, API 필드, 영어로 쓴 시험 이름.
- ADR 본문(봉인), `product-design.md` 4절, `requirements.md`(보호 경로이며 인용 문장이 많다).
- 권한, CI, 문서 검사에 속한 파일은 문자열 안의 낱말 하나를 바꾸는 것 말고는 건드리지 않았다.

## 결과
`ui-words.yaml`, `ui-words.ts`와 시험, `run-all.ts`의 한 줄, 용어집의 "한 가지 말" 절, 웹 화면 문서의 인용 문장. 구조 검사는 `ui-words` 이름으로 돈다.
