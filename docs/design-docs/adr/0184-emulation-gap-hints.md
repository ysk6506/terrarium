---
title: ADR-0184 실험장이 못 해서 틀린 것에만 힌트를 준다 — 흉내 한계(emulation gap)는 한 가지 길로 말하고 기록한다
kind: decision
status: active
last_verified: 2026-11-12
enforced_by:
  - tests/spec/emulation-gaps.test.ts
updates_docs:
  - docs/design-docs/service-os-layer.md
amends:
  - adr: "0117"
    what: 흉내가 못 하는 것은 command not found나 안 돼요로만 답하고 센다
touches_protected:
  - docs/design-docs/adr/0117-deep-os-simulation.md
amends_tests:
  - tests/spec/accel-tools-faults.test.ts::nvidia-smi, ibstat and dcgmi on a node in trouble, and on a host without the hardware [REQ-107] > a host without GPUs has no driver, no DCGM engine and no IB devices; other dcgmi commands are listed as missing
  - tests/spec/db-shell.test.ts::psql answers the few queries a person asks to see the state [REQ-095] [REQ-098] > a query the fake does not answer says which ones it does, and a session without -c is outside it
  - tests/spec/deep-os-corners.test.ts::=ROWS
  - tests/spec/deep-os-files.test.ts::stat, touch, cp, mv, rm and truncate change and refuse like the real ones [REQ-098] > cp copies a file, into a directory under its own name, and mv moves it
  - tests/spec/deep-os-files.test.ts::stat, touch, cp, mv, rm and truncate change and refuse like the real ones [REQ-098] > truncate to zero empties a file; another size, or none, is refused
  - tests/spec/deep-os-find-units.test.ts::find walks the fake file system [REQ-098] > a missing place is named, and an operator or test the fake does not have is outside it
  - tests/spec/deep-os-find-units.test.ts::systemctl reads and changes the units [REQ-098] > a unit that is not there, and a verb the fake does not have, are refused
  - tests/spec/deep-os-gaps-args.test.ts::the options of a command [REQ-098] > [REQ-098] a long option the fake does not know is said so, whether or not it carries a value
  - tests/spec/deep-os-gaps-find-sed.test.ts::find [REQ-098] > [REQ-098] a test left hanging, or a word that follows a finished test, is turned back with that word
  - tests/spec/deep-os-gaps-find-sed.test.ts::find [REQ-098] > [REQ-098] depth limits keep the start out or keep to it, and one with no number is taken as zero
  - tests/spec/deep-os-gaps-system.test.ts::ps and top [REQ-098] > [REQ-098] a sort key the fake does not know is refused and counted outside
  - tests/spec/deep-os-gaps-system.test.ts::time and certificates [REQ-098] > [REQ-098] openssl and chronyc without a subcommand are refused and counted outside, as are unknown switches
  - tests/spec/deep-os-gaps-text.test.ts::test and [ [REQ-098] > [REQ-098] -o is true when either side is, -a when both are, and a side that is not understood is counted outside
  - "tests/spec/deep-os-links.test.ts::ln -s and readlink make and read symbolic links [REQ-098] > [REQ-098] a hard link is not simulated: it says so and is counted as outside"
  - tests/spec/deep-os-links.test.ts::mkdir makes directories as a world event [REQ-098] > [REQ-098] -p makes the parents, -v says so, and a plain mkdir refuses what bash refuses
  - tests/spec/deep-os-net.test.ts::dig and nslookup print the answer or the NXDOMAIN of the resolver [REQ-098] > nslookup names the server it asked and says where a name cannot be found
  - tests/spec/deep-os-option-sweep.test.ts::=TAKES_ANY
  - tests/spec/deep-os-option-sweep.test.ts::an option the fake does not have is named and sent outside the simulation [REQ-098] > %s refuses -Z and --no-such-option
  - tests/spec/deep-os-shell.test.ts::the shell reads a line the way bash does [REQ-098] > an unknown command is bash's own words with exit 127; kubectl waits for the container layer
  - tests/spec/deep-os-sockets.test.ts::ip shows the address, the link and the route of the host [REQ-098] > an object the fake does not have is outside it
  - tests/spec/deep-os-sockets.test.ts::lsof lists the open files of the processes [REQ-098] > -i lists the internet sockets, :port narrows to one port, -p one process, a path its owner
  - tests/spec/deep-os-syntax.test.ts::what the shell does not do is refused in its own words and listed as outside it [REQ-098] > a command that does not exist is command not found, listed as outside, and exit 127
  - tests/spec/deep-os-system.test.ts::df, free, uptime and mount read the host's numbers [REQ-098] > logrotate needs a config that exists, -d only reads it, -f rotates
  - tests/spec/deep-os-system.test.ts::df, free, uptime and mount read the host's numbers [REQ-098] > mount lists the mounts, remounting read-write is allowed, anything else is outside the fake
  - tests/spec/deep-os-system.test.ts::df, free, uptime and mount read the host's numbers [REQ-098] > uptime says how long the host has run, -p in words, -s since when
  - tests/spec/deep-os-time-log.test.ts::chronyc and timedatectl tell whether the clock is in step [REQ-098] > a command chronyc has and the fake does not is outside it, as is the interactive prompt
  - tests/spec/deep-os-time-log.test.ts::chronyc and timedatectl tell whether the clock is in step [REQ-098] > timedatectl shows the local and universal time and says the clock is synchronised
  - tests/spec/deep-os-time-log.test.ts::openssl x509 reads the certificate files of the host [REQ-098] > a missing file or input and the parts of openssl the fake does not have are refused
  - tests/spec/k8s-shell.test.ts::crictl ps lists the containers on a node, API or not [REQ-096] > a verb other than ps is refused with what it can do
  - tests/spec/k8s-shell.test.ts::kubectl describe node and the things the fake does not do [REQ-096] [REQ-100] > a verb the fake does not have prints what it can do and exits 1
  - tests/spec/mesh-shell.test.ts::istioctl proxy-status shows each sidecar against the control plane [REQ-100] > a world with no mesh says there is no Istio, and a command the fake does not do says which
  - tests/spec/service-tools.test.ts::the fake shell prints what the state says, in the shape of Linux [REQ-087] > a command outside the list is an answer, not an error; a host that is down cannot be logged in to
test_change_reason: 흉내가 못 하는 입력의 답이 바뀐다. 실제 도구도 거절하는 입력은 실제 도구의 말과 종료 코드로 답하고 흉내 밖으로 세지 않으며, 실제 도구가 하는 입력은 terrarium 줄이 붙는다. 되는 입력의 출력은 바뀌지 않았다.
decision_hash: 46802b0de2a30f6f
---
# ADR-0184 실험장이 못 해서 틀린 것에만 힌트를 준다

이슈 47의 첫째 항목(실패했을 때 스스로 고칠 수 있는 말)만 다룬다. 둘째~넷째와 여러 실행에 걸친 한계 순위는 다루지 않는다.

## 맥락

테라리움은 에이전트가 진짜 장비처럼 일하는지를 잰다. 에이전트가 실패했을 때 두 가지가 섞여 있었다.

- 진짜 도구도 그 입력을 거절한다. 없는 옵션, 틀린 프로그램, 없는 하위 명령. 에이전트의 실수다.
- 진짜 도구는 그 입력을 처리하는데 흉내가 못 한다. 실험장의 한계다.

예전에는 둘 다 "이 흉내에서는 안 돼요" 같은 제각각의 말로 거절했고 종료 코드는 2였다. 에이전트는 자기 실수인지 실험장의 한계인지 알 수 없었고, 평가하는 사람은 한계 때문에 깎인 점수를 알아볼 수 없었다.

## 결정

**힌트는 실험장의 흉내가 진짜 도구가 하는 것을 못 해서 실패했을 때만 준다. 진짜 도구도 거절하는 입력은 진짜 도구가 할 말 그대로 답하고 힌트를 붙이지 않는다.**

1. 흉내 한계(emulation gap)를 하나의 길로 말한다. `world/emulation-gap.ts`의 `GapNotice`(도구, 기능 키, 사람이 읽는 이름, 되는 것, 돌아가는 명령 하나)와 `os/types.ts`의 `emulationGap`/`softGap`이다. 곳곳의 제각각 "안 돼요" 문자열은 없앴다. 스위치 CLI는 `facades/netos-gaps.ts`, 계층 명령(kubectl, crictl, istioctl, dcgmi)은 `tools/shell-gap.ts`에서 같은 구성을 쓴다.
2. 거절하는 자리마다 "진짜 도구도 실패" 인지 "진짜 도구는 함" 인지 가른다. 가르는 근거는 진짜 도구의 문서가 적은 옵션·하위 명령·함수 표다(`os/real-options.ts`, `os/real-commands.ts`, 스위치 명령표). 표는 GNU coreutils·procps·util-linux·iproute2·curl·systemd 설명서, 벤더(Arista EOS, Cisco NX-OS, Cisco IOS XE) 명령 설명서를 따랐다. 표에 없는 새 진짜 옵션은 진짜 도구도 거절한 것으로 읽히니, 에이전트가 진짜인데 없다고 만난 것은 표에 더한다. 확실하지 않은 것은 한계로 보고 표시했다.
3. 진짜 도구에는 있지만 흉내에 아직 없는 명령(`vim`, `export`, `tcpdump`...)은 `command not found`(127)에 힌트가 붙는 한계다. 어느 호스트에도 없는 이름은 힌트 없는 `command not found`다.

## 출력의 모양

stderr의 첫 줄은 그 도구의 말투 그대로다. 그 뒤에 `terrarium:` 줄 셋이 온다.

```
terrarium: 이 실험장은 <도구>의 <기능> 기능을 지원하지 않아요. 실제 <도구>에는 있어요.
terrarium: <도구>에서 되는 것: <짧은 목록>
terrarium: 대신 이 명령은 돼요: <돌아가는 명령 하나>
```

종료 코드는 0이 아니다(도구의 말투를 따라 1이나 2, 명령이 없으면 127). 글은 입력과 상태만으로 정해져 같은 입력은 글자까지 같다. 해요체이고 에이전트가 친 글이 `terrarium:` 줄에 들어가지 않는다. `tail -f`와 `journalctl -f`는 줄은 보여 주고 끝나므로 출력과 종료 코드는 그대로 두고 뒤에 `terrarium:` 줄만 붙는다(종료 코드가 0일 수 있는 유일한 경우).

## 기록

한계 하나가 이벤트 하나다. 실행 기록에 `kind: "gap"`이 도구 호출 이벤트 바로 뒤에 쌓이고 `tool`, `feature`, 그 호출의 `call`(번호)을 가진다. `feature`는 고정 표에서 고른 안정된 키(`flag:-Z`, `function:gensub`, `verb:list-timers`, `command`)라서 에이전트가 친 글, 파일 이름, 행 내용이 들어가지 않는다. 호출 기록(`ToolCallRecord.gaps`)과 진단 내보내기(`terrarium.diagnosis/1`의 선택 항목 `gaps`: 키별 횟수)도 같은 키를 나른다. 흉내 밖 명령 목록(`outside`, ADR-0117)은 그대로 둔다. 진짜 도구도 거절한 입력은 이제 `outside`에 넣지 않는다.

## 화면

실행 상세의 단계 목록에서 한계를 만난 단계에 "실험장 한계" 표시와 "실험장이 이 명령의 일부를 지원하지 못했어요. 에이전트의 실수가 아니에요."를 보인다. 실행 머리줄에는 한계가 있을 때만 "실험장 한계 N번"을 적는다. 다른 화면은 바꾸지 않는다. API 길과 계약표는 건드리지 않았다.

## 이유

제품의 값은 "에이전트가 진짜 장비에서 어떻게 일할지를 정확히 아는 것"이다. 진짜 도구가 거절하는 입력에 힌트를 주면 시험이 현실보다 쉬워지고, 진짜 도구가 하는 입력을 힌트 없이 거절하면 에이전트의 능력이 아닌 흉내의 구멍을 재게 된다. 둘을 가르면 에이전트는 막다른 곳에서 고칠 길을 얻고, 평가하는 사람은 점수가 어디서 한계 때문에 눌렸는지 보며, 유지하는 사람은 한계를 키 별로 센 첫 일감 목록을 얻는다.

## 대안과 버린 이유

- 모든 실패에 힌트를 준다: 진짜 도구도 거절하는 입력이 쉬워져 평가가 틀어진다.
- 한계를 기존 `outside` 문자열에만 더 적는다: 글에 사람이 친 값이 섞이고 키로 셀 수 없다.
- 힌트 없이 기록만 한다: 에이전트가 같은 막다른 곳을 되풀이한다.

## 이 결정 밖

이슈 47의 둘째~넷째 항목, 여러 실행에 걸친 한계 순위를 유지하는 사람에게 보여 주는 화면과 API(길·계약·정책표는 건드리지 않았다)는 다음 일이다.

## 열린 질문

한계를 만난 호출을 도구 효율 점수 항목에서 빼야 하는가? 지금은 점수를 바꾸지 않았다(`scoring-unchanged.test.ts`가 지킨다). 에이전트가 한계 때문에 쓴 호출이 효율을 깎는 것이 맞는지는 한계 기록이 쌓인 뒤 정한다.

## 결과

- `world/emulation-gap.ts`와 `os/real-*.ts`, `facades/netos-gaps.ts`, `tools/shell-gap.ts`가 한 길을 이룬다.
- 잠긴 시험 중 안 되는 입력의 답을 단언하던 32개를 `amends_tests`로 바꿨다. 되는 입력의 출력을 단언하던 시험은 바뀌지 않았다.
- 시험은 `tests/spec/emulation-gaps.test.ts`(표 주도: 한계 입력의 줄·되는 목록·돌아가는 명령, 진짜 오류에 `terrarium:` 없음, 글자 단위 결정론, 실행 기록과 내보내기)와 `apps/web/src/logic/emulation-gaps.test.ts`다.
