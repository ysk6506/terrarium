# vCenter와 Aria Operations 응답 스키마

`schemas.ts`는 `tests/spec/vmware-conformance.test.ts`가 vCenter와 Aria Operations(vROps) 파사드의 응답을 대조하는 스키마 모음이다(REQ-003, REQ-061, ADR-0058).

제조사가 내려받는 OpenAPI 파일을 공개하지 않아서(쪽으로만 올라와 있다), **참고서의 쪽을 읽고 사람이 옮겨 적었다.** 필드 이름, 필수/선택, 열거값은 쪽의 것이고, 쪽이 말하지 않은 규칙은 쓰지 않았다. 확인한 날은 2026-11-04다.

## 옮겨 적은 쪽

vSphere Automation API 8.0.3 (developer.broadcom.com/xapis/vsphere-automation-api/8.0.3):

- `vcenter/data-structures/VM_Summary`, `VM_Info`, `Host_Summary`, `Cluster_Summary`, `Datastore_Summary`
- `cis/api/session/post` (201, 새 세션 토큰이 JSON 글자로 온다), `data-structures/Cis Session Info` (`user`, `created_time`, `last_accessed_time`)

VCF Operations API (developer.broadcom.com/xapis/vcf-operations-api):

- `data-structures/resource`, `resources`, `alert`, `alerts`, `stat-list`
- 토큰 받기 (docs.vmware.com, Aria Operations 8.14 API Programming Operations: `token`, `validity`, `expiresAt`, `roles`, `Authorization: OpsToken …`)

## 읽는 법과 한계

- 항목이 전부 나열된 구조(VM 요약, 호스트 요약 등)는 `additionalProperties: false`로 **모르는 항목이 있으면 실패**한다.
- 쪽이 "필수"라고 표시한 항목은 `required`다. 중첩 항목(예: `cpu`, `memory`의 하위 항목)의 필수 여부는 쪽이 말하지 않아서 최소만 요구한다.
- VM 상세의 `disks`, `nics` 같은 항목은 장치 ID를 열쇠로 하는 맵이다(쪽의 예시는 열쇠 이름을 한 번 더 보여 준다).
- 사람이 옮긴 것이라 틀렸을 수 있다. 쪽이 바뀌면 이 파일도 고쳐야 한다.
