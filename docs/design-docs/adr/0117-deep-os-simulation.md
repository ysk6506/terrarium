---
title: ADR-0117 흉내 OS를 깊게 — 작은 리눅스 흉내가 run_command에 답한다 (0116 대체)
kind: decision
status: active
supersedes: 0116-real-hosts-in-the-world.md
enforced_by:
  - tests/spec/deep-os-shell.test.ts
  - tests/spec/deep-os-faults.test.ts
  - tests/spec/deep-os-determinism.test.ts
  - tests/spec/deep-os-outside.test.ts
touches_protected:
  - docs/product-specs/requirements.md
decision_hash: 85cc3d71e0e2466c
amended_by:
  - adr: "0184"
    what: 흉내가 못 하는 것은 command not found나 안 돼요로만 답하고 센다
---
# ADR-0117 흉내 OS를 깊게 — 작은 리눅스 흉내가 run_command에 답한다

## 맥락
ADR-0116은 "진짜 VM 섞기"를 실제 리눅스 호스트를 붙이는 것으로 읽었다. 제품 책임자가 바로잡음(2026-11-06): **실제 VM이 아니라 흉내를 깊게** 하자는 뜻이다. 실제 호스트는 결정론·빨리 감기·리플레이·운영을 전부 깨고, 테라리움의 가치가 결정론이다. 지금 `run_command`는 허용 목록 명령만 상태에서 출력 한 줄을 만들어서, 에이전트가 목록 밖 명령(파이프·파일 읽기·`awk`)을 치면 "이 명령은 아직 못 해요"가 난다. 그 한계를 흉내 안에서 없앤다.

## 결정
1. **가상 파일시스템.** 호스트(서버·VM)마다 결정론으로 만들어지는 파일 트리: `/proc`(cpuinfo·meminfo·loadavg·uptime·pid별 status·cmdline), `/var/log`(서비스·시스템 로그가 **세계 사건으로 실제로 쌓임** — 알람·고장·툴 조치가 줄이 됨), `/etc`(hostname·hosts·resolv.conf·systemd 유닛·인증서·logrotate), `/tmp`, `/var/lib`(서비스 데이터 디렉터리). 고장이 파일을 만들거나 키운다(디스크 꽉 참 = 큰 파일, 로그 폭주 = 로그가 자람, 인증서 만료 = 만료일이 지난 인증서 파일). 파일 내용은 세계 시간·시드·상태의 함수라 리플레이와 같다.
2. **프로세스 표.** 호스트마다 PID·이름·상태(R/S/Z/D)·CPU·메모리·부모·시작 시각. 서비스·에이전트·배치·시스템 데몬이 프로세스다. 메모리 누수는 그 프로세스의 RSS가 자라고, 좀비 누적은 Z 상태가 늘고, 재시작 반복은 PID가 바뀐다.
3. **유닛과 저널.** `systemctl status|start|stop|restart|enable <unit>`, `journalctl -u <unit> [-n] [--since] [-p]`, `journalctl -k`. 저널은 `/var/log`와 같은 사건에서 만든다.
4. **셸.** 파이프 여러 단계, `>`·`>>`·`2>&1`, `&&`·`||`·`;`, 변수 없음(주석으로 거절), 명령: `cat ls du df free top ps ss netstat ip ping curl dig nslookup date uptime hostname mount lsblk lsof stat tail head grep egrep awk sed sort uniq wc cut tr xargs find which echo env kill pkill nice chronyc timedatectl pg_isready psql multipath kubectl crictl` (kubectl·crictl은 컨테이너 층, psql·multipath는 DB·스토리지 층과 같은 상태를 읽음). `grep/awk/sed`는 실제 의미대로 동작(작은 구현: 정규식, 필드, 치환). 모르는 명령은 리눅스처럼 `bash: xyz: command not found`(종료 코드 127). 쓰기 명령(`rm`·`systemctl restart`·`kill`·`logrotate`·`mount -o remount`·`reboot`)은 세계를 바꾸고 사건 기록에 남는다.
5. **결정론·시간·리플레이는 그대로.** 모든 출력이 가상 상태에서 나오므로 빨리 감기·시드 재현·기록 재생이 전과 같다. 실제 호스트는 붙이지 않는다.
6. **정직한 한계와 측정.** 커널이 아니다. 임의 프로그램 실행·컴파일·패키지 설치·네트워크 밖 접속은 안 되고 `command not found` 또는 "이 흉내에서는 안 돼요"로 답한다. 실행 결과에 **"흉내 밖 명령 n번(목록)"**을 적어, 흉내를 어디부터 더 메울지 보이게 한다(허용 목록 대신 "흉내 범위"가 늘어나는 근거).
7. **진단 길이 생긴다.** OS 고장 10개와 컨테이너·DB 고장은 "로그를 읽고 → 프로세스를 보고 → 파일을 확인"하는 길이 실제로 열린다. 변별력 점검에 "흔한 명령만으로 원인에 닿는가"(`journalctl`·`ps`·`df`·`cat`)를 더한다.

## 결과
- REQ-098의 뜻을 바꾼다: 진짜 호스트가 아니라 깊은 OS 흉내. ADR-0116 폐기. 구현 순서: 가상 FS + 프로세스 표 → 셸(파이프·텍스트 명령) → 유닛·저널 → 고장 10개를 파일·프로세스로 → `kubectl`·`psql` 연결 → 흉내 밖 명령 측정.
