---
title: 골든 안전망 — 모델을 옮기기 전에 못 박아 둔 것, 읽는 법, 바꿀 때의 절차
kind: spec
status: active
covers:
  - tests/spec/test-support/golden-matrix.ts
  - tests/spec/test-support/golden-impact.ts
  - tests/spec/test-support/golden-facade.ts
  - tests/spec/test-support/golden-scenario.ts
---
# 골든 안전망

[제품 설계 한 장](product-design.md) 5절의 2번(전파 엔진 하나 [ADR-0168](adr/0168-experiment-copy-behaves-like-the-operation-world.md), 포트를 핵심 모델로 [ADR-0169](adr/0169-one-model-for-invented-and-real-worlds.md))은 시뮬레이터의 심장을 만져요. 두 변경의 규칙은 같아요: **오늘 있는 세계의 파사드 출력과 점수 분해는 바이트까지 같다.** 이 문서는 그 규칙을 지키는 시험이 무엇을 못 박았는지, 무엇을 못 박지 못했는지 적어요.

## 이미 있던 것 (겹치지 않게)

| 시험 | 못 박은 것 | 못 박지 않은 것 |
|---|---|---|
| `tests/spec/physics-golden.test.ts` + `physics-golden.json` (REQ-005) | 세계 열세 개의 물리 상태 해시: 데운 뒤, 고장 종류마다 넣는 중·뺀 뒤, 명령 뒤 | 영향 범위, 파사드 글, 점수 |
| `reference-solutions.test.ts` (REQ-110) | 정답 풀이가 정해진 세계에서 정확히 100점 | 100점이 아닌 짝의 점수, 점수 분해, 풀이 뒤 세계 |
| `reference-determinism.test.ts`, `reproducibility.test.ts`, `physics-determinism.test.ts` | 같은 입력으로 두세 번 돌리면 같다 (서로 견줌) | 옛 값과의 같음 (코드가 바뀌면 둘 다 같이 바뀌어도 통과) |
| `impact.test.ts`, `network-os-outputs.test.ts`, `facades.test.ts` | 작은 표본 세계 하나의 숫자와 글 줄 몇 개 | 층이 다 있는 세계, 출력 전체 |
| `kernel.test.ts`, `physics-profile.test.ts` | 해시 함수 한 값, 기본 물리의 지문 `v1` | |

`toMatchSnapshot` 계열은 저장소에 없어요. 옛 값에 대한 못 박기는 `physics-golden` 하나뿐이었어요.

## 무엇을 못 박았나

지문은 글자 수와 안정 해시(`hashHex`, 64비트)예요. `길이:해시` 꼴이고, 영향 범위는 앞에 `영향 장비/랙/서버` 수를 붙여 읽기 쉽게 했어요. 기대값은 시험 파일의 문자열 값이고 실행 때 다시 만들지 않아요.

| 종류 | 시험 파일 | 무엇을 | 개수 |
|---|---|---|---|
| 영향 범위 (REQ-078) | `tests/spec/golden-impact-{iap,campus,sdn,train,fabric}.test.ts` | 세계마다, 지원하는 고장 종류를 첫 대상과 마지막 대상(링크 고장은 스위치끼리 업링크도)에 넣고 물리를 120초 돌린 뒤 `impactOf`의 영향 장비·방·랙·서버 수·심각도·서비스 영향·고장/알람 출처 | 447 |
| 파사드 (REQ-062, REQ-065) | `tests/spec/golden-facade.test.ts` | 스위치마다 인터페이스·이웃(CLI), BGP·ECMP·EVPN·경로·설정 글(CLI), SNMP 인터페이스 걷기. 업링크 하나를 끊은 뒤 그 양 끝 스위치도 | 120 |
| 정답 풀이 (REQ-110) | `tests/spec/golden-scenario-{iap,campus,sdn,train,fabric,extra}.test.ts` | 세계가 받을 수 있는 내장 템플릿마다 정답 풀이를 걷고 점수 분해와 풀이 뒤 세계 상태 | 264 (풀이 132회) |

도우미는 `tests/spec/test-support/golden-*.ts`예요. 시험 제목은 모두 `[REQ-001]`(같은 입력이면 같은 결과)을 달고, 영향은 `[REQ-078]`, 파사드는 `[REQ-062] [REQ-065]`, 점수는 `[REQ-110]`을 달아요.

## 표 세계

가장 작은 크기에서 층이 모두 들어가게 골랐고 시드는 고정이에요. 기존 생성기와 시험용 세계만 써요.

| 이름 | 만드는 법 | 맡은 것 |
|---|---|---|
| `iap` | `generateShaped(DEFAULT_SHAPE, servers 12)`, 시드 1 (서버 수는 하한 때문에 68대로 지어짐) | leaf-spine, A+B 전원, N+1 냉방, 가상화 클러스터, 공유 스토리지, 데이터베이스, 쿠버네티스 |
| `campus` | `campusBlueprint()` | 플랜트, 발전기, 사이트·DR, SDN, 앱·메시, 쿠버네티스, 스토리지 풀 (스위치 1대) |
| `sdn` | `sdnLab({ cloudNative: true })` | 오버레이, VTEP, 스위치 OS 셋 중 둘 |
| `train` | `accelLab("gpu-training-cluster", { network: "net-leaf-spine" })`, 시드 7 | GPU, IB 패브릭, leaf-spine, 전력 한도 |
| `fabric` | `gpuLab()` | 클라우드 패브릭: 케이블마다 eBGP, leaf-spine 사이 ECMP (`maximum-paths`) |

같은 템플릿을 받을 수 있는 세계가 여럿이면 세계마다 걸어요. 어느 세계도 못 받는 템플릿 여덟(`sidecar-crash`, `split-brain`, `gpu-memory-leak`, `mig-misconfig`, `utility-feed-loss`, `cdu-pump-fail`, `site-power-loss`, `dr-failover-stuck`)은 정답 풀이 시험이 쓰는 세계(`operatorCases`)에서 한 번씩 걸어요(`extra`). 그래서 내장 템플릿 <!-- fact:scenario_templates -->69<!-- /fact -->개가 모두 한 번 이상 들어 있어요.

## 정답 풀이가 100점이 아니던 짝 (ADR-0172)

처음 못 박을 때는 제공되는 짝 가운데 21개가 정답 풀이로 100점이 아니거나 오류를 냈고, 그 값 그대로를 못 박았어요. [ADR-0172](adr/0172-offered-scenario-means-reference-solution-reaches-full-score.md)가 그것을 불변식으로 바꿨어요: **제공되는 짝은 정답 풀이가 오류 없이 100점이다.** 시험은 `tests/spec/offered-means-solvable.test.ts`이고 이 문서의 골든 행렬을 그대로 써요. 그래서 이 문서의 골든 점수에서 100이 아닌 값은 없어요.

값이 바뀐 기대 값은 키 52개예요. 나머지 키는 글자까지 그대로예요.

| 짝 | 전 | 후 | 왜 바뀌었나 |
|---|---|---|---|
| `wrong-vlan-port`, `port-shut-by-mistake` (`iap`, `train`) | 65 | 100 | 풀이기가 포트 설명에서 서버를 아이디로만 찾았어요. 이름으로도 찾아요 |
| `firmware-failure` (`iap`, `train`) | 90 | 100 | 풀이가 실패한 서버만이 아니라 서버 넷을 모두 두 번 올려 제한 시간을 넘겼어요. 첫 바퀴 뒤 알람이 가리키는 서버만 다시 올려요 |
| `firmware-failure` (`campus`, `sdn`, `fabric`) | 100 | 100 | 같은 길 변경 때문에 점수 설명의 시간과 세계 지문이 바뀌었어요 (점수는 그대로) |
| `firmware-one` (`train`) | 60 | 100 | 비어 있는 서버 다섯을 모두 올렸어요. 시트가 처음 가리키는 한 대만 올려요 |
| `k8s-pending` (`iap`) | 오류 | 100 | 줄일 워크로드 이름을 `report`로 못 박았어요. 서비스가 기대지 않는 워크로드를 찾아요 |
| `domain-memory-vendor` (`sdn`) | 오류 | 100 | 대기 쪽이 없는 서비스에서 VM을 옮길 서버가 없었어요. 다른 서버로 옮겨요 |
| `db-primary-down` (`campus`) | 오류 | 100 | 클러스터가 스스로 넘기는 세계의 길이 없었어요. 읽고, 원인을 말하고, 기다려요 |
| `db-replication-broken`, `db-shared-path-cut`, `session-store-down`, `mesh-control-stuck`, `k8s-worker-down`, `k8s-etcd-quorum`, `replication-broken` (`campus`) | 30 | 100 | `srv-t1`의 서비스 프로세스 열 개가 메모리 100%를 채워, 서버를 건드리면 월간 리포트가 느려지고 포털이 정상이 되지 못했어요. 프로세스당 몫을 나눠 메모리가 85%를 넘지 않게 했어요. |
| `k8s-pending`, `k8s-disk-pressure`, `site-power-loss`, `dr-failover-stuck` (`campus`) | 오류 또는 30 | 제공 안 함 | 이 세계로는 정답 풀이도 복구하지 못해요(배치 작업 없음, 파드가 들어갈 자리 없음, 복구 사이트에 서버 없음). `unavailable()`이 이유를 말해요. 뒤의 둘은 정답 풀이 시험의 사이트 세계에서 한 번씩 못 박아요(`extra`, 새 키 넷) |

같은 불변식을 골든 행렬 밖의 모양(기본 세계, 사다리 칩 하나씩, 세계 생성기와 캠퍼스 생성기의 사업장 프리셋)에도 건 [ADR-0178](adr/0178-offered-scenario-solved-on-every-world-shape.md)이 풀이를 더 고치면서 골든 기대 값 세 개를 더 바꿨어요: `domain-port-network@campus`의 점수와 세계, `power-cap-cooling-short@train`의 세계. 점수는 100 그대로이고 풀이가 그 세계에서 한 일(대기 쪽으로 넘김, 더 낮은 전력 캡)이 달라 세계 지문만 바뀌었어요. 그 밖의 키는 글자까지 그대로예요.

## 시간과 결정성

로컬에서 새 시험 열두 파일이 합쳐 20초쯤이에요(가장 느린 `golden-scenario-campus`가 8초). 파일이 따로라서 CI는 조각 열두 개에 나뉘어 돌아가요. 같은 값이 두 프로세스에서 나와야 해서 기대값을 만들 때 두 번씩 돌려 견주었고, 달라지는 것은 없었어요. 시계와 난수는 `Clock`과 `Rng`만 써요.

## 못 박지 못한 것

| 빈틈 | 왜 |
|---|---|
| 영향 범위의 "죽음(down)" 집합 | `impactOf`가 돌려주지 않아요 (`spread`는 안 내보냄). 대신 "죽음"이 만드는 것(영향 장비, 랙, 서버, 심각도)은 모두 들어 있어요. 내보내려면 제품 코드를 건드려야 해서 하지 않았어요 |
| Redfish·vCenter·vROps·BACnet 파사드 | 링크가 아니라 상태에서 거의 다 나오고 적합성 시험이 있어요. 링크에서 오는 `Power` 급전 쪽은 못 박지 못했어요 |
| 툴 출력(`list_alarms`, 토폴로지 접기, 리플레이) | 값이 많고 시간에 얽혀 싸게 못 박기 어려워요. 정답 풀이 점수가 툴을 통과한 결과라서 간접으로 걸려요 |
| 블루프린트 자체 | 일부러 안 걸었어요. ADR-0169 4번이 링크 표현을 바꾸니 처음부터 바뀔 것이라, 걸면 바뀌어야 할 것이 막혀요 |
| 시드를 바꾼 실행, 고장 둘 이상의 조합 | 영향은 고장 하나씩, 점수는 시드 1만. 템플릿이 넣는 조합은 정답 풀이로 걸려요 |
| 큰 세계, 다방·다건물, 액냉·DR 사이트·지오 스토리지 | 가장 작은 크기만 골랐어요. DR은 `campus`와 `extra`에만 있어요 |

## 실패를 읽는 법

실패는 하나를 뜻해요. **오늘 있는 세계의 동작이 바뀌었어요.** 시험이 틀린 것이 아니에요. 키가 어디인지 보세요.
- `golden-impact-…` 키 `고장종류@대상`: 그 고장의 영향 범위가 달라졌어요. `golden-impact.ts`의 `rangeOf(world)`로 구조를 그대로 찍어 옛 값과 견주세요(앞의 수 셋이 같아도 해시가 달라질 수 있어요).
- `golden-facade…` 키 `스위치/interfaces|routing|snmp`: 그 스위치의 그 보기가 달라졌어요. `golden-facade.ts`의 `transcript`로 명령 글을 찍어 옛 코드에서 찍은 글과 견주세요.
- `golden-scenario-…` 키 `템플릿@세계:score|world`: 점수 분해 또는 풀이 뒤 세계 상태가 달라졌어요. `score`가 같고 `world`만 다르면 점수는 지켰지만 세계가 움직이는 방식이 바뀐 거예요.
- 영향·파사드·점수가 한꺼번에 많이 빨개지면 세계 생성기나 물리가 바뀌었는지부터 봐요 (`physics-golden`도 함께 빨개요).

## 바꾸려는 것이 맞을 때

1. 바뀐 값이 의도한 것인지 위 방법으로 확인하고, **왜 바뀌었는지**를 ADR에 적어요 ([작성 절차](adr-process.md)). 점수가 바뀐다면 ADR-0138의 첫째 기둥(채점이 늘 맞고 같다)에 비추어 정당화해야 해요.
2. ADR에 `amends_tests`와 `test_change_reason`을 적고 봉인해요 ([ADR-0004](adr/0004-test-lock.md)).
3. 기대값을 바꾼 뒤 `pnpm tsx harness/src/checks/testguard.ts lock --amend <ADR 파일>`로 잠금을 고쳐요. 바뀐 키만 고치고 다른 키는 그대로 두어요.
4. 기대값을 도구로 다시 뽑을 때는 도우미(`impactFingerprints`, `facadeFingerprints`, `recordCases`)를 임시 시험에서 찍어요. 시험 쪽에는 "다시 쓰기" 모드를 두지 않아요.
