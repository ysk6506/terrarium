---
title: 컨테이너 층 — 쿠버네티스 클러스터, 노드, 파드, 그리고 클러스터가 알아서 하는 일
kind: spec
status: active
covers:
  - packages/core/src/world/k8s.ts
  - packages/core/src/world/k8s-sched.ts
  - packages/core/src/world/k8s-health.ts
  - packages/core/src/world/k8s-act.ts
  - packages/core/src/world/state-k8s.ts
  - packages/core/src/world/faults-k8s.ts
  - packages/core/src/physics/k8s.ts
  - packages/core/src/physics/drs.ts
  - packages/core/src/physics/k8s-alarms.ts
  - packages/core/src/tools/catalog-k8s.ts
  - packages/core/src/tools/handlers-k8s.ts
  - packages/core/src/tools/shell-k8s.ts
  - packages/core/src/tools/shell-layers.ts
  - packages/core/src/scenario/library-k8s.ts
  - packages/core/src/sources/worldgen/shaped-k8s.ts
  - packages/core/src/topology/impact-k8s.ts
  - packages/core/src/world/ladder.ts
---
# 컨테이너 층 (REQ-096, [ADR-0107](adr/0107-world-entry-two-doors-ha-ladders.md) 결정 6, [ADR-0114](adr/0114-container-layer-amend-tests.md))

## 한 문장으로

**서비스가 기대는 쿠버네티스 클러스터(컨트롤 플레인과 워커 노드, 워크로드와 그 파드)를 코어 모델로 올렸다. 서비스 건강은 파드가 몇 개 돌고 있는지를 그대로 읽고, 클러스터는 죽은 노드의 파드를 옮기고 죽는 파드를 기다렸다 다시 띄우며, 그 복구는 에이전트가 한 복구와 따로 센다.**

비유하면 식당 홀이다. 서비스는 손님이 받는 음식, 워크로드는 "이 요리는 늘 세 접시"라는 주문서, 파드는 접시 하나, 노드는 조리대, 컨트롤 플레인은 주문서를 보고 접시를 조리대에 나눠 주는 매니저다. 조리대 하나가 불이 나도 매니저는 5분쯤 기다렸다가(혹시 돌아올까 봐) 접시를 다른 조리대에 다시 올린다. 매니저가 자리를 비우면 새 주문과 자리 옮기기만 멈추고, 이미 올라간 접시는 계속 나간다.

기본 서비스 카드 IAP는 "VM 위에 직접 만든 쿠버네티스" 모양이라서 IAP 기본 카드의 컴퓨트 칸이 이 층이다.

## 한계부터 (정직하게)

- **진짜 쿠버네티스가 아니다.** 컨테이너도 이미지도 없다. 파드는 이름·노드·상태·재시작 횟수 몇 가지이고, 로그와 `describe`는 그 상태로 진짜 모양의 글을 만든다. 스케줄러는 "남은 자리가 가장 많은 노드"만 보는 하나의 규칙이다(어피니티·테인트·우선순위 없음).
- **파드는 블루프린트 개체가 아니다.** 스케일과 재스케줄로 늘고 줄어서, 워크로드의 상태 안의 목록으로 둔다. 개체는 클러스터·노드·워크로드(`k8s_cluster`, `k8s_node`, `k8s_workload`) 셋이다. `workload`라는 이름은 서비스의 일감 설정이 이미 쓰고 있어서 `k8s_workload`로 했다.
- **롤링 업데이트는 하나씩 겹쳐 띄우는 것뿐이다.** 새 파드를 먼저 띄우고 뜨면 옛 파드를 지운다. 최대 불가·서지 설정은 없다.
- **디스크 압박은 사람이 uncordon 해야 풀린다.** 진짜는 압박이 풀리면 테인트가 알아서 빠지지만, 여기서는 압박으로 쫓아낸 노드를 스케줄이 막힌 채로 두어 "디스크를 비우고 uncordon"이라는 두 단계를 시나리오로 잴 수 있게 했다.
- **CNI·이미지 풀은 상태 하나다.** 네트워크 플러그인은 노드마다 켜짐·꺼짐, 이미지 풀 실패는 클러스터마다 켜짐·꺼짐이다. 어떤 파드끼리 통신이 끊기는지는 가르지 않고, 그 노드의 파드가 모두 제 몫을 못 한다고 센다.
- **워크로드끼리의 호출 건강은 컨테이너 층이 읽지 않는다.** 서비스 사이의 호출 관계(`calls`)는 [애플리케이션 층](application-layer.md)이 준다. 워크로드끼리 잇는 `calls`는 그림과 영향 범위만 넓힌다.

## 개체와 상태

설정은 속성(`props`)에, 연결은 링크에, 지금의 모습은 상태에 있다. 노드는 `hosted_on`으로 VM(또는 베어메탈 서버)에 올라가고, 노드와 워크로드는 `member_of`로 클러스터에 속하고, 서비스는 `depends_on`으로 워크로드에 기댄다.

| 개체 | 설정(속성) | 상태 | 링크 |
|---|---|---|---|
| `k8s_cluster` 클러스터 | 파드 쫓아내기까지 기다리는 시간(`evictionS`, 기본 300초 = `pod-eviction-timeout`) | API가 답하는가(`apiUp`), etcd 멤버 `etcdUp/etcdTotal`, 쿼럼, 컨트롤 플레인 `cpUp/cpTotal`, 클러스터가 옮긴 파드 수(`reschedules`), 트래픽을 다른 클러스터로 돌렸는가(`shifted`) | 노드·워크로드 `member_of` 클러스터 |
| `k8s_node` 노드 | 역할(컨트롤 플레인 / 워커), 할당 가능 CPU(밀리코어)·메모리(MiB) | API가 보는 상태(Ready / NotReady), 밑의 머신이 도는가(`reachable`), cordon 여부(`unschedulable`), 디스크 압박, CNI 고장, 지금 할당 가능량 | `hosted_on` VM 또는 서버, `member_of` 클러스터 |
| `k8s_workload` 워크로드(Deployment) | 레플리카, 파드 하나가 요청하는 CPU·메모리, 이름공간 | 원하는 레플리카(`desired`, `kubectl scale`이 바꿈), 파드 목록, 롤아웃 세대와 대기열 | `member_of` 클러스터. 서비스가 `depends_on` |
| 파드 (워크로드 상태 안) | — | 이름, 노드(없으면 Pending), 상태(Running · ContainerCreating · Pending · CrashLoopBackOff · ImagePullBackOff · Evicted), 재시작 횟수, 만든 때, 다음 시도 때 | — |

VM 위의 노드(IAP)와 베어메탈 위의 노드가 같은 개체다. 노드가 올라간 곳이 멈추면(VM이 꺼지거나 호스트가 죽으면) 노드는 곧 말이 없어진다.

## 서비스 건강이 파드를 읽는 법

규칙은 `world/k8s-health.ts`에 있다. 파드는 **Running이고, 올라간 노드의 머신이 돌고, 그 노드의 네트워크 플러그인이 살아 있을 때** 제 몫을 한다. 서비스가 기대는 워크로드마다 따로 읽는다.

| 지금의 워크로드 | 서비스 |
|---|---|
| 원하는 레플리카가 모두 제 몫을 함 | 정상 |
| 일부만 제 몫을 함 (n/m) | 느려짐. 이유에 상태별 개수를 적는다("CrashLoopBackOff 2개") |
| 하나도 못 함, 또는 레플리카를 0으로 줄임 | 멈춤 |
| 컨트롤 플레인이 멈춤 (API 없음) | **건강에는 영향이 없다.** 돌던 파드는 그대로 나간다. 새 배포·스케줄·재스케줄만 멈춘다 |
| 클러스터가 둘이고 한쪽 워크로드가 통째로 멈춤 | 느려짐만(다른 쪽이 받는다). 둘 다 멈추면 멈춤 |

서비스는 `service_on`으로 노드의 VM도 가리키지만(빌더 카드와 토폴로지에 보이게), 건강은 VM이 아니라 파드로 읽는다. VM이 죽으면 노드가 말이 없어지고 그 노드의 파드가 제 몫을 못 하는 길로 건강에 닿는다.

### 고장 → 서비스 건강

| 고장 | 노드 | 파드 | 서비스 | 클러스터가 알아서 |
|---|---|---|---|---|
| `k8s_node_notready` 워커 NotReady (또는 밑의 VM·호스트 정지) | 40초 뒤 NotReady | 그 노드의 파드가 바로 제 몫을 못 함 | 느려짐 (n-k / n) | 5분 뒤 파드를 다른 노드로 옮김. 자리가 없으면 Pending |
| `k8s_control_plane_down` 컨트롤 플레인 노드 다운 | 그 노드 NotReady | 영향 없음 | 컨트롤 플레인이 하나면 API가 멈춰 새 배포·재스케줄 불가(건강은 그대로). 셋이면 하나를 잃어도 정상 | — |
| `k8s_etcd_quorum_lost` etcd 쿼럼 상실 | — | 영향 없음 | API가 멈춤. 마침 노드가 멈춰 있으면 재스케줄이 안 되어 느려진 채로 남음 | 없음 (API가 없다) |
| `k8s_pod_crashloop` CrashLoopBackOff | — | 모든 파드가 뜨자마자 죽음. 기다림 10초, 20초, 40초 … 최대 5분 | 멈춤 | 기다렸다 다시 시도할 뿐, 원인이 남아 있으면 같다 |
| `k8s_resource_exhausted` 자원 부족 | 할당 가능량이 줄어듦 | 이미 도는 파드는 그대로. 새로 뜨는 파드는 자리가 없으면 Pending | 파드를 다시 만들어야 할 때 느려지거나 멈춤 | 스케줄러가 자리를 찾음 |
| `k8s_image_pull_failure` 이미지 풀 실패 | — | 새로 뜨는 파드가 ImagePullBackOff | 도는 파드는 그대로. 롤아웃이나 재스케줄이 막힘 | 풀리면 다시 시도 |
| `k8s_disk_pressure` kubelet 디스크 압박 | 스케줄 막힘(cordon) | 그 노드의 파드가 모두 Evicted | 짧게 느려졌다 돌아오거나, 자리가 없으면 Pending으로 남아 느려짐 | 쫓겨난 파드의 대체를 다른 노드에 만듦 |
| `k8s_cni_failure` 네트워크 플러그인 고장 | Ready로 보임 | Running으로 보이지만 통신이 끊김 | 느려짐 (눈에 안 띈다) | 없음 |

## 클러스터가 알아서 하는 일

물리가 매 스텝 돌린다(`physics/k8s.ts`). 사람이 한 일이 아니라서 세계의 사건에 원인 **`cluster`**로 남고, 세션은 이것을 에이전트의 조치로 세지 않는다.

| 규칙 | 시간 | 사건으로 남는가 |
|---|---|---|
| 노드가 말이 없으면 NotReady로 표시 (API가 살아 있을 때만) | 40초 | 아니오 |
| NotReady 노드의 파드를 포기하고 다른 노드에 다시 만듦 | 5분(`evictionS`) | 예 ("파드 n개를 다른 노드로 옮기도록 했어요") |
| 새 파드가 이미지를 받아 시작함 | 15초 | 아니오 |
| 죽는 파드를 기다렸다 다시 시도 (CrashLoopBackOff) | 10초부터 두 배씩, 최대 5분 | 아니오 |
| 레플리카가 모자라면 새로 만들고 많으면 지움 | 바로 (API가 있을 때) | 아니오 |
| 자리가 있는 노드에 Pending 파드를 붙임 | 바로 (API가 있을 때) | 아니오 |
| 디스크 압박이 시작되면 그 노드의 파드를 쫓아내고 막음 (kubelet) | 바로 (API 없이도) | 예 |
| 멀티클러스터: 한쪽 워크로드가 통째로 멈추면 다른 쪽이 받음 | 바로 | 예 ("트래픽을 다른 클러스터로 돌렸어요") |
| **DRS**: 호스트 하나가 80% 넘게 바쁘고 가장 한가한 호스트보다 30%p 넘게 바쁘면 그 호스트의 가장 무거운 VM을 옮김 | 한 번에 하나, 옮기는 동안(30초) 그 VM이 느림 | 예 (`vm.migrate`, 원인 `cluster`) |

컨트롤 플레인이 없으면(API 없음) 위 표에서 "API가 있을 때"라고 쓴 일과 노드 NotReady 표시, 5분 뒤 옮기기가 모두 멈춘다.

## 고장 여덟

모두 `FAULT_SPECS`에 있고, 도메인은 모두 **서비스/OS**(가상화 팀이 아니라 서비스를 돌리는 쪽이 고친다고 보았다)이며, `FAULT_TOOLS`·`FAULT_RESPONSES`·리드타임 행·운영 모드 MTBF 행이 하나씩 있다.

| 고장 | 대상 | 푸는 길 | 리드타임(원격) |
|---|---|---|---|
| `k8s_node_notready` | 노드 | 그 노드에서 `systemctl restart kubelet`(`run_command`). 밑의 VM·호스트 고장이면 그것부터 | 15분 / 30분 / 2시간 |
| `k8s_control_plane_down` | 노드 | 같다 (kubelet·API 서버를 다시 시작) | 30분 / 1시간 / 4시간 |
| `k8s_etcd_quorum_lost` | 클러스터 | 에이전트의 길이 없다. 컨트롤 플레인을 아는 팀에 넘긴다 | 1시간 / 3시간 / 1일 |
| `k8s_pod_crashloop` | 워크로드 | 로그에서 원인을 읽고 `kubectl_rollout_restart`. 파드 하나 지우기·drain은 소용없다 | 15분 / 30분 / 2시간 |
| `k8s_resource_exhausted` | 클러스터 | 덜 중요한 워크로드를 `kubectl_scale`로 줄이거나 노드 추가를 요청(넘기기) | 1시간 / 4시간 / 1일 |
| `k8s_image_pull_failure` | 클러스터 | 에이전트의 길이 없다. 레지스트리·네트워크 쪽에 넘긴다 | 30분 / 1시간 / 4시간 |
| `k8s_disk_pressure` | 노드 | 그 노드에서 디스크를 비우고(`rm /var/log/…`) `kubectl_uncordon` | 15분 / 30분 / 2시간 |
| `k8s_cni_failure` | 노드 | 그 노드에서 `systemctl restart containerd`, 또는 `kubectl_drain`으로 파드를 옮긴다 | 30분 / 1시간 / 4시간 |

노드 밑의 머신이 멈추는 것(전원 장치 고장, 커널 패닉, VM 꺼짐)은 새 고장이 아니라 기존 고장이고, 노드는 그것을 그대로 읽어 NotReady가 된다.

## 툴 아홉

모두 다섯 칸(요약·언제 쓰나·언제 안 쓰나·예·비용)을 채웠고 `realism: common`이며 서비스/OS 도메인이다. 컨트롤 플레인이 멈추면 모두 "연결이 거부됐어요"로 실패한다(`kubectl_get`도 같다).

| 툴 | 하는 일 | 바꾸는가 | 어느 칸 |
|---|---|---|---|
| `kubectl_get(kind, namespace?, cluster?)` | 노드·파드·디플로이먼트 목록을 `kubectl get`의 모양으로. API가 보는 대로 말한다 | 보기만 | 관측 |
| `kubectl_describe(kind, name)` | 노드의 조건·테인트·자원, 파드의 상태와 이벤트(Pending 사유 포함) | 보기만 | 관측 |
| `kubectl_logs(pod, tail?)` | 파드의 마지막 로그. 아직 시작 못 한 파드는 로그가 없다 | 보기만 | 관측 |
| `kubectl_rollout_restart(workload)` | 파드를 하나씩 새것으로 바꾼다(고친 설정을 읽는다) | 바꿈 | 조치 |
| `kubectl_scale(workload, replicas)` | 레플리카 수를 바꾼다 | 바꿈 | 조치 |
| `kubectl_cordon(node)` / `kubectl_uncordon(node)` | 새 파드를 막거나 다시 받게 한다 | 바꿈 | 조치 |
| `kubectl_drain(node)` | cordon 하고 파드를 모두 내보낸다 | 바꿈 | 조치 |
| `kubectl_delete_pod(pod)` | 파드 하나를 지운다. 워크로드가 새로 만든다 | 바꿈 | 조치 |

툴이 아홉 개 늘어난다(SDN 층의 아홉과 합쳐 40개에서 58개). 바꾸는 여섯은 제어 가능 요소표의 행 다섯(`k8s.rollout_restart`, `k8s.scale`, `k8s.cordon`(cordon과 uncordon), `k8s.drain`, `k8s.delete_pod`)과 `host.kubelet`(노드 호스트의 kubelet·containerd 다시 시작)을 가진다.

가짜 셸 `run_command`는 노드인 호스트에서 `kubectl get nodes|pods|deployments [-n <ns>]`, `kubectl describe node <이름>`, `crictl ps`를 흉내 낸다(상태에서 생성). 깊은 OS 흉내의 셸([서비스와 OS 층](service-os-layer.md))에 `tools/shell-layers.ts`가 `registerShellCommand`로 두 명령을 달기 때문에 파이프·`grep`·`awk`와 함께 쓸 수 있다. 노드가 아닌 호스트에서는 `command not found`(127)다. `systemctl restart kubelet`과 `containerd`가 되고, 노드의 kubelet이 멈춘 동안 `systemctl status kubelet`은 failed를 보인다.

## 채점: 클러스터가 한 복구와 에이전트가 한 복구

[데이터베이스 층](db-storage-layers.md#채점-클러스터가-한-복구와-에이전트가-한-복구)과 같은 규칙이다. 서비스가 정상이 된 때가 에이전트의 마지막 조치보다 늦은 원인 `cluster`의 사건 뒤이면 클러스터가 한 복구(`byCluster`)로 읽고 시간·순서 축에 점수를 주지 않는다. 노드가 멈춘 지 5분 뒤 파드가 옮겨져 돌아오는 것이 그 예다. 에이전트가 kubelet을 바로 되살려 5분 안에 돌려놓으면 에이전트의 복구다.

## 사다리와 세계 생성

`world/ladder.ts`에서 세 칩이 `modeled: true`가 되었다(점선은 14개에서 11개가 된다, [world-entry](world-entry.md)). 가상화 클러스터(HA)와 자동 재배치(DRS)는 공유 저장소가, 컨테이너 오케스트레이션 위에서만 의미 있는 클라우드 네이티브·서비스 메시는 컴퓨트가, 멀티클러스터는 서버룸이 둘 이상이어야 말이 된다는 전제 규칙(`requires`·`pointlessWith`, REQ-102)이 붙었다.

| 칩 | 짓는 것 | 멈추는 고장 | 느려지는 고장 |
|---|---|---|---|
| 가상화 + 자동 재배치(`cmp-drs`) | 가상화 클러스터 모양, 세계의 `cluster`에 `drs` 표시 | 커널 패닉, BMC 무응답 | PSU 고장, VM CPU 급증, 메모리 누수, CPU 폭주, 서버 팬 고장 |
| 컨테이너 오케스트레이션(`cmp-containers`) | 서비스마다 클러스터 하나 | 파드 CrashLoopBackOff | 워커 NotReady, 컨트롤 플레인 다운, etcd 쿼럼 상실, 자원 부족, 이미지 풀 실패, 디스크 압박, CNI 고장, PSU 고장 |
| 멀티클러스터·서버리스(`cmp-multicluster`) | 서비스마다 클러스터 둘, 서로 다른 호스트에 | 없음 | 위 여덟 고장 모두(한쪽이 멈춰도 느려질 뿐) |

`shaped.ts`가 서비스마다 클러스터를 깐다(`shaped-k8s.ts`). 서비스의 노드 VM 가운데 앞의 몇 개가 컨트롤 플레인이고(카드의 "컨트롤 플레인 VM" 수, 없으면 노드 6개부터 3개) 나머지가 워커다. VM은 호스트를 돌아가며 얹히므로 컨트롤 플레인 셋은 서로 다른 호스트, 서로 다른 랙에 선다(시험). 서비스 카드의 윗단 부품마다 워크로드 하나가 생기고(`workload` 이름과 `count` 레플리카), 서비스가 기대지 않는 `batch` 워크로드가 하나 더 있어 자리를 차지한다. 파드가 요청하는 양은 워커 할당량의 절반쯤이 차게 잡아, 노드 하나를 잃어도 버티고 더 잃으면 자리가 모자라게 했다. 멀티클러스터는 호스트를 둘로 나눠 클러스터마다 쓴다(호스트 수가 두 배). 같은 구성과 번호면 같은 세계다. 칩 카드의 "생기는 고장"은 칩의 `stops`·`slows`를 고장 이름으로 풀어 쓴 것이라 실제 고장 목록과 같다(시험).

예시 플랫폼 기본 카드(`shaped-defaults.ts`)의 컴퓨트 기본은 `cmp-containers`이고 "컨트롤 플레인 VM 3 · 워커 VM 6"이 실제로 그렇게 지어진다(시험). "알아서"도 카드에 컨트롤 플레인 VM이 있는 서비스는 컨테이너 칩을 고른다.

## 시나리오 다섯

`scenario/library-k8s.ts`, 모두 복구 우선 채점이다. 같은 조치를 일찍 하면 만점에 가깝고, 오래 살핀 뒤에 하면 낮고, 아무것도 안 하면 0점이다. 쿠버네티스 위에서 도는 서비스가 있는 세계에서만 만들어진다.

| 시나리오 | 고장 | 정답 | 틀린 조치(감점) |
|---|---|---|---|
| 워커 노드가 멈췄어요 | `k8s_node_notready` | kubelet을 다시 시작하거나, 5분 지켜보며 옮겨지는 걸 확인하고 호스트 원인을 보고 | — |
| 파드가 CrashLoopBackOff예요 | `k8s_pod_crashloop` | 로그를 읽고 롤아웃 재시작 | drain(−10), 레플리카 바꾸기(−5) |
| etcd 쿼럼을 잃었어요 | `k8s_etcd_quorum_lost` + 노드 NotReady | kubectl이 거부되는 것으로 컨트롤 플레인 문제를 알아채고 넘기기. 노드의 kubelet을 되살려 버틸 수는 있다 | 롤아웃 재시작(−10), drain(−10) |
| 자원이 모자라 파드가 Pending이에요 | `k8s_resource_exhausted` + 노드 NotReady | describe로 사유를 읽고 덜 중요한 워크로드를 줄이거나 노드 추가를 요청(넘기기) | drain(−10) |
| 노드 디스크가 가득 차 파드가 쫓겨났어요 | `k8s_disk_pressure` + 자원 부족 | 디스크를 비우고 uncordon. 쫓겨난 파드는 자리가 없어 Pending으로 남는다 | — |

자원 부족의 크기는 블루프린트의 요청량과 노드 할당량에서 계산한다(같은 세계면 같다). 두 시나리오는 정답이 닿을 때만 제공한다(ADR-0172): "자원이 모자라 파드가 Pending"은 서비스가 기대지 않아 줄여도 되는 배치 작업이 클러스터에 있을 때, "노드 디스크가 가득 차"는 노드를 되살린 뒤 스케줄러가 파드를 모두 앉힐 수 있을 때(노드마다 남는 자리를 파드 크기로 헤아린다) 나온다. 아니면 `unavailable()`이 이유를 말한다. 점검은 고장마다 "아무것도 안 함 = 0점", "정답만 앎 = 60점 미만", 흔한 툴 길로 원인 장비에 닿는지, 그리고 클러스터 고유의 길(롤아웃 재시작, 워크로드 줄이기, kubelet·containerd 다시 시작, 디스크 비우고 uncordon, drain)로 서비스가 돌아오는지를 잰다. 스스로 복구되는 워커 NotReady는 에이전트가 복구 점수를 받을 수 없어 최대 30점이다.

## 토폴로지

네트워크·가상화 층에서 서비스 바로 뒤에 단계 셋이 붙는다: **워크로드·파드**, **쿠버네티스 클러스터**, **쿠버네티스 노드**. 읽는 순서는 서비스 → 워크로드 → 클러스터 → 노드 → VM → 서버다. 영향 범위는 호스트 → VM → 노드 → 파드 → 워크로드 → 서비스로 번진다: 올라간 곳이 멈추면 노드가 멈춘 것이고, 노드가 멈추면 그 노드에 파드가 있는 워크로드가 범위에 들고, 파드가 모두 멈춘 노드에 서 있으면 워크로드가 멈춘 것이다. 파드는 개체가 아니라 워크로드의 선 옆에 "파드 3/4개 돌아요"로 보인다. 3D는 손대지 않았다.

## 하지 않은 것

- 스케줄 어피니티, 테인트와 톨러레이션, 우선순위와 선점, 자원 한도(limits)와 OOM은 없다.
- HPA(자동 스케일)와 서버리스는 없다. 멀티클러스터는 "클러스터 둘이 서로를 받친다"만 흉내 낸다.
- 서비스 메시와 서비스 사이의 호출은 [애플리케이션 층](application-layer.md), 인그레스는 [SDN 층](sdn-network-layer.md)의 일이다. 영구 볼륨은 없다.
- DRS는 CPU 부하만 보고 메모리나 스토리지 부하, 호스트 유지보수 모드는 보지 않는다.
