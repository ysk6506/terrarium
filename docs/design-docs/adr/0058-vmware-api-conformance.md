---
title: ADR-0058 vCenter와 Aria Operations 응답은 제조사의 공개 API 참고서를 따르고, 참고서에서 옮긴 스키마로 대조한다
kind: decision
status: active
last_verified: 2026-11-04
enforced_by:
  - tests/spec/vmware-conformance.test.ts
  - tests/spec/facades.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - tests/spec/facades.test.ts::vCenter facade [REQ-003] [REQ-004] > lists VMs with filters and shows details with placement
test_change_reason: vCenter의 VM 상세 응답에서 공식 API 참고서에 없는 placement 항목을 없애고 필수 항목을 채웠다. 시험은 이름을 바꾸고, 호스트는 hosts 조건으로 찾는다는 것과 상세에 placement가 없다는 것을 확인하도록 바꿨다. VM 목록의 조건과 상세의 cpu 값을 확인하는 부분은 그대로다.
decision_hash: 428985489b155ba1
---
# ADR-0058 vCenter와 Aria Operations 응답은 공개 API 참고서를 따른다

## 맥락
요구는 "표준(공개 명세)이 있으면 그에 맞게 에뮬레이트"였다. Redfish는 DMTF가 JSON 스키마 파일을 공개해서 그대로 내려받아 기계가 대조한다(ADR-0057).
vCenter(vSphere Automation API)와 Aria Operations(vROps) API는 제조사 사이트(developer.broadcom.com)에 **HTML 쪽으로만** 올라와 있고, 내려받을 수 있는 OpenAPI 파일을 이 환경에서는 구하지 못했다.

## 결정
1. **참고서의 쪽을 읽고 스키마로 옮겨 적는다**(`tests/spec/vmware-schemas/schemas.ts`). 필드 이름, 필수/선택 표시, 열거값은 쪽이 말하는 대로 쓰고, 쪽이 말하지 않는 규칙은 만들지 않는다.
   어느 쪽에서 가져왔는지는 `tests/spec/vmware-schemas/README.md`에 적는다. 이 스키마로 모든 응답을 Ajv로 대조하고, 대조가 실제로 틀린 것을 잡는지도 시험한다(`tests/spec/vmware-conformance.test.ts`).
2. **어긋난 곳을 고쳤다.** 대조해서 찾은 것:
   - vCenter `GET /api/vcenter/vm/{vm}`: 참고서의 필수 항목(`hardware`, `boot`, `boot_devices`, `disks`, `nics`, `cdroms`, `floppies`, `parallel_ports`, `serial_ports`, `sata_adapters`, `scsi_adapters`)이 없었고,
     참고서에 없는 `placement`가 있었다. 필수 항목을 채우고 `placement`를 없앴다. VM이 어느 호스트에 있는지는 현실처럼 VM 목록의 `hosts` 조건으로 찾는다.
   - vCenter `GET /api/session`: 필수인 `last_accessed_time`이 없었다.
   - vROps 리소스: 필수인 `creationTime`, `resourceHealthValue`가 없었고, `identifierType`에 `dataType`, `isPartOfUniqueness`가 없었다.
   - vROps 토큰: 참고서에서 `validity`는 만료 시각(에포크 밀리초), `expiresAt`은 "Friday, August 5, 2016 6:22:05 PM UTC" 같은 글이고 `roles` 목록이 있다. 우리는 기간과 "never"를 돌려주고 있었다. 6시간 뒤로 맞췄다.
   - vROps 경보: `controlState`를 더했다(`OPEN`).
3. **요구사항 REQ-061**을 더한다.

## 버린 대안
- **쪽을 못 읽는 것은 만들지 않고 두기**: 어긋남이 있는지도 모른 채 "비슷하다"로 끝난다. 읽을 수 있는 만큼 읽어서 대조하는 편이 낫다.
- **`placement`를 남기기**: 에이전트가 시뮬레이터에서 `placement.host`를 쓰는 법을 익히면 진짜 vCenter에서는 그 필드가 없어 틀린다. 시뮬레이터가 현실보다 친절하면 평가가 부풀려진다.

## 한계 (솔직하게)
- 스키마는 **사람이 쪽을 읽고 옮긴 것**이다. 옮기다 틀렸거나, 쪽이 말하지 않은 규칙(중첩 항목의 필수 여부 등)은 비워 두었다. 제조사가 내려받는 OpenAPI 파일을 공개하면 그걸로 바꿔야 한다.
- 대조하는 것은 vCenter 8.0.3 참고서와 Aria Operations(VCF Operations) 참고서의 쪽들이다. 7.0 호환 경로(`/rest/…`)는 같은 VM 상세 모양으로 대조했을 뿐 7.0 참고서와 맞춰 보지는 않았다.
- 월드는 VM의 디스크, 네트워크 카드, 장치를 갖고 있지 않아서 그 항목들은 비어 있다(진짜 VM은 항상 몇 개 가진다).
- 에러 본문(`error_type`, `messages`)의 `id`는 진짜 vCenter의 메시지 번호(`com.vmware.api.…`)와 다르다.
- 데이터스토어 용량은 모든 데이터스토어가 같은 고정값이다.
