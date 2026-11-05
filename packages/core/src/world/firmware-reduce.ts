/** How the firmware commands change a server's state (ADR-0101); `World.reduce` hands the state and the command here. */
import {
  FIRMWARE_LABELS,
  type FirmwareCommand,
  type FirmwareComponent,
  REBOOT_SECONDS,
  STAGE_SECONDS,
} from "./firmware";
import type { ServerState } from "./state";

type Update = {
  readonly component: FirmwareComponent;
  readonly version: string;
  readonly fails: boolean;
};

/** The update starts: the image is staged and the reboot is planned. */
export function startUpdate(server: ServerState, now: number, update: Update): void {
  server.fw = {
    component: update.component,
    version: update.version,
    startedAt: now,
    rebootAt: now + STAGE_SECONDS,
    doneAt: now + STAGE_SECONDS + REBOOT_SECONDS[update.component],
    fails: update.fails,
  };
}

/** The server goes down for the update. A server somebody had switched off stays off afterwards. */
export function rebootForUpdate(server: ServerState): void {
  if (!server.fw) return;
  server.fw = { ...server.fw, restoreOn: server.adminOn };
  server.rebooting = true;
  server.adminOn = false;
}

function comeBack(server: ServerState): void {
  if (server.fw?.restoreOn && !server.adminOn) server.adminOn = true;
  server.rebooting = false;
  server.fw = undefined;
}

/** The new version runs, and an earlier failure is forgotten. */
export function finishUpdate(server: ServerState): void {
  const job = server.fw;
  if (!job) return;
  if (job.component === "bmc") server.bmcVersion = job.version;
  else server.biosVersion = job.version;
  server.fwFailed = undefined;
  comeBack(server);
}

/** The update did not take: the old version stays and the server warns until an update works. */
export function failUpdate(server: ServerState): void {
  const job = server.fw;
  if (!job) return;
  server.fwFailed = `${FIRMWARE_LABELS[job.component]} ${job.version}`;
  comeBack(server);
}

/** Apply a firmware command to its server. */
export function reduceFirmware(server: ServerState, command: FirmwareCommand, now: number): void {
  if (command.type === "firmware.update") startUpdate(server, now, command);
  else if (command.type === "firmware.reboot") rebootForUpdate(server);
  else if (command.type === "firmware.finish") finishUpdate(server);
  else failUpdate(server);
}
