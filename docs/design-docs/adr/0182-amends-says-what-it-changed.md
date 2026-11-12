---
title: ADR-0182 고친 결정에는 무엇을 고쳤는지 한 구절을 적는다 — amends의 what, link-amends가 옮겨 적고, 결정 목록이 보인다
kind: decision
status: active
enforced_by:
  - DOC091
  - harness/src/checks/doc-amends.test.ts
updates_docs:
  - docs/design-docs/adr-process.md
amends:
  - adr: "0180"
    what: amends와 amended_by는 파일 이름만 적음
touches_protected:
  - harness/**
  - docs/design-docs/adr/0023-benchmark-sets-and-comparison.md
  - docs/design-docs/adr/0028-identity-and-sharing.md
  - docs/design-docs/adr/0044-identity-slot.md
  - docs/design-docs/adr/0084-topology-view.md
  - docs/design-docs/adr/0144-reality-data-pipeline-ontology-manager-world-kinds.md
  - docs/design-docs/adr/0149-source-roles-and-read-only-allowlist.md
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
  - docs/design-docs/adr/0172-offered-scenario-means-reference-solution-reaches-full-score.md
  - docs/design-docs/adr/0174-permissions-proxy-identity-three-scopes-audit.md
  - docs/design-docs/adr/0178-offered-scenario-solved-on-every-world-shape.md
amends_tests: []
test_change_reason: ""
decision_hash: 35b8829c9f8ae1bc
---
# ADR-0182 고친 결정에는 무엇을 고쳤는지 한 구절을 적는다 — amends의 what, link-amends가 옮겨 적고, 결정 목록이 보인다

## 맥락
[ADR-0180](0180-docs-follow-decisions-not-only-code.md)은 `amends`와 `amended_by`로 "뒤의 결정이 앞의 결정 일부를 바꿨다"를 앞부분에 남기고 결정 목록을 만들어 냈다. 그런데 그 목록은 "일부 고침: 0168"까지만 말한다. 0168이 0165의 무엇을 바꿨는지는 0168 본문을 열어야 안다. 손으로 쓰던 제품 설계 한 장 4절의 표에는 "사용자 타입은 실험에 안 들어감"처럼 어느 부분인지가 적혀 있었는데, 만든 목록으로 바꾸며 그 정보를 잃었다. 읽는 사람이 알고 싶은 것은 번호가 아니라 "내가 읽는 결정의 어느 부분이 더는 맞지 않나"이다.

## 정한 것
1. **`amends` 항목은 `{ adr: "0165", what: "사용자 타입은 실험에 안 들어감" }`로 쓴다.** `adr`은 번호이고 `what`은 대상 결정의 어느 부분이 바뀌었는지를 20자쯤의 쉬운 말로 적은 것이다. 파일 이름만 적던 옛 항목도 그대로 읽는다(이미 있는 결정을 고치지 않는다).
2. **이 결정 뒤에 더하는 ADR은 `what`이 있어야 한다.** 변경에 새로 더해진 ADR의 `amends` 항목에 `what`이 없으면 `DOC091`이 실패한다. 번호가 어느 ADR도 가리키지 않아도 `DOC091`이다.
3. **`link-amends`는 같은 구절을 대상의 `amended_by`에 옮겨 적는다.** 항목은 `{ adr: "0168", what: "..." }`이다. 이미 파일 이름만 있던 항목은 구절이 있는 항목으로 바꿔 쓴다. 본문은 건드리지 않는다.
4. **결정 목록은 구절을 함께 보인다.** "일부 고침: 0168 (사용자 타입은 실험에 안 들어감)". `amended_by` 항목에 구절이 없으면 번호만 보인다.
5. **옛 항목에는 본문을 읽어 구절을 채웠다.** ADR-0180 때 채운 14쌍과 이번에 찾은 하나(0152가 0149 3번을 대신한다고 본문 7번에 적혀 있다), 그리고 0180이 0170을 고친 한 쌍이다. 본문에서 근거를 찾은 것만 적었다.

## 이유
- 목록은 "무엇이 지금 유효한가"를 알려 주려고 있다. 번호만 있으면 읽는 사람은 여전히 고친 결정을 열어야 하고, 그러면 목록이 아낀 일이 다시 생긴다.
- 구절을 쓰는 순간은 결정을 쓰는 사람이 무엇을 바꾸는지 가장 잘 아는 순간이다. 나중에 다른 사람이 본문에서 캐내는 것보다 싸고 정확하다.
- 옛 항목을 억지로 바꾸지 않아서 이미 봉인된 결정의 앞부분을 읽는 길이 둘(파일 이름, `adr`+`what`)로 남는다. 그 비용은 읽는 코드 한 곳(`doc-amends.ts`)에 모았다.

## 대안과 버린 이유
- **구절을 목록 쪽 파일에 따로 적는다.** 손으로 쓰는 목록이 다시 생기고, 병렬 변경이 같은 줄에서 부딪친다. ADR-0180이 없애려던 것이다.
- **구절을 본문 첫 단락에서 기계로 뽑는다.** 본문 모양이 결정마다 달라서 틀린 구절이 나온다.
- **옛 항목도 모두 새 모양으로 강제한다.** 근거를 못 찾은 쌍에 지어낸 구절을 쓰게 된다.

## 결과
- `doc-amends.ts`가 두 모양을 읽고, `doc-follow.ts`(`DOC091` 양쪽 확인), `doc-decisions.ts`(`link-amends`와 목록), `doc-diff.ts`(새 ADR의 `what`)가 그것을 쓴다. 시험은 `doc-amends.test.ts`이다.
- `touches_protected`에 적힌 ADR 파일의 앞부분이 바뀐다. 본문은 하나도 바뀌지 않는다.
- [ADR 작성 절차](../adr-process.md)에 새 모양을 적었다.
