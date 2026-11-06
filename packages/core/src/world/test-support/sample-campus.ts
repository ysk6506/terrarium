/**
 * The sample hall plus the parts of a campus: owned and for-sale land, a liquid-cooled rack on a CDU,
 * a chiller, and a generator behind a transfer switch that feeds a second UPS. The extra parts hang
 * off nothing in the original hall, so everything that holds for the sample still holds here.
 */
import type { Blueprint, Entity, Link } from "../blueprint";
import { serviceProps } from "../service";
import { sampleBlueprint } from "./sample";

const ent = (
  id: string,
  kind: Entity["kind"],
  parentId: string,
  placement: Entity["placement"],
  extra: Partial<Entity> = {},
): Entity => ({ id, kind, name: extra.name ?? id, parentId, placement, props: {}, ...extra });

const link = (kind: Link["kind"], from: string, to: string): Link => ({
  id: `l-${kind}-${from}-${to}`,
  kind,
  from,
  to,
  props: {},
});

export const CAMPUS_ENTITY_IDS = [
  "parcel-1",
  "parcel-2",
  "rack-l",
  "srv-l1",
  "cdu-1",
  "chiller-1",
  "gen-1",
  "ats-1",
  "ups-2",
  "tank-1",
  "srv-t1",
] as const;

export function campusBlueprint(): Blueprint {
  const bp = sampleBlueprint();
  const entities: Entity[] = [
    ent(
      "parcel-1",
      "parcel",
      "site",
      { type: "area", x: 5, y: 5, w: 100, d: 80 },
      { name: "본 부지" },
    ),
    ent(
      "parcel-2",
      "parcel",
      "site",
      { type: "area", x: 110, y: 5, w: 80, d: 80 },
      { name: "매입 가능 부지", props: { owned: false } },
    ),
    ent(
      "rack-l",
      "rack",
      "hall",
      { type: "spot", x: 9.0, y: 3.0, rotation: 0 },
      { modelId: "aq-48u-dlc" },
    ),
    ent("srv-l1", "server", "rack-l", { type: "unit", u: 10 }, { modelId: "ax-4u-8gpu-dlc" }),
    ent(
      "tank-1",
      "rack",
      "hall",
      { type: "spot", x: 9.0, y: 5.5, rotation: 0 },
      { modelId: "sm-tank-24u" },
    ),
    ent("srv-t1", "server", "tank-1", { type: "unit", u: 4 }, { modelId: "sm-2u-imm" }),
    {
      id: "svc-portal",
      kind: "service",
      name: "사내 포털",
      props: serviceProps({ kind: "request", process: "portal", perHourKrw: 2_000_000 }),
    },
    ent(
      "cdu-1",
      "cdu",
      "hall",
      { type: "spot", x: 10.5, y: 8, rotation: 0 },
      { modelId: "aq-cdu-500kw" },
    ),
    ent(
      "chiller-1",
      "chiller",
      "site",
      { type: "spot", x: 80, y: 15, rotation: 0 },
      { modelId: "gl-chiller-screw-1mw" },
    ),
    ent(
      "gen-1",
      "generator",
      "site",
      { type: "spot", x: 80, y: 40, rotation: 0 },
      { modelId: "tg-diesel-2mw" },
    ),
    ent(
      "ats-1",
      "power_panel",
      "site",
      { type: "spot", x: 80, y: 62, rotation: 0 },
      { modelId: "sy-ats-1600a" },
    ),
    ent(
      "ups-2",
      "ups",
      "fl1",
      { type: "spot", x: 30, y: 12, rotation: 0 },
      { modelId: "ups-200kva" },
    ),
  ];
  const links: Link[] = [
    link("power", "ups-2", "ats-1"),
    link("power", "ats-1", "gen-1"),
    link("power", "cdu-1", "ups-2"),
    link("power", "srv-l1", "ups-2"),
    link("power", "srv-t1", "ups-2"),
    link("power", "chiller-1", "ats-1"),
    link("cooling", "rack-l", "cdu-1"),
    link("cooling", "tank-1", "cdu-1"),
    link("cooling", "cdu-1", "chiller-1"),
    { ...link("service_on", "svc-portal", "vm-web"), props: { role: "active" } },
    { ...link("service_on", "svc-portal", "srv-b1"), props: { role: "standby" } },
  ];
  return {
    ...bp,
    id: "campus-sample",
    entities: [...bp.entities, ...entities],
    links: [...bp.links, ...links],
  };
}
