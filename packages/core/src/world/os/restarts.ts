/** How many times a process was started again since the host booted (systemd's restart counter). */
import type { OsHost } from "./host";

export const procRestarts = (h: OsHost, name: string): number =>
  h.os.processes.find((p) => p.name === name)?.restarts ?? 0;
