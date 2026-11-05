---
title: ADR-0096 파워 캐핑 — 전기요금을 아끼면서 서비스를 지키는 줄다리기를 잰다
kind: decision
status: active
last_verified: 2026-11-05
enforced_by:
  - none
no_enforcement_reason: 구현 전 결정 기록이다. 구현 작업이 끝나면 frontmatter의 enforced_by를 그 작업의 시험으로 바꾼다.
touches_protected:
  - docs/product-specs/requirements.md
decision_hash: 022f0832de0cd50f
---
# ADR-0096 파워 캐핑 — 전기요금을 아끼면서 서비스를 지키는 줄다리기를 잰다

## 맥락
서버·랙 단위 파워 캐핑으로 지출을 줄이는 일을 하는 사람들이 있다(연수 님). "비용 vs 서비스"의 줄다리기라 에이전트에게 맡기기 좋은 운영 작업이고, 돈이 의미를 갖는 두 번째 자리(전기요금)다.

## 결정
1. Redfish 파사드에 표준 전력 제한(`PowerControl/PowerLimit/LimitInWatts`)을 살리고 `set_power_cap`(서버·랙·PDU)을 툴로 연다.
2. 물리: 캡 → CPU 스로틀 → 발열 감소 → 서비스 처리량·지연 악화(ADR-0091의 서비스 층 필요).
3. 사업장에 전기요금 모델(계약전력·피크 요금·시간대 단가). 대시보드에 "에이전트가 아낀 전기요금".
4. 시나리오 3종: 피크 시간대 전력 8% 줄이되 지연 2배 이내, UPS 배터리로 버티는 동안 캡핑으로 시간 벌기, 냉방기 고장 때 캡핑으로 과열 막기. 채점은 절감액 − SLO 위반 피해.
5. 박사의 캡핑 모델(캡 → 성능·발열 곡선)은 모델 플러그인(ADR-0095)의 첫 손님.

## 결과
REQ-092.
