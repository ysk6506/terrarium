---
title: ADR-0025 저장소는 Node 내장 SQLite 파일 하나
kind: decision
status: active
last_verified: 2026-10-29
enforced_by:
  - tests/spec/store.test.ts
touches_protected: []
decision_hash: 5bc44729fd8092bb
---
# ADR-0025 저장소는 Node 내장 SQLite

## 맥락
세계·시나리오(버전 포함)·실험·실행·공유 링크를 서버가 다시 시작해도 잃지 않아야 한다(REQ-030, REQ-040). 서버는 사내 장비 한 대
(8 vCPU / 64 GB)에서 돈다. 따로 운영할 DB 서버를 늘리는 것은 사내 도입의 걸림돌이다.

## 결정
- Node 22에 들어 있는 `node:sqlite`(`DatabaseSync`)를 쓴다. 파일 하나(`<dataDir>/terrarium.db`), WAL 모드.
- 레코드는 JSON 문서로 넣고, 옆 열에는 목록이 거르고 정렬하는 값(소유자, 벤치마크 키, 부모, 상태, 시각)만 둔다.
- 세계와 시나리오의 버전은 digest별로 영원히 남긴다. 실험이 그 버전을 가리키기 때문이다. "삭제"는 목록에서 숨기기다.
- 스키마 버전은 `PRAGMA user_version`. 더 새 버전의 파일을 만나면 열지 않고 "서버를 업데이트한다"고 알린다.
- 저장소는 `ExperimentStore` 포트 뒤에 있다. 메모리 구현과 SQLite 구현이 **같은 테스트 묶음**(`tests/spec/store.test.ts`)을 통과해야 한다.

## 이유
- 설치할 것이 없다(네이티브 빌드도, 별도 프로세스도). 백업은 파일 복사다.
- 동기 API지만 쓰기가 작고 드물다(실행 상태 변경, 결과 저장). 무거운 일(시뮬레이션)은 워커 스레드에서 한다(ADR-0027).
- JSON 문서 저장은 core 타입이 바뀌어도 마이그레이션이 거의 없다.

## 버린 대안
- **PostgreSQL**: 강력하지만 운영할 서버가 하나 늘어난다. 지금 규모(실험 수천, 실행 수만)에 필요 없다. 포트 뒤에 있으므로 나중에 바꿀 수 있다.
- **better-sqlite3**: 네이티브 빌드가 필요하고, 사내망에서 바이너리 받기가 막힐 수 있다.
- **JSON 파일들**: 동시 쓰기와 부분 실패에 약하다.

## 결과
- `node:sqlite`는 Node 22에서 "실험적" 경고를 한 번 출력한다. 기능은 안정적으로 쓰고, Node 24에서 경고가 사라진다.
