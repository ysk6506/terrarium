# DMTF Redfish 스키마 묶음

`dmtf-schemas.json.gz`는 테라리움의 Redfish 응답을 DMTF의 공개 JSON 스키마와 대조하는 시험(`tests/spec/redfish-conformance.test.ts`)이 쓰는 스키마 모음이다(REQ-002, REQ-060, ADR-0057).

- 출처: DMTF/Redfish-Publications (BSD-3-Clause, 저작권 고지는 `LICENSE-DMTF.md`). 묶음 안의 `source`와 `commit`에 어느 시점인지 적혀 있다.
- 내용: 파사드가 내는 리소스 종류마다 가장 새로운 버전 파일과, 열거값을 위한 버전 없는 파일. 지금 83개 파일, 압축 약 116 KiB.
- 검사기: `validator.ts` (Ajv). 리소스의 `@odata.type`으로 스키마를 고르고, 스키마 묶음에 없는 종류는 건너뛰지 않고 오류로 알린다.

## 새 리소스 종류를 낼 때

1. 공개 저장소를 받아 둔다(`git clone --depth 1 --filter=blob:none --sparse https://github.com/DMTF/Redfish-Publications` 후 `json-schema` 폴더).
2. `python3 tests/spec/redfish-schemas/build-bundle.py <받은 곳> <이름 또는 이름.v1_2_3>...` 로 묶음에 더한다. 정확한 버전이 필요하면 `Name.vX_Y_Z`로 적고, 가장 새 버전으로 올리려면 `--upgrade`.
3. `pnpm vitest run tests/spec/redfish-conformance.test.ts`로 확인한다.

## 한계

검사는 리소스마다 묶음에 든 **한 버전**과 대조한다. 같은 마이너 버전의 오류 정정판은 같은 것으로 본다. 다른 버전을 가리키는 링크는 거부하고, 묶음에 없는 리소스를 가리키는 링크는 통과시킨다(대상이 따로 검사되기 때문이다).
