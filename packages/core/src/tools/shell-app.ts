/**
 * What the fake shell prints for the service mesh (REQ-100): `istioctl proxy-status`, one line per sidecar with the
 * state of its configuration against the control plane. As everywhere in the shell the output is made from the state
 * in the shape of the real tool; a control plane that is down is the error the real tool prints.
 */
import { meshControls, type WorldPort } from "@terrarium/core/world";
import { ISTIOCTL, type ShellOut, subcommandGap } from "./shell-gap";

export type { ShellOut };

const COLUMNS = ["NAME", "CLUSTER", "CDS", "LDS", "EDS", "RDS", "ISTIOD", "VERSION"];

function table(rows: readonly (readonly string[])[]): string {
  const widths = COLUMNS.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows
    .map((r) =>
      r
        .map((c, i) => c.padEnd((widths[i] ?? 0) + 3))
        .join("")
        .trimEnd(),
    )
    .join("\n");
}

export function istioctl(world: WorldPort, args: readonly string[]): ShellOut {
  const control = meshControls(world.index)[0];
  if (!control)
    return { output: "Error: could not find any Istio installation in this cluster", exitCode: 1 };
  if (args[0] !== "proxy-status" && args[0] !== "ps") return subcommandGap(ISTIOCTL, args[0]);
  const c = world.stateAs(control.id, "mesh_control");
  if (c.status === "down")
    return {
      output:
        "Error: unable to retrieve Istiod debug information: connection refused (istiod is not running)",
      exitCode: 1,
    };
  const rows = [...world.index.ofKind("mesh_sidecar")]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => {
      const s = world.stateAs(e.id, "mesh_sidecar");
      const word =
        s.status === "down" ? "NOT SENT" : s.revision === c.revision ? "SYNCED" : "STALE";
      const instance = world.index.outgoing(e.id, "hosted_on")[0]?.to ?? e.id;
      return [
        `${instance}.default`,
        "Kubernetes",
        word,
        word,
        word,
        word,
        `${control.id}-7d9f8b6c5-x2k4p`,
        "1.20.3",
      ];
    });
  return { output: table([COLUMNS, ...rows]), exitCode: 0 };
}
