/**
 * The ladders as the screen reads them (ADR-0107 item 3, ADR-0108 item 4): eight layers, each with its question and its
 * choices left to right, every choice with its card. The mechanics of a choice (what it builds, which faults it makes
 * possible, whether the core can imitate it) live in the core (`@terrarium/core/world` LADDER); a test keeps the two
 * lists in step, so a choice cannot be added to one and forgotten in the other.
 */
import { type ChipMech, LADDER, LAYER_IDS, type LayerId } from "@terrarium/core/world";
import type { ChipCard } from "./card-types";
import { APP_CARDS, DATABASE_CARDS, STORAGE_CARDS } from "./cards-data";
import { COOLING_CARDS, POWER_CARDS, SITE_CARDS } from "./cards-infra";
import { COMPUTE_CARDS, NETWORK_CARDS } from "./cards-net-compute";

export type { ChipCard, Diagram, DiagramRow, Join } from "./card-types";

export const LAYER_INFO: Readonly<Record<LayerId, { name: string; question: string }>> = {
  network: { name: "네트워크", question: "어떻게 이어지나요" },
  compute: { name: "컴퓨트", question: "서비스가 무엇 위에서 도나요" },
  storage: { name: "스토리지", question: "데이터는 어디에" },
  database: { name: "데이터베이스", question: "상태는 어떻게 지키나요" },
  app: { name: "애플리케이션", question: "요청은 어떻게 받나요" },
  power: { name: "전원", question: "전기는 몇 줄" },
  cooling: { name: "냉방", question: "더워지면" },
  site: { name: "사이트·DR", question: "자리는 어디에" },
};

export const CARDS: readonly ChipCard[] = [
  ...NETWORK_CARDS,
  ...COMPUTE_CARDS,
  ...STORAGE_CARDS,
  ...DATABASE_CARDS,
  ...APP_CARDS,
  ...POWER_CARDS,
  ...COOLING_CARDS,
  ...SITE_CARDS,
];

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export const cardOf = (id: string): ChipCard | undefined => BY_ID.get(id);

/** A choice: its card and its mechanics together. */
export interface Chip {
  readonly card: ChipCard;
  readonly mech: ChipMech;
}

/** The choices of one layer, left to right. */
export function chipsOfLayer(layer: LayerId): readonly Chip[] {
  return LADDER[layer].flatMap((mech) => {
    const card = BY_ID.get(mech.id);
    return card ? [{ card, mech }] : [];
  });
}

export { LAYER_IDS };

/** The layers an operator domain stands for (ADR-0098 names the domains; this is the temporary list until it lands). */
export const OWN_LAYER_CHOICES: readonly LayerId[] = LAYER_IDS;
