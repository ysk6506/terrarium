/**
 * Worlds for the tests of the accelerator, power and cooling ladders (REQ-107): the generator builds them, so a lab is the
 * world a person gets by choosing the chips ("gpu training lab", "power ladder lab", "cooling ladder lab").
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  DEFAULT_SHAPE,
  draftFromCard,
  generateShaped,
  type ShapeSpec,
} from "@terrarium/core/sources/worldgen";
import { type Blueprint, type Layers, SERVICE_CATALOG } from "@terrarium/core/world";

const card = (id: string) => {
  const c = SERVICE_CATALOG.find((x) => x.id === id);
  if (!c) throw new Error(`no card ${id}`);
  return c;
};

export const BASE_LAYERS: Layers = {
  ...DEFAULT_SHAPE.layers,
  network: "net-leaf-spine",
  compute: "cmp-virt-ha",
  accel: "gpu-none",
  storage: "sto-shared",
  database: "db-single",
  app: "app-single",
  power: "pwr-ab",
  cooling: "cool-n1",
  site: "site-one-room",
};

export interface LabOptions {
  readonly layers?: Partial<Layers>;
  /** Cards, in order; the first service is the one a part with no AI card serves. */
  readonly cards?: readonly string[];
  readonly servers?: number;
}

/** A shaped world from chips. */
export function shapedLab(options: LabOptions = {}): Blueprint {
  const keys: string[] = [];
  const services = (options.cards ?? ["web-api"]).map((id) => {
    const draft = draftFromCard(card(id), keys);
    keys.push(draft.key);
    return draft;
  });
  const spec: ShapeSpec = {
    ...DEFAULT_SHAPE,
    name: "ladder lab",
    seed: 7,
    servers: options.servers ?? 30,
    services,
    layers: { ...BASE_LAYERS, ...options.layers },
  };
  return generateShaped(spec, new Catalog()).blueprint;
}

/** GPU training lab: a scheduler, a training job with spares, an IB fabric, and a serving pool beside it. */
export const accelLab = (accel = "gpu-training-cluster", layers: Partial<Layers> = {}): Blueprint =>
  shapedLab({
    layers: { accel, ...layers },
    cards:
      accel === "gpu-training-cluster" || accel === "gpu-liquid-pod"
        ? ["training-pipeline"]
        : ["ai-serving"],
  });

/** Power ladder lab: one web service on the chosen power chip. */
export const powerLab = (power = "pwr-substation", layers: Partial<Layers> = {}): Blueprint =>
  shapedLab({ layers: { power, ...layers } });

/** Cooling ladder lab: one web service on the chosen cooling chip (dense racks hang on the liquid loop). */
export const coolingLab = (cooling = "cool-liquid", layers: Partial<Layers> = {}): Blueprint =>
  shapedLab({ layers: { cooling, ...layers } });
