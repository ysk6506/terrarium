---
title: ADR-0180 문서는 코드뿐 아니라 결정도 따라간다 — 결정이 바꾸는 문서를 적고, 고쳐진 결정에 표시를 남기고, 목록은 만들어 낸다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - DOC010
  - DOC090
  - DOC091
  - DOC092
  - DOC093
  - DOC094
  - DOC095
  - DOC096
  - DOC097
  - DOC098
  - harness/src/checks/doc-follow.test.ts
  - harness/src/checks/doc-claims.test.ts
  - harness/src/checks/doc-facts.test.ts
  - harness/src/checks/doc-diff.test.ts
  - harness/src/checks/doc-audit.test.ts
  - harness/src/checks/doc-decisions.test.ts
updates_docs:
  - AGENTS.md
  - README.md
  - docs/index.md
  - docs/design-docs/product-design.md
  - docs/design-docs/adr-process.md
  - docs/design-docs/harness-guide.md
  - docs/design-docs/core-beliefs.md
  - docs/design-docs/moss.md
amends:
  - adr: "0170"
    what: 4절의 손으로 쓴 결정 목록
touches_protected:
  - harness/**
  - docs/product-specs/requirements.md
  - AGENTS.md
  - docs/design-docs/adr/0023-benchmark-sets-and-comparison.md
  - docs/design-docs/adr/0028-identity-and-sharing.md
  - docs/design-docs/adr/0044-identity-slot.md
  - docs/design-docs/adr/0084-topology-view.md
  - docs/design-docs/adr/0144-reality-data-pipeline-ontology-manager-world-kinds.md
  - docs/design-docs/adr/0150-reality-worlds-are-a-requirement-decisions-and-proposals.md
  - docs/design-docs/adr/0151-source-sync-schedule-safeguards-pinned-versions.md
  - docs/design-docs/adr/0152-reality-worlds-admin-fork-excel-spl.md
  - docs/design-docs/adr/0153-operation-mode-worlds-are-highly-available-open-beta.md
  - docs/design-docs/adr/0154-reality-scale-tens-of-millions-rows-scopes-measure.md
  - docs/design-docs/adr/0156-blast-radius-ports-redundancy-groups-in-memory-index.md
  - docs/design-docs/adr/0157-model-standards-three-tiers-platform-mapping.md
  - docs/design-docs/adr/0158-repeats-per-seed-and-seed-level-statistics.md
  - docs/design-docs/adr/0161-shape-sample-test-fills-the-gaps.md
  - docs/design-docs/adr/0164-ecmp-from-device-config-list-excel-k8s-vdi.md
  - docs/design-docs/adr/0165-dataset-refine-ontology-link-layers-open-types.md
  - docs/design-docs/adr/0167-data-pipeline-words-from-practice.md
  - docs/design-docs/adr/0168-experiment-copy-behaves-like-the-operation-world.md
  - docs/design-docs/adr/0169-one-model-for-invented-and-real-worlds.md
  - docs/design-docs/adr/0170-product-design-one-page-six-principles.md
  - docs/design-docs/adr/0174-permissions-proxy-identity-three-scopes-audit.md
amends_tests:
  - harness/src/checks/docs-main.test.ts::=front
  - harness/src/checks/docs.test.ts::=front
  - harness/src/checks/docs.test.ts::docs check [REQ-020] > docs expire by kind, decisions never do
  - harness/src/checks/docs.test.ts::docs check [REQ-020] > broken links and dead path references fail; fenced code and external links are ignored
test_change_reason: 문서 검사에 follows 필수(DOC092)와 수명 단축(안내 30일)이 들어와, 시험의 가짜 문서에 follows가 필요하고 앞부분 줄이 세 줄 늘고 만료 날짜 경계가 옮겨졌다. 검사하는 규칙은 그대로다.
decision_hash: 5a89817b918a3415
amended_by:
  - adr: "0182"
    what: amends와 amended_by는 파일 이름만 적음
---
# ADR-0180 문서는 코드뿐 아니라 결정도 따라간다 — 결정이 바꾸는 문서를 적고, 고쳐진 결정에 표시를 남기고, 목록은 만들어 낸다

## 맥락
제품 책임자가 README가 엿새 동안 낡은 채였다는 것을 짚고, 처음부터 구조가 있던 지식 관리가 왜 문서를 최신으로 지켜 주지 못하는지 물었다. 잰 사실은 다섯이다.

1. **낡음을 알리는 장치가 코드만 본다.** `covers`는 문서가 묘사하는 코드의 지문이고, 코드가 바뀌면 `DOC010`이 알린다. 나이 한도는 종류마다 있다(안내 60일, 계획 30일, 명세 180일). 결정과 계획을 말하는 문서(README, 계획 문서, 제품 설계 한 장)는 이 장치에 보이지 않는다. 결정 기록이 아닌 문서 74개 가운데 20개에 `covers`가 없었고 README가 그중 하나였다.
2. **결정 기록은 덧붙이기만 한다.** ADR이 168개인데 `superseded`는 셋뿐이다. 뒤의 결정이 앞의 결정 일부를 뒤집은 경우가 많지만, 옛 ADR을 읽는 사람에게 일부가 더는 맞지 않는다고 알려 주는 것이 없다.
3. **결정이 바꾸는 문서를 같은 변경에서 고쳤는지 아무도 보지 않는다.**
4. **손으로 쓰는 목록이 병렬 변경을 부딪치게 한다.** `docs/index.md`의 ADR 목록과 제품 설계 한 장 4절의 "지금 유효한 결정" 표는 결정마다 고쳐진다. 그래서 병렬 변경이 늘 같은 줄에서 충돌한다(부채 TD-0008).
5. **제품 목표 문장의 원본이 하나가 아니다.** 원본은 `requirements.md`의 "제품 목표"인데, README와 AGENTS.md는 더 오래된 문장을 며칠 더 가지고 있었다.

더 깊은 원인은 같다. 문서가 "확인했다"고 말할 수만 있고, 기계가 확인할 수 있는 주장을 하지 않았다. `reverify`는 날짜와 한 줄을 남길 뿐이라, 도장이 되기 쉽다.

## 정한 것 일곱
1. **결정 기록은 자기가 바꾸는 문서를 적는다.** 앞부분에 `updates_docs: [경로]`. 바꾸는 문서가 없으면 빈 목록과 `updates_docs_reason`. 새로 더해지는 ADR마다 이것이 있어야 하고, 적힌 문서는 같은 변경(기준 브랜치와의 차이)에서 실제로 바뀌어 있어야 한다 (`DOC090`). 이미 있는 ADR에는 소급하지 않는다. 새로 더해진 ADR만 본다.
2. **앞선 결정의 일부를 바꾸면 양쪽에 남긴다.** 새 ADR의 `amends: [ADR 파일 이름]`. 명령 `docs.ts link-amends <새 ADR>`가 대상 ADR의 앞부분에 `amended_by`를 더한다(앞부분은 봉인 대상이 아니다). `amends`가 가리키는 ADR마다 `amended_by`에 이 ADR이 있어야 하고 그 반대도 맞아야 한다 (`DOC091`). 전체를 대체하면 지금처럼 `superseded`.
3. **목록은 손으로 쓰지 않고 만들어 낸다.** (a) `docs/index.md`에서 ADR 목록을 없앤다. 색인은 결정 기록 폴더를 가리키고, 도달 가능 검사(`DOC040`)는 폴더의 ADR을 색인에서 닿는 것으로 친다. (b) "지금 유효한 결정" 표는 ADR의 앞부분(`title`, `status`, `amends`, `amended_by`, `superseded_by`)에서 만들어 낸다. `docs.ts decisions`가 `docs/generated/decisions.md`를 쓴다(번호 순, 결정마다 한 줄). 이 파일은 품질 등급표처럼 5시간마다 도는 정리 작업이 main에서 새로 만들고, 변경마다 커밋하지 않는다. 낡았으면 알림 한 줄(`DOC098`)이고 실패가 아니다. 제품 설계 한 장 4절은 그 파일로 가는 링크와, 사람이 쓴 짧은 설명만 남긴다.
4. **코드를 묘사하지 않는 문서는 다른 문서를 따라간다.** 결정 기록이 아닌 모든 문서는 `covers`(코드)나 `follows`(문서나 ADR의 경로·글롭) 가운데 하나 이상을 가진다 (`DOC092`). `follows`도 지문(`follows_hash`)을 뜨고, 따라가는 문서가 바뀌면 `DOC010`과 같은 방식으로 낡았다고 알린다. 마크다운은 본문만 지문에 들어간다. 따라가는 문서가 다시 확인되며 앞부분만 바뀌는 일이 연쇄로 번지지 않게 하려는 것이다. `reverify`가 두 지문을 함께 갱신한다.
5. **수명을 줄인다.** `max_age_days`: 계획 14일, 안내 30일. 참고와 명세는 그대로.
6. **목표 문장을 검사한다.** `requirements.md`의 "## 제품 목표" 아래 굵은 한 문장이 `README.md`와 `AGENTS.md`의 첫머리(제목 다음 첫 단락)에 그대로 있어야 한다 (`DOC093`).
7. **확인했다는 기록이 아니라 확인할 수 있는 주장으로 바꾼다.** 도장만 드러내는 것으로는 약하다. 낡은 문장 대부분은 문서가 기계가 확인할 수 있는 주장을 하면 기계가 잡는다.
   - **7a. 문서가 가리키는 것은 있어야 한다 (`DOC094`).** 결정 기록이 아닌 모든 문서에서, 모양이 모호하지 않은 것만 본다. `TERRARIUM_` 환경 변수는 코드나 설정에 있어야 한다. `pnpm <스크립트>`는 어느 `package.json`에 있어야 한다. `METHOD /api/...`는 계약의 길 표(또는 파사드가 답하는 길)에 있고, 계약에 있는 경로면 방법도 맞아야 한다. 검사 코드(`DOC010` 꼴)는 하네스에 있어야 한다. `` `이름`(`파일.ts`) `` 또는 `` `파일.ts`의 `이름` ``처럼 바로 붙어 적은 이름은 그 파일에 있어야 한다. `ADR-NNNN`과 `REQ-NNN`은 있어야 한다. 아직 합쳐지지 않은 결정은 같은 줄에 '만드는 중'이나 '예정'이라고 적는다. 결정 기록은 봉인되어 있어 7a의 대상이 아니다.
   - **7b. 셀 수 있는 사실은 세어서 견준다 (`DOC095`).** 이름 붙은 사실의 작은 등록부(객체 종류, 링크 종류, 툴, 내장 시나리오 템플릿, 계약의 길, 검사 코드)를 코드에서 센다. 문서는 `<!-- fact:tools -->96<!-- /fact -->`처럼 적는다. 주석이라 마크다운과 GitHub에서 보이지 않고 숫자만 읽힌다. 적힌 값이 센 값과 다르면 실패하고, `reverify`로는 고쳐지지 않는다. 숫자를 고친다. 객체 종류·링크 종류·툴·템플릿은 코어 코드가 돌아야 알 수 있어서, 하네스는 코어를 import하지 않고 `scripts/doc-facts-core.ts`를 자식 프로세스로 돌려 받는다.
   - **7c. 행동을 말하는 표는 시험을 가리킨다 (`DOC096`, 알림).** "시험"이라는 제목 아래의 표와 `시험 파일` 칸이 있는 표에서, 만든 기능의 줄(예정이 아닌 줄)에 존재하는 시험 파일의 경로가 없으면 문서별로 센다. 아직 실패가 아니다.
   - **7d. 그래도 남는 글은 다른 눈이 읽는다 (`DOC097`).** 본문은 그대로이고 `reverify`만 된 문서의 수와 이름을 구조 검사 요약에 알림으로 낸다. `reverify`는 본문이 같은 채 다시 확인된 횟수를 `unchanged_reverifies`에 센다. `docs.ts audit-queue`는 그런 문서를 마지막 감사가 오래된 순으로 보여 주고, `docs.ts audit <문서> --note`가 `last_audited`를 남기고 횟수를 지운다. 5시간마다 도는 정리 작업은 큐의 앞 셋을 독립된 눈으로 읽는다.

## 이유
- 낡음은 코드가 바뀔 때만 생기지 않는다. 결정이 바뀌어도 생기고, 결정은 `covers`로 묶을 코드가 없다. `follows`가 그 자리를 채운다.
- 결정이 어느 문서를 바꾸는지는 결정을 내리는 사람이 가장 잘 안다. 쓸 때 적게 하면 검토하는 사람이 "고쳤나"를 따로 찾지 않아도 된다.
- 봉인된 본문을 고칠 수 없으니 옛 결정에는 앞부분의 표시가 유일한 길이다. 양쪽에 남기면 어느 쪽에서 읽어도 알 수 있다.
- 생성물은 충돌하지 않는다. 손으로 쓰는 목록이 충돌의 원인이었다.
- 확인했다는 기록은 거짓일 수 있고 읽은 사람만 안다. 가리키는 것의 존재와 센 숫자는 기계가 매번 다시 확인한다. 7a를 처음 돌렸을 때 이미 틀린 문장이 나왔고, 이는 이 장치가 필요했다는 증거다(결과는 이 변경의 설명에 있다).

## 대안과 버린 이유
- **문서마다 담당자를 두기**: 담당할 사람이 없다.
- **모든 결정 때 모든 문서를 다시 확인**: 양이 많아 도장이 된다.
- **ADR 본문을 고쳐 최신으로 유지**: 봉인을 깬다.
- **7a에서 문장 속 아무 식별자나 검사**: 일반 낱말과 구별이 안 되어 거짓 경보가 나온다. 바로 붙어 적은 이름만 본다.

## 결과
- 새 검사 코드: `DOC090`~`DOC093`(실패), `DOC094`, `DOC095`(실패), `DOC096`~`DOC098`(알림). 중복 코드 `DOC010`, `DOC011`, `DOC012`는 `follows`에도 쓴다.
- 이 결정은 ADR-0170의 4번("결정 기록을 쓸 때마다 한 장의 4절을 함께 고친다")을 바꾼다. 4절은 이제 손으로 쓰는 표가 아니라 생성된 [결정 목록](../../generated/decisions.md)을 가리킨다. 결정이 한 장을 고쳐야 하면 `updates_docs`에 적는다.
- 열린 변경이 `docs/index.md`에 ADR 줄을 더했거나 제품 설계 한 장 4절 표에 줄을 더했다면, 합칠 때 그 줄을 버린다. 결정 목록이 대신한다.
