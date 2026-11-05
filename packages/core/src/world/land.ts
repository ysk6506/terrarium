/**
 * What land costs (REQ-043, REQ-059): the price on every parcel for sale, in million won per square metre.
 *
 * The prices follow the real market. `reported` ones come from a figure printed in the news or a public
 * notice (the source and its date are in `note`); `estimated` ones are scaled from such figures to the area
 * around a campus, because no listing for that exact ground could be found. docs/design-docs/real-prices.md
 * keeps the sources and says how far to trust each.
 */
export type PriceBasis = "reported" | "estimated";

export interface LandMarket {
  readonly id: string;
  readonly label: string;
  /** Million won per square metre. */
  readonly perM2M: number;
  readonly basis: PriceBasis;
  readonly note: string;
}

/**
 * Ordinary factory land south of Seoul, when the area is not known: Hwaseong listings ask 평당 270~600만 원
 * (서울경제, 2026-11-04), about 0.8~1.8 million won per square metre.
 */
export const LAND_PRICE_M_PER_M2 = 1.2;

export const LAND_MARKETS: readonly LandMarket[] = [
  {
    id: "general",
    label: "수도권 남부 일반 공장용지",
    perM2M: LAND_PRICE_M_PER_M2,
    basis: "reported",
    note: "화성 서부 공장 매물 평당 270~600만 원 (서울경제 2026-11-04)",
  },
  {
    id: "hwaseong",
    label: "화성 (동탄 인접)",
    perM2M: 2.4,
    basis: "estimated",
    note: "동탄 일반산단 조성원가 86만 원/㎡ (LH, 2011)에 그동안의 상승을 곱하고, 안양 평당 2,000만 원 위쪽 끝과 서부 화성 아래쪽 끝 사이에 놓은 값",
  },
  {
    id: "pyeongtaek",
    label: "평택 (고덕)",
    perM2M: 2.1,
    basis: "estimated",
    note: "고덕 산업단지 값을 찾지 못해, 화성과 같은 방법으로 조금 낮게 잡은 값",
  },
  {
    id: "giheung",
    label: "용인 (기흥)",
    perM2M: 3,
    basis: "estimated",
    note: "기흥구 상하동 토지 감정가 평당 329만 원(약 100만 원/㎡, 2026)보다 공업용지답게 높게 잡은 값",
  },
  {
    id: "suwon",
    label: "수원 (영통·매탄)",
    perM2M: 4.5,
    basis: "estimated",
    note: "도시 안 공업용지라서 안양 평당 2,000만 원(약 600만 원/㎡) 아래쪽으로 잡은 값",
  },
  {
    id: "cheonan",
    label: "천안",
    perM2M: 0.9,
    basis: "estimated",
    note: "수도권 남부 일반 공장용지의 4분의 3쯤으로 잡은 값",
  },
  {
    id: "onyang",
    label: "아산 (온양)",
    perM2M: 0.9,
    basis: "estimated",
    note: "천안과 같게 잡은 값",
  },
];

const GENERAL = LAND_MARKETS[0] as LandMarket;

/** The market for a site (its preset's id), or ordinary factory land when the area is not known. */
export const landMarket = (id: string | undefined): LandMarket =>
  LAND_MARKETS.find((m) => m.id === id) ?? GENERAL;

/** One pyeong, the unit Korean land is quoted in, in square metres. */
export const PYEONG_M2 = 3.3058;

/** The price of a parcel of this size, million won; `perM2M` is the area's price, ordinary land when left out. */
export const parcelPriceM = (w: number, d: number, perM2M: number = LAND_PRICE_M_PER_M2): number =>
  Math.round(w * d * perM2M);
