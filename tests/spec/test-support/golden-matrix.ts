/**
 * The small, fixed matrix of worlds the golden suites run on (docs/design-docs/golden-safety-net.md), and the one
 * fingerprint they all use: the length of the text and a stable 64-bit hash of it, so a changed byte shows up and the
 * literal in a test stays short. Every world is built from fixed seeds by existing generators and test labs; nothing
 * here reads the clock or random numbers.
 */
import { Catalog } from "@terrarium/core/catalog";
import { hashHex, stableStringify } from "@terrarium/core/kernel";
import { Physics } from "@terrarium/core/physics";
import { DEFAULT_SHAPE, generateShaped } from "@terrarium/core/sources/worldgen";
import { type Blueprint, World } from "@terrarium/core/world";
import { gpuLab } from "../../../packages/core/src/world/test-support/gpu-lab";
import { campusBlueprint } from "../../../packages/core/src/world/test-support/sample-campus";
import { sdnLab } from "../../../packages/core/src/world/test-support/sdn-lab";
import { accelLab } from "./ladder-labs";

export interface GoldenWorld {
  readonly id: string;
  /** What the world is, for a reader of a failure. */
  readonly shape: string;
  readonly make: () => Blueprint;
}

/**
 * Five worlds that together hold every layer: `iap` is the smallest shaped world (leaf-spine, A+B feeds, N+1 cooling,
 * a virtualisation cluster, shared storage, a database, Kubernetes); `campus` is the hand-made world with the plant,
 * the site and DR, SDN and the application layer; `sdn` the overlay lab; `train` the GPU training lab on a leaf-spine
 * network; `fabric` the lab whose switches are a cloud fabric with eBGP and ECMP between leaves and spines.
 */
export const GOLDEN_WORLDS: readonly GoldenWorld[] = [
  {
    id: "iap",
    shape: "generateShaped(DEFAULT_SHAPE, servers 12, seed 1)",
    make: () => generateShaped({ ...DEFAULT_SHAPE, servers: 12 }, new Catalog()).blueprint,
  },
  { id: "campus", shape: "campusBlueprint()", make: campusBlueprint },
  { id: "sdn", shape: "sdnLab({ cloudNative: true })", make: () => sdnLab({ cloudNative: true }) },
  {
    id: "train",
    shape: "accelLab(gpu-training-cluster, net-leaf-spine), seed 7",
    make: () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" }),
  },
  { id: "fabric", shape: "gpuLab()", make: gpuLab },
];

/** A matrix world by id. */
export function goldenWorld(id: string): GoldenWorld {
  const found = GOLDEN_WORLDS.find((w) => w.id === id);
  if (!found) throw new Error(`no golden world ${id}`);
  return found;
}

export const catalog = new Catalog();

/** Length and hash of a text. */
export const fingerprintText = (text: string): string => `${text.length}:${hashHex(text)}`;

/** Length and hash of a value with its keys in a fixed order. */
export const fingerprintOf = (value: unknown): string => fingerprintText(stableStringify(value));

/** A world built from the blueprint with the physics run to rest. */
export function settledWorld(blueprint: Blueprint): World {
  const world = World.fromBlueprint(blueprint, catalog);
  new Physics(world).settle();
  return world;
}
