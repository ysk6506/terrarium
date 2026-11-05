/**
 * Firmware on a server (REQ-002, ADR-0101): the BMC and the BIOS each have a version, an update is a job that
 * stages the image, reboots the server for a few minutes and then either takes the new version or fails, and a
 * failed update leaves the old version in place with a warning until a later update (or a rollback) succeeds.
 * The numbers and the image names are here so the world, the physics and the Redfish facade agree.
 */

export type FirmwareComponent = "bmc" | "bios";

export const FIRMWARE_COMPONENTS: readonly FirmwareComponent[] = ["bmc", "bios"];

export const FIRMWARE_LABELS: Readonly<Record<FirmwareComponent, string>> = {
  bmc: "BMC",
  bios: "BIOS",
};

/** What a server runs until someone updates it. The BMC shows its profile's own version in this case. */
export const SHIPPED_FIRMWARE: Readonly<Record<FirmwareComponent, string>> = {
  bmc: "shipped",
  bios: "1.0.0",
};

/** Seconds from the update request until the server reboots (the image is copied and checked). */
export const STAGE_SECONDS = 120;
/** Seconds the server stays down for the update to finish. */
export const REBOOT_SECONDS: Readonly<Record<FirmwareComponent, number>> = { bmc: 120, bios: 240 };

/** A running update. `rebootAt` and `doneAt` are world seconds. */
export interface FirmwareJob {
  readonly component: FirmwareComponent;
  readonly version: string;
  readonly startedAt: number;
  readonly rebootAt: number;
  readonly doneAt: number;
  /** Whether it will fail when it ends (decided when it starts, from the faults on the server). */
  readonly fails: boolean;
  /** Whether the server was on when the reboot began (it is switched back on when the update ends). */
  readonly restoreOn?: boolean;
}

/** The world commands of a firmware update: an operator starts it; the physics takes it through the reboot and its end. */
export type FirmwareCommand =
  | {
      readonly type: "firmware.update";
      readonly target: string;
      readonly component: FirmwareComponent;
      readonly version: string;
      /** Decided when the update starts: it will fail at the end. */
      readonly fails: boolean;
    }
  | { readonly type: "firmware.reboot"; readonly target: string }
  | { readonly type: "firmware.finish"; readonly target: string }
  | { readonly type: "firmware.fail"; readonly target: string };

const IMAGE = /(?:^|[/_.-])(bmc|bios)[-_ ]?v?(\d+(?:\.\d+){1,3})(?=[._-]|$)/i;

/** The part and version an image name stands for: `http://repo/fw/bios-2.4.1.bin` is BIOS 2.4.1. */
export function parseImage(
  uri: string,
): { readonly component: FirmwareComponent; readonly version: string } | undefined {
  const file = uri.split(/[?#]/)[0]?.split("/").at(-1) ?? "";
  const found = IMAGE.exec(file);
  if (!found) return undefined;
  return {
    component: (found[1] as string).toLowerCase() as FirmwareComponent,
    version: found[2] as string,
  };
}

/** The image name for a part and version, as the repository serves it. */
export const imageName = (component: FirmwareComponent, version: string): string =>
  `${component}-${version}.bin`;

/** Seconds the whole update takes from the request to the end. */
export const updateSeconds = (component: FirmwareComponent): number =>
  STAGE_SECONDS + REBOOT_SECONDS[component];

/** The world as far as deciding whether an update fails needs it. */
interface FaultReader {
  faultsOn(target: string): readonly {
    readonly type: string;
    readonly since: number;
    readonly params: Readonly<Record<string, number>>;
  }[];
  events(): readonly { readonly type: string; readonly t: number; readonly target?: string }[];
}

/** Whether an update started now on this server fails: its fault lets the first `failures` updates fail and then lets one work. */
export function willFail(world: FaultReader, server: string): boolean {
  const fault = world.faultsOn(server).find((f) => f.type === "firmware_update_failure");
  if (!fault) return false;
  const before = world
    .events()
    .filter((e) => e.type === "firmware.fail" && e.target === server && e.t >= fault.since).length;
  return before < (fault.params.failures ?? 1);
}
