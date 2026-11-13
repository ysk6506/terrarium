---
title: ADR-0200 진짜 셸과 awk를 꺼진 채로 들인다 — 포트는 코어에, 엔진은 서버에, 한도는 세는 것만, 조용한 성공은 없다
kind: decision
status: active
enforced_by:
  - tests/spec/shell-engine.test.ts
  - tests/spec/shell-engine-bundle.test.ts
updates_docs:
  - ARCHITECTURE.md
  - docs/design-docs/service-os-layer.md
  - docs/design-docs/operations.md
touches_protected:
  - harness/config/architecture.yaml
  - harness/config/third-party-assets.yaml
  - .github/workflows/shell-wasm.yml
amends_tests: []
decision_hash: 3e675cb3316f08f2
---
# ADR-0200 진짜 셸과 awk를 꺼진 채로 들인다

ADR-0196 결정 7번의 (1)이다. 엔진을 들이되 기본은 옛 셸이다.

## 맥락
ADR-0196은 셸(mvdan/sh)과 awk(goawk)를 WebAssembly로 바꾸기로 했고, 기본을 바꾸기 전에 엔진을 꺼진 채로 들이는 걸음을 먼저 두었다. 실험(PR #72)은 기본을 바꿨고 조건을 채우지 않았다.

## 결정
1. **포트와 자리.** 코어는 `world/os/shell-engine.ts`의 `ShellEngine`, `ShellHostPort`만 안다. 엔진과 일꾼은 `apps/server/src/shell`(구조 계약의 단위 `server.shell`, `core.*`만 import)이고 세션을 여는 쪽이 `SessionConfig.shellEngine`으로 꽂는다. 엔진이 여는 것은 호스트 포트(세계의 파일·시계·명령)뿐이고 모듈이 들이는 함수는 `call` `take` `job` 셋이다. 코어와 웹은 엔진 이름을 import하지 않는다(시험으로).
2. **기본은 옛 엔진.** 서버 설정 `shell.engine`(`legacy` 기본, `wasm`)이나 시험의 주입으로만 켠다. 엔진이 둘인 것은 이 단계뿐이고, 새 엔진이 못 읽는다고 옛 엔진으로 돌리는 길은 만들지 않는다(못 읽으면 `terrarium:` 줄의 한계). 기본에서 기존 시험·골든·점수 불변 시험과 잠금 시험은 바뀌지 않는다.
3. **세는 한도.** mvdan/sh에는 문장마다, goawk에는 반복 한 바퀴·`for in` 한 번·함수 호출·입력 한 줄마다 부르는 `StepHook`을 패치로 더했다. 한도는 단계 20,000, 출력 1MB, 메모리 128MB(살아 있는 힙을 세고 64단계마다 샘플), 펼치는 목록 50,000, 세계 시간(한 줄이 `sleep`으로 보낼 수 있는 양)이다. 벽시계 10초는 안전망이다. 크기는 기존 시험과 정답 풀이가 쓰는 양보다 크게 잡은 첫 값이며, 잰 값으로 고치는 일은 기본을 바꾸는 걸음의 몫이다.
4. **조용한 성공의 원인과 고친 것.** (가) 큰 중괄호 확장: mvdan/sh가 16,384개를 넘으면 오류 줄만 쓰고 끝낸 줄의 종료 코드는 0이었다 → 확장 오류를 한도로 센다(패치 `ExpandErrHook`). (나) 출력 홍수와 `cat /dev/zero`: 가상 파일시스템의 `/dev/zero`가 빈 파일이라 명령이 빈 출력으로 0으로 끝났다 → 끝없는 원천을 명령이 읽으면 출력 한도. (다) 포크 폭탄은 단계 한도로 잡힌다(실험에서는 0으로 끝났다(이 모듈에서는 단계 한도에 걸린다; 실험 때의 정확한 원인은 재현하지 못했다)). (라) 거절된 쓰기: 쓰기를 받는 쪽이 진짜 셸의 문구와 종료 코드 1을 낸다. 한도에 걸린 줄은 종료 124와 `terrarium:` 줄이고, 그 호출은 실험장 한계로 기록된다(`shell:limit:<종류>`).
5. **의미.** `sleep`은 세계 시간(사건 하나에서는 세계를 `wait` 한 번의 한도와 남은 시간 중 작은 만큼 보낸다; 운영에서는 바로 돌아오고 한계로 알림), `date`와 파일 시각은 세계 시계, `timeout`은 모듈 시계(세계 시간), 호출은 새 로그인 셸, `export`와 `FOO=1 cmd`는 흉내 낸 명령(`Cmd.env`)과 `env` `printenv`에 넘어가고, `&`는 시작 차례대로 돌며, `$RANDOM`은 (실행의 seed, 호스트, 호출 번호)로 정해지고, 글롭은 목록을 줄 안에서 한 번만 묻는다.
6. **awk.** goawk에 패치: 무한대를 `+inf`/`-inf`(gawk 5.2.1에서 잰 값)로 쓴다. `substr`의 위치와 `**`는 v1.32.0이 이미 gawk와 같았다. gawk에만 있는 함수·변수는 한계로 알린다.
7. **묶음.** `.wasm`을 저장소에 둔다. `toolchain.lock.json`이 Go 버전·모듈 커밋·패치와 입력 해시·출력 해시를 고정하고, `shell-wasm` 작업이 소스가 바뀔 때 Go를 소스에서 빌드해 같은 파일인지 본다. 같은 소스에서 두 번 빌드해 해시가 같음을 확인했다. 고지 파일과 라이선스 검사가 mvdan/sh, goawk, Go 표준 라이브러리, golang.org/x/sys, x/term을 안다.

## 이유
- 세는 한도만이 같은 줄을 어디서나 같은 곳에서 멈추게 한다. 느린 호스트를 흉내 낸 시험(명령을 일부러 늦춤)에서 끝없는 이어쓰기 줄이 같은 파일을 남긴다.
- 조용한 성공은 에이전트가 맞게 한 줄과 구분이 안 되어 채점을 깬다. 0이 아닌 코드와 `terrarium:` 줄은 에이전트의 탓이 아님을 보인다.

## 버린 길
- 새 엔진이 못 읽으면 옛 엔진으로 돌리기: 같은 줄이 엔진에 따라 다르게 답한다.
- 한도를 벽시계로 두기: 기계에 따라 다른 점수.

## 결과
스위치 뒤에 엔진이 들어왔다. 이번에 닫지 못한 것(보고에 적음): 한도 크기를 재서 정하기, 시험 시간 증가 측정, 새 엔진으로 돌린 기존 시험의 깨지는 목록, 일꾼 풀 손보기, 실험 보고서 빈틈 15개의 시험, 호출마다 `$SECONDS`.
