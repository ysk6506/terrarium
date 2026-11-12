---
title: ADR-0118 깊은 OS 흉내를 구현하면서 시험 다섯 곳의 기대값을 고치고 시험을 더한다
kind: decision
status: active
enforced_by:
  - tests/spec/deep-os-shell.test.ts
  - tests/spec/deep-os-faults.test.ts
  - tests/spec/deep-os-determinism.test.ts
  - tests/spec/deep-os-outside.test.ts
  - apps/web/src/logic/shell-outside.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - "tests/spec/os-scenarios.test.ts::the right fix on the host pays nearly in full [REQ-087] > disk full: df shows it, deleting old logs frees it"
  - tests/spec/recovery-scoring.test.ts::the default tools can solve a fault of the operating system [REQ-088] > a full disk is cleared with the default selection alone
  - "tests/spec/service-tools.test.ts::the fake shell prints what the state says, in the shape of Linux [REQ-087] > writes change the world: rm frees the disk, a restart ends a flood, a remount fixes a read-only disk"
  - tests/spec/service-tools.test.ts::the fake shell prints what the state says, in the shape of Linux [REQ-087] > a command outside the list is an answer, not an error; a host that is down cannot be logged in to
  - tests/spec/controllability.test.ts::<stmt:c459c3aa>
test_change_reason: 허용 목록이던 `run_command`가 작은 리눅스 흉내(가상 파일시스템·프로세스 표·셸)로 바뀌어, 예전 시험이 기대한 두 가지가 진짜 리눅스와 맞게 바뀐다. 하나, 지우는 명령은 없는 경로(`/var/log/journal/old.log`, `/var/log/messages-old`)를 조용히 받지 않고 `No such file or directory`로 답하고, 디스크는 지운 파일의 크기만큼 비며 조치는 `free_disk` 한 가지가 아니라 `remove`로 남는다(`free_disk`는 `logrotate -f` 몫). 시험은 같은 성질(디스크를 비우면 서비스가 돌아온다, 지우는 명령은 디스크 비우기 조치로 채점된다)을 실제로 있는 파일(`find /var/log -size +1G`로 찾은 큰 로그, 지난주 로그 `messages-20251221`)로 읽는다. 둘, 목록 밖 명령(`vim`)은 안내문이 아니라 bash의 `command not found`(종료 코드 127)이고 `/etc/passwd`를 지우면 `Operation not permitted`다.
decision_hash: bb51d5fa2dc33f3f
---
# ADR-0118 깊은 OS 흉내를 구현하면서 시험 다섯 곳의 기대값을 고치고 시험을 더한다

## 맥락
[ADR-0117](0117-deep-os-simulation.md)을 구현했다(REQ-098). `run_command`는 더 이상 허용 목록을 맞추는 한 줄짜리 셸이 아니라 호스트마다 가상 파일시스템·프로세스 표·유닛·저널을 가진 작은 리눅스 흉내다. 동작과 규칙은 [서비스와 OS 층](../service-os-layer.md)에 있다. 이 구현이 잠긴 시험 다섯 곳을 건드렸고, 구현하면서 정한 것이 몇 있어 남긴다.

## 결정
1. **지우는 명령은 진짜 `rm`이다.** 없는 경로는 `No such file or directory`(`-f`면 조용히), 디렉터리는 `-r` 없이는 `Is a directory`, `/etc`·`/usr`·`/boot` 같은 시스템 자리는 `Operation not permitted`, 읽기 전용이면 `Read-only file system`이다. 지운 만큼 `df`가 줄고(`host.act`의 `remove`, 지운 바이트 수를 함께 싣는다), 90% 밑으로 내려오면 디스크 꽉 참이 풀린다. 예전의 "`/var/log` 아래라면 무엇이든 35%를 비운다"는 없어졌고, `logrotate -f`가 예전의 `free_disk`(35%)를 그대로 한다.
2. **호스트 조치가 열두 가지가 된다.** 다시 시작·디스크 비우기·다시 마운트·재부팅에 멈춤·시작·켜기·끄기·신호·지우기·쓰기·비우기(`truncate`)가 더해진다. 채점에서는 지우기·쓰기·비우기를 "디스크 비우기", 나머지 새 조치를 "프로세스 다시 시작"으로 센다. 파이프·`xargs`·`find -exec`·`sudo` 속에 숨은 쓰기도 조치로 읽는다(`callEffect`).
3. **물리의 저장 상태는 바뀌지 않는다.** 호스트의 저장 상태에는 쓴 파일·지운 경로·끈 유닛(`files`·`removed`·`disabled`)만 새로 생기고, 운영자가 그 조치를 한 호스트에만 생긴다. 물리 스텝이 쓰던 로그 줄과 숫자는 그대로라서 물리 기록값(`physics-golden`)은 한 글자도 안 바뀌었다. 고장이 박자대로 쓰는 줄(재시작 반복의 종료, 로그 폭주의 에러, 시계 경고, DNS·인증서)은 저널이 고장의 시작과 끝에서 다시 계산하고, 물리가 저장한 같은 줄은 목록에서 뺀다.
4. **변별력 점검에 셋째 물음이 더해진다.** "흔한 명령(`journalctl`·`ps`·`df`·`cat`)만으로 호스트 안의 원인에 닿는가"(`shellReach`). OS 고장 열 가지 모두 닿고, 안 닿으면 경고한다.
5. **실행 결과에 "흉내 밖 명령 n번(목록)"이 적힌다.** `RunResult.shellOutside`. 점수에 섞이지 않는다.

## 결과
- 시험 다섯 곳이 같은 성질을 새 값으로 읽는다(위 `amends_tests`). 새 시험 다섯 파일이 셸 문법, 텍스트 명령, 고장 열 가지의 진단 길, 결정론(같은 명령 열은 같은 글자, 빨리 감기가 같은 로그), "흉내 밖 명령" 세기와 변별력 점검을 지킨다.
- `kubectl`·`crictl`은 컨테이너 층이 `registerShellCommand`로 달 때까지 `command not found`다.
