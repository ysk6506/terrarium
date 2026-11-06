/**
 * The cards of the builder (REQ-094, ADR-0107 item 8): what the card for an empty unit offers, what the small card of a
 * server tells (its services, its power, its switch), and the sums the bar at the foot of the stage shows for one step
 * of building. The numbers are read off the blueprint and the catalog; nothing is kept here.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { type BlueprintIndex, type Entity, rackStandardOf } from "@terrarium/core/world";
import { watts } from "../format";
import type { Level } from "./levels";
import { servicesOnPlace } from "./service-edit";
import { costOf, levelStats } from "./stats";

/** What "서버 넣기" offers: three kinds, each with a model that exists in the catalog. */
export const INSERT_CHOICES: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly modelId: string;
}> = [
  { id: "gpu", label: "GPU 서버", modelId: "srv-4u-gpu" },
  { id: "general", label: "일반 서버", modelId: "srv-1u-compute" },
  { id: "storage", label: "스토리지", modelId: "stor-2u-24bay" },
];

export interface InsertOption {
  readonly id: string;
  readonly label: string;
  readonly modelId: string;
  readonly height: number;
  readonly detail: string;
  readonly costM: number;
  /** Whether the rack's standard takes this model; false when the rack is built to another one. */
  readonly fits: boolean;
}

/** The three kinds as the card shows them: height, power and price, from the catalog. */
export function insertOptions(catalog: Catalog, rack: Entity): InsertOption[] {
  const standard = rackStandardOf(rack, catalog);
  return INSERT_CHOICES.flatMap((c) => {
    try {
      const m = catalog.get(c.modelId);
      if (!("uHeight" in m)) return [];
      const power = "maxPowerW" in m ? watts(m.maxPowerW) : "";
      return [
        {
          ...c,
          height: m.uHeight,
          detail: power === "" ? m.name : `${m.name} · ${power}`,
          costM: m.costM,
          fits:
            (m as { mount?: string }).mount === undefined ||
            (m as { mount?: string }).mount === standard,
        },
      ];
    } catch {
      return [];
    }
  });
}

export interface ServerFacts {
  readonly services: readonly Entity[];
  /** "PDU-A · PDU-B", the supplies it hangs on. */
  readonly power: string;
  /** The switches it is cabled to, with the speed when the model says. */
  readonly switches: string;
  readonly model: string;
}

const names = (index: BlueprintIndex, ids: readonly string[]): string =>
  ids.map((id) => index.find(id)?.name ?? id).join(" · ") || "연결 없음";

/** The small card of one server: what it carries, what feeds it and where it is cabled. */
export function serverFacts(index: BlueprintIndex, catalog: Catalog, e: Entity): ServerFacts {
  const peak = e.modelId && catalog.has(e.modelId) ? catalog.get(e.modelId) : undefined;
  const model = peak?.name ?? e.modelId ?? "";
  const w = peak && "maxPowerW" in peak ? ` · ${watts(peak.maxPowerW)}` : "";
  return {
    services: servicesOnPlace(index, e.id),
    power: `${names(
      index,
      index.outgoing(e.id, "power").map((l) => l.to),
    )}${w}`,
    switches: names(
      index,
      index.outgoing(e.id, "network").map((l) => l.to),
    ),
    model,
  };
}

/** What the foot bar says about one step: "이 랙 6대 · 1억 2,000만 원 · 서비스 2개". */
export interface StepSum {
  readonly label: string;
  readonly servers: number;
  readonly costM: number;
  readonly services: number;
}

export function stepSum(
  index: BlueprintIndex,
  catalog: Catalog,
  level: Level,
  rack?: Entity,
): StepSum {
  const all = rack
    ? [rack, ...index.descendants(rack.id)]
    : level.kind === "site"
      ? index.all()
      : [index.entity(level.id), ...index.descendants(level.id)];
  const costM = rack ? costOf(index, catalog, rack) : levelStats(index, catalog, level).costM;
  const serverIds = new Set(all.filter((e) => e.kind === "server").map((e) => e.id));
  // A service stands on a server directly, or on a VM that runs on one.
  const places = (id: string): string[] => [
    id,
    ...index.incoming(id, "runs_on").map((l) => l.from),
  ];
  const services = new Set(
    [...serverIds].flatMap((id) =>
      places(id).flatMap((p) => servicesOnPlace(index, p).map((s) => s.id)),
    ),
  );
  return {
    label: rack
      ? "이 랙"
      : level.kind === "site"
        ? "이 부지"
        : level.kind === "floor"
          ? "이 층"
          : "이 서버룸",
    servers: serverIds.size,
    costM,
    services: services.size,
  };
}
