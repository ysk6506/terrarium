/** The built-in models: nominal, fictional-vendor specs. Imported equipment maps onto these by kind. */
import type { EquipmentModel } from "../models";
import { CDUS, CHILLERS, COOLING_UNITS, GENERATORS, PANELS, UPSES } from "./facility";
import { PDUS, STORAGES, SWITCHES } from "./it";
import { RACKS } from "./racks";
import { SERVERS } from "./servers";

export const BUILTIN_MODELS: readonly EquipmentModel[] = [
  ...SERVERS,
  ...SWITCHES,
  ...STORAGES,
  ...PDUS,
  ...RACKS,
  ...COOLING_UNITS,
  ...CDUS,
  ...CHILLERS,
  ...GENERATORS,
  ...PANELS,
  ...UPSES,
];

/** The model used when an import names a model we do not know. */
export const DEFAULT_MODEL_BY_KIND: Readonly<Record<EquipmentModel["kind"], string>> = {
  server: "srv-2u-compute",
  switch: "sw-tor-48x25g",
  storage: "stor-2u-24bay",
  pdu: "pdu-17kw",
  rack: "rack-42u-std",
  cooling_unit: "crah-100kw",
  cdu: "aq-cdu-500kw",
  chiller: "gl-chiller-screw-1mw",
  generator: "tg-diesel-2mw",
  power_panel: "panel-400a",
  ups: "ups-500kva",
};
