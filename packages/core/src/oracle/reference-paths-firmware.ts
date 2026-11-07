/** Reference paths of the firmware work (REQ-110, ADR-0133): one image at a time, and wait until the server is back. */
import { change, eachServer, path, type ReferencePath, read } from "./reference-path";

const BMC_WAIT_S = 260;
const BIOS_WAIT_S = 400;

const image = (name: string) =>
  change("redfish_request", {
    server: "{target}",
    method: "POST",
    path: "/redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate",
    body: { ImageURI: `http://repo.local/fw/${name}` },
  });
const wait = (seconds: number) => change("wait", { seconds });
const look = read("get_entity", { id: "{target}" });

/** BIOS on every server the sheet names, one after another. */
const BIOS_ROUND = path([], [eachServer(image("bios-2.4.1.bin"), wait(BIOS_WAIT_S))], [], {
  settleS: 1,
});

export const FIRMWARE_PATHS = {
  firmware_update: BIOS_ROUND,
  // a failed update leaves an alarm and the old version: the same image once more, which mends it
  firmware_update_failure: path(
    [],
    [
      eachServer(image("bios-2.4.1.bin"), wait(BIOS_WAIT_S)),
      eachServer(image("bios-2.4.1.bin"), wait(BIOS_WAIT_S)),
    ],
    [],
    { settleS: 1 },
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;

/** The sheet that asks for the BMC as well as the BIOS, on the one empty server. */
export const FIRMWARE_VARIANTS = {
  "firmware-one": path(
    [look],
    [
      eachServer(
        image("bmc-8.40.bin"),
        wait(BMC_WAIT_S),
        image("bios-2.4.1.bin"),
        wait(BIOS_WAIT_S),
      ),
    ],
    [],
    { settleS: 1 },
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;
