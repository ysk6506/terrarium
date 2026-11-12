---
title: ADR-0063 GPU는 칩 이름으로 다루고, 아직 출시되지 않은 칩은 예정으로만 둔다
kind: decision
status: active
last_verified: 2026-11-04
enforced_by:
  - tests/spec/gpu-catalog.test.ts
  - packages/core/src/world/construction.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - packages/core/src/world/construction.test.ts::what equipment costs [REQ-059] > a GPU server costs 30~80 million won per GPU, as 8-GPU HGX servers do (about 22,000~60,000 dollars each)
test_change_reason: B300 8-GPU 서버는 판매처에서 한 장에 6.7~9.8만 달러(약 90~130백만 원)에 올라와 있어서, 한 장당 30~80백만 원이라던 상한이 현실보다 낮았다. 요구사항 REQ-059의 뜻(가격이 현실을 따른다)은 그대로이고 상한만 현실에 맞추어 130백만 원으로 올린다.
decision_hash: 3bd3ae1c5c93fd75
---
# ADR-0063 GPU는 칩 이름으로 다루고, 베라 루빈은 도입 예정으로만 둔다

## 맥락
제품 책임자의 요구: 제품은 H100·H200·B200·B300을 칩 단위로 다루고, 발표됐지만 아직 출시되지 않은 칩(베라 루빈)은 "예정" 표시로만 둔다.
지금 카탈로그의 GPU 서버는 "GPU 8장" 정도만 말한다. 어느 칩인지(메모리가 80GB인지 288GB인지, 한 장이 700W인지 1,100W인지)가 없어서 에이전트가 "B300 서버가 어디 있나", "이 랙이 H100 서버를 몇 대 더 받을 수 있나"를 물을 수 없다.

## 결정
1. **칩 사양표(`GpuModel`)를 따로 둔다.** H100 SXM5 80GB(HBM3, 3.35TB/s, 700W), H200 141GB(HBM3e, 4.8TB/s, 700W), B200 180GB(HBM3e, 8TB/s, 1,000W), B300 288GB(HBM3e, 8TB/s, 1,100W). NVLink는 Hopper 900GB/s, Blackwell 1,800GB/s. 짝으로 오는 NIC는 ConnectX-7 400G, B300은 ConnectX-8 800G.
2. **칩 이름은 현실의 것을 쓰고, 서버를 만든 회사는 가상으로 둔다.** 사람들이 "H100 팜", "B300 열"이라고 말하기 때문이다. 서버 제조사는 지금까지처럼 Aerion AI라는 가상의 회사다.
3. **서버 모델은 `gpuModel`로 칩을 가리킨다.** 칩이 정해지지 않은 예전 GPU 서버(srv-4u-gpu, AX-8 등)는 이 값이 없다. 값이 없으면 "가속기가 있다"까지만 말한다.
4. **서버 5종을 더한다.** `ax-8u-h100-air`, `ax-8u-h200-air`, `ax-10u-b200-air`, `ax-8u-b300-air`, `ax-4u-b300-dlc`. 모두 GPU 8장이다. 전력은 DGX급 서버 사양(H100·H200 10.2kW, B200 14.3kW, B300 14kW)을 따르고, 수랭 B300은 4U에 열의 85%를 물로 보낸다.
5. **값은 8-GPU 서버가 판매처에 올라온 가격을 따른다(2026-09).** H200 31.9~46.7만 달러, B200 38.4~56.2만, B300 53.7~78.6만. 가운데쯤으로 잡았다. H100은 현재 판매 값을 찾지 못해서 추정이다. 베라 루빈은 값이 없다.
6. **아직 출시되지 않은 칩(베라 루빈)은 "도입 예정"으로만 둔다.** 사양표에 `status: planned`, `year: 2027`, `firm: false`로 있다. 어느 서버에도 얹히지 않는다. 빌더에서 GPU 서버를 고르면 "도입 예정" 한 줄이 따라붙는다. 사양이 공식이 아니어서 서버로 만들면 거짓 정밀도가 생기기 때문이다.
7. **Redfish에 `Processors`를 더한다.** 서버마다 `CPU0…`와 `GPU0…`가 나오고, 칩이 정해진 GPU는 `Manufacturer`, `Model`, `TDPWatts`, `MemorySummary`, `ProcessorMemory`(HBM 종류), `SerialNumber`를 말한다. DMTF 스키마 묶음에 `Processor`를 더해서 기계가 대조한다.
8. **GPU 한 장당 값의 상한을 현실에 맞춘다.** REQ-059의 검사가 장당 30~80백만 원이라 했는데 B300은 90~130이다. 상한을 130으로 올린다(`amends_tests`).
9. **요구사항 REQ-066**을 더한다.

## 버린 대안
- **베라 루빈 서버 모델을 만듦**: 전력, 값, 규격(NVL144 랙)이 공식이 아니다. 만들면 숫자가 그럴듯해 보여서 사람이 믿는다. 사양표에 표시만 한다.
- **칩 이름도 가상으로(예: "Aerion G3")**: 현장 말과 달라서 에이전트 평가 시나리오를 현실과 못 맞춘다.
- **GPU마다 엔티티로 월드에 넣음**: 수천 장 월드에서 엔티티가 8배가 된다. 서버가 장수와 칩을 알고 있으면 충분하다. 칩 단위 고장이 필요해지면 그때 고른다.
- **Redfish를 `Oem` 한 덩어리로**: 현실의 BMC는 `Processors`로 말한다. 에이전트가 배운 대로 읽을 수 있어야 한다.

## 한계 (솔직하게)
- 칩 하나의 온도, 전력, 사용률, ECC 오류, XID 오류(nvidia-smi, DCGM)는 없다. GPU 고장도 서버 단위다.
- B300의 장당 전력은 자료마다 1,100W와 1,400W로 갈린다. 8-GPU HGX 서버에서는 1,100W, 랙형 GB300은 1,400W가 일반적이라고 보고 1,100W를 썼다. 어느 쪽인지 NVIDIA 공식 규격표로 확인하지 못했다.
- H100 서버 값은 추정이다. 판매처에서 현재 값을 찾지 못했다. H200 서버(31.9만 달러)보다 낮게 30만 달러로 잡았다. 검색 결과 요약에 H100 카드 한 장이 2.7~4만 달러라고 나오지만 그 글을 열어 읽지는 못했다.
- 이 환경에서는 NVIDIA 규격표를 직접 읽지 못했다. H100(80GB, 3.35TB/s, 700W)과 B300(288GB)은 사양을 옮겨 적은 페이지로 확인했다. H200·B200의 대역폭·전력, 서버 전력(DGX급 10.2kW, 14.3kW, 14kW), B200의 메모리 180GB는 기억과 판매처 글에 기댔다.
- 베라 루빈의 수치(HBM4 288GB, 장당 1,800W, NVLink 3.6TB/s, NIC 1.6T)는 보도와 발표 자료에서 가져온 것이고 서버 값은 없다.
- NVLink 구성(NVSwitch 몇 장, 랙형 NVL72)과 GPU 네트워크(InfiniBand·RoCE, rail-optimized)는 이 결정에 없다.
