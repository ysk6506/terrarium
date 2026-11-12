---
title: ADR-0114 컨테이너 층을 코어 모델로 올리면서 시험의 기대값을 고친다
kind: decision
status: active
enforced_by:
  - tests/spec/k8s-physics.test.ts
  - tests/spec/k8s-scenarios.test.ts
  - tests/spec/k8s-worldgen.test.ts
  - packages/core/src/topology/k8s-layer.test.ts
  - apps/web/src/logic/world-shape/k8s-cards.test.ts
  - tests/spec/controllability.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - docs/design-docs/adr/0107-world-entry-two-doors-ha-ladders.md
amends_tests:
  - apps/web/src/logic/recovery-cluster.test.ts::클러스터가 알아서 한 복구는 결과 화면에서 따로 말한다 [REQ-095] [REQ-088] > 에이전트가 한 복구가 아니고 클러스터가 승격한 것이라고 적는다
  - "apps/web/src/logic/world-shape/world-shape.test.ts::HA 사다리: 선택지와 카드 [REQ-094] > 점선은 ADR-0107 결정 5의 목록 그대로다"
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
  - packages/core/src/scenario/scenario.test.ts::scenario palette [REQ-034] > in the sample hall every supported fault can be used, each as its own block
  - packages/core/src/world/test-support/sample-campus.ts::=CAMPUS_ENTITY_IDS
  - packages/core/src/world/test-support/sample-campus.ts::=campusBlueprint
  - packages/core/src/world/world-edges.test.ts::lookups and labels at the edges [REQ-001] > only the four virtual kinds are virtual
  - tests/spec/controllability.test.ts::<import:89c5634a>
  - tests/spec/controllability.test.ts::<stmt:052bd52a>
  - tests/spec/controllability.test.ts::the kinds a row says it acts on are the kinds the world accepts [REQ-069] > %s
  - tests/spec/controllability.test.ts::the list of what can be controlled is made of real things [REQ-069] > every world command is either on the list or named as no operator's
  - tests/spec/physics-golden.test.ts::=worlds
  - tests/spec/service-tools.test.ts::every tool is described in the standard order and tagged with how real it is [REQ-080] [REQ-086] > a summary, when to use and not, an example, access and cost; realism on all of them
test_change_reason: 컨테이너 층을 코어 모델로 올려 개체 종류가 셋, 고장 종류가 여덟, 툴이 아홉, 세계 명령이 다섯, 행동 종류가 다섯 늘고 ADR-0107 결정 5의 점선이던 컴퓨트 칩 셋이 실선이 된다. 시험들은 같은 성질(모든 툴이 같은 모양, 모든 명령이 목록에 있거나 운영자의 것이 아니다, 가상 종류의 목록, 점선의 목록, 팔레트의 쓸 수 없는 고장, 모든 고장 종류의 물리 기록)을 새 값으로 읽고, 캠퍼스 샘플은 "모든 종류를 쓴다"는 성질을 지키려고 쿠버네티스 개체를 얻는다.
decision_hash: 768ba826f96c349b
---
# ADR-0114 컨테이너 층을 코어 모델로 올리면서 시험의 기대값을 고친다

## 맥락
[ADR-0107](0107-world-entry-two-doors-ha-ladders.md) 결정 5가 점선으로 둔 컴퓨트 칩 셋(자동 재배치 DRS, 컨테이너 오케스트레이션, 멀티클러스터)을 실선으로 바꿨다(REQ-096). 기본 서비스 카드 IAP가 "VM 위에 직접 만든 쿠버네티스" 모양이라서 컨테이너 오케스트레이션이 핵심이고, IAP 기본 카드가 이 칩으로 지어져야 한다. 동작과 규칙은 [컨테이너 층](../container-layer.md)에 있다. 구현이 잠긴 시험 몇 곳을 건드렸고, 구현하면서 정한 것이 몇 있어 함께 남긴다.

## 결정
1. **개체 종류 셋과 링크 규칙을 더한다.** `k8s_cluster`, `k8s_node`, `k8s_workload`는 자기 자리가 없는 가상 종류다. 파드는 개체가 아니라 워크로드 상태 안의 목록이다(스케일과 재스케줄로 늘고 줄어서). `workload`라는 이름은 서비스의 일감 설정(`world/workload.ts`)이 이미 쓰고 있어서 `k8s_workload`로 했다. 서비스가 기대는 `depends_on`의 대상과 노드가 올라간 곳 `hosted_on`, 노드·워크로드가 클러스터에 속하는 `member_of`의 종류를 넓혔다.
2. **서비스 건강은 도는 파드의 비율로 읽는다.** 쿠버네티스 위에서 도는 서비스(자기 자리가 모두 노드 밑의 머신인 서비스)는 VM이 아니라 파드로 읽는다: 전부 돌면 정상, 일부면 느려짐, 하나도 없으면 멈춤. 컨트롤 플레인이 멈춰도 돌던 파드는 정상이다. VM·서버 위에도 서 있는 서비스는 머신 규칙도 함께 읽는다(그래서 캠퍼스 샘플의 OS 시나리오는 그대로다).
3. **고장 여덟을 더한다.** 워커 NotReady, 컨트롤 플레인 노드 다운, etcd 쿼럼 상실, 파드 CrashLoopBackOff, 자원 부족(Pending), 이미지 풀 실패, kubelet 디스크 압박, CNI 고장. 모두 서비스/OS 도메인(새 도메인을 만들지 않았다), 리드타임 표에 행이 있고(원격), 운영 모드 MTBF 표에 행이 있다. 노드 밑의 VM·호스트가 멈추면 노드는 새 고장 없이 그것을 읽어 NotReady가 된다.
4. **툴 아홉을 더한다.** `kubectl_get`, `kubectl_describe`, `kubectl_logs`, `kubectl_rollout_restart`, `kubectl_scale`, `kubectl_cordon`, `kubectl_uncordon`, `kubectl_drain`, `kubectl_delete_pod`. 툴이 40개에서 49개가 된다. 바꾸는 여섯은 제어 가능 요소표의 행 다섯(`k8s.rollout_restart`, `k8s.scale`, `k8s.cordon`, `k8s.drain`, `k8s.delete_pod`)과 `host.kubelet`을 가지고, 월드 명령 다섯이 더해진다. 가짜 셸 `run_command`는 노드인 호스트에서 `kubectl get|describe`와 `crictl ps`를 흉내 낸다.
5. **클러스터가 알아서 하는 일은 원인 `cluster`다.** 죽은 노드의 파드를 5분 뒤 옮기는 일, 디스크 압박으로 쫓아내는 일, 멀티클러스터가 트래픽을 돌리는 일, DRS의 VM 옮기기는 세계의 사건에 원인 `cluster`로 남는다([ADR-0111](0111-db-storage-layers-amend-tests.md) 결정 4의 규칙을 그대로 쓴다). 복구 우선 채점은 이것을 에이전트가 한 복구와 가른다.
6. **디스크 압박은 사람이 uncordon 해야 풀린다.** 진짜 쿠버네티스는 압박이 풀리면 테인트가 알아서 빠지지만, 두 단계("디스크를 비우고 uncordon")를 시나리오로 잴 수 있게 했다. 한계로 문서에 적었다.
7. **사다리 칩 셋이 실선이 된다.** `ChipBuild`에 `drs`와 `k8s`(클러스터 수)가 생기고, 세계 생성이 서비스마다 클러스터를 깐다. 컨트롤 플레인 셋은 다른 호스트·다른 랙에 서고, 멀티클러스터는 호스트를 나눠 클러스터마다 쓴다. IAP 기본 카드의 컴퓨트 기본은 컨테이너 오케스트레이션(`IAP_LAYERS`)이다. 점선은 14개에서 11개가 된다.
8. **시나리오 다섯과 점검.** 워커 노드가 멈췄어요, 파드가 CrashLoopBackOff예요, etcd 쿼럼을 잃었어요, 자원이 모자라 파드가 Pending이에요, 노드 디스크가 가득 차 파드가 쫓겨났어요. 복구 우선 채점이고 변별력 점검(아무것도 안 함 0점, 정답만 앎 60점 미만, 복구 먼저 > 원인 먼저 > 아무것도 안 함)을 통과한다. "서비스를 옮겨서 복구하는 길" 점검은 쿠버네티스 위 서비스에는 대기도 VM도 없어서 건너뛰고 컨테이너의 길을 새 세션마다 따로 해 본다.
9. **토폴로지.** 네트워크·가상화 층에 워크로드·파드, 클러스터, 노드 단계 셋이 서비스 뒤에 붙고, 영향 범위가 호스트 → VM → 노드 → 파드 → 워크로드 → 서비스로 번진다. 3D는 손대지 않았다.

## 시험을 고친 이유
- 툴 수, 세계 명령 목록, 개체 종류 목록, 행동 종류 목록, 팔레트의 쓸 수 없는 고장, 점선 목록은 같은 성질(모든 툴이 같은 모양, 모든 명령이 목록에 있다, 가상 종류의 목록, 점선의 목록)을 새 값으로 읽는다.
- 제어 가능 요소표 시험은 새 명령 다섯의 "받아들이는 종류" 시험과 새 길의 드라이브(스물아홉 + 일곱)를 더했다.
- 캠퍼스 샘플은 "모든 종류를 쓴다"는 성질을 지키려고 쿠버네티스 개체(클러스터·노드 넷·워크로드)를 얻는다.
- 결과 화면과 채점표가 클러스터가 한 복구를 "스스로 승격해서"라고 적던 문장은 "스스로 복구해서"로 바꾼다(쿠버네티스가 옮기는 것은 승격이 아니다). 결과 화면 시험이 그 문장을 같은 성질(에이전트가 한 복구가 아니라고 적는다)로 읽는다.
- 물리 골든 시험은 컨테이너 클러스터 세계를 하나 더 기록한다(쿠버네티스 고장은 기존 세계에 놓을 곳이 없다). 기존 세계의 해시는 바뀌지 않는다.

## 결과
- 요구사항: REQ-096(컨테이너 층). 클로즈 베타 차수 계획은 `beta-rounds.md`에서 컨테이너 층을 오픈 뒤 로드맵에서 뺐다(서버리스는 남는다).
- 새 시험 `tests/spec/k8s-physics.test.ts`, `k8s-scenarios.test.ts`, `k8s-worldgen.test.ts`, `packages/core/src/topology/k8s-layer.test.ts`, `apps/web/src/logic/world-shape/k8s-cards.test.ts`가 이 결정을 강제한다.
