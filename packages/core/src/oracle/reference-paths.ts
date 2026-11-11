/** Every fault kind's reference path in one table (REQ-110, ADR-0133); a kind without one does not compile. */
import type { ReferenceKey, ReferencePath } from "./reference-path";
import { ACCEL_PATHS, ACCEL_VARIANTS } from "./reference-paths-accel";
import { DB_PATHS, DB_VARIANTS } from "./reference-paths-db";
import { FACILITY_PATHS } from "./reference-paths-facility";
import { FIRMWARE_PATHS, FIRMWARE_VARIANTS } from "./reference-paths-firmware";
import { NETWORK_PATHS } from "./reference-paths-network";
import { OS_PATHS } from "./reference-paths-os";
import { OVERLAY_PATHS } from "./reference-paths-overlay";
import { REST_PATHS } from "./reference-paths-rest";
import { SERVER_PATHS } from "./reference-paths-server";
import { SITE_PATHS } from "./reference-paths-site";

export const REFERENCE_PATHS = {
  ...FACILITY_PATHS,
  ...NETWORK_PATHS,
  ...FIRMWARE_PATHS,
  ...OS_PATHS,
  ...DB_PATHS,
  ...OVERLAY_PATHS,
  ...SERVER_PATHS,
  ...SITE_PATHS,
  ...ACCEL_PATHS,
  ...REST_PATHS,
} satisfies Readonly<Record<ReferenceKey, ReferencePath>>;

/** Sheets that are solved differently from the path of their fault kind, by template id. */
export const REFERENCE_VARIANTS: Readonly<Record<string, ReferencePath>> = {
  ...FIRMWARE_VARIANTS,
  ...DB_VARIANTS,
  ...ACCEL_VARIANTS,
};
