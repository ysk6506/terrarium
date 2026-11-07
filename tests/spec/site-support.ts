/** Small worlds with a second site, geo storage or one of the two new databases, for the REQ-106 tests. */
import {
  customService,
  DEFAULT_SHAPE,
  generateShaped,
  type ServiceDraft,
  type ShapeSpec,
} from "@terrarium/core/sources/worldgen";
import type { Blueprint, Layers } from "@terrarium/core/world";

export type SiteWorld =
  | "cold"
  | "warm"
  | "hot"
  | "active"
  | "split"
  | "raft"
  | "managed"
  | "geo"
  | "db";

const LAYERS: Readonly<Record<SiteWorld, Partial<Layers>>> = {
  cold: { site: "site-dr-cold" },
  warm: { site: "site-dr-warm", storage: "sto-geo" },
  hot: { site: "site-dr-hot", storage: "sto-geo", database: "db-auto-failover" },
  active: { site: "site-multi-active", storage: "sto-geo", database: "db-distributed-sql" },
  split: { site: "site-multi-active", storage: "sto-geo" },
  raft: { database: "db-distributed-sql" },
  managed: { database: "db-managed-multiaz" },
  geo: { site: "site-dr-cold", storage: "sto-geo" },
  db: { database: "db-distributed-sql" },
};

/** The ledger service; in the "db" world it chooses the managed database for itself while IAP runs a consensus ring. */
const ledger = (own: boolean): ServiceDraft => ({
  ...customService(2, {
    name: "원장",
    gives: "계좌 원장을 지켜요",
    stopsText: "입출금이 멈춰요",
    kind: "stateful",
  }),
  ...(own
    ? {
        layers: {
          compute: DEFAULT_SHAPE.layers.compute,
          storage: DEFAULT_SHAPE.layers.storage,
          database: "db-managed-multiaz",
          app: DEFAULT_SHAPE.layers.app,
        },
      }
    : {}),
});

export const siteSpec = (kind: SiteWorld, servers = 48): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  servers,
  services: [...DEFAULT_SHAPE.services, ledger(kind === "db")],
  layers: { ...DEFAULT_SHAPE.layers, ...LAYERS[kind] },
});

export const siteBlueprint = (kind: SiteWorld, servers = 48): Blueprint =>
  generateShaped(siteSpec(kind, servers)).blueprint;
