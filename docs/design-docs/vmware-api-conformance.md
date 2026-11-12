---
title: vCenter와 Aria Operations 응답 — 참고서와 맞춘 것, 못 맞춘 것
kind: spec
status: active
covers:
  - packages/core/src/facades/vcenter.ts
  - packages/core/src/facades/vrops.ts
  - tests/spec/vmware-schemas/schemas.ts
---
# vCenter와 Aria Operations 응답 (REQ-061, ADR-0058)

## 한 줄로

에이전트가 시뮬레이터에서 읽은 응답 모양이 진짜 vCenter와 Aria Operations(vROps)에서도 그대로 통하도록, 제조사의 공개 API 참고서가 말하는 모양을 따른다.

## 어떻게 확인하나

참고서는 쪽(HTML)으로만 공개돼 있어서, 쪽을 읽고 **사람이 스키마로 옮겨 적었다**(`tests/spec/vmware-schemas/`, 어느 쪽인지는 그 폴더의 README). 시험이 응답마다 스키마와 대조한다.
빠진 필수 항목, 참고서에 없는 항목, 참고서에 없는 열거값은 모두 실패한다. 제품 버전(프로파일)마다 확인한다: vCenter 8.0과 7.0(옛 `/rest` 경로), vROps 8.10과 Aria Operations 8.18.

## 맞춘 응답

| 제품 | 응답 | 참고서의 모양 |
|---|---|---|
| vCenter | `GET /api/vcenter/vm` | VM 요약: `vm`, `name`, `power_state`, `cpu_count`, `memory_size_MiB` |
| vCenter | `GET /api/vcenter/vm/{vm}` | VM 상세: `guest_OS`, `hardware`, `boot`, `cpu`, `memory`, 장치 맵들까지 필수 항목 전부 |
| vCenter | `GET /api/vcenter/host`, `cluster`, `datastore` | 호스트·클러스터·데이터스토어 요약 |
| vCenter | `POST/GET /api/session` | 새 토큰(201, JSON 글자), 세션 정보(`user`, `created_time`, `last_accessed_time`) |
| vCenter | 오류 응답 (예: 없는 VM은 404) | `error_type`(`NOT_FOUND` 등)과 `messages[]`(`id`, `default_message`, `args`) |
| vROps | `GET /suite-api/api/resources` | 리소스: `creationTime`, `resourceHealth`, `resourceHealthValue`, `resourceKey`, `resourceStatusStates` |
| vROps | `GET /suite-api/api/resources/{id}` | 리소스 하나: 목록의 한 줄과 같은 모양 |
| vROps | `GET …/resources/{id}/stats/latest` | `values[].stat-list.stat[]` |
| vROps | `GET /suite-api/api/alerts` | 경보: `alertLevel`, `status`, `controlState`, … |
| vROps | `POST /suite-api/api/auth/token/acquire` | `token`, `validity`(만료 시각, 밀리초), `expiresAt`(글), `roles` |

## 달라진 점 (이전과 비교)

- VM 상세에서 참고서에 없는 `placement`를 없앴다. VM이 어느 호스트에 있는지는 현실처럼 VM 목록의 `hosts` 조건으로 찾는다.
- vROps 토큰은 기간이 아니라 **만료 시각**을 돌려준다(6시간 뒤).

## 한계

- 스키마는 사람이 옮긴 것이라 틀렸을 수 있다.
- 월드가 VM의 디스크·네트워크 카드를 갖고 있지 않아서 그 맵들은 비어 있다.
- 에러 본문의 `id`와 데이터스토어 용량은 진짜와 다르다(용량은 모두 같은 값).
- 7.0 호환 경로는 8.0.3 참고서의 VM 상세 모양으로 대조했다.
- 7.0 호환 경로(`/rest`)는 세션, VM 목록·상세, 호스트 목록만 있다. 클러스터와 데이터스토어는 `/api`에만 있다.
- VM 전원 동작(`POST /api/vcenter/vm/{vm}/power?action=start|stop|reset`)은 본문 없이 204로 답해서 스키마로 대조하지 않는다.
