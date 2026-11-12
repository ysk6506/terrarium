# 다른 프로젝트로 옮긴 설계

테라리움은 처음의 제품 목표까지만 한다([ADR-0192](../../design-docs/adr/0192-terrarium-returns-to-its-first-goal.md)). 이 폴더의 문서는 테라리움이 만들지 않기로 한 것의 설계다. 더 고치지 않고, 검사도 받지 않는다. 새 프로젝트가 시작될 때 가져간다.

| 문서 | 무엇의 설계였나 |
|---|---|
| reality-data-and-ontology.md | 현실 시스템에서 데이터를 받아 모델에 대응시키는 일 |
| source-management.md | 소스의 동기화 주기, 실행 기록, 안전장치 |
| reality-shape-samples.md | 소스 여덟 가지의 생김새를 설계에 넣어 본 결과 |
| pipeline-versions-and-branches.md | 파이프라인의 버전과 브랜치 |
| glossary-data.md | 데이터 파이프라인, 온톨로지 매니저, 워크플로 자동화의 말 |
| workflow-automation.md | 검증한 워크플로만 운영에 내보내는 일 |

문서 안의 링크와 요구사항 번호는 옮기기 전 그대로라 지금은 맞지 않는 것이 있다. 이 설계가 풀지 못한 것 하나를 적어 둔다: 실험장은 시나리오로 평가하고 운영의 일은 프로세스로 돈다. 워크플로를 흐름도로 그리면 둘이 맞물리지 않는다.
