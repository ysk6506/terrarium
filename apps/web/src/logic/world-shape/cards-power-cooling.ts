/** Cards of the power and cooling choices REQ-107 (ADR-0130) adds to the ladders: UPS with a spare module, rack batteries, a substation, rear doors and immersion. */
import { type ChipCard, rows } from "./card-types";

export const POWER_EXTRA_CARDS: readonly ChipCard[] = [
  {
    id: "pwr-n1-ups",
    layer: "power",
    label: "N+1 UPS",
    what: "두 계통(A+B)에 UPS를 필요한 수보다 한 대 더 둬요. 모듈 하나가 고장 나도 나머지가 부하를 받아요. 발전기는 없어서 긴 정전은 못 버텨요.",
    canLose: "UPS 모듈 하나 · 한 계통",
    mustNot: "정전이 배터리 시간보다 길어지는 일",
    faults: "UPS 모듈 고장 · UPS 배터리 열화 · 한전 정전",
    cost: "UPS 모듈 한 대 더 · 1억 원쯤",
    result: "UPS 모듈 하나가 죽어도 나머지가 받아요",
    diagram: rows(
      "UPS 모듈 셋이 PDU 둘에 전기를 보내고 모듈 하나가 끊김",
      [
        ["UPS 모듈", 3],
        ["PDU", 2, "mesh"],
      ],
      [0, 2],
    ),
  },
  {
    id: "pwr-rack-bbu",
    layer: "power",
    label: "랙 배터리(BBU) + 48V DC",
    what: "랙마다 배터리 모듈(BBU)이 있어서 UPS가 넘어가는 몇 초를 랙이 직접 메워요. 랙 안은 48V DC 버스로 전력을 나눠요. 2N UPS와 발전기 위에 얹는 선택이에요.",
    canLose: "BBU 셀 몇 개 · UPS 한 계통",
    mustNot: "48V 버스가 처지는 일",
    faults: "랙 배터리(BBU) 셀 고장 · 48V DC 버스 전압 강하 · UPS 모듈 고장",
    cost: "랙당 BBU · 랙당 수백만 원",
    result: "전환 순간의 끊김을 랙 배터리가 메워요",
    diagram: rows(
      "UPS 둘 아래 랙마다 배터리와 DC 버스가 있고 배터리 하나가 끊김",
      [
        ["UPS", 2],
        ["랙 BBU", 4, "mesh"],
        ["DC 버스", 4, "one"],
      ],
      [1, 2],
    ),
  },
  {
    id: "pwr-substation",
    layer: "power",
    label: "자체 변전소",
    what: "건물이 한전에서 직접 받아 변압기 둘로 낮춰요. 수전 선로가 둘이라 한 줄이 끊겨도 다른 줄이 있지만, 옮기는 건 사람이 해야 해요. 가장 크고 비싸요.",
    canLose: "수전 한 줄 · 변압기 하나",
    mustNot: "두 수전 줄이 함께 끊기는 일",
    faults: "수전 한 줄 끊김 · 변압기 과열 · 발전기 기동 실패",
    cost: "변전소 설비 · 수십억 원쯤",
    result: "한 줄이 끊겨도 다른 줄로 옮기면 돼요",
    diagram: rows(
      "수전 선로 둘이 변압기 둘로 들어가고 선로 하나가 끊김",
      [
        ["수전", 2],
        ["변압기", 2, "mesh"],
        ["ATS", 2, "one"],
      ],
      [0, 0],
    ),
  },
];

export const COOLING_EXTRA_CARDS: readonly ChipCard[] = [
  {
    id: "cool-rdhx",
    layer: "cooling",
    label: "리어도어 열교환",
    what: "랙 뒷문에 냉각수가 흐르는 열교환기를 달아요. 서버가 내보내는 뜨거운 바람을 문에서 식혀서 방에 열이 덜 퍼져요. 고밀도 랙에 맞아요.",
    canLose: "냉방기 하나",
    mustNot: "냉각수가 새는 일 · 밸브가 끼는 일",
    faults: "리어도어 밸브 고착 · 냉각수 누설 · 냉각 플랜트 정지",
    cost: "랙당 열교환 도어 · 랙당 수천만 원",
    result: "뒷문에서 열을 먼저 잡아서 방이 덜 더워져요",
    diagram: rows(
      "냉각 플랜트가 랙 뒷문 열교환기 넷에 냉각수를 보내고 밸브 하나가 끼임",
      [
        ["플랜트", 1],
        ["리어도어", 4, "mesh"],
        ["랙", 4, "one"],
      ],
      [1, 2],
    ),
  },
  {
    id: "cool-immersion",
    layer: "cooling",
    label: "침지 냉각",
    what: "서버를 부도체 냉각액이 든 탱크에 통째로 담가요. 팬이 필요 없고 열을 가장 잘 빼지만, 어떤 서버든 침지용으로 바꿔야 하고 유지보수가 달라져요.",
    canLose: "순환 펌프 하나",
    mustNot: "냉각액이 모자라지는 일",
    faults: "액침 순환 정지 · 액침 유체 수위 낮음 · 냉각 플랜트 능력 저하",
    cost: "탱크 + 냉각액 + 서버 개조 · 가장 커요",
    result: "펌프가 멈추면 탱크 안 온도가 천천히 올라요",
    diagram: rows(
      "냉각 플랜트가 침지 탱크 둘에 순환 펌프로 냉각액을 보내고 펌프 하나가 끊김",
      [
        ["플랜트", 1],
        ["침지 탱크", 2, "mesh"],
        ["서버", 4, "mesh"],
      ],
      [1, 0],
    ),
  },
];
