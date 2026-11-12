---
title: ADR-0120 컨테이너·SDN 층을 깊은 OS 흉내 위에 얹으면서 노드 디스크 압박 시험의 지우는 길을 고친다
kind: decision
status: active
enforced_by:
  - tests/spec/k8s-physics.test.ts
  - tests/spec/k8s-scenarios.test.ts
  - tests/spec/deep-os-shell.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - tests/spec/k8s-physics.test.ts::a node runs short of disk [REQ-096] > its pods are evicted and made again elsewhere; cleaning the disk ends the pressure; uncordon lets it take pods
  - tests/spec/k8s-scenarios.test.ts::=fix
  - "tests/spec/k8s-scenarios.test.ts::what the cluster heals by itself is not the agent's recovery [REQ-096] [REQ-088] > a disk-pressure node: the evicted pods wait until the disk is clean and the node uncordoned"
test_change_reason: 컨테이너 층(REQ-096)의 노드 디스크 압박 시험은 `rm /var/log/messages-old`로 디스크를 비웠다. 깊은 OS 흉내(ADR-0117, ADR-0118 결정 1)에서 `rm`은 없는 경로를 `No such file or directory`로 답하고 지운 파일 크기만큼만 디스크가 비므로 이 명령은 아무것도 지우지 못한다. 시험은 같은 성질(노드의 디스크를 비우면 압박이 풀리고, uncordon 하면 다시 파드를 받는다)을 실제로 있는 파일로 읽는다. 노드 VM에서 `find /var/log -size +1G`로 찾은 큰 묵은 로그를 지운다. 이 큰 로그는 노드의 디스크 압박 고장이 노드 VM에 남긴다.
decision_hash: 5422c4e64b832110
---
# ADR-0120 컨테이너·SDN 층을 깊은 OS 흉내 위에 얹으면서 노드 디스크 압박 시험의 지우는 길을 고친다

## 맥락
컨테이너 층(o1, ADR-0114), SDN 층(o2, ADR-0115)과 깊은 OS 흉내(o3, ADR-0117·0118)를 합쳤다. 깊은 OS 흉내가 예전 허용 목록 셸을 대신하므로 컨테이너 층의 셸 동작(`kubectl`, `crictl`, `systemctl restart kubelet|containerd|calico-node`)은 새 셸에 명령으로 등록하거나 새 `systemctl`이 한다.

## 결정
1. **`kubectl`·`crictl`은 새 셸에 등록한다.** `tools/shell-layers.ts`가 `registerShellCommand`로 두 명령을 달고, 출력은 그대로 `tools/shell-k8s.ts`가 노드가 속한 클러스터의 상태에서 만든다. 노드가 아닌 호스트에서는 `command not found`(127)이고 흉내 밖 명령으로 센다. 지원하지 않는 부명령은 예전과 같은 안내문에 `kubectl <부명령>`을 흉내 밖 명령으로 적는다.
2. **재시작의 뒤처리는 한 곳에 모은다.** `world/reduce-os.ts`의 `host.act` 뒤처리가 `postgresql`, `kubelet`·`containerd`, CNI(`calico-node`), 인그레스 유닛의 재시작을 모두 읽고, 컨테이너 명령(`k8s.*`)과 SDN 명령은 그대로 각자의 리듀서가 처리한다.
3. **노드의 디스크 압박은 노드 VM에 큰 묵은 로그를 남긴다.** 압박 고장의 대상은 노드(`k8s_node`)이지만 디스크는 노드가 서 있는 VM의 것이라, 가상 파일시스템이 그 호스트의 고장 구간에 노드의 `k8s_disk_pressure`를 더해 디스크 꽉 참과 같은 큰 묵은 로그 파일을 보여 준다. 그것을 지우면 디스크가 비고 압박이 풀린다.

## 시험을 고친 이유
- 노드 디스크 압박 시험 둘(물리와 시나리오)과 그 시나리오의 "맞는 조치" 도우미는 같은 성질을 읽는 방법만 바꿨다(위 `test_change_reason`).

## 결과
- 요구사항: REQ-096, REQ-097, REQ-098. 새 시험을 더하지 않고 기존 `tests/spec/k8s-*.test.ts`와 `deep-os-shell.test.ts`의 "다른 층이 명령을 단다"가 이 결정을 강제한다.
