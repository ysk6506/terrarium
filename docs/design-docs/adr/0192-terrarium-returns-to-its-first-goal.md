---
title: ADR-0192 테라리움은 처음의 목표로 돌아간다 — 현실 세계 만들기와 워크플로 자동화는 다른 프로젝트가 맡고, 둘 사이는 세계 스냅샷과 판정으로만 잇는다
kind: decision
status: active
last_verified: 2026-11-12
enforced_by:
  - none
no_enforcement_reason: 범위를 줄이는 결정이다. 남는 두 이음매(REQ-121, REQ-122)는 아직 만들지 않았고, 만들 때 "내보낸 세계를 다시 받아 연 세계에서 점수 분해가 같다"를 시험으로 건다. 목표 문장이 맨 위 문서에 그대로 있는지는 DOC093이 본다.
updates_docs:
  - docs/product-specs/requirements.md
  - docs/design-docs/product-design.md
  - README.md
  - AGENTS.md
  - docs/exec-plans/active/beta-rounds.md
  - docs/index.md
  - docs/design-docs/glossary.md
  - docs/design-docs/model-standards.md
  - docs/design-docs/permissions.md
  - docs/design-docs/moss.md
amends:
  - adr: "0084"
    what: 가져오기는 스냅샷 받기로 연다
  - adr: "0144"
    what: 현실 데이터를 받는 네 단과 현실 평면
  - adr: "0156"
    what: 수천만 규모의 성능 목표와 색인
  - adr: "0161"
    what: 손질과 커넥터의 결정
  - adr: "0164"
    what: 엑셀과 ECMP를 받는 방법
  - adr: "0165"
    what: 데이터셋·정제·매핑의 층
  - adr: "0168"
    what: 운영 세계와 범위 복사
  - adr: "0169"
    what: 매핑 화면과 왕복 시험
  - adr: "0170"
    what: 원칙 3과 6의 글
  - adr: "0177"
    what: 목표 첫째 부분의 한 줄
touches_protected:
  - docs/product-specs/requirements.md
  - AGENTS.md
  - docs/design-docs/adr/0084-topology-view.md
  - docs/design-docs/adr/0144-reality-data-pipeline-ontology-manager-world-kinds.md
  - docs/design-docs/adr/0156-blast-radius-ports-redundancy-groups-in-memory-index.md
  - docs/design-docs/adr/0161-shape-sample-test-fills-the-gaps.md
  - docs/design-docs/adr/0164-ecmp-from-device-config-list-excel-k8s-vdi.md
  - docs/design-docs/adr/0165-dataset-refine-ontology-link-layers-open-types.md
  - docs/design-docs/adr/0168-experiment-copy-behaves-like-the-operation-world.md
  - docs/design-docs/adr/0169-one-model-for-invented-and-real-worlds.md
  - docs/design-docs/adr/0170-product-design-one-page-six-principles.md
  - docs/design-docs/adr/0177-goal-text-reality-worlds-and-top-level-docs.md
  - docs/design-docs/adr/0149-source-roles-and-read-only-allowlist.md
  - docs/design-docs/adr/0150-reality-worlds-are-a-requirement-decisions-and-proposals.md
  - docs/design-docs/adr/0151-source-sync-schedule-safeguards-pinned-versions.md
  - docs/design-docs/adr/0152-reality-worlds-admin-fork-excel-spl.md
  - docs/design-docs/adr/0153-operation-mode-worlds-are-highly-available-open-beta.md
  - docs/design-docs/adr/0154-reality-scale-tens-of-millions-rows-scopes-measure.md
  - docs/design-docs/adr/0155-ingestion-observability.md
  - docs/design-docs/adr/0166-pipeline-versions-snapshots-branches.md
  - docs/design-docs/adr/0189-verified-workflows-go-to-operation.md
  - docs/design-docs/adr/0190-mock-tools-stand-in-for-real-tools-in-verification.md
  - docs/design-docs/adr/0191-gateway-routes-verification-calls-to-terrarium.md
amends_tests: []
decision_hash: e8ffd3820f0a68ff
---
# ADR-0192 테라리움은 처음의 목표로 돌아간다 — 현실 세계 만들기와 워크플로 자동화는 다른 프로젝트가 맡고, 둘 사이는 세계 스냅샷과 판정으로만 잇는다

## 맥락
목표가 두 번 넓어졌다. ADR-0177은 "현실의 데이터로 세계를 짓는다"를, ADR-0189는 "통과한 것만 운영에 나간다"를 더했다. 워크플로 주제에서는 하루에 결정 기록이 셋 나왔다(ADR-0189, 0190, 0191). 제품 설계 한 장은 이럴 때 멈추고 전체를 다시 보라고 한다.

다시 보니 넓힌 두 부분은 실험장과 성질이 다르다.

- **평가하는 단위가 다르다.** 실험장은 시나리오로 평가하고, 운영의 일은 프로세스로 돈다. 워크플로의 갈래를 시나리오로 다 덮을 수 없고, 에이전트가 맡는 단계가 좁으면 장기 실행의 점수가 뜻을 잃고, 워크플로 전체를 맡은 에이전트를 어떻게 실행할지 답이 없었다(제품 책임자의 지적). 설계 담당은 흐름도를 가운데에 둔 설계가 잘못이었다고 봤다.
- **멈춰도 되는 물건과 멈추면 안 되는 물건이다.** 워크플로가 들어오면 테라리움이 운영 경로의 일부가 된다. 고가용이 필요해지고, 실험장은 죽어도 현실에 아무 일이 없다는 전제가 깨진다.
- **다루는 데이터가 다르다.** 현실 시스템에 연결해 읽으려면 그 시스템의 계정과 실제 구성 데이터를 다뤄야 한다. 지어낸 것만 두는 공개 저장소의 실험장과 한곳에 두기 어렵다(ADR-0187).

제품 책임자의 결정: 테라리움은 처음의 제품 목표까지만 한다. 현실 세계를 만드는 것부터 E2E 워크플로까지는 별도 프로젝트로 나눈다.

## 결정
1. **목표 문장은 ADR-0138의 것으로 돌아간다.** 부분은 셋이다. 첫째 부분의 한 줄(ADR-0177)은 이렇게 고친다: 세계는 지어내거나, 밖에서 만든 세계 스냅샷을 받아 연다. 어느 쪽이든 같은 모델이다.
2. **테라리움이 만들지 않는 것.**
   - 현실 시스템에 연결해 받기: 소스, 수집, 정제, 매핑, 링크 정의, 동기화, 파이프라인의 버전과 브랜치.
   - 운영 세계와 그 고가용 저장소, 수천만 규모의 저장과 조회.
   - 워크플로 자동화: 워크플로 정의, 툴 매핑, 게이트웨이 연동, 승인과 건, 적용 단계, 나간 뒤의 측정.

   요구사항 REQ-115, REQ-116, REQ-117, REQ-120을 없앤다. 번호는 다시 쓰지 않는다.
3. **이음매는 둘이고, 둘 다 파일이다.**
   - **세계 스냅샷 받기**(REQ-121, 예정). 스냅샷은 테라리움의 모델로 적은 세계 하나다: 객체, 링크, 속성, 값마다의 근거 등급(사실·가정·모름), 만든 쪽이 붙인 이름과 버전. 테라리움은 형식(스키마와 검증기)을 정해 공개하고, 받은 것을 검증해 무엇이 가정이고 무엇이 비었는지 보이고, 보통의 세계로 연다. 받은 세계의 버전은 스냅샷의 지문이다. 테라리움은 그것을 누가 어떻게 만들었는지 모른다.
   - **판정 내주기**(REQ-122, 예정). 실험의 결과를 판정 기록으로 내준다: 무엇을(에이전트·하네스·모델·툴의 버전), 무엇으로(세계와 시나리오 묶음의 버전), 어떤 조건으로 평가했는지, 합격선에 대 본 결과와 근거, 그 실험에서 드러난 실험장 한계. 지문이 붙는다. 테라리움은 그것을 누가 어디에 쓰는지 모른다.
   - 형식의 자세한 것은 만들 때 정한다. 스냅샷은 바탕 일(포트 모델)과 함께, 판정은 "맡겨도 되나"에 답하는 실험의 설계와 함께 한다.
4. **지어낸 세계를 스냅샷으로 내보낸다.** 내보낸 것을 다시 받아 연 세계에서 기존 시나리오의 점수 분해가 원래와 같아야 한다. 이것이 형식이 모자라지 않다는 시험이고(ADR-0169 9번의 왕복 시험을 이것으로 바꾼다), 스냅샷을 만드는 쪽에 주는 본보기다.
5. **원칙 여섯 가운데 둘의 글을 고친다**(ADR-0170).
   - 3: 버전을 고정하면 결과가 같다. 실험은 세계의 버전을 고정하고, 받은 세계의 버전은 스냅샷의 지문이다.
   - 6: 현실에 닿지 않는다. 현실의 것은 스냅샷 파일로만 들어오고, 판정은 파일로만 나간다. 테라리움은 현실 시스템에 연결하지 않고 실제 툴을 부르지 않는다.
6. **모델에 관한 결정은 테라리움에 남는다.** 모델은 하나(ADR-0169), 층마다의 표준(ADR-0157), 전파 엔진 하나와 정밀도 두 단계(ADR-0168), 포트 단위와 묶음의 뜻(ADR-0156의 2·3·6·7·8), 열린 타입과 닫힌 목록의 링크 뜻(ADR-0165의 3·4·6·8), 모델에 받는 모양(ADR-0161의 8·11·12·13, ADR-0164의 3~6), 근거 등급(ADR-0144), 현업의 말(ADR-0167). 스냅샷은 테라리움이 모르는 타입을 실을 수 있고, 그런 타입은 닫힌 목록의 링크 뜻에 따라 기본 단계로 움직인다. ADR-0168과 ADR-0169가 말하는 "운영 세계"와 "현실에서 만든 세계"는 받은 세계로 읽는다.
7. **범위를 자르는 것은 만드는 쪽의 일이다.** 스냅샷은 실험 세계의 한도 안이어야 하고, 넘으면 받지 않고 까닭을 말한다. 테라리움은 받은 것이 닫혀 있는지(기대는 전원·냉방·업링크가 들어 있는지) 확인하고 잘린 경계를 보인다(ADR-0168 7번을 이렇게 고친다).
8. **옮기는 설계는 보관함에 둔다.** 워크플로 자동화와 현실 데이터 파이프라인의 설계 문서는 `docs/archive/`로 옮기고 더 고치지 않는다. 새 프로젝트가 시작될 때 가져간다. 그 설계가 풀지 못한 것(시나리오와 프로세스의 어긋남)도 새 프로젝트가 이어받는다.
9. **이미 만든 현실 연결 코드는 걷어낸다.** 그래프 소스를 읽는 창과 남아 있는 가져오기 코드가 그것이다. 걷어내는 변경은 시험을 바꾸므로 따로 결정 기록을 가진다. 그때까지는 지금처럼 관리자만 부를 수 있다.
10. **순서.** 차수 계획의 "바탕과 현실 세계 한 줄"은 "바탕과 스냅샷 한 줄"이 된다. 워크플로 자동화는 순서에서 빠지고, 그것을 위해 감사 기록·권한·모델 화면에 미리 두기로 한 자리(ADR-0189)는 두지 않는다.

ADR-0149, 0150, 0151, 0152, 0153, 0154, 0155, 0166, 0189, 0190, 0191은 이 결정으로 대체된다. 테라리움에서는 더 유효하지 않고, 새 프로젝트의 출발 자료다.

## 이유
- **한 제품은 한 가지 값을 판다.** 실험장의 값은 "이 점수를 믿어도 된다"이고, 운영 도구의 값은 "멈추지 않고 안전하다"다. 둘은 고가용, 권한, 데이터의 민감도, 고치는 주기가 다 다르다. 한 제품에 두면 둘 다 어정쩡해진다.
- **이음매가 파일이면 서로의 사정을 몰라도 된다.** 실험장은 현실의 계정을 갖지 않고, 운영 도구는 실험장이 죽어도 돈다. 파일은 지문 하나로 버전이 고정돼 "같은 버전이면 같은 점수"가 그대로 선다.
- **모델은 테라리움이 쥔다.** 타입에는 시뮬레이터의 동작이 붙어 있다. 형식을 만드는 쪽이 정하면 시뮬레이터가 뜻을 모르는 것이 들어온다.
- **내보내기와 받기의 왕복**은 형식의 시험이면서 만드는 쪽에 주는 본보기다. 글로 형식을 설명하는 것보다 어긋날 일이 적다.

## 버린 길
- **그대로 두고 워크플로 설계만 고치기**: 시나리오와 프로세스의 어긋남은 풀 수 있어도, 운영 경로가 되는 문제와 현실 계정의 문제는 남는다.
- **연결 코드는 남기고 워크플로만 나누기**: 실험장이 현실 시스템의 계정을 계속 가진다. 제품 책임자의 결정도 "현실 세계를 만드는 것부터"다.
- **모델까지 새 프로젝트로 넘기기**: 실험장이 남의 형식을 따라가야 하고, 채점의 버전 고정이 남의 손에 놓인다.
- **이음매를 API로 하기**: 양쪽이 함께 살아 있어야 하고 버전이 서로 엮인다.

## 남은 일
- 스냅샷 형식(REQ-121)과 판정 기록(REQ-122)의 설계.
- 현실 연결 코드 걷어내기(결정 9).
- "맡겨도 되나"에 답하는 실험의 설계: 지금 있는 것(사건 하나와 운영 두 종류의 실험, 가상 담당자, 내 도메인만 맡기) 위에 권한 수준으로 일 나누기, 규칙으로서의 승인, 운영 실험의 일감과 합격선, 업무 단위와 근무 단위의 판정을 더한다. 흐름도는 그리지 않는다. 따로 설계한다.
- 새 프로젝트의 시작은 이 저장소 밖의 일이다.

## 결과
`requirements.md`의 목표와 요구사항, `product-design.md`의 기둥·원칙·순서·위험, README와 AGENTS.md의 목표 문장, 차수 계획의 순서, 색인, 용어집의 한 절을 고쳤다. 옮기는 설계 문서 여섯을 `docs/archive/moved-out/`로 옮기고, 이끼의 질문 은행을 지금의 문서로 다시 만들었다.
