---
title: ADR-0194 확인 상태는 문서 밖의 (문서, 대상) 기록에 둔다 — 허브 문서의 앞부분 충돌을 없애고, 생성물은 변경이 커밋하지 않고, 문서 검사를 빠르게 한다
kind: decision
status: active
enforced_by:
  - DOC010
  - DOC011
  - DOC097
  - DOC099
  - DOC100
  - DOC101
  - DOC102
  - harness/src/checks/doc-records.test.ts
  - harness/src/checks/doc-migrate.test.ts
  - harness/src/checks/doc-generated.test.ts
updates_docs:
  - AGENTS.md
  - docs/index.md
  - docs/design-docs/adr-process.md
  - docs/design-docs/harness-guide.md
  - docs/design-docs/moss.md
amends:
  - adr: "0002"
    what: 문서의 확인 날짜는 앞부분이 아니라 확인 기록에 둔다
  - adr: "0124"
    what: 자동 질문은 파일에 커밋하지 않고 시험이 만든다
  - adr: "0180"
    what: 확인 상태와 목록 생성물을 변경이 커밋하지 않는다
touches_protected:
  - harness/**
  - AGENTS.md
  - docs/product-specs/requirements.md
  - docs/design-docs/adr/**
amends_tests:
  - harness/src/checks/doc-audit.test.ts::audit queue [REQ-020] > a re-verify that leaves the body alone puts the doc in the queue; an edit does not
  - harness/src/checks/doc-follow.test.ts::docs follow other docs [REQ-020] > a document with neither covers nor follows fails DOC092, an ADR is exempt
  - harness/src/checks/doc-follow.test.ts::docs follow other docs [REQ-020] > a followed doc whose body changes makes the follower stale, front matter changes do not
  - harness/src/checks/doc-follow.test.ts::docs follow other docs [REQ-020] > follows that match nothing fail DOC012
  - harness/src/checks/docs-main.test.ts::=front
  - harness/src/checks/docs-main.test.ts::=docsRepo
  - harness/src/checks/docs.test.ts::=front
  - harness/src/checks/docs.test.ts::=docsRepo
  - harness/src/checks/docs.test.ts::docs check [REQ-020] > covers without a hash, or matching nothing, fail
  - harness/src/checks/docs.test.ts::docs check [REQ-020] > docs expire by kind, decisions never do
  - harness/src/checks/docs.test.ts::docs check [REQ-020] > broken links and dead path references fail; fenced code and external links are ignored
  - harness/src/checks/quality.test.ts::=doc
  - harness/src/checks/quality.test.ts::the quality table is generated and kept fresh [REQ-024] > the oldest active doc that covers a unit's code is shown; ADRs, old status and uncovered docs are not
  - harness/src/test-support/docs-repo.ts::=front
  - harness/src/test-support/docs-repo.ts::=adr
  - harness/src/test-support/docs-repo.ts::=docsRepo
  - harness/src/checks/doc-audit.test.ts::<import:0525def2>
  - harness/src/checks/doc-audit.test.ts::<import:1701697f>
  - harness/src/checks/doc-audit.test.ts::<import:46dc40aa>
  - harness/src/checks/doc-audit.test.ts::<import:a52e17e9>
  - harness/src/checks/doc-audit.test.ts::audit queue [REQ-020] > audit records last_audited, clears the count and needs a note; the longest unaudited comes first
  - harness/src/checks/docs-main.test.ts::<import:73c7b1a0>
  - harness/src/checks/docs-main.test.ts::=FOLLOW_HASH
  - harness/src/checks/docs-main.test.ts::docs command line [REQ-020] [REQ-021] > reverify writes the note into the doc and exits 0, with the root taken from --root
  - harness/src/checks/docs.test.ts::<import:0bf8b541>
  - harness/src/checks/docs.test.ts::<import:73c7b1a0>
  - harness/src/checks/docs.test.ts::=FOLLOW_HASH
  - harness/src/checks/docs.test.ts::docs check [REQ-020] > future or malformed dates fail
  - harness/src/checks/docs.test.ts::docs check [REQ-020] > reverify clears staleness, logs the note and keeps the last five notes
  - harness/src/test-support/docs-repo.ts::<import:50321f6c>
  - harness/src/test-support/docs-repo.ts::<import:7ff9be4a>
  - harness/src/test-support/docs-repo.ts::=FOLLOW_HASH
test_change_reason: 확인 상태가 문서 앞부분에서 (문서, 대상) 확인 기록으로 옮겨 가서, 앞부분의 날짜·지문·기록·횟수를 쓰던 문서 검사의 시험 도우미와 확인·감사·품질 표의 시험이 새 기록으로 같은 것을 단언하도록 고쳤다. 검사하는 규칙은 같고, 옛 앞부분을 만들던 가짜 문서와 그 기대값만 바뀌었다.
decision_hash: 120fc1ce8e850be7
---
# ADR-0194 확인 상태는 문서 밖의 (문서, 대상) 기록에 둔다 — 허브 문서의 앞부분 충돌을 없애고, 생성물은 변경이 커밋하지 않고, 문서 검사를 빠르게 한다

## 맥락
문서는 자기가 낡았는지를 스스로 증명해야 한다(ADR-0002). 그 증명은 지금까지 각 문서의 앞부분에 있었다: `last_verified`, `verification_log`, `covers_hash`, `follows_hash`, `verified_body`, `unchanged_reverifies`. 잰 것은 셋이다.

1. **허브 문서의 앞부분이 모든 변경에서 부딪친다.** README, AGENTS.md, 색인, 제품 설계 한 장, 핵심 신념, 차수 계획, 요구사항은 거의 모든 변경이 다시 확인한다. 두 변경이 열려 있으면 이 문서들의 앞부분(날짜, 지문, 확인 기록)이 서로 다르게 바뀌어 반드시 충돌한다. 하나가 합쳐질 때마다 나머지 모두가 main을 합치고, 같은 앞부분 충돌을 손으로 풀고, 검사를 다시 기다렸다. 이 때문에 아홉 개의 변경이 줄을 서서 합쳐졌고, 그 비용이 변경 안의 일보다 컸다(부채 TD-0008의 한 부분).
2. **생성물을 변경이 커밋한다.** 결정 목록, 품질 등급표, 색인의 손으로 쓴 문서 목록, 이끼 질문 은행의 자동 질문 1800여 개가 변경마다 다시 쓰여 같은 줄에서 충돌한다.
3. **문서 검사가 느리다.** 구조 검사 전체가 CI에서 20초를 넘었고, 이를 돌리는 시험은 제한 시간을 늘렸다(ADR-0188 7번). 문서 검사만 5~6초였다. 한 검사 안에서 저장소 전체를 걷는 일이 문서마다 몇 번씩 있었고, 문서마다 git을 한 번씩 불렀다.

없애면 안 되는 것은 문서 검사의 목적이다. 문서가 코드를 `covers`하거나 다른 문서를 `follows`하면 그 대상이 바뀐 순간 낡은 것으로 알려지고, 다시 확인하면 진실한 메모가 남고, 글을 안 고친 채 다시 확인만 한 것은 눈에 띄어(`DOC097`) 독립된 감사 줄에 들어간다.

## 정한 것 열
1. **확인 상태는 문서를 떠난다.** 문서의 앞부분에는 사람이 쓰는 것만 남는다: `title`, `kind`, `status`, `covers`, `follows`, 그리고 결정 기록은 봉인과 관계 필드(`decision_hash`, `enforced_by`, `updates_docs`, `amends`, `amended_by`, `superseded_by`, `touches_protected`, `amends_tests` 등). 날짜, 지문, 기록, 횟수는 없다. 결정 기록의 `last_verified`도 없앤다(결정은 늙지 않는다).
2. **(문서, 대상)마다 작은 기록 파일 하나.** 위치는 `docs/verified/<문서 슬러그>/<대상 슬러그>.yaml`. 슬러그는 저장소 경로에서 `/`를 `__`로 쓴 것이고 문서의 `.md`는 뗀다(예: `docs/verified/docs__design-docs__moss/apps__server__src__runtime__moss-index.ts.yaml`). 기록에는 문서와 대상의 전체 경로가 있어 슬러그가 겹쳐도 `DOC101`로 걸린다. 한 줄에 필드 하나이고 값은 JSON 낱말이라 어느 YAML 읽기도 읽고, 하네스는 YAML 해석기 없이 읽는다.

   ```yaml
   doc: "docs/design-docs/moss.md"
   target: "apps/server/src/runtime/moss-index.ts"
   hash: "8644eaba6a9ddf9d"
   date: "2026-11-12"
   note: "색인 만드는 법과 점수 식이 코드와 같다"
   text_changed: false
   doc_hash: "ca85e859db5c1f8a"
   ```

   `hash`는 확인했을 때 대상의 내용 지문이다(TypeScript는 구조로, Markdown은 본문으로, 그 밖은 바이트로). `text_changed`는 이 확인에서 문서의 글이 이전 확인 때와 달랐는지, `doc_hash`는 확인 때 문서 본문의 지문이다. 문서마다 감사 기록 `_audit.yaml`(날짜, 메모, 본문 지문)이 따로 있다.
3. **대상은 글롭이 맞는 파일 하나하나다.** `covers`와 `follows`의 항목은 맞는 파일로 풀리고 파일마다 대상이다(폴더는 안의 파일 전부). 글롭 전체를 한 지문으로 뜨는 길(옛 방식)은 거짓 낡음이 많다: 같은 글롭 안의 서로 다른 파일을 고친 두 변경이 같은 기록을 서로 다르게 써서, 합친 결과가 둘 다 맞는데도 충돌하고 합쳐진 뒤에도 낡았다고 나온다. 파일마다 두면 두 변경이 다른 파일의 기록을 쓰므로 충돌 없이 합쳐지고 합친 결과도 맞다. 비용은 기록 파일 수인데, 문서 75개의 대상은 글롭 항목 635개가 파일 689개로 풀렸으니 거의 늘지 않는다(가장 큰 글롭이 54개). 글롭에 파일이 더해지면 그 파일의 기록이 없어 낡았고, 파일이 지워지거나 항목이 빠지면 남은 기록이 낡음으로 센다(문서가 읽은 것이 지금 설명하는 것과 다르기 때문이다).
4. **낡음은 대상마다 센다.** 문서는 대상 T에 대해 (문서, T)의 기록이 없거나 기록된 지문이 T의 지금 지문과 다르면 낡았다. 기록이 아예 없으면 `DOC011`, 일부가 낡았으면 `DOC010`이고 메시지에 낡은 대상이 나온다. 문서의 마지막 확인일은 그 문서 기록들의 가장 새 날짜이고 `DOC020`(나이)과 `DOC021`(미래 날짜)이 그것을 쓴다. 두 변경이 서로 다른 대상에 대해 같은 문서를 다시 확인하면 다른 파일을 건드리니 충돌하지 않는다. 같은 문서를 같은 대상에 대해 다시 확인한 두 변경만 충돌하고, 그 충돌은 진짜다: 합친 대상은 둘 다 다르므로 읽고 다시 확인해야 한다.
5. **명령은 이름을 지킨다.** `docs.ts reverify <문서> --note "…"`은 낡은 대상 모두에(낡은 것이 없으면 모든 대상에) 같은 메모로 기록을 쓰고 없어진 대상의 기록을 지운다. `--target <경로>`는 그 대상 하나만 쓴다. 여러 대상에 같은 메모를 적는 것은 의도다: 메모는 문서를 읽은 일에 대한 것이고, 기록이 각각 독립이어야 충돌하지 않는다. `docs.ts audit-queue`와 `audit`는 기록에서 일한다: 기록의 `text_changed: false`이면서 마지막 감사보다 날짜가 새로운 기록이 있는 문서가 큐에 들고, 그 수가 옛 `unchanged_reverifies` 자리를 대신한다. 구조 검사의 `DOC097` 알림은 이 변경이 더하거나 고친 기록 가운데 문서의 글이 달라지지 않았다고 말하는 것만 모아 문서를 이름 붙인다(기록 뒤에 글을 고쳤다면 이름 붙이지 않는다). 변경이 어떤 문서를 다시 확인했으면 `updates_docs`는 그 문서를 "고친 것"으로 센다.
6. **변경은 생성물을 커밋하지 않는다.** `docs/generated/decisions.md`, `docs/generated/quality.md`, 색인의 문서 목록은 5시간마다 도는 정리 작업만 새로 만든다. 색인은 손으로 쓴 소개와 두 표지 주석 사이의 목록으로 나뉘고, 목록은 모든 문서의 `title`에서 만든다(`docs.ts generate`가 결정 목록과 이 목록을 함께 쓴다). 만든 것과 문서가 어긋나는 것은 알림이다(`DOC098`, `DOC102`, `QUAL001`), 실패가 아니다. 변경이 기준 브랜치와 다르면서 지금 만든 것과도 다른 생성물은 손으로 고친 것이고 `DOC099`로 실패한다(지금 만든 것과 같으면 정리 작업이 쓴 것이라 통과한다). 목록이 모든 문서를 싣는 것이 구조이므로 표지가 있는 색인에서는 새 문서가 고아가 아니다(`DOC040`은 표지가 없는 색인과 결정 기록 폴더에 남는다).
7. **질문 은행.** 이끼의 자동 질문은 문서 조각마다 하나이고, 시험(`tests/spec/moss-questions.test.ts`)이 이미 같은 함수(`autoQuestions`)로 지금 문서에서 새로 만들어 90%를 재고 있었다. 커밋한 사본은 문서를 고칠 때마다 수백 줄이 바뀌었을 뿐이다. 그래서 커밋하는 `moss-questions.json`에는 손으로 쓴 "왜" 질문만 두고, `loadBank()`가 시험이 돌 때 자동 질문을 만들어 합쳐 준다. 시험은 한 줄도 바뀌지 않았고, 은행 전체에서 재는 90%는 이제 항상 지금 문서에서 잰다(시험이 약해지지 않고 사본이 뒤처질 일이 없어졌다). 대신 시험이 도는 시간이 조금 늘었다(은행 전체와 지금 문서의 두 재기가 같은 질문을 두 번 만든다).
8. **옮기기는 이 변경에서 한다.** 모든 문서의 상태를 기록으로 옮기고 앞부분의 옛 키를 지웠다(`docs.ts migrate`). 옛 규칙으로 신선했던 문서는 모든 대상에 지금 지문의 기록이 있고, 낡았던 문서는 모든 대상에 어떤 지문과도 맞지 않는 기록(`hash: migrated-stale`)이 있어 여전히 낡다(날짜는 옛 `last_verified`를 지켜 나이 규칙도 같다). 옛 `last_audited`와 `unchanged_reverifies`는 감사 기록과 `text_changed`로 옮겼다. 시험이 옛 형식의 가짜 저장소에서 옛 규칙의 판정과 옮긴 뒤의 판정이 문서마다 같음을 보인다. 문서마다 최근 다섯 줄이던 `verification_log`는 가장 새 줄만 기록의 메모로 옮기고 나머지는 버렸다(역사는 git에 있고, 되살릴 값이 문서 수 곱하기 대상 수의 파일이 되기 때문이다).
9. **옛 형식의 열린 변경.** 앞부분에 옛 키가 하나라도 남은 문서가 있으면 `DOC100`이 한 번 실패하고 무엇을 돌릴지 말한다: main을 합치고(앞부분이 충돌하면 main의 앞부분을 고르고), `pnpm tsx harness/src/checks/docs.ts migrate`(여러 번 돌려도 같다)를 돌린 뒤, 변경 때문에 낡아진 문서를 `reverify`한다. 옛 키가 남은 문서의 낡음 검사는 건너뛰어 같은 문제가 수백 줄로 나오지 않는다. 기록 파일이 읽히지 않으면(합침 충돌 표지가 남았을 때 등) `DOC101`이다.

10. **속도.** 구조 검사 안에서 문서 검사는 5.5~6.4초였다. 비용은 (가) 문서마다 몇 번씩 저장소 전체를 걷던 `expandGlobs`, (나) 파일마다 여러 번 뜨던 지문, (다) 문서마다 부르던 git(`DOC097`), (라) 코드 목록 전체 문자열에서 낱말마다 `includes`를 하던 `DOC094`(1.3초), (마) 매번 자식 프로세스로 코어를 돌려 센 사실(0.8초)이었다. 한 번의 실행이 파일 목록을 한 번 읽고(`DocFiles`), 파일을 한 번만 지문 뜨고, 글롭을 한 번만 풀고, 확인 기록을 문서마다 한 번 읽는다. 기록 읽기는 YAML 해석기를 거치지 않는다. git은 변경된 기록 파일만 본다. 규칙 코드는 집합으로 찾는다. 코어에서 센 사실은 코어 소스의 내용 지문을 열쇠로 `node_modules/.cache/terrarium/`에 저장해 소스가 그대로면 자식 프로세스를 돌리지 않는다. 품질 등급표의 문서 날짜도 같은 파일 목록으로 푼다. 이끼 색인 검사(자식 프로세스, 4~5초)는 `run-all`이 시작할 때 먼저 띄워 앞선 검사와 나란히 돌린다. `run-all --timing`이 검사마다 시간을 보여 준다. 측정한 전과 후는 이 변경의 설명에 있다.


## 이유
- 충돌의 원인은 "문서마다 하나"였던 상태 저장소다. 상태가 (문서, 대상) 단위로 쪼개지면 같은 일을 하는 두 사람만 같은 파일에 닿는다. 그 충돌은 정보가 있다: 두 사람이 같은 대상에 대해 같은 문서를 읽었다는 뜻이다.
- 문서 앞부분이 사람이 쓰는 필드만 가지면, 문서를 읽는 눈은 기계가 쓴 줄 없이 문서를 본다. 앞부분이 바뀌면 사람이 고친 것이다.
- 생성물은 원본이 있는 파생물이다. 파생물을 변경마다 커밋하게 하면 원본이 바뀐 모든 변경이 서로 부딪친다. 만든 것과 어긋나는 것은 알림이면 충분하고, 손으로 고치는 것만 막으면 된다.
- 속도의 대부분은 같은 일을 되풀이한 것이었다. 줄일 수 있는 것은 줄이고, 줄일 수 없는 것(코드를 해석하는 일)은 검사들이 이미 나눠 쓰는 해석 결과를 쓴다.

## 대안과 버린 이유
- **글롭 하나를 한 대상으로 묶어 지문 하나를 뜬다.** 파일 수는 적지만 위 3번의 거짓 충돌과 합친 뒤의 거짓 낡음이 남는다. 기록 수는 689 대 635로 거의 같아 얻는 것이 없다.
- **허브 문서만 따로 다룬다.** 허브가 아닌 문서도 같은 코드를 덮는 두 변경에서 부딪친다. 규칙이 둘이 되고 허브 목록을 누가 정하느냐가 남는다.
- **확인 상태를 한 파일에 모은다.** 3.4MB 잠금 파일에서 보듯 한 파일은 모든 변경이 만진다.
- **자동 질문을 커밋하되 정리 작업이 쓰게 한다.** 시험이 이미 지금 문서에서 새로 만드는데 사본을 따로 두면 사본이 뒤처질 뿐이다.
- **확인 이력을 보관한다.** 문서 수 곱하기 대상 수의 파일이 더 늘고, 이력은 git이 이미 갖고 있다.

## 결과와 남은 일
- 새 검사 코드: `DOC099`(생성물을 손으로 고침, 실패), `DOC100`(옛 형식, 실패), `DOC101`(기록을 못 읽음 또는 문서 없는 기록 폴더, 실패), `DOC102`(색인 목록이 낡음, 알림). `DOC010`·`DOC011`·`DOC020`·`DOC021`·`DOC097`은 같은 뜻으로 기록에서 계산한다. 필수 앞부분 키에서 `last_verified`가 빠졌다.
- 잠긴 시험 가운데 옛 앞부분 필드를 쓰던 것(문서 검사 도우미, 확인 기록과 감사 시험, 품질 표의 문서 날짜)을 새 기록에 맞게 고쳤다. 검사가 보는 규칙은 같고, 고쳐진 시험이 새 기록으로 같은 것을 단언한다. `apps/server/src/http/scoring-unchanged.test.ts`는 그대로다.
- 한계: (가) 옮길 때 이미 낡았던 문서는 어느 대상이 바뀌었는지 알 수 없어 모든 대상이 낡음으로 남는다. (나) 감사 날짜와 같은 날 다시 확인한 기록은 큐에 들지 않는다(날짜만 비교한다). (다) 허브 문서의 본문이 바뀌면 그것을 `follows`하는 모든 문서가 낡아 각각 다시 읽어야 한다. 이것은 실제로 읽어야 하는 일이라 없애지 않았다. (라) 테스트 잠금 파일의 충돌은 이 결정이 풀지 않는다(부채 TD-0015).
- 열린 변경이 `docs/index.md`나 결정 목록, 품질 등급표, 질문 은행의 자동 질문을 고쳤다면 그 부분을 버린다. 정리 작업이 대신한다.
- 정리 작업의 첫 단계는 `pnpm quality write`, `pnpm tsx harness/src/checks/docs.ts generate`로 바뀌고, 그 결과를 main에 올린다.
