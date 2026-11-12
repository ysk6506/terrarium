# 실험: 셸 언어를 WebAssembly로 (머지하지 않음)

시뮬레이션 머신의 셸을 손으로 쓴 TypeScript 대신 `mvdan/sh`(셸 해석기)와 `goawk`(awk)로 바꿔 보는 실험이에요.
세계를 읽고 바꾸는 명령(`ip`, `systemctl`, `kubectl`, `grep`, `sed` …)은 그대로 TypeScript이고,
셸이 실행 훅으로 그 명령에 되돌려 보내요. 코드는 버릴 거예요.

## 구성

| 경로 | 하는 일 |
|---|---|
| `go/` | 모듈 소스. `main.go`(셸 + 훅), `awk.go`(goawk), `hostio.go`(호스트와의 유일한 통로) |
| `patches/goawk-shell-hook.patch` | goawk의 `system()`·`cmd \| getline`·`print \| cmd`를 모듈 안의 셸로 돌리는 패치(os/exec는 WASI에 없어요) |
| `scripts/build.sh` | 태그로 고정한 소스를 GitHub에서 받아 `bin/terrarium-sh.wasm`을 만들어요 |
| `host/engine.ts`, `host/worker.mjs` | 워커 스레드 + `SharedArrayBuffer` + `Atomics.wait`로 동기 호출, 시간 한도로 `terminate()` |
| `host/shell.ts` | 파일·명령을 기존 `VirtualFs`와 `Run.exec`에 이어 줘요 |
| `bench/` | 지연, 틈 범위, 결정성, 중단 측정 스크립트 |
| `scripts/run-compat.sh`, `scripts/summarize.py` | 기존 시험을 스위치를 켜고 파일 하나씩 돌려 모아요 |

기존 코드에 닿은 곳은 `packages/core/src/world/os/shell-exec.ts` 한 파일이에요(스위치와 `export` 몇 개).

## 다시 만들기

1. Go 1.26 이상이 필요해요(`mvdan.cc/sh` v3.14.1의 `go.mod`가 요구해요). 없으면 설치된 Go로 소스에서 만들 수 있어요:
   `git clone --branch go1.26.11 https://github.com/golang/go` 뒤에 `GOROOT_BOOTSTRAP=$(go env GOROOT) src/make.bash`(약 10분).
2. `GO=<go 1.26 바이너리> experiments/userland-wasm/scripts/build.sh` (GitHub만 닿으면 돼요. Go 모듈 프록시는 안 써요)
3. 켜기: `TERRARIUM_SHELL=wasm npx vitest run tests/spec/deep-os-shell.test.ts`

환경 변수: `TERRARIUM_WASM_WORKERS`(기본 2), `TERRARIUM_WASM_PREWARM`(기본 1, 0이면 호출마다 새 인스턴스),
`TERRARIUM_WASM_AWK`(`ts`면 awk를 옛 구현으로), `TERRARIUM_WASM_TIMEOUT_MS`(기본 5000),
`TERRARIUM_WASM_MAX_STEPS`(기본 20000), `TERRARIUM_WASM_MAX_OUT`(기본 4000000), `TERRARIUM_WASM_MEM_MB`(기본 256),
`TERRARIUM_WASM_SLEEP`(`noop` 기본, `advance`면 `sleep`이 세계 시계를 밀어요).

## 라이선스 (읽은 곳)

| 소재 | 라이선스 | 읽은 곳 |
|---|---|---|
| mvdan.cc/sh v3.14.1 | BSD-3-Clause | 저장소 루트 `LICENSE` |
| goawk v1.32.0 | MIT | 저장소 루트 `LICENSE.txt` |
| golang.org/x/sys, x/term | BSD-3-Clause | 각 저장소 `LICENSE` |
| Go 표준 라이브러리(.wasm에 들어가요) | BSD-3-Clause | Go 소스 `LICENSE` |

`.wasm` 파일은 저장소에 넣지 않아요(`bin/`은 무시돼요). 위 소재의 고지문은 파일을 내보낼 때 같이 내야 해요.
