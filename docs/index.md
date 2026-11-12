---
title: 문서 색인
kind: reference
status: active
covers:
  - harness/src/checks/doc-index.ts
---
# 문서 색인

모든 문서는 여기서 도달 가능해야 한다 (`DOC040`). 아래 "문서 목록"은 하네스가 문서의 `title`에서 만든다(ADR-0194): 새 문서를 만들어도 여기에 줄을 더하지 않는다. 목록은 5시간마다 도는 정리 작업이 `pnpm tsx harness/src/checks/docs.ts generate`로 새로 만들고, 변경마다 커밋하지 않는다(낡으면 `DOC102` 알림만 나온다). 목록을 손으로 고치면 `DOC099`로 실패한다. 결정 기록은 폴더 전체가 닿는 것으로 친다.

## 먼저 읽기

- [AGENTS.md](../AGENTS.md) — 에이전트 진입점, 절대 규칙
- [ARCHITECTURE.md](../ARCHITECTURE.md) — 단위와 의존 방향
- [요구사항](product-specs/requirements.md) — `REQ-NNN`의 단일 출처
- [품질 등급표](generated/quality.md) — 단위별 등급 A~D (하네스가 만든 생성물, 정리 작업은 가장 낮은 단위부터)

## 문서 목록

<!-- docs-list:begin -->

### 제품 명세

- [테라리움 요구사항](product-specs/requirements.md)

### 설계

- [ADR 작성 절차](design-docs/adr-process.md)
- [온도와 공기 흐름 지도 — 서버룸 안의 바람을 그리는 법](design-docs/airflow-map.md)
- [애플리케이션 층 — 로드 밸런서·세션·서킷 브레이커·메시·리전과 서비스 호출 그래프](design-docs/application-layer.md)
- [CCTV 자리 — 카메라 개체, 보는 자리, 배경 자리](design-docs/camera-and-backdrop.md)
- [부지 배치 규칙과 동물 반응](design-docs/campus-layout.md)
- [용량 — 한 프로세스가 동시에 몇 개를 들고 있나](design-docs/capacity.md)
- [설정 변경 시나리오 — 누군가 바꾼 설정으로 사고를 만들고, 블록은 장비가 가진 것에서 고른다](design-docs/config-scenarios.md)
- [컨테이너 층 — 쿠버네티스 클러스터, 노드, 파드, 그리고 클러스터가 알아서 하는 일](design-docs/container-layer.md)
- [제어 가능 요소표 — 실험이 무엇을 바꿀 수 있고, 에이전트가 무엇을 할 수 있는가](design-docs/controllability.md)
- [핵심 신념](design-docs/core-beliefs.md)
- [데이터베이스 층과 스토리지 HA 층 — 서비스가 기대는 두 겹](design-docs/db-storage-layers.md)
- [도메인과 가상 담당자 — 내 도메인 밖의 고장은 넘기고, 기다리는 동안 다른 일을 한다](design-docs/domains-and-counterparts.md)
- [실험과 결과 분석](design-docs/experiments-and-analysis.md)
- [설비의 표준 인터페이스 — Redfish, SNMP, BACnet](design-docs/facility-protocols.md)
- [용어집(데이터 파이프라인과 온톨로지 매니저) — 다른 프로젝트로 옮긴 설계](design-docs/glossary-data.md)
- [용어집 층별 말 — SDN·컨테이너·애플리케이션·가속기·사이트](design-docs/glossary-layers.md)
- [용어집 — 화면에 쓰는 말은 여기서 정한다](design-docs/glossary.md)
- [골든 안전망 — 모델을 옮기기 전에 못 박아 둔 것, 읽는 법, 바꿀 때의 절차](design-docs/golden-safety-net.md)
- [GPU 카탈로그 — H100부터 B300까지, 베라 루빈은 도입 예정](design-docs/gpu-catalog.md)
- [GPU 백엔드 네트워크 — 서버마다 NIC 8개가 rail로 꽂히고, rail 하나를 잃으면 느려진다](design-docs/gpu-fabric.md)
- [가속기(GPU) 층 — GPU·NVLink·IB 패브릭·스케줄러·학습 잡·추론 풀, 고장 여덟과 시스템이 스스로 하는 일](design-docs/gpu-layer.md)
- [진짜 하네스로 끝까지 — LangGraph, OpenCode, OpenClaw 실측과 재현 절차](design-docs/harness-e2e.md)
- [품질 하네스 사용법](design-docs/harness-guide.md)
- [하네스 프로토콜 (terrarium.harness/1)](design-docs/harness-protocol.md)
- [HTTP API 계약](design-docs/http-api.md)
- [고장 종류별 리드타임 — 넘기면 얼마나 걸려 사라지나](design-docs/lead-times.md)
- [측정의 신뢰 — 효율 점수는 과제를 푼 만큼만, 시험지는 기준 에이전트로 점검](design-docs/measurement.md)
- [모델 등록 — LLM API를 워크스페이스에 등록하고 연결 확인까지](design-docs/model-registration.md)
- [표준 모델 대조 — 층마다 빌려오는 뼈대와 플랫폼 매핑](design-docs/model-standards.md)
- [이끼 — 테라리움 도우미가 문서와 화면으로 답하고 화면을 같이 넘기는 법](design-docs/moss.md)
- [네트워크의 두 가지 모양 — 레거시(VLAN·스패닝 트리)와 클라우드(leaf-spine·BGP)](design-docs/network-fabrics.md)
- [스위치의 운영 체제 — 아리스타 EOS, 시스코 NX-OS·IOS XE](design-docs/network-os.md)
- [운영 모드 — 끝이 없는 실험, 당겨서 보는 모니터링, 실시간과 빨리 감기](design-docs/operation-mode.md)
- [서버 운영 — 설치와 외부 시스템 연결](design-docs/operations.md)
- [권한 — 누구인지, 무엇을 보고 바꾸는지, 누가 무엇을 했는지](design-docs/permissions.md)
- [물리 법칙이 닿는 자리와 모델 자리 — 무엇이 물리이고, 지금 어떻게 돼 있고, 어떻게 바꿔 끼우나](design-docs/physics-laws.md)
- [물리 프로필 레퍼런스 — 자리별 숫자·곡선, 지문, 무엇이 자리 뒤로 갔고 무엇이 남았나](design-docs/physics-profile.md)
- [파이프라인의 버전과 브랜치 — 다른 프로젝트로 옮긴 설계](design-docs/pipeline-versions-and-branches.md)
- [전원·냉방 사다리 확장 — N+1 UPS·랙 배터리·자체 변전소, 리어도어·액냉·침지, 그리고 파워 캐핑(모델만)](design-docs/power-cooling-ladders.md)
- [프로세스 비교 — 지금 하는 방식과 에이전트가 하는 방식을 단계·사람·시간으로 견주기 (REQ-112)](design-docs/process-compare.md)
- [제품 설계 한 장 — 테라리움의 값, 원칙 여섯, 지금 유효한 결정, 순서](design-docs/product-design.md)
- [랙 규격과 PDU 콘센트 — EIA-310, OCP ORv3, 콘센트 켜고 끄기](design-docs/rack-standards.md)
- [세계 인기·좋아요·칭호와 계급 모델](design-docs/ranking-and-titles.md)
- [현실의 가격 — 땅, 건물, 장비값의 근거와 믿을 만한 정도](design-docs/real-prices.md)
- [현실 데이터와 모델 — 다른 프로젝트로 옮긴 설계](design-docs/reality-data-and-ontology.md)
- [생김새 견본 시험 — 다른 프로젝트로 옮긴 설계](design-docs/reality-shape-samples.md)
- [규모 키우기 — 스케일 업과 스케일 아웃](design-docs/scaling.md)
- [시나리오 편집기 검토 — 처음 쓰는 사람의 눈으로, 토스의 원칙으로](design-docs/scenario-editor-review.md)
- [시나리오 모델](design-docs/scenario-model.md)
- [SDN 오버레이와 클라우드 네이티브 네트워크 층 — 리프-스파인 위에 덮는 가상 네트워크와 서비스의 문](design-docs/sdn-network-layer.md)
- [서비스 카탈로그 — 기본 제공 카드 열 장과 내 카드 (REQ-104)](design-docs/service-catalog.md)
- [서비스와 OS 층 — 장비 위에서 무엇이 도는가](design-docs/service-os-layer.md)
- [사이트·DR 층 — 서버룸 하나에서 멀티 사이트까지, 지역 복제, 합의 DB, 관리형 멀티 AZ](design-docs/site-dr-layer.md)
- [소스 관리 — 다른 프로젝트로 옮긴 설계](design-docs/source-management.md)
- [스위치의 VLAN·MAC 표·ARP·라우팅 — 설정이 실제로 길을 바꾼다](design-docs/switch-l2l3.md)
- [툴 범위, 에스컬레이션, 절차서 — 실험 설계자가 정하는 세 가지 변수](design-docs/tool-scope-and-sop.md)
- [토폴로지 보기 — 무엇에 기대고 있나를 층별로 그리고, 같은 것은 접는다](design-docs/topology.md)
- [맡겨도 되나에 답하는 실험 — 권한 수준, 승인, 규칙, 운영 실험의 깊이, 판정](design-docs/trust-experiments.md)
- [UX Honeycomb 측정](design-docs/ux-honeycomb.md)
- [vCenter와 Aria Operations 응답 — 참고서와 맞춘 것, 못 맞춘 것](design-docs/vmware-api-conformance.md)
- [연결 화면 — 내 연결·하네스 종류·기준 에이전트](design-docs/web-ui-connections.md)
- [토폴로지 보기 — 3D와 토폴로지 전환, 다시 보기](design-docs/web-ui-topology.md)
- [웹 화면 — 디자인 원칙과 구조](design-docs/web-ui.md)
- [E2E 워크플로 자동화 — 다른 프로젝트로 옮긴 설계](design-docs/workflow-automation.md)
- [세계 만들기 검토 — 설명 없이도 되는가, 토스의 원칙으로](design-docs/world-builder-review.md)
- [세계 만들기 입구와 서비스부터 (REQ-094)](design-docs/world-entry.md)
- [세계 소스 — 생성과 가져오기](design-docs/world-sources.md)

### 안내

- [운영 에이전트 설계 가이드 — 8시간 동안 지켜보는 에이전트를 만드는 법](guides/operation-agent-guide.md)

### 계획

- [클로즈 베타 피드백 장부](exec-plans/active/beta-feedback.md)
- [클로즈 베타 차수 계획](exec-plans/active/beta-rounds.md)
- [구현 계획 — 테라리움](exec-plans/active/build-plan.md)

<!-- docs-list:end -->

### 결정 기록

결정 기록(ADR)은 [docs/design-docs/adr/](design-docs/adr/)에 있다. 손으로 쓰는 목록은 없다 (ADR-0180): 번호 순 목록과 어느 결정이 어느 결정을 고쳤는지는 하네스가 만든 [결정 목록](generated/decisions.md)에서 본다. 지금 유효한 것의 요약은 [제품 설계 한 장](design-docs/product-design.md) 4절. 새 결정 기록은 이 색인에 줄을 더하지 않는다.

## 그 밖의 파일

- [기술 부채 장부](exec-plans/tech-debt.yaml) (YAML)
- [화면 다듬기 목업 — 사다리 닫힘·열림, 직접 짓기 아무것도 안 고름·랙 고름](design-docs/mockups/ux-round3-mockup.html) (승인됨, REQ-102)
