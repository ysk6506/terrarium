# 결정 목록

이 문서는 하네스가 만들어요(`pnpm tsx harness/src/checks/docs.ts decisions`). 손으로 고치지 않아요. 결정 기록의 앞부분(제목, 상태, `amends`, `amended_by`, `superseded_by`)에서 번호 순으로 한 줄씩 만들고, 5시간마다 도는 정리 작업이 main에서 새로 만들어 올려요. 결정마다 커밋하지 않아요. 낡으면 구조 검사가 알림 한 줄만 내요.

'일부 고침'이 적힌 결정은 뒤의 결정이 그 일부를 바꿨다는 뜻이에요. 본문은 봉인되어 그대로이니, 거기 적힌 결정 가운데 무엇이 지금 유효한지는 고친 결정을 읽어 확인해요.

| 결정 | 상태 | 무엇이 고쳤나 |
|---|---|---|
| [ADR-0001 레이어 아키텍처](../design-docs/adr/0001-layered-architecture.md) | 대체됨 | 대체: [0011](../design-docs/adr/0011-units-v2.md) |
| [ADR-0002 문서 신선도 장치](../design-docs/adr/0002-doc-freshness.md) | 유효 |  |
| [ADR-0003 기술 부채 장부와 래칫](../design-docs/adr/0003-debt-ledger.md) | 유효 |  |
| [ADR-0004 테스트 잠금](../design-docs/adr/0004-test-lock.md) | 유효 |  |
| [ADR-0005 보호 경로](../design-docs/adr/0005-protected-paths.md) | 유효 |  |
| [ADR-0006 결정론적 시뮬레이션](../design-docs/adr/0006-deterministic-simulation.md) | 유효 |  |
| [ADR-0007 카탈로그·프로파일·파사드 분리](../design-docs/adr/0007-catalog-profile-facade.md) | 유효 |  |
| [ADR-0008 독립 공간 모듈과 소스 격리](../design-docs/adr/0008-spatial-and-sources.md) | 유효 |  |
| [ADR-0009 읽기 전용 현실 소스 포트](../design-docs/adr/0009-readonly-source-port.md) | 유효 |  |
| [ADR-0010 TypeScript 단일 언어 모노레포](../design-docs/adr/0010-typescript-monorepo.md) | 유효 |  |
| [ADR-0011 단위 기반 아키텍처 (core / server / web)](../design-docs/adr/0011-units-v2.md) | 유효 |  |
| [ADR-0012 웹 커버리지는 로직은 단위 테스트, 화면은 e2e로](../design-docs/adr/0012-web-coverage-split.md) | 유효 |  |
| [ADR-0013 같은 호출을 두 번 비교하는 단언은 허용한다 (TEST003 보정)](../design-docs/adr/0013-test003-repeated-evaluations.md) | 유효 |  |
| [ADR-0014 근거가 충분할 때만 커버리지 하한을 올린다](../design-docs/adr/0014-coverage-ratchet-evidence.md) | 유효 |  |
| [ADR-0015 테스트 코드에서는 any를 허용한다](../design-docs/adr/0015-tests-may-use-any.md) | 유효 |  |
| [ADR-0016 시나리오는 흐름 그래프와 채점표로 나눈다](../design-docs/adr/0016-scenario-flow-and-scoring.md) | 유효 |  |
| [ADR-0017 에이전트는 센서가 보고하는 값을 보고, 진실은 오라클만 본다](../design-docs/adr/0017-agents-see-sensor-readings.md) | 유효 |  |
| [ADR-0018 단위 테스트는 단위의 의존 규칙을 따르고, 단위 사이의 약속은 tests/spec에 둔다](../design-docs/adr/0018-test-placement.md) | 유효 |  |
| [ADR-0019 필수·금지 행동은 툴 이름이 아니라 세계에 끼친 효과로 판정한다](../design-docs/adr/0019-score-actions-by-effect.md) | 유효 |  |
| [ADR-0020 테스트 잠금 수정 명령은 ADR 경로도 받는다](../design-docs/adr/0020-amend-accepts-paths.md) | 유효 |  |
| [ADR-0021 세계 소스 — 생성은 건강하게, 가져오기는 읽기만 하고 가정은 드러낸다](../design-docs/adr/0021-world-sources.md) | 유효 |  |
| [ADR-0022 실험·분석·계약 단위는 세션(과 세계 소스)을 쓸 수 있다](../design-docs/adr/0022-experiments-see-sessions.md) | 유효 |  |
| [ADR-0023 벤치마크 세트, 순위, "분명한 차이"의 기준](../design-docs/adr/0023-benchmark-sets-and-comparison.md) | 유효 | 일부 고침: [0158](../design-docs/adr/0158-repeats-per-seed-and-seed-level-statistics.md) (순위는 실행 3번 이상) |
| [ADR-0024 실행 스케줄링 — 가장 적게 돌리고 있는 사람부터](../design-docs/adr/0024-fair-scheduling.md) | 유효 |  |
| [ADR-0025 저장소는 Node 내장 SQLite 파일 하나](../design-docs/adr/0025-sqlite-store.md) | 유효 |  |
| [ADR-0026 하네스 연결은 세 가지 — 내장, OpenAI 호환, 하네스 프로토콜(HTTP + MCP)](../design-docs/adr/0026-harness-adapters.md) | 대체됨 | 대체: [0042](../design-docs/adr/0042-connectors.md) |
| [ADR-0027 실행은 워커 스레드에서, 끝나는 방식은 다섯 가지로 정한다](../design-docs/adr/0027-run-hosting.md) | 유효 |  |
| [ADR-0028 사용자 식별은 SSO 프록시 헤더, 없으면 스스로 밝힌 이름. 보기는 모두, 바꾸기는 만든 사람](../design-docs/adr/0028-identity-and-sharing.md) | 유효 | 일부 고침: [0174](../design-docs/adr/0174-permissions-proxy-identity-three-scopes-audit.md) (신원과 권한을 넓힘) |
| [ADR-0029 하네스는 파싱한 파일을 다시 쓴다](../design-docs/adr/0029-harness-parse-cache.md) | 유효 |  |
| [ADR-0030 웹은 Vite와 React 한 벌, 라우터는 직접, 3D와 편집기는 열 때 내려받는다](../design-docs/adr/0030-web-stack.md) | 유효 |  |
| [ADR-0031 UX는 브라우저가 세고 하네스가 점수를 매긴다](../design-docs/adr/0031-ux-honeycomb-measurement.md) | 유효 |  |
| [ADR-0032 스케일 아웃은 워커 노드를 붙이는 것, 스케일 업은 스레드를 늘리는 것](../design-docs/adr/0032-scale-out-workers.md) | 유효 |  |
| [ADR-0033 워밍업 상태를 기억해 두고 세션을 빨리 연다](../design-docs/adr/0033-warm-start-and-capacity-defaults.md) | 유효 |  |
| [ADR-0034 쓰지 않는 e2e 스크립트를 없앤다](../design-docs/adr/0034-remove-stale-e2e-script.md) | 유효 |  |
| [ADR-0035 캠퍼스 세계: 용도별 방, 수랭 사슬, 전원 사슬, 제조사 다양성](../design-docs/adr/0035-campus-world-model.md) | 유효 |  |
| [ADR-0036 사업장은 개략 외곽선을 갖고 건물은 그 안에 선다](../design-docs/adr/0036-site-outlines.md) | 유효 |  |
| [ADR-0037 화면 디자인은 사용자가 고른 안으로만 바꾼다](../design-docs/adr/0037-design-approval-gate.md) | 유효 |  |
| [ADR-0038 묶음 랙: 서버를 개체로 만들지 않고 대수로 세는 랙](../design-docs/adr/0038-light-racks.md) | 유효 |  |
| [ADR-0039 반도체 팹 건물과 사업장의 생활감](../design-docs/adr/0039-fab-buildings.md) | 유효 |  |
| [ADR-0040 지도에서 옮긴 사업장 배치와 하나의 3D 무대(WorldStage)](../design-docs/adr/0040-site-layout-and-world-stage.md) | 유효 |  |
| [ADR-0041 실시간 활동 — 어떤 에이전트가 어느 장비에서 무엇을 하는지 세계에 보인다](../design-docs/adr/0041-live-activity.md) | 유효 |  |
| [ADR-0042 하네스·에이전트 연결은 커넥터 플러그인과 연결 레지스트리로 한다](../design-docs/adr/0042-connectors.md) | 유효 |  |
| [ADR-0043 연결의 비밀 값은 봉인해 보관하고, 안 쓰는 연결은 알린 뒤 지우며, 에이전트는 버전으로 관리한다](../design-docs/adr/0043-connection-secrets-retention-versions.md) | 유효 |  |
| [ADR-0044 사용자 식별은 하나의 자리(Authenticator)로 꽂는다 — 지금은 프록시 헤더와 스스로 밝힌 이름, 나중에 사내 SSO](../design-docs/adr/0044-identity-slot.md) | 유효 | 일부 고침: [0174](../design-docs/adr/0174-permissions-proxy-identity-three-scopes-audit.md) (신원과 권한을 넓힘) |
| [ADR-0045 캠퍼스 꾸미기 — 도로 격자 블록에 용도별 시설을 채운다](../design-docs/adr/0045-campus-decoration.md) | 유효 |  |
| [ADR-0046 사업장의 건물 자리는 모두 정해져 있고, 서버룸은 팹·연구동·HPC센터의 현실 구조를 따른다](../design-docs/adr/0046-site-places-and-server-rooms.md) | 유효 |  |
| [ADR-0047 건물은 지도가 부르는 이름과 자리를 따르고, 월드가 만들지 않는 건물도 그 자리에 선다](../design-docs/adr/0047-site-names-and-places.md) | 유효 |  |
| [ADR-0048 하네스·에이전트 연결은 화면에서 한다 — 메뉴의 "연결", 폼은 커넥터가 그린다, 버전은 한 화면에서 본다](../design-docs/adr/0048-connections-screens.md) | 유효 |  |
| [ADR-0049 3D 그림은 기계가 따라가지 못하면 스스로 가벼워진다 — 같은 디자인, 값비싼 효과만 뺀다](../design-docs/adr/0049-adaptive-3d-quality.md) | 유효 |  |
| [ADR-0050 UX는 토스의 원칙으로 한다 — 한 화면에 한 가지, 해요체, 눈에 보이는 디테일마다 기준과 측정](../design-docs/adr/0050-toss-ux-principles.md) | 유효 |  |
| [ADR-0051 가격은 현실의 값을 따르고, 확인한 값과 추정한 값을 나누어 밝힌다](../design-docs/adr/0051-real-world-prices.md) | 유효 |  |
| [ADR-0052 빌더는 땅을 사고, 건물을 용도대로 짓고, 서버룸을 채우고, 새 사업장에서 시작한다](../design-docs/adr/0052-builder-redesign.md) | 유효 |  |
| [ADR-0053 화면 모양은 토스의 결(안 B)을 따르고, 새 사업장·땅 사기 여정을 측정에 넣는다](../design-docs/adr/0053-toss-visual-b.md) | 유효 |  |
| [ADR-0054 빌더는 무작위 편집으로 시험하고, 땅은 옮길 수 없고, 서로 겹치는 일은 한 곳에서 본다](../design-docs/adr/0054-builder-random-walk.md) | 유효 |  |
| [ADR-0055 GoClaw와 Hermes는 공식 소스를 읽고 만든 전용 연결로 붙이고, 설정 파일로만 도구를 받는 하네스에는 고정 도구 주소를 준다](../design-docs/adr/0055-goclaw-hermes-slot.md) | 유효 |  |
| [ADR-0056 규모는 TypeScript 그대로, 재서 고친다 — 월드를 한 번만 준비하고, 물리는 배열로 읽고, 메모리로 입장시킨다](../design-docs/adr/0056-scale-performance.md) | 유효 |  |
| [ADR-0057 설비는 표준이 있으면 그 말로 답한다 — Redfish는 스키마로 대조, UPS는 SNMP, 냉각·발전은 BACnet](../design-docs/adr/0057-facility-standard-interfaces.md) | 유효 |  |
| [ADR-0058 vCenter와 Aria Operations 응답은 제조사의 공개 API 참고서를 따르고, 참고서에서 옮긴 스키마로 대조한다](../design-docs/adr/0058-vmware-api-conformance.md) | 유효 |  |
| [ADR-0059 스위치는 운영 체제의 말로 답한다 — 아리스타 EOS, 시스코 NX-OS·IOS XE의 명령줄과 eAPI·NX-API, 포트 shutdown은 월드를 바꾼다](../design-docs/adr/0059-switch-operating-systems.md) | 유효 |  |
| [ADR-0060 랙은 두 규격(EIA-310, OCP ORv3)을 다루고, PDU 콘센트는 하나씩 끌 수 있다](../design-docs/adr/0060-rack-standards-and-outlets.md) | 유효 |  |
| [ADR-0061 스위치는 VLAN·MAC 표·ARP·라우팅을 갖고, 설정이 실제로 길을 바꾼다](../design-docs/adr/0061-switch-l2-l3.md) | 유효 |  |
| [ADR-0062 네트워크는 레거시와 클라우드 두 가지로 짓고, 클라우드는 케이블마다 BGP 세션이 선다](../design-docs/adr/0062-network-fabrics.md) | 유효 |  |
| [ADR-0063 GPU는 칩 이름으로 다루고, 베라 루빈은 도입 예정으로만 둔다](../design-docs/adr/0063-gpu-catalog.md) | 유효 |  |
| [ADR-0064 GPU 백엔드는 서버마다 NIC 여럿을 rail로 꽂는 세 번째 패브릭이고, rail 하나를 잃으면 느려질 뿐 끊기지 않는다](../design-docs/adr/0064-gpu-fabric.md) | 유효 |  |
| [ADR-0065 설정 변경은 시나리오 블록이고, 블록은 외워 쓰지 않고 장비가 가진 것에서 고른다](../design-docs/adr/0065-config-scenarios.md) | 유효 |  |
| [ADR-0066 제어 가능한 것은 한 장의 표로 말하고, 표는 월드와 툴에서 거꾸로 검증한다](../design-docs/adr/0066-controllability-matrix.md) | 유효 |  |
| [ADR-0067 효율 점수는 과제를 푼 만큼만 주고, 시험지는 기준선 에이전트로 점검한다](../design-docs/adr/0067-measurement-soundness.md) | 유효 |  |
| [ADR-0068 블록은 누르면 이어 붙고, 뻔한 문제는 버튼으로 고치고, 시험지 점검은 편집기에서 한다](../design-docs/adr/0068-authoring-first-use.md) | 유효 |  |
| [ADR-0069 홈 첫 문구는 테라리움을 처음 보는 사람 기준으로 쓴다](../design-docs/adr/0069-home-copy-for-newcomers.md) | 유효 |  |
| [ADR-0070 시나리오 편집기는 처음 쓰는 사람이 10분 안에 돌아가는 시나리오를 만들게 한다](../design-docs/adr/0070-scenario-editor-first-use.md) | 유효 |  |
| [ADR-0071 화면의 말은 용어집 하나로 정하고, 글 전체를 한 번 점검한다](../design-docs/adr/0071-glossary-and-copy-audit.md) | 유효 |  |
| [ADR-0072 편집기의 말을 용어집에 맞추고, 그 말을 지키던 시험 일곱 개의 기대값을 고친다](../design-docs/adr/0072-editor-words-amend-tests.md) | 유효 |  |
| [ADR-0073 편집기 밖의 화면 글도 용어집에 맞추고, 그 말을 지키던 시험 열여섯 개의 기대값을 고친다](../design-docs/adr/0073-app-words-amend-tests.md) | 유효 |  |
| [ADR-0074 온도·공기 흐름은 3D 장면 위에 겹치고, 위에서 본 지도는 같은 장면의 정사영이다](../design-docs/adr/0074-airflow-map.md) | 유효 |  |
| [ADR-0075 운영 채점은 물리가 보상하는 곳에만 넣고, 채점표는 사실만 말한다](../design-docs/adr/0075-operation-scoring.md) | 유효 |  |
| [ADR-0076 운영 채점으로 채점표와 기대값이 달라진 시험 열네 개의 기대값을 고친다](../design-docs/adr/0076-operation-scoring-amend-tests.md) | 유효 |  |
| [ADR-0077 공기 흐름 지도의 말도 용어집 점검에 넣고, 그 점검이 읽는 목록을 고친다](../design-docs/adr/0077-airflow-words-amend-tests.md) | 유효 |  |
| [ADR-0078 서버룸의 사람은 꾸밈이지만 세계를 읽는다 — 고장이 나면 걸어가서 일한다](../design-docs/adr/0078-people-in-the-hall.md) | 유효 |  |
| [ADR-0079 서버룸과 건물은 직사각형 안에서 자유롭게 넓히고, 꽉 차면 길을 보여 준다](../design-docs/adr/0079-room-resize.md) | 유효 |  |
| [ADR-0080 방은 직사각형 조각을 붙인 하나의 공간이다 — L자와 육각형 윤곽을 그대로 만든다](../design-docs/adr/0080-room-pieces.md) | 유효 |  |
| [ADR-0081 건물은 실제 크기에 묶이고, 방은 그 바닥이 허락하는 만큼 자유롭다](../design-docs/adr/0081-real-building-size.md) | 유효 |  |
| [ADR-0082 느린 기계에서는 멈추지 않고 줄인다 — 품질·부하 시험 기대값을 고친다](../design-docs/adr/0082-quality-degrade-amend-tests.md) | 유효 |  |
| [ADR-0083 세계 만들기는 결과를 고르고, 빌더는 고른 것 하나에 할 일 하나다](../design-docs/adr/0083-world-making-redesign.md) | 유효 |  |
| [ADR-0084 가져오기를 없애고 토폴로지 보기를 둔다 — 같은 것은 접고 다른 것만 편다](../design-docs/adr/0084-topology-view.md) | 유효 | 일부 고침: [0150](../design-docs/adr/0150-reality-worlds-are-a-requirement-decisions-and-proposals.md) (현실 가져오기를 지움) |
| [ADR-0085 텔레메트리는 연결마다 어댑터로 붙이고, 묶는 열쇠는 어댑터가 정한다](../design-docs/adr/0085-telemetry-adapters.md) | 유효 |  |
| [ADR-0086 세계 만들기 재설계로 달라진 글과 흐름의 시험 기대값을 고친다](../design-docs/adr/0086-world-making-amend-tests.md) | 유효 |  |
| [ADR-0087 툴 범위는 실험 설계자가 정하고, 현실 수준 꼬리표를 달고, 에스컬레이션과 절차서는 실험 변수다](../design-docs/adr/0087-tool-scope-escalation-sop.md) | 유효 |  |
| [ADR-0088 테라리움의 데이터는 재활용하도록 설계한다 — 불변 사건, 버전 묶음, 표준 내보내기, 라벨 사건](../design-docs/adr/0088-data-reuse.md) | 유효 |  |
| [ADR-0089 홈은 경영진 한 장이고 그 뒤가 엔지니어 근거다 — 벤치마크는 pass^k·실패 유형·버전 세트·비용을 말한다](../design-docs/adr/0089-dashboard-benchmark.md) | 유효 |  |
| [ADR-0091 세계에 서비스·OS 층을 올리고, 채점은 복구 우선이다](../design-docs/adr/0091-service-os-layer-recovery-first.md) | 유효 |  |
| [ADR-0092 서비스부터 세계를 만들 수 있고, 만든 구성은 저장해 두고 다시 쓴다](../design-docs/adr/0092-service-first-world-and-templates.md) | 유효 |  |
| [ADR-0094 운영 모드 — 끝이 없는 실험, 당겨서 보는 모니터링, 실시간과 빨리 감기](../design-docs/adr/0094-operation-mode.md) | 유효 |  |
| [ADR-0095 현실의 쌍둥이는 네 단계로 가고, 세계의 모델은 플러그인으로 바꿀 수 있다](../design-docs/adr/0095-digital-twin-and-model-plugins.md) | 유효 |  |
| [ADR-0096 파워 캐핑 — 전기요금을 아끼면서 서비스를 지키는 줄다리기를 잰다](../design-docs/adr/0096-power-capping.md) | 유효 |  |
| [ADR-0097 토폴로지 보기 ①이 건드리는 보호 경로 — 새 코어 단위, UX 여정, 두 문서의 앞부분](../design-docs/adr/0097-topology-amend-tests.md) | 유효 |  |
| [ADR-0098 도메인 범위, 가상 담당자, 작업 티켓 — 넘기고 기다리고 그동안 다른 일을 하는 운영을 잰다](../design-docs/adr/0098-domains-virtual-counterparts-tickets.md) | 유효 |  |
| [ADR-0099 가상 담당자는 거절하지 않고 코드로 결정론적으로 움직이며, 티켓 툴은 선택이고, 교체 작업은 3D에 보인다 (ADR-0098 보정)](../design-docs/adr/0099-counterparts-deterministic.md) | 유효 |  |
| [ADR-0100 에스컬레이트는 도메인 하나만 받는다 — 그 시점의 그 도메인 고장이 고장 종류별 리드타임 뒤에 사라진다 (ADR-0098·0099 단순화)](../design-docs/adr/0100-escalate-by-domain.md) | 유효 |  |
| [ADR-0101 랙 실장 장면, 컨테인먼트 안, 펌웨어 올리기 — 시험 세 개의 기대값을 고친다](../design-docs/adr/0101-rack-containment-firmware-amend-tests.md) | 유효 |  |
| [ADR-0102 서비스·OS 층을 구현하면서 시험 다섯 개의 기대값을 고친다](../design-docs/adr/0102-service-os-amend-tests.md) | 유효 |  |
| [ADR-0103 토폴로지 보기 ②가 건드리는 보호 경로 — ADR-0084의 강제 장치에 새 시험을 잇는다](../design-docs/adr/0103-topology-replay-amend-tests.md) | 유효 |  |
| [ADR-0104 복구 우선 채점을 구현하면서 시험 세 개의 기대값을 고친다](../design-docs/adr/0104-recovery-scoring-amend-tests.md) | 유효 |  |
| [ADR-0105 툴 범위·에스컬레이션·절차서를 구현하면서 시험 세 곳의 기대값을 고친다](../design-docs/adr/0105-tool-scope-sop-amend-tests.md) | 유효 |  |
| [ADR-0106 도메인·넘기기를 구현하면서 시험 두 개의 기대값을 고친다 — 에이전트 투입의 제한 시간 상한, 서버룸 사람의 말 묶음](../design-docs/adr/0106-domains-escalate-amend-tests.md) | 유효 |  |
| [ADR-0107 세계 만들기 입구를 둘로 가르고, 서비스부터는 층마다 HA 사다리에서 고른다 — 모르는 층은 알아서](../design-docs/adr/0107-world-entry-two-doors-ha-ladders.md) | 유효 |  |
| [ADR-0108 서비스부터는 IAP 하나로 시작하고, 사다리의 칩마다 그림·설명 카드가 있다 (0107 보정)](../design-docs/adr/0108-world-entry-iap-and-chip-cards.md) | 유효 |  |
| [ADR-0109 세계 만들기 입구를 구현하면서 글 잣대 시험의 화면 목록 둘을 고친다](../design-docs/adr/0109-world-entry-amend-tests.md) | 유효 |  |
| [ADR-0110 운영 모드를 구현하면서 ADR-0094의 강제 장치를 시험으로 잇는다](../design-docs/adr/0110-operation-mode-amend-tests.md) | 유효 |  |
| [ADR-0111 데이터베이스 층과 스토리지 HA 층을 코어 모델로 올리면서 시험 열한 곳의 기대값을 고친다](../design-docs/adr/0111-db-storage-layers-amend-tests.md) | 유효 |  |
| [ADR-0112 서버가 멈춰도 운영은 이어 가고, 저장해 둔 것은 서버에 두고, 서비스마다 모양을 고르고, 운영의 끝은 운영의 말로 쓴다](../design-docs/adr/0112-operation-resume-and-presets-amend-tests.md) | 유효 |  |
| [ADR-0114 컨테이너 층을 코어 모델로 올리면서 시험의 기대값을 고친다](../design-docs/adr/0114-container-layer-amend-tests.md) | 유효 |  |
| [ADR-0115 SDN 오버레이와 클라우드 네이티브 네트워크 층을 코어 모델로 올리면서 시험 열다섯 곳의 기대값을 고친다](../design-docs/adr/0115-sdn-network-layer-amend-tests.md) | 유효 |  |
| [ADR-0116 진짜 호스트 섞기 — 세계의 서버 몇 대는 실제 리눅스가 답한다](../design-docs/adr/0116-real-hosts-in-the-world.md) | 대체됨 | 대체: [0117](../design-docs/adr/0117-deep-os-simulation.md) |
| [ADR-0117 흉내 OS를 깊게 — 작은 리눅스 흉내가 run_command에 답한다 (0116 대체)](../design-docs/adr/0117-deep-os-simulation.md) | 유효 |  |
| [ADR-0118 깊은 OS 흉내를 구현하면서 시험 다섯 곳의 기대값을 고치고 시험을 더한다](../design-docs/adr/0118-deep-os-tests.md) | 유효 |  |
| [ADR-0119 LLM API 등록 — 워크스페이스 단위 모델 연결, 키는 서버에만, 얇은 클라이언트](../design-docs/adr/0119-llm-api-registration.md) | 유효 |  |
| [ADR-0120 컨테이너·SDN 층을 깊은 OS 흉내 위에 얹으면서 노드 디스크 압박 시험의 지우는 길을 고친다](../design-docs/adr/0120-container-layer-on-deep-os.md) | 유효 |  |
| [ADR-0121 애플리케이션 층을 코어 모델로 올리고 서비스 호출 그래프를 넣는다 — 시험의 목록 기대값을 늘린다](../design-docs/adr/0121-application-layer-and-calls.md) | 유효 |  |
| [ADR-0122 세계 인기 순서·좋아요·칭호, 그리고 계급 모델 — 점수는 서버가 기록에서 세고, 칭호는 한 번 얻으면 안 잃고, 계급은 아직 화면에 없다](../design-docs/adr/0122-world-popularity-likes-titles.md) | 유효 |  |
| [ADR-0123 사다리 화면과 직접 짓기를 주인공 하나로 다시 그리고, 칩에 전제 규칙을 두고, 돌려 보기를 시운전으로 부른다](../design-docs/adr/0123-ladder-and-builder-focus.md) | 유효 |  |
| [ADR-0124 이끼 — 테라리움 도우미: 이름, 지식 둘, 화면 등록, 누락 검사, 기본 모델, 품질 측정, 먼저 말 걸지 않는다](../design-docs/adr/0124-moss-assistant.md) | 유효 |  |
| [ADR-0125 이끼는 LLM을 연결해야만 쓸 수 있다 — 기본 모델이 없으면 꺼져 있고, 점수 질문은 채점 문서를 먼저 찾는다](../design-docs/adr/0125-moss-requires-model.md) | 유효 |  |
| [ADR-0126 run-all은 이끼 검사도 돌린다 (0124 보정)](../design-docs/adr/0126-run-all-includes-moss.md) | 유효 |  |
| [ADR-0127 서비스부터는 질문 셋과 "실험 시작"(클릭 넷), 서비스는 카탈로그에서 고르고 내 카드로 저장·공유한다, 입구 그림은 비운다](../design-docs/adr/0127-short-world-flow-and-service-catalog.md) | 유효 |  |
| [ADR-0128 부지는 도로 → 주차장 → 차 → 나무 순서로 깔고, 고양이와 새는 눌리면 대답한다](../design-docs/adr/0128-campus-layout-and-animals.md) | 유효 |  |
| [ADR-0129 마지막 점선 다섯을 실선으로 — 사이트·DR 사다리, 지역 복제, 분산 SQL, 관리형 멀티 AZ](../design-docs/adr/0129-site-dr-geo-storage-distributed-db.md) | 유효 |  |
| [ADR-0130 GPU 가속기 층을 사다리에 올리고, 전원·냉방 사다리를 끝까지 실선으로 늘리며, 파워 캐핑을 모델로 옮긴다](../design-docs/adr/0130-gpu-layer-power-cooling-ladders.md) | 유효 |  |
| [ADR-0131 내장 에이전트가 DR을 알고, 복구 채점의 시간 창이 세계의 모양을 따른다](../design-docs/adr/0131-baseline-dr-and-expected-recovery-window.md) | 유효 |  |
| [ADR-0132 세계 만들기의 크기는 서비스 숫자로 세고, 알아서는 숫자의 규칙 표이며, 빌더 카드는 고른 물체 옆에 붙는다](../design-docs/adr/0132-world-entry-sizing-and-ux-fixes.md) | 유효 |  |
| [ADR-0133 채점 정확성 보증: 정답 풀이·결정성·변이 검사](../design-docs/adr/0133-grading-correctness-reference-solver.md) | 유효 |  |
| [ADR-0134 내 카드만으로도 끝까지 가고, 크기의 숫자는 하나의 계산이며, 빌더 오른쪽 아래는 겹치지 않는다](../design-docs/adr/0134-own-card-alone-and-one-sizing.md) | 유효 |  |
| [ADR-0135 지금 하는 방식은 사람이 적고, 에이전트의 값은 코드가 기록에서 세어 둘을 같은 잣대로 견준다](../design-docs/adr/0135-process-compare.md) | 유효 |  |
| [ADR-0136 물리가 닿는 열네 자리를 모델 자리로 만들고, 법칙 검사와 프로필 지문으로 채점을 지킨다](../design-docs/adr/0136-physics-inventory-and-model-slots.md) | 유효 |  |
| [ADR-0137 물리 모델 자리(이음매)와 물리 프로필(숫자·곡선·바깥 온도·지문)의 코어를 만든다](../design-docs/adr/0137-physics-slots-and-profile-core.md) | 유효 |  |
| [ADR-0138 제품 목표를 요구사항 문서 맨 위에 적고 설계 결정의 기준으로 삼는다](../design-docs/adr/0138-product-goal.md) | 유효 |  |
| [ADR-0139 CCTV는 카메라 개체·보는 자리·배경 자리의 세 자리로 두고, 실험의 그림은 서버가 결정적으로 그린다](../design-docs/adr/0139-camera-view-and-backdrop-slots.md) | 유효 |  |
| [ADR-0140 CI가 합치기 관문이다 — 테스트는 조각으로 나눠 병렬로, 커버리지는 따로 잰다](../design-docs/adr/0140-ci-shards-and-merge-gate.md) | 유효 |  |
| [ADR-0141 UX 검사를 게이트인 여정과 게이트 아닌 측정으로 나누고, 러너에서 안 되던 화면을 고친다](../design-docs/adr/0141-ux-journeys-gate-and-measure.md) | 유효 |  |
| [ADR-0142 커버리지 하한을 새 단위까지 넓히고, 고장 난 날에도 물리 법칙을 검사한다](../design-docs/adr/0142-coverage-floors-and-fault-law-checks.md) | 유효 |  |
| [ADR-0143 깊은 OS 흉내를 GNU에 더 가깝게 하고 커버리지 하한을 채운다](../design-docs/adr/0143-shell-fidelity-and-coverage-gate.md) | 유효 |  |
| [ADR-0144 현실 데이터는 네 단으로 들어오고, 세계는 현실과 실험 두 종류이며, 모델은 핵심을 잠그고 넓힌다](../design-docs/adr/0144-reality-data-pipeline-ontology-manager-world-kinds.md) | 유효 | 일부 고침: [0156](../design-docs/adr/0156-blast-radius-ports-redundancy-groups-in-memory-index.md) (관계 표의 끊기면 넘어가나), [0165](../design-docs/adr/0165-dataset-refine-ontology-link-layers-open-types.md) (정제·링크를 한 단계 안에 접음), [0167](../design-docs/adr/0167-data-pipeline-words-from-practice.md) (순우리말로 지은 이름), [0170](../design-docs/adr/0170-product-design-one-page-six-principles.md) (단계 A~D의 순서) |
| [ADR-0145 보정 시험은 한 번 돌리고 여러 번 묻는다](../design-docs/adr/0145-calibration-ask-once.md) | 유효 |  |
| [ADR-0146 캡처 검토에서 나온 화면 결함을 고치고, 겹침 검사를 글자·선·제목까지 넓힌다](../design-docs/adr/0146-capture-review-fixes-and-wider-layout-check.md) | 유효 |  |
| [ADR-0147 구조 검사는 같은 파일에 같은 질문을 두 번 하지 않는다](../design-docs/adr/0147-harness-derived-cache.md) | 유효 |  |
| [ADR-0148 검사는 조용히 끌 수 없고, 단위별 품질 등급표는 하네스가 만든다](../design-docs/adr/0148-no-silent-ignores-and-quality-grades.md) | 유효 |  |
| [ADR-0149 소스의 역할은 구성·사건·실측 셋이고, 읽기 전용은 허용 목록과 계정으로 지킨다](../design-docs/adr/0149-source-roles-and-read-only-allowlist.md) | 유효 | 일부 고침: [0152](../design-docs/adr/0152-reality-worlds-admin-fork-excel-spl.md) (SPL은 정해 둔 검색만) |
| [ADR-0150 현실 데이터로 세계 만들기는 요구사항이고, 그 설계를 결정과 제안으로 나눈다](../design-docs/adr/0150-reality-worlds-are-a-requirement-decisions-and-proposals.md) | 유효 | 일부 고침: [0151](../design-docs/adr/0151-source-sync-schedule-safeguards-pinned-versions.md) (계속 동기화는 범위 밖), [0152](../design-docs/adr/0152-reality-worlds-admin-fork-excel-spl.md) (같은 것 알아보기는 둘째 걸음), [0153](../design-docs/adr/0153-operation-mode-worlds-are-highly-available-open-beta.md) (평면 둘·고가용성은 제안) |
| [ADR-0151 소스는 주기로 동기화하고, 적용은 안전장치를 거치며, 실험은 세계의 판에 묶인다](../design-docs/adr/0151-source-sync-schedule-safeguards-pinned-versions.md) | 유효 | 일부 고침: [0153](../design-docs/adr/0153-operation-mode-worlds-are-highly-available-open-beta.md) (서버 한 대 전제) |
| [ADR-0152 현실에서 만든 세계는 관리자가 다루고 복사해서 실험하며, 엑셀과 SPL이 첫 길이다](../design-docs/adr/0152-reality-worlds-admin-fork-excel-spl.md) | 유효 |  |
| [ADR-0153 운영 모드의 세계는 고가용으로 설계하고, 오픈 베타에 넣는다](../design-docs/adr/0153-operation-mode-worlds-are-highly-available-open-beta.md) | 유효 |  |
| [ADR-0154 현실 데이터는 수천만 개체까지 본다 — 줄로 저장하고, 범위로 보고 복사하며, 재서 정한다](../design-docs/adr/0154-reality-scale-tens-of-millions-rows-scopes-measure.md) | 유효 | 일부 고침: [0156](../design-docs/adr/0156-blast-radius-ports-redundancy-groups-in-memory-index.md) (3초와 저장소에서 되짚기) |
| [ADR-0155 수집의 관측성 — 지표는 밖으로 내보내고, 데이터가 평소와 다른지 보고, 로그에 내용을 찍지 않는다](../design-docs/adr/0155-ingestion-observability.md) | 유효 |  |
| [ADR-0156 영향 범위는 포트 단위까지 묶음의 뜻으로 계산하고, 메모리의 색인에서 1초·수 초 안에 답한다](../design-docs/adr/0156-blast-radius-ports-redundancy-groups-in-memory-index.md) | 유효 | 일부 고침: [0161](../design-docs/adr/0161-shape-sample-test-fills-the-gaps.md) (포트의 딸린 줄), [0164](../design-docs/adr/0164-ecmp-from-device-config-list-excel-k8s-vdi.md) (관계 표의 묶음 뜻), [0168](../design-docs/adr/0168-experiment-copy-behaves-like-the-operation-world.md) (모르는 것은 보고), [0169](../design-docs/adr/0169-one-model-for-invented-and-real-worlds.md) (포트를 타입에 넣지 않음) |
| [ADR-0157 모델은 층마다 표준에서 뼈대를 빌리고, 종류는 세 층이며, 가상화 플랫폼은 대응 표로 받는다](../design-docs/adr/0157-model-standards-three-tiers-platform-mapping.md) | 유효 | 일부 고침: [0161](../design-docs/adr/0161-shape-sample-test-fills-the-gaps.md) (OpenStack 애그리거트), [0165](../design-docs/adr/0165-dataset-refine-ontology-link-layers-open-types.md) (사용자가 만든 관계는 영향이 안 넘어감), [0168](../design-docs/adr/0168-experiment-copy-behaves-like-the-operation-world.md) (모르는 것은 보고), [0169](../design-docs/adr/0169-one-model-for-invented-and-real-worlds.md) (타입 세 층) |
| [ADR-0158 시드마다 여러 번 돌리고, 통계의 단위는 실행이 아니라 시드다](../design-docs/adr/0158-repeats-per-seed-and-seed-level-statistics.md) | 유효 |  |
| [ADR-0159 관문의 브라우저 설치는 시스템 꾸러미 없이 하고, 다시 해 본다](../design-docs/adr/0159-retry-browser-install-in-ci.md) | 유효 |  |
| [ADR-0160 시드당 반복을 지을 때 정한 말과 짜임, 그리고 ADR-0158의 시험 수정 목록](../design-docs/adr/0160-repeats-per-seed-built-words-and-wiring.md) | 유효 |  |
| [ADR-0161 생김새 견본 시험에서 막힌 열아홉 곳을 메운다 — 손질은 여덟 가지, 딸린 요청, 다듬어 견주기, 묶음의 출처](../design-docs/adr/0161-shape-sample-test-fills-the-gaps.md) | 유효 | 일부 고침: [0164](../design-docs/adr/0164-ecmp-from-device-config-list-excel-k8s-vdi.md) (ECMP의 출처) |
| [ADR-0162 포크 여정은 포크만 재고, 반복은 자기 여정을 가진다](../design-docs/adr/0162-fork-journey-measures-the-fork-repeats-have-their-own.md) | 유효 |  |
| [ADR-0163 멈춘 실행이 하나라도 있는 실험은 "완료"가 아니라 "멈춤"으로 읽힌다](../design-docs/adr/0163-a-stopped-experiment-reads-stopped.md) | 유효 |  |
| [ADR-0164 ECMP는 장비 설정에서 읽고, 위치 엑셀은 목록으로 받고, VMware의 쿠버네티스와 VDI 둘을 대응 표에 넣는다](../design-docs/adr/0164-ecmp-from-device-config-list-excel-k8s-vdi.md) | 유효 |  |
| [ADR-0165 데이터셋·정제·온톨로지 매핑·링크 조건을 각자의 층으로 나누고, 객체 종류와 링크 종류는 열려 있다](../design-docs/adr/0165-dataset-refine-ontology-link-layers-open-types.md) | 유효 | 일부 고침: [0168](../design-docs/adr/0168-experiment-copy-behaves-like-the-operation-world.md) (사용자 타입은 실험에 안 들어감) |
| [ADR-0166 파이프라인은 버전으로 남기고, 브랜치에서 고쳐 미리보기 세계로 확인한 뒤 운영에 병합한다](../design-docs/adr/0166-pipeline-versions-snapshots-branches.md) | 유효 |  |
| [ADR-0167 데이터 파이프라인과 온톨로지 매니저의 말은 지어내지 않고 현업에서 쓰는 말을 쓴다](../design-docs/adr/0167-data-pipeline-words-from-practice.md) | 유효 | 일부 고침: [0170](../design-docs/adr/0170-product-design-one-page-six-principles.md) (객체·링크와 개체·관계를 나중에 맞춤) |
| [ADR-0168 실험용 복사본은 운영 세계와 같은 의미로 움직인다 — 전파 엔진은 하나이고, 모든 타입이 실험에 들어간다](../design-docs/adr/0168-experiment-copy-behaves-like-the-operation-world.md) | 유효 |  |
| [ADR-0169 모델은 하나다 — 현실에서 만든 세계와 지어낸 세계는 같은 타입과 같은 링크 표현을 쓰고, 매핑의 목적지는 핵심 모델이다](../design-docs/adr/0169-one-model-for-invented-and-real-worlds.md) | 유효 |  |
| [ADR-0170 제품의 값과 원칙 여섯을 한 장에 두고, 요구사항은 그 한 장에 대 본 뒤 설계한다](../design-docs/adr/0170-product-design-one-page-six-principles.md) | 유효 | 일부 고침: [0180](../design-docs/adr/0180-docs-follow-decisions-not-only-code.md) (4절의 손으로 쓴 결정 목록) |
| [ADR-0171 실험 결과의 첫 화면은 세 물음에 답하고, 나머지는 탭 뒤로 간다](../design-docs/adr/0171-result-page-answers-three-questions.md) | 유효 |  |
| [ADR-0172 제공되는 시나리오는 그 세계에서 정답 풀이가 만점을 받는다](../design-docs/adr/0172-offered-scenario-means-reference-solution-reaches-full-score.md) | 유효 | 일부 고침: [0178](../design-docs/adr/0178-offered-scenario-solved-on-every-world-shape.md) (정답 풀이 불변식은 골든 행렬의 다섯 세계만) |
| [ADR-0173 문서만 바뀐 변경은 가벼운 CI 경로를 탄다](../design-docs/adr/0173-docs-only-changes-take-a-light-ci-path.md) | 유효 |  |
| [ADR-0174 권한은 프록시가 넘겨준 신원, 역할 둘, 공개 범위 셋, 감사 기록으로 한다](../design-docs/adr/0174-permissions-proxy-identity-three-scopes-audit.md) | 유효 |  |
| [ADR-0177 제품 목표의 "현실을 닮은 세계"에 현실의 데이터로 지은 세계를 적고, 맨 위 문서를 목표에 맞춘다](../design-docs/adr/0177-goal-text-reality-worlds-and-top-level-docs.md) | 유효 |  |
| [ADR-0178 제공되는 시나리오는 제품이 만드는 모든 세계 모양에서 정답 풀이가 만점을 받는다](../design-docs/adr/0178-offered-scenario-solved-on-every-world-shape.md) | 유효 |  |
| [ADR-0180 문서는 코드뿐 아니라 결정도 따라간다 — 결정이 바꾸는 문서를 적고, 고쳐진 결정에 표시를 남기고, 목록은 만들어 낸다](../design-docs/adr/0180-docs-follow-decisions-not-only-code.md) | 유효 | 일부 고침: [0182](../design-docs/adr/0182-amends-says-what-it-changed.md) (amends와 amended_by는 파일 이름만 적음), [0186](../design-docs/adr/0186-requirements-do-not-follow-the-design-page.md) (follows는 문서의 서로 가리킴에서 고른다) |
| [ADR-0181 테라리움의 라이선스는 Apache License 2.0이다](../design-docs/adr/0181-license-apache-2.md) | 유효 |  |
| [ADR-0182 고친 결정에는 무엇을 고쳤는지 한 구절을 적는다 — amends의 what, link-amends가 옮겨 적고, 결정 목록이 보인다](../design-docs/adr/0182-amends-says-what-it-changed.md) | 유효 |  |
| [ADR-0186 요구사항 문서는 제품 설계 한 장을 따라가지 않는다 — 따라가기는 목표에서 설계로 한 방향이다](../design-docs/adr/0186-requirements-do-not-follow-the-design-page.md) | 유효 |  |
