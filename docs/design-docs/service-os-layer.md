---
title: 서비스와 OS 층 — 장비 위에서 무엇이 도는가
kind: spec
status: active
last_verified: 2026-11-11
covers:
  - packages/core/src/world/service.ts
  - packages/core/src/world/service-events.ts
  - packages/core/src/world/service-health.ts
  - packages/core/src/world/service-act.ts
  - packages/core/src/world/os.ts
  - packages/core/src/world/faults-os.ts
  - packages/core/src/world/host-os.ts
  - packages/core/src/physics/os-physics.ts
  - packages/core/src/physics/os-alarms.ts
  - packages/core/src/physics/services.ts
  - packages/core/src/sources/worldgen/services.ts
  - packages/core/src/tools/shell.ts
  - packages/core/src/world/os/*.ts
  - packages/core/src/session/shell-reach.ts
  - packages/core/src/scenario/library-os.ts
verification_log:
  - "2026-11-10: 물리 상수를 슬롯 표로 옮김(REQ-113). v1 동작은 physics-golden이 비트까지 같음을 확인, 문서 내용 변화 없음"
  - "2026-11-11: 2026-11-11: 깊은 OS 흉내 — mkdir·ln -s·readlink, 디렉터리·링크 항목, find /·du / 순회, 빈 명령 문법 오류, grep·sed·awk·sort의 GNU와 다른 점을 고치고 남은 것을 '흉내 내지 않는 것'에 적음 (REQ-098)"
  - "2026-11-11: awk: do-while, %E %G %*d, substr, length(배열), 미설정 변수, \\x, BEGIN의 exit 뒤 END"
  - "2026-11-11: tools·world/os: 닿지 않는 분기 정리와 시험 추가; 동작은 같음(TD-0002), awk는 이름 바로 뒤 '(' 호출과 srand 반환값"
  - "2026-11-11: cat, printf, wc, test, find 연산자, uniq, cut 옵션을 실제 coreutils 출력과 맞춤"
covers_hash: 02aa6fabb272cbc8
---
# 서비스와 OS 층 (REQ-086, REQ-087, [ADR-0091](adr/0091-service-os-layer-recovery-first.md))

## 한 문장으로

**장비 위에서 일하는 것(서비스)과 그 장비 안의 운영체제를 세계에 올렸다. 서비스의 건강은 따로 시뮬레이션하지 않고 아래 장비와 호스트 상태에서 그때그때 계산하고, 호스트 안은 흉내 OS(`run_command`)로 들여다본다.**

비유하면 식당이다. 장비는 주방 설비(가스, 냉장고)이고, 서비스는 "점심 영업"이다. 가스가 끊기면 영업이 멈추고, 냉장고가 약하면 메뉴가 줄고, 주방장(프로세스)이 계속 쓰러지거나 설거지통(디스크)이 넘치면 설비는 멀쩡해도 영업이 안 된다. 서비스 층은 영업이 되는지를, OS 층은 설비 안쪽의 일을 맡는다.

## 한계부터 (정직하게)

- **진짜 OS가 아니다.** 호스트 상태(숫자 몇 개와 프로세스 목록, 로그 줄)를 물리 스텝이 움직이고, 셸은 그 **상태에서 가상 파일 트리와 프로세스 표를 만들어** 진짜 Linux 출력의 모양으로 답한다([ADR-0117](adr/0117-deep-os-simulation.md)). 진짜 호스트를 붙이지 않는다. 커널이 아니라서 임의 프로그램 실행, 컴파일, 패키지 설치, 네트워크 밖 접속은 안 되고 `command not found`로 답한다. 어디까지 못 했는지는 실행 결과의 "흉내 밖 명령 n번"으로 센다.
- **시간당 피해는 추정이다.** 생성기가 깐 값은 업종 평균을 어림한 것이고 모든 서비스에 `harmEstimated`가 붙어 툴 출력과 화면에 "추정"으로 나온다. 실제 사업장에 맞게 고쳐야 의미가 있다.
- **컨테이너(kubectl, crictl)는 컨테이너 층의 일이다.** 이 층은 서버·VM의 OS만 다루고, 컨테이너 층(`tools/shell-layers.ts`)이 `registerShellCommand`로 두 명령을 단다. 쿠버네티스 노드인 호스트에서는 컨테이너 층의 출력이 나오고([컨테이너 층](container-layer.md)), 노드가 아닌 호스트에서는 `command not found`다.
- 건강은 **지금 상태의 함수**다. 응답 시간 분포나 요청 단위 실패는 없다. 느려짐(degraded)은 "지금 정상 조건에서 벗어났다"는 뜻이다.

## 서비스 (`world/service.ts`)

서비스는 `service` 종류의 엔티티다. 자기 자리(방·랙)가 없는 가상 종류이고, 설정은 속성에, 자리는 링크에 있다.

| 항목 | 뜻 |
|---|---|
| 종류 | `request`(요청 처리), `batch`(배치), `stateful`(상태 유지) |
| 도는 곳 | 링크 `service_on`(역할 `active` 또는 `standby`): VM, 서버, 스토리지 |
| 경로 | 링크 `service_via`: 이 서비스의 트래픽이 지나는 스위치 |
| 프로세스 | 일을 하는 프로세스 이름(`systemctl`이 부르는 이름) |
| SLO | 가용성(기본 0.99), 지연 |
| 피해 | `perHourKrw`(멈추면 시간당 원) 또는 `delayHours`(멈추면 늦어지는 시간) |
| 대기열 | 배치만: 멈춘 동안 시간당 쌓이는 일의 수와 단위("건") |
| 정상 조건 | 종류별 기본값 + 일감(가장 많이 쓰는 자원의 한계가 비중만큼 낮아짐, `workload.ts`) + 서비스별로 덮어쓰기(적혀 있으면 일감이 덮지 않음) |

종류별 기본 정상 조건(넘으면 느려짐):

| 종류 | 흡기 온도 | CPU | 메모리 | 디스크 |
|---|---|---|---|---|
| 요청 처리 | 32°C | 90% | 90% | 90% |
| 배치 | 32°C | 98% | 92% | 92% |
| 상태 유지 | 32°C | 90% | 88% | 85% |

**서비스 상태**(`ServiceState`): `status`(healthy·degraded·down), `reasons`(왜, 최대 4개), `runsOn`/`standby`(지금 도는 곳과 대기 쪽 — 옮기면 바뀐다), `since`(언제부터 정상이 아닌가), `lostKrw`(지금까지 본 피해, 추정), `backlog`(밀린 일), `failovers`(옮긴 횟수). 물리 스텝마다 갱신된다(`physics/services.ts`). 멈추면 시간당 피해 전부, 느려지면 30%가 쌓이고, 배치의 대기열은 멈춘(또는 느린) 동안 늘고 돌아오면 쌓일 때의 두 배 속도로 줄어든다.

## 건강 규칙 (`world/service-health.ts`)

호스트(도는 곳) 하나씩 `ok`·`slow`·`dead`를 정하고, 서비스 전체로 합친다.

### 호스트 하나 — 위에서부터 먼저 걸리는 것

| 조건 | 서버 | VM | 스토리지 |
|---|---|---|---|
| 전원 없음, 꺼짐, 재부팅 중 | dead | (VM은 꺼짐: dead) | 꺼짐: dead |
| 메모리 불량(`memory_failure`, REQ-093) | dead (원인 `hardware`) | 올라간 서버를 따라감 | — |
| 네트워크로 닿지 않음(케이블·스위치·설정) | dead | 올라간 서버를 따라감 | dead |
| OS가 내려가 있음(재부팅·패닉) | dead | dead | — |
| 서비스 프로세스가 죽었거나 재시작 중 | dead | dead | — |
| 좀비 3,000개 이상 | dead | dead | — |
| 파일시스템 읽기 전용 | 요청 처리 slow, 그 밖에 dead | 같음 | — |
| 디스크 99.5% 이상 | 요청 처리 slow, 그 밖에 dead | 같음 | — |
| 시계가 5분 넘게 어긋남 | 요청 처리 dead, 그 밖에 slow | 같음 | — |
| DNS 실패 | 요청 처리 dead, 그 밖에 slow | 같음 | — |
| 인증서 만료 | 요청 처리 dead, 상태 유지 slow, 배치는 영향 없음 | 같음 | — |
| 메모리가 정상 조건 이상 | slow | slow | — |
| 디스크가 정상 조건 이상 | slow | slow | 95% 이상 찼거나 디스크 고장: slow |
| 좀비 200개 이상 | slow | slow | — |
| 흡기 ≥ 32°C, CPU가 열 때문에 느려짐, CPU ≥ 정상 조건 | slow | VM의 CPU ≥ 정상 조건: slow | — |

VM은 자기 OS 상태를 보기 전에 올라간 서버의 "전원·네트워크·OS 가동"을 먼저 따른다(VM은 서버 디스크의 영향은 받지 않는다).

### 서비스 전체

1. 도는 곳이 없거나 **모두 dead**면 `down`.
2. **상태 유지** 서비스는 도는 곳 **하나라도 dead**면 `down`(둘 중 하나만 죽어도 상태가 갈린다).
3. 요청 처리·배치는 일부만 dead이거나 slow가 있으면 `degraded`(이중화로 버티는 중).
4. 경로의 스위치가 **모두** 멈추면 `down`, 일부만 멈추면 `degraded`.
5. 아니면 `healthy`. 위 둘(2·3 과 4) 중 나쁜 쪽을 쓴다.

6. **오버레이와 클라우드 네이티브 층**(REQ-097): 서비스가 기대는 세그먼트·인그레스·가상 방화벽과, 서비스를 지키는 네트워크 정책, 서비스 노드의 CNI 플러그인도 읽어 합친다(`sdn-health.ts`). 끊긴 VTEP 뒤의 노드는 죽은 자리로 세고, 닫힌 인그레스는 요청 서비스를 멈추게 하고 나머지는 느리게 한다. 컨트롤러가 멈춘 것은 서비스에 영향이 없다. 규칙은 [SDN 오버레이와 클라우드 네이티브 네트워크 층](sdn-network-layer.md#서비스-건강이-오버레이를-읽는-법).
7. **서비스가 기대는 것**(`depends_on`, REQ-095): 서비스가 데이터베이스 클러스터나 스토리지 풀에 기대면 그 상태도 읽어 위와 합친다. 하나라도 멈췄으면 서비스가 멈추고 하나라도 느리면 느리다. 읽는 규칙(프라이머리가 멈추면 요청 처리는 읽기만 되어 느려지고 나머지는 멈춘다, 복제 지연이 한계를 넘으면 느려진다 따위)은 [데이터베이스 층과 스토리지 HA 층](db-storage-layers.md)에 있다. 서비스를 대기 쪽으로 옮겨도 데이터베이스는 그대로라서, 데이터베이스가 원인이면 옮겨도 돌아오지 않는다.
8. **서비스가 서 있는 클러스터**(`depends_on` 워크로드, REQ-096): 서비스가 쿠버네티스 워크로드에 기대고 노드 VM 위에만 서 있으면, 건강은 VM이 아니라 **파드**로 읽는다. 레플리카 중 제 몫을 하는 파드가 전부면 정상, 일부면 느려짐, 하나도 없으면 멈춤이다. 컨트롤 플레인이 멈춰도 돌던 파드는 정상이다(새 배포·재스케줄만 멈춘다). 노드 밑의 머신이 멈추면 노드가 NotReady가 되고 그 노드의 파드가 제 몫을 못 하는 길로 닿는다. 규칙은 [컨테이너 층](container-layer.md#서비스-건강이-파드를-읽는-법)에 있다. VM이나 서버 위에도 서 있는 서비스는 머신 규칙도 함께 읽는다.

장비를 고치거나 서비스를 대기 쪽으로 옮기면 다음 스텝에 저절로 돌아온다. 따로 "복구"를 쓰는 곳이 없다.

## OS 층 (`world/os.ts`, `physics/os-physics.ts`)

서버·VM마다 호스트 상태가 **필요할 때** 만들어진다(무엇도 건드리지 않은 호스트는 상태가 없고 id에서 같은 모양으로 매번 만들어진다. 그래서 OS 고장이 없는 세계는 비용이 늘지 않는다).

`cpuPct`, `memPct`, `diskPct`, `zombies`, `fs`(rw·ro), `ntpOffsetS`, `dnsOk`, `certOk`, `uptimeS`, `up`, `logRate`, `processes`(이름·pid·사용자·상태·재시작 횟수·CPU 몫·메모리 몫), `log`(마지막 60줄).

기본으로 도는 프로세스는 systemd-journald, sshd, chronyd, systemd-resolved, rsyslogd, crond와 서비스의 프로세스다. 물리 스텝이 고장에 따라 움직이고, **고장이 끝나면(운영자가 풀었든 시간이 지났든) 굽었던 상태가 정상으로 돌아와 어떤 끝이든 멀쩡한 호스트가 남는다.**

### 고장 열 가지와 번짐

| 고장 | 호스트에서 벌어지는 일 | 서비스에 번지는 모양 | 푸는 길 |
|---|---|---|---|
| 디스크 꽉 참 | 디스크 100%, 로그에 "No space left on device" | 요청 처리는 느려짐, 배치·상태 유지는 멈춤 | 큰 로그를 찾아 지우기(`du`·`find`로 찾고 `rm`, 또는 `logrotate -f`) |
| 로그 폭주 | 디스크가 분당 3%(조절) 차오르고 로그가 초당 4,500줄 | 정상 조건을 넘으면 느려지고 가득 차면 디스크 꽉 참과 같음 | 서비스 프로세스 다시 시작(폭주를 끊음), 그다음 디스크 비우기 |
| 메모리 누수 | 서비스 프로세스 메모리가 분당 2%(조절) 늘어 99%에서 OOM 강제 종료, 20초 뒤 다시 떠서 또 샘 | 90%쯤부터 느려지고 강제 종료 순간 멈췄다 돌아오기를 반복 | 다시 시작은 잠깐뿐(누수는 남음). 서비스를 대기 쪽으로 옮기면 오래 감 |
| 프로세스 재시작 반복 | 30초(조절)마다 죽고 재시작 횟수가 늘고 로그에 `status=1/FAILURE` | 멈춤 | 다시 시작해도 같음. 서비스를 대기 쪽으로 옮김 |
| 좀비 누적 | 분당 40개(조절) 쌓임, 3,000개에서 `fork: Resource temporarily unavailable` | 200개부터 느려지고 3,000개에서 멈춤 | 서비스 프로세스 다시 시작, 재부팅 |
| 파일시스템 읽기 전용 | `ext4 … Remounting filesystem read-only`, 쓰기 모두 실패 | 요청 처리는 느려짐, 나머지는 멈춤 | `mount -o remount,rw /`, 재부팅 |
| 시간 동기 어긋남 | 시계가 분당 90초(조절) 어긋남, 5분이 넘으면 인증 실패 | 요청 처리는 멈춤(401), 나머지는 느려짐 | `systemctl restart chronyd` |
| DNS 실패 | 이름 풀이 실패(IP 직접 호출은 됨) | 요청 처리는 멈춤(502), 나머지는 느려짐 | `systemctl restart systemd-resolved` |
| 커널 패닉 | OS가 내려가고 4분(조절) 뒤 저절로 다시 부팅, 프로세스 재시작 | 그동안 멈춤 | 기다리거나 서비스를 대기 쪽으로 옮김 |
| 인증서 만료 | 로그에 `certificate has expired`, 연결 거부 | 요청 처리는 멈춤, 상태 유지는 느려짐, 배치는 그대로 | 이 층에서는 진단과 보고(인증서를 새로 받는 툴은 없음) |

알람은 종류 `os`(디스크, 메모리, 프로세스, 파일시스템, 시계, DNS, 좀비, 로그 폭주, 인증서, OS 내려감)와 `service`(서비스 멈춤은 심각, 느려짐은 경고)가 있다. 호스트가 장비 쪽 이유로 꺼져 있으면 OS 알람은 내지 않는다(그쪽 알람이 이미 있다).

## 깊은 OS 흉내 (`world/os/`, [ADR-0117](adr/0117-deep-os-simulation.md))

`run_command(host, cmd)`는 호스트(서버 또는 VM)에서 명령 한 줄을 실행한다. 꺼져 있거나 닿지 않는 호스트는 `ssh: connect to host … Connection timed out`이고, 커널 패닉도 같다. 그 밖에는 **작은 리눅스 흉내**가 답한다. 허용 목록은 없다. 흉내가 할 수 있는 명령은 모두 돌고, 모르는 명령은 `bash: xyz: command not found`(종료 코드 127)다. 출력은 세계 시드·상태·세계 시간의 함수라서 같은 명령 열은 새 세계에서 같은 글자를 내고, 빨리 감기와 기록 재생이 전과 같다(`tests/spec/deep-os-determinism.test.ts`).

호출 결과는 `{stdout, stderr, exitCode, outside, output}`이다. `output`은 stdout 다음에 stderr를 이은 글(예전 모양)이고, `outside`는 이 호출에서 흉내가 못 한 명령·기능의 목록이다.

### 가상 파일시스템 (`os/fs.ts`, `fs-etc.ts`, `fs-proc.ts`, `fs-var.ts`)

호스트마다 파일 트리를 **그때그때 서술**한다(저장하는 덩어리가 없다). 파일 내용은 읽을 때만 만든다. 운영자가 쓴 것(`>`, `>>`, `tee`, `sed -i`, `cp`, `touch`), 만든 것(`mkdir`, `ln -s`)과 지운 것은 호스트 상태(`files`·`removed`)에 사건으로 남아 트리 위에 덮인다.

| 자리 | 들어 있는 것 | 어디서 나오나 |
|---|---|---|
| `/proc` | `cpuinfo`, `meminfo`, `loadavg`, `uptime`, `mounts`, `<pid>/status·cmdline·comm·stat` | 호스트 숫자와 프로세스 표 (`free`·`top`·`ps`와 같은 값) |
| `/var/log` | `messages`(=`syslog`), `secure`(=`auth.log`), `kern.log`, `cron`, `dmesg`, `<서비스>/<서비스>.log`, 지난주 로그(`messages-20251221` 따위), `journal/` | 호스트의 **한 사건 목록**(아래). 알람·고장·조치·건강 점검이 줄이 되고 시각은 세계 시간 |
| `/etc` | `hostname`, `hosts`, `resolv.conf`, `fstab`, `passwd`, `logrotate.conf`·`logrotate.d/<서비스>`, `systemd/system/*.service`, `ssl/certs/<서비스>.pem`(머리에 notAfter), `<서비스>.conf`, `chrony.conf` | 고장이 바꾸는 파일이 여기 있다 |
| `/var/lib` | `<서비스>/data/store.dat`, `state.db`, 데이터베이스 호스트의 `pgsql/data` | 디스크의 기본 사용량을 채우는 큰 파일 |
| `/tmp`, `/home/ops`, `/opt/app/bin`, `/usr/bin`, `/dev`, `/boot` | 업로드 임시 파일, 로그인 홈, 서비스 실행 파일, 명령 파일 | 얼개 |

크기는 서로 맞는다. `df`의 사용량 = 기본 사용량(호스트 id에서 정해짐) + 고장이 쌓은 묵은 로그이고, `du`와 `ls -l`은 같은 트리를 더한다. 지우면 그만큼 `df`가 줄어든다. 쓰기와 지우기는 `/var/log`·`/tmp`·`/home` 같은 자리만 되고(`/etc`는 쓰기만), 그 밖은 `Operation not permitted`·`Permission denied`다. 파일시스템이 읽기 전용이면 `/tmp`를 뺀 모든 쓰기가 `Read-only file system`이다.

### 프로세스 표 (`os/procs.ts`)

호스트마다 PID·PPID·사용자·이름·명령줄·상태(R/S/D/Z)·CPU%·RSS·시작 시각을 가진다. systemd(PID 1), 커널 스레드, 시스템 데몬(sshd, chronyd, systemd-resolved, rsyslogd, crond, journald), 서비스의 프로세스(`appsvc`), 데이터베이스·CNI 같은 얹힌 것, 로그인 세션(sshd 자식, bash)이 있다. `ps`, `top -b -n 1`, `pgrep`, `/proc/<pid>/status`가 모두 이 표 하나를 읽는다. 메모리 누수는 그 프로세스의 RSS가 자라고, 좀비 누적은 Z 줄이 부모(서비스 프로세스) 밑에 늘고, 재시작 반복은 재시작 때마다 PID가 바뀐다(`pid + 재시작 횟수 × 1009`). 한 번 재시작하면 새 PID이고, 죽이는 신호(`kill -9`)는 systemd가 다시 띄우고 얌전한 신호(`kill`)는 끝낸다.

### 유닛과 저널 (`os/units.ts`, `os/events.ts`, `os/journal.ts`)

유닛은 호스트의 프로세스다. `systemctl status|start|stop|restart|reload|enable|disable|is-active|is-enabled|is-failed|list-units [--failed]|show -p|cat`가 된다. 상태에는 재시작 횟수(`show -p NRestarts`)와 최근 저널 줄이 같이 나온다. `journalctl`은 `-u`(여러 번), `-n`, `--since`·`--until`("10 minutes ago", "today", "2026-01-01 00:10"), `-p`, `-k`, `-b`(`-b -1`은 지난 부팅), `-g`, `-r`, `-o cat`를 알고, `-f`는 안 된다고 말하고 마지막 줄만 보여 준다. 저널, `/var/log/*`, `dmesg`는 **호스트의 한 사건 목록**에서 나온다.

| 사건의 출처 | 예 |
|---|---|
| 물리가 저장한 줄 | 메모리 90%·강제 종료, 파일시스템 읽기 전용 전환, 커널 패닉과 부팅, 다시 시작 |
| 고장의 박자(고장이 시작된 때부터 계산) | 재시작 반복의 `Scheduled restart job`·`Main process exited`, 로그 폭주의 에러, 시계 어긋남 경고(분마다), DNS 실패, 인증서 만료 |
| 살아 있는 호스트의 바탕 | cron(10분), 시간 동기(1시간), 로그인(2시간), 서비스의 건강 점검(2분), 데이터베이스 체크포인트 |
| 세계의 알람·조치 | `monitoring-agent`의 알람 줄, `sudo`의 조치 줄(`COMMAND=…`) |

고장의 박자는 고장의 시작·끝과 지금 시각만으로 계산해서, 한 번에 빨리 감아도 1초씩 걸어도 같은 줄이 나온다.

### 셸 문법 (`os/shell-parse.ts`, `os/shell-exec.ts`)

| 되는 것 | 안 되는 것(거절하고 종료 코드 2, "흉내 밖"으로 센다) |
|---|---|
| 파이프 여러 단계 `a \| b \| c`, `&&` `\|\|` `;` | 변수 `$X`, `$(…)`, 백틱 |
| `>` `>>` `<` `2>` `2>>` `2>&1`, `/dev/null` | `&`(백그라운드), 히어독 `<<`, 서브셸 |
| `'…'` `"…"` 백슬래시 따옴표, `*` `?` `[…]` 글롭, `~` | `if`·`for`·`while`·`case`·함수 |
| `cd`, `pwd`, `sudo`(그냥 실행), `sleep`(바로 끝) | |

### 명령 표

| 분야 | 명령과 되는 옵션 |
|---|---|
| 읽기·찾기 | `cat`(-n), `ls`(-l -a -h -R -d -t -S -r -F; 디렉터리를 가리키는 링크는 -l·-d가 아니면 안을 보여 줌), `stat`(-c), `readlink`(-f -e -m -n), `find`(-name -iname -type -size -mtime -mmin -newer -user -empty -maxdepth -print -ls -delete -exec), `du`(-s -h -a -c -d --max-depth), `which`, `env`, `wc`(-l -w -c), `head`·`tail`(-n -c -N, `-f`는 안 됨) |
| 글 다루기 | `grep`·`egrep`·`fgrep`(-i -v -c -n -E -F -r -l -L -w -x -o -h -H -q -s -m -A -B -C, -e 여러 번, -f 파일, --include·--exclude), `awk`(-F -v -f, `$N` `NF` `NR`, 패턴, `BEGIN`·`END`, `printf`, 배열, `if`·`for`·`while`, 내장 함수), `sed`(`s///[g\|p\|N]`과 바꿀 글의 `\U \L \u \l \E`, `d` `p` `q` `y` `a` `i` `c` `=` `h` `H` `g` `G` `x`, 주소·범위·`!`, -n -e(여러 번, `-ne`·`-e1d` 꼴도) -f -E -r -s -z -i[접미사]), `sort`(-n -r -u -f -h -b -V -s -c -o -t, -k는 여러 개와 `F,F` 범위와 키별 `nrfhbV`, 긴 옵션 몇 개), `uniq`(-c -d -u -i), `cut`(-d -f -c), `tr`(-d -s -c, 문자 클래스), `xargs`(-n -I -r), `tee`(-a), `echo`, `printf`, `test`·`[` |
| 시스템 | `ps`(aux, -ef, -eo, -p -C -u, --sort), `top`(-b -n -o -p), `free`(-m -g -h), `df`(-h -T -i), `uptime`, `date`(+FORMAT -d -u), `hostname`, `uname`, `mount`, `lsblk`, `lsof`(-i -p 파일), `kill`·`pkill`·`pgrep`·`pidof`·`nice`, `dmesg`(-T -l), `journalctl`, `systemctl`, `timedatectl`, `chronyc`(tracking sources), `openssl x509`(-dates -enddate -checkend -subject -in), `logrotate`(-f -d) |
| 네트워크 | `ping`, `curl`(-I -s -S -o -w -f), `dig`(+short @서버), `nslookup`, `ss`·`netstat`(-tulnpa -r), `ip`(a r l) |
| 쓰기 | `rm`(-r -f -v), `truncate -s 0`, `touch`, `cp`, `mv`, `mkdir`(-p -v), `ln -s`(-f -v), `tee`, `>` `>>`, `sed -i`, `kill`, `systemctl start·stop·restart·enable·disable`, `logrotate -f`, `mount -o remount,rw`, `reboot` |
| 다른 층 | `pg_isready`, `psql -c`, `multipath -ll`(데이터베이스 호스트, [데이터베이스 층](db-storage-layers.md)). `kubectl get nodes\|pods\|deployments [-n <ns>]`, `kubectl describe node <이름>`, `crictl ps`(쿠버네티스 노드인 호스트, 컨테이너 층이 `registerShellCommand`로 달고 노드가 아닌 호스트에서는 `command not found`, [컨테이너 층](container-layer.md)). `systemctl restart kubelet\|containerd\|calico-node`는 위 `systemctl`이 하고, 노드의 디스크 압박과 CNI 고장 같은 그 층의 상태도 함께 풀린다([SDN 층](sdn-network-layer.md)) |

쓰는 명령은 월드 명령 `host.act`가 되어 사건으로 남는다(다시 시작, 멈춤·시작, 켜기·끄기, 신호, 지우기, 쓰기, 비우기, 디렉터리 만들기 `mkdir`, 링크 만들기 `symlink`, 로그 돌리기, 다시 마운트, 재부팅). 만든 디렉터리와 링크는 호스트 상태의 `files`에 `dir`·`link` 항목으로 남고, 되감기·빨리 감기·기록 재생이 같은 트리를 다시 만든다. 사건 기록과 복구 우선 채점이 예전 툴 조치와 같이 읽는다. 파이프 속(`find … \| xargs rm`, `find -exec rm`, `sudo …`)에 숨은 쓰기도 조치로 센다(`callEffect`).

### 고장 열 가지가 보이는 길

흔한 명령만으로 원인에 닿는 길이 있다. 변별력 점검(`session/shell-reach.ts`)이 이 목록을 순서대로 쳐서 확인한다: `journalctl -p warning`, `systemctl list-units --failed`, `ps aux --sort=-%mem`, `df -h`, `free -m`, `mount`, `cat /etc/resolv.conf`, `date`, `timedatectl`, `cat /var/log/messages`, `journalctl -b -1`, `ps … grep defunct`, `ls -lS /var/log`.

| 고장 | 파일과 프로세스에 남는 것 | 진단 길 |
|---|---|---|
| 디스크 꽉 참 | `/var/log/<서비스>/`에 날짜별 큰 로그 넷, `logrotate.d/<서비스>`의 로테이션이 꺼져 있음 | `df -h` 100% → `du`·`find /var/log -size +1G` → `cat /etc/logrotate.d/…` |
| 로그 폭주 | 서비스 로그 하나가 자람, 저널에 같은 에러가 5초마다 | `ls -lS` 두 번 비교, `journalctl -u` |
| 메모리 누수 | 그 프로세스의 RSS가 자람, 저널에 `heap usage n%` | `ps aux --sort=-rss`, `free -m`, `journalctl -p warning` |
| 재시작 반복 | PID가 바뀜, `NRestarts` 증가, 설정 14번째 줄이 깨짐 | `systemctl status`(activating (auto-restart)), `journalctl -u`, `sed -n 14p /etc/….conf` |
| 좀비 누적 | 서비스 프로세스 밑에 Z 줄이 늘고 좀비는 `kill`이 안 먹음 | `ps aux \| grep -c defunct`, `ps -eo ppid,stat` |
| 읽기 전용 | `mount`가 `ro`, 쓰기가 `Read-only file system`, 커널 줄 | `mount`, `journalctl -k` |
| 시간 어긋남 | `date`가 앞섬(RTC는 그대로), `System clock synchronized: no` | `timedatectl`, `chronyc tracking`, `journalctl -u chronyd` |
| DNS 실패 | `resolv.conf`가 죽은 리졸버(`10.20.99.53`)를 가리킴, `dig`가 시간 초과 | `cat /etc/resolv.conf`, `dig`, `dig @10.20.0.54`(좋은 리졸버는 답함) |
| 커널 패닉 | 로그인이 안 되다가(`ssh` 시간 초과) 부팅하면 업타임이 짧고 지난 부팅 저널에 패닉 | `uptime`, `journalctl -b -1 -p err` |
| 인증서 만료 | `.pem` 머리의 notAfter가 지금보다 앞, 앱이 `certificate has expired` | `openssl x509 -noout -dates -in …`, `-checkend 0` |

### "흉내 밖 명령" 세기 (ADR-0117 결정 6)

호출마다 흉내가 못 한 것을 `outside`에 적는다. 모르는 명령은 이름, 안 되는 옵션과 기능은 `명령 옵션`(`tail -f`, `셸 문법 $`, `psql 질의 …`)이다. 실행 결과는 `shellOutside`(`commands`, `count`, `items`)를 가지고, 결과 화면의 "흉내 밖 명령" 블록이 "흉내 밖 명령 n번 (목록)"을 점수와 따로 보여 준다. `run_command`를 한 번도 안 쓴 실행은 이 줄이 없다. 이 목록이 흉내를 어디부터 더 메울지의 근거다.

### 정직한 한계

- 커널이 아니다. 임의 프로그램 실행, 컴파일, 패키지 설치, `vim` 같은 대화형 프로그램, 네트워크 밖 접속은 안 된다.
- 쓰기는 파일을 **고정된 내용**으로 바꾼다. 로그를 `>`로 비우면 그 파일은 비어 있는 채로 남고 그 뒤의 새 줄은 그 파일에 안 들어간다(저널에는 계속 쌓인다).
- 묵은 로그는 날짜별 네 파일로 나뉜다(디스크 꽉 참뿐 아니라 쿠버네티스 노드의 디스크 압박도 노드 VM에 같은 큰 로그를 남긴다). 지우면 그 파일 몫만큼 디스크가 비고, 90% 밑으로 내려오면 디스크 꽉 참이 풀린다. 열린 파일을 지워도 공간이 안 돌아오는 일(삭제된 파일을 쥔 프로세스)은 흉내 내지 않는다.
- 지난 줄의 PID는 지금 PID로 찍힌다(재시작 반복의 에러 줄만 그때의 PID).
- 저널은 마지막 6시간(`--since`로 24시간까지)만 만든다. 그 앞은 없다.

### 흉내 내지 않는 것 (REQ-098)

없는 명령은 진짜 최소 호스트처럼 `bash: xyz: command not found`(127)이고 "흉내 밖"으로 센다. 있는 명령의 안 되는 옵션은 `명령 옵션: 이 흉내에서는 안 돼요`(2)이고 역시 센다. 틀린 글을 찍느니 거절한다.

- 없는 명령: `chmod`, `chown`, `chgrp`, `mknod`, `mkfifo`, `install`, `rmdir`, `dd`, `tar`, `gzip`, `vi`·`vim`·`nano`. 권한과 소유자는 만들지 않는다(디렉터리는 `drwxr-xr-x root`, 링크는 `lrwxrwxrwx root`).
- `ln`은 심볼릭 링크(`-s`)만 만든다. 하드 링크(`ln a b`)는 거절한다: 트리를 서술하는 쪽에는 같이 쓰는 inode가 없다. `mkdir -m`도 거절한다.
- 링크는 링크 위치로 읽고 쓰고(`cat`, `>`, `touch`, `ls`, `cd`, `readlink -f`), `find`·`du`·`rm`은 링크 자체를 다룬다(따라가지 않는다). 링크 고리는 "없는 곳"이다(`Too many levels of symbolic links` 대신 `No such file or directory`).
- `find /`와 `du /`는 트리 전체를 돈다. 출력은 다른 명령처럼 `run_command`가 400줄에서 자른다.

**`grep`·`sed`·`awk`·`sort`가 GNU와 다른 곳** (고친 것은 빼고 남은 것만):

| 명령 | 다른 점 |
|---|---|
| 넷 모두 | 정규식은 자바스크립트 엔진이 POSIX 문법에서 옮겨 돈다: 갈래(`a\|ab`)는 가장 긴 것이 아니라 먼저 맞는 것을 고른다. `LANG=en_US.UTF-8`이라도 글자 순서는 바이트 순서(C 로캘)다: `sort`는 대문자가 소문자보다 앞서고 구두점을 무시하지 않는다. |
| `grep` | `--color=always`, `-z`는 거절. `-w`는 자바스크립트 `\b`로 단어 경계를 본다(패턴이 `-`·`.`로 시작하면 GNU와 다를 수 있다). 파일 사이의 `--` 구분선은 없다. `--exclude-dir`, `-b`, `-T`, `-U`는 거절. `-P`는 확장 정규식처럼 옮긴다. |
| `sed` | 명령 `n N D P b t T l r w e z F`, `first~step`·`addr,+N`·`addr,~N` 주소, `0,/re/`, 빈 정규식(`s//x/`, 직전 정규식 다시 쓰기), `s///w`·`e`·`m` 표시는 없다(없는 명령은 문법 오류 `unknown command`). 오류 문구의 `char 0`은 위치가 아니라 자리 채움이다. `-i`의 접미사에 `*`·`/`가 있으면 거절. `--version`, `-u`, `-l`, `--posix`는 거절. |
| `awk` | `getline`, `print > 파일`·`print \| 명령`·`system()`, 사용자 함수(`function`), `CONVFMT`·`OFMT`(거절; 숫자는 늘 `%.6g`), gawk 전용 함수(`gensub`, `strftime`, `systime`, `asort`…)는 없다(거절하거나 `function … never defined`). `RS`는 줄바꿈, 한 글자, 빈 문자열(문단), 정규식이 되지만 `RT`는 없고, 문단 모드에서 줄바꿈을 칸 구분자로 더하는 일도 없다. `--version`은 거절. 변수 인자(`name=값`)는 첫 파일을 읽기 전에 한꺼번에 정해진다(파일 사이에서 바뀌지 않는다). |
| `sort` | `-M -d -g -R -m -z`는 거절. `-k F.C`(칸 안의 글자 위치)는 거절. 칸은 공백 덩어리로 나뉘고 키는 앞 공백을 뺀 칸에서 시작한다(`-b`를 준 것과 같다). 긴 옵션은 `--reverse --unique --numeric-sort --ignore-case --human-numeric-sort --version-sort --stable --check --key --field-separator --output`만 된다. |

## 서비스 툴

| 툴 | 하는 일 | 현실 수준 |
|---|---|---|
| `list_services` | 서비스와 상태, 도는 곳, 밀린 일 | 흔함 |
| `service_status` | 한 서비스의 도는 곳별 상태·이유, 대기 쪽, 경로, 피해(추정), 지금까지 본 피해 | 흔함 |
| `failover_service` | 도는 곳을 대기 쪽과 바꾼다(옛 곳은 대기가 됨). 대기가 없으면 거절 | 흔함 |
| `migrate_vm` | VM을 다른 서버로 옮긴다(켜진 서버로만) | 흔함 |
| `restart_service` | 서비스가 도는 모든 곳에서 프로세스를 다시 시작한다(15초쯤 멈춤) | 흔함 |
| `run_command` | 위의 가짜 셸. **기본 툴 묶음에 들어 있다**(OS 고장이 호스트 안에서 풀리기 때문, [제어 가능 요소표](controllability.md)) | 흔함 |

툴 설명은 [ADR-0087](adr/0087-tool-scope-escalation-sop.md) 표준(언제 쓰나·언제 안 쓰나·입력 예·읽기/쓰기·비용)을 따르고 현실 수준 꼬리표(`common`·`rare`·`ideal`)가 모든 툴에 있다. 소스는 `tools/docs.ts` 한 곳이다.

## 서비스 생성 (`sources/worldgen/services.ts`)

생성기가 건물의 쓰임에 맞춰 서비스를 깐다. 서비스는 건물의 VM(없으면 서버) 위에서 돌고, 대기 쪽은 **다른 랙**이고 그중 같은 전원 공급(분전반·UPS)을 가장 적게 나눠 쓰는 서버다.

| 사업장 | 서비스 | 종류 | 시간당 피해 기본값(추정) |
|---|---|---|---|
| HPC센터 | 설계 검증 큐 | 배치 | 4시간 지연, 시간당 400건 쌓임 |
| | EDA 라이선스 서버 | 상태 유지 | 5,000만 원 |
| | 스토리지 게이트웨이 | 상태 유지(스토리지 위에도) | 2,000만 원 |
| 팹 서버룸 | MES 연동 | 요청 처리 | 1억 5,000만 원 |
| | 설비 로그 수집 | 배치 | 2시간 지연, 시간당 2만 건 |
| 작은 사업장 | 사내 포털 | 요청 처리 | 200만 원 |
| | 로그 수집 | 배치 | 1시간 지연, 시간당 3,000건 |

랙에 서버가 없는 건물(묶음 랙뿐)은 서비스가 없다. 빌더에서는 서버·VM·스토리지를 고르면 "떠받치는 서비스 n개"가 한 줄로 보이고 서비스를 더하거나 종류와 피해를 고칠 수 있다.

## 토폴로지와 영향 범위

네트워크·가상화 층의 맨 앞(왼쪽) 단계가 **서비스**이고, 서비스는 자기가 도는 VM·서버에 기댄다. 영향 범위 상자의 첫 줄이 서비스 집계다: "서비스 3개 멈춤 · 설계 검증 큐 1,200건 대기"(멈춤, 느려짐, 밀린 일 상위 둘). [토폴로지 보기](topology.md)를 본다.

## 시나리오 템플릿 "OS 고장" 다섯 (`scenario/library-os.ts`)

| 템플릿 | 일어나는 일 | 풀리는 길 | 어려움 |
|---|---|---|---|
| 디스크가 꽉 찼어요 | 요청 처리 서비스가 느려지고 쓰기 오류 | 로그 지우기 | 쉬움 |
| 메모리가 계속 새요 | 서비스가 느려지다 죽고 다시 뜸 | 다시 시작은 잠깐, 대기 쪽으로 옮겨야 오래 감 | 보통 |
| 프로세스가 죽고 또 죽어요 | 서비스 멈춤, 다시 시작해도 같음 | 대기 쪽으로 옮김 | 보통 |
| 파일시스템이 읽기 전용이 됐어요 | 쓰는 서비스 멈춤 | 다시 마운트 | 보통 |
| 시계가 어긋나 인증이 실패해요 | 인증 실패로 서비스 멈춤 | 시간 동기 데몬 다시 시작 | 어려움 |

채점(REQ-088, [ADR-0104](adr/0104-recovery-scoring-amend-tests.md)): 이 다섯 템플릿은 **복구 우선**으로 센다(시나리오 문서의 `scoring: "recovery"`). **서비스 복구 시간 35, 복구 순서 15, 복구 중 악화 없음 20, 진단·보고 30**이고, 호스트 재부팅은 −15점이다. 규칙과 계산은 [측정의 신뢰](measurement.md#3-서비스가-있는-시나리오는-복구-우선으로-채점한다-req-088-adr-0091-adr-0104)에 있다. 채점표에는 진단, 재부팅 금지, "끝에 서비스가 정상이다"(메모리 누수는 여기에 "대기 쪽으로 옮겼다"가 더해진다)만 남는다. 끝에 정상이 아니거나 누수를 다시 시작만 한 복구는 오래 가지 않는 것이라 시간과 순서 점수를 반만 받는다. 시간 제한과 툴 호출 상한은 채점표가 아니라 에이전트 투입 블록이 정한다. 기준 에이전트 아홉으로 재면(다섯 템플릿 모두, 화성 샘플 홀과 캠퍼스 표본에서 같다, `tests/spec/recovery-scoring.test.ts`):

| 에이전트 | 점수 | 이유 |
|---|---|---|
| 아무것도 안 함 | 0 | 조치도 진단도 없다 |
| 찍기 | 0 | 없는 장비, 맞지 않는 종류 |
| 정답만 앎, 진단 후 기다리기 | 30 | 진단·보고뿐이다. 합격선(60) 아래 |
| 맞게 고치고 보고 | 100 | |
| 복구 먼저(서비스를 옮김), 원인은 나중 | 100 | 복구 순서가 만점이다 |
| 원인 먼저 살펴보고 10분 뒤 복구 | 69.4 | 복구 시간 일부, 복구 순서 0 |
| 서비스 다시 시작만 하고 보고 | 30 (누수 35) | 고치는 것이 없다. 누수는 잠깐 돌아와 반을 받는다 |
| 호스트를 재부팅하고 보고(디스크·메모리·프로세스·시계) | 15~20 | 재부팅 −15, 복구 못 함 |
| 재부팅으로 읽기 전용을 풀고 보고 | 85 | 복구는 했지만 −15 |

순서는 설계대로 복구 먼저(100) > 원인 먼저(69.4) > 재시작만(30~35)이다. 변별력 점검은 템플릿마다 장비를 못 고쳐도 서비스를 대기 쪽으로 옮겨 살리는 길이 있는지 확인한다. 이 다섯은 대기 쪽이 있는 서비스를 먼저 골라서 어느 세계에서나 길이 있다.

설계 메모: 이 층의 고장은 **장비를 못 고쳐도 서비스는 옮길 수 있게** 했다(프로세스 재시작 반복과 메모리 누수는 대기 쪽으로 옮기는 길이 있다).

## 시험

- `packages/core/src/physics/service-os.test.ts`: 건강 규칙(종류별), 고장 열 가지의 번짐과 풀리는 길, 알람, 대기 쪽 옮기기.
- `tests/spec/service-tools.test.ts`: 툴 설명 표준과 현실 수준 꼬리표, 서비스 툴, 가짜 셸 출력과 `command not found`.
- `tests/spec/deep-os-shell.test.ts`: 셸 문법, `grep`·`awk`·`sed` 같은 텍스트 명령, 쓰기가 사건이 되는 것, 파일과 프로세스가 서로 맞는 것 (REQ-098).
- `tests/spec/deep-os-faults.test.ts`: 고장 열 가지가 흔한 명령으로 보이고 풀리는 길 (REQ-098).
- `tests/spec/deep-os-determinism.test.ts`: 같은 명령 열은 같은 글자, 빨리 감기와 1초씩이 같은 로그 (REQ-098).
- `tests/spec/deep-os-outside.test.ts`: "흉내 밖 명령" 세기와 "흔한 명령만으로 원인에 닿는가" 점검 (REQ-098).
- `tests/spec/os-scenarios.test.ts`: 템플릿 다섯의 변별력(기준 에이전트), 맞게 고친 점수, 재부팅 감점.
- `tests/spec/recovery-scoring.test.ts`: 복구 우선 채점의 순서(기준 에이전트 아홉), 사고 비용, 복구하는 길, 흔한 툴로 닿는 길 (REQ-088).
- `apps/web/src/logic/builder/service-edit.test.ts`: 빌더의 "떠받치는 서비스" 줄과 서비스 더하기.
- `packages/core/src/topology/service-layer.test.ts`: 서비스 단계와 영향 범위 첫 줄.
