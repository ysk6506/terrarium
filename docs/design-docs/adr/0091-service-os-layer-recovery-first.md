---
title: ADR-0091 세계에 서비스·OS 층을 올리고, 채점은 복구 우선이다
kind: decision
status: active
last_verified: 2026-11-05
enforced_by:
  - packages/core/src/physics/service-os.test.ts
  - tests/spec/service-tools.test.ts
  - tests/spec/os-scenarios.test.ts
  - packages/core/src/oracle/recovery.test.ts
  - tests/spec/recovery-scoring.test.ts
  - apps/web/src/logic/recovery.test.ts
touches_protected:
  - docs/product-specs/requirements.md
decision_hash: 005eacf940902a71
---
# ADR-0091 세계에 서비스·OS 층을 올리고, 채점은 복구 우선이다

## 맥락
세계는 장비·시설·가상화까지만 있어 "서비스가 몇 분 멈췄나"를 못 잰다. 원인은 맞혔는데 복구가 늦은 에이전트는 실전에 못 넣는다(연수 님). 현실 알람의 절반 이상은 OS(디스크·메모리·프로세스·로그·시간 동기·DNS)에서 난다.

## 결정
1. **서비스 층.** 서비스 = 이름 + 무엇 위에서 도는지(VM·서버·스토리지·네트워크 경로) + 정상 조건. 건강은 아래 장비에서 계산된다(따로 시뮬레이션하지 않음). 생성기가 사업장에 맞는 서비스를 깐다(HPC센터: 설계 검증 큐·EDA 라이선스·스토리지 게이트웨이; 팹: MES 연동·설비 로그 수집). 서비스마다 멈추면 시간당 피해(원) 또는 지연(시간). 토폴로지 맨 위층. 영향 범위는 "서비스 3개 멈춤 · 설계 검증 큐 1,200건 대기"로 말한다. 툴: `list_services`, `service_status`, `failover_service`, `migrate_vm`, `restart_service`.
2. **OS 층 1차.** 서버·VM마다 호스트 상태(CPU·메모리·디스크·프로세스·파일시스템·시간 동기·DNS·시스템 로그 — 상태에서 생성). 고장 10가지(디스크 꽉 참, 메모리 누수, 프로세스 죽음·재시작 반복, 파일시스템 읽기 전용, NTP 어긋남, DNS 실패, 커널 패닉, 좀비 누적, 인증서 만료, 로그 폭주). 툴은 가짜 셸 `run_command(host, cmd)` — 허용 명령 목록(top·df·free·ps·journalctl·systemctl·dmesg·ping·curl·date…)과 쓰기 명령(systemctl restart·파일 지우기·재부팅)은 세계를 바꾼다. 허용 밖은 "이 명령은 아직 못 해요". 컨테이너(kubectl)는 2차. 정직한 한계: 진짜 OS가 아니라 상태에서 출력을 흉내 낸다.
3. **복구 우선 채점.** 첫 축 서비스 복구 시간(MTTR), 둘째 복구 순서(원인 분석에 시간을 쓰느라 복구가 늦으면 감점, 복구 먼저 하고 원인은 나중이면 만점), 셋째 악화 금지(조치가 멈춘 서비스를 늘리면 큰 감점), 넷째 진단·보고. 사고 비용 = 복구 시간 × 시간당 피해. 템플릿마다 복구 가능한 길이 하나 이상 있어야 한다(장비를 못 고쳐도 서비스는 옮길 수 있게).
4. **흔함 툴만으로 원인에 닿는 길**이 있는지 변별력 점검에 더한다. 길이 없는 시나리오는 그렇다고 표시한다.

## 결과
REQ-086(서비스 층), REQ-087(OS 층), REQ-088(복구 우선 채점). 대시보드 첫 숫자가 "서비스 복구 시간 · 사람 없이 복구한 비율 · 복구 중 악화"로 바뀐다.
