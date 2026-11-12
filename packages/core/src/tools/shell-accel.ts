/**
 * What the fake shell prints for the accelerator layer (REQ-107): `nvidia-smi`, `nvidia-smi -q -d TEMPERATURE,POWER`,
 * `ibstat` and `dcgmi diag -r 1`. They are made from the state the physics keeps, in the shape of the real tools.
 */
import { Accel, type Entity, type WorldPort } from "@terrarium/core/world";
import { DCGMI, type ShellOut, subcommandGap } from "./shell-gap";

const NO_DRIVER =
  "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is installed and running.";

function serverOf(world: WorldPort, host: { readonly id: string }): string | undefined {
  return Accel.gpusOf(world.index, host.id).length > 0 ? host.id : undefined;
}

function row(world: WorldPort, g: Entity, i: number): string[] {
  const s = world.stateAs(g.id, "gpu");
  const total = Number(g.props.memGiB ?? 80) * 1024;
  const state = s.status === "down" ? "ERR!" : `${Math.round(s.tempC)}C`;
  return [
    `${i}  ${String(g.props.model ?? "GPU")}`,
    s.status === "down" ? "ERR!" : `${state}  P${s.throttled ? 2 : 0}  ${Math.round(s.powerW)}W`,
    `${Math.round(s.memUsedGiB * 1024)}MiB / ${total}MiB`,
    `${s.utilPct}%`,
    s.xidErrors > 0 ? `Xid ${s.xidErrors}` : "-",
  ];
}

export function nvidiaSmi(
  world: WorldPort,
  host: { readonly id: string },
  args: readonly string[],
): ShellOut {
  const id = serverOf(world, host);
  if (!id) return { output: NO_DRIVER, exitCode: 9 };
  const gpus = Accel.gpusOf(world.index, id);
  if (args.includes("-q")) {
    return {
      output: gpus
        .map((g, i) => {
          const s = world.stateAs(g.id, "gpu");
          return [
            `GPU ${i}: ${String(g.props.model ?? "GPU")}`,
            "    Temperature",
            `        GPU Current Temp            : ${Math.round(s.tempC)} C`,
            `        GPU Slowdown Temp           : ${Accel.GPU_THROTTLE_C} C`,
            `        Clocks Throttle Reasons     : ${s.throttled ? "HW Thermal Slowdown Active" : "Not Active"}`,
            "    Power Readings",
            `        Power Draw                  : ${s.powerW.toFixed(2)} W`,
            `        Max Power Limit             : ${Number(g.props.tdpW ?? 700).toFixed(2)} W`,
          ].join("\n");
        })
        .join("\n\n"),
      exitCode: 0,
    };
  }
  const lines = [
    `GPU  Name                 Temp/Perf/Pwr        Memory-Usage          GPU-Util  Errors`,
    ...gpus.map((g, i) => row(world, g, i).join("   ")),
  ];
  const bad = gpus.filter((g) => world.stateAs(g.id, "gpu").status === "down");
  if (bad.length > 0)
    lines.push("", "Unable to determine the device handle for one or more GPUs: GPU is lost (Xid)");
  return { output: lines.join("\n"), exitCode: 0 };
}

export function ibstat(world: WorldPort, host: { readonly id: string }): ShellOut {
  const link = world.index.ofKind("ib_link").find((l) => Accel.serverOfAccel(l) === host.id);
  if (!link) return { output: "ibpanic: stat: no IB devices found", exitCode: 1 };
  const s = world.stateAs(link.id, "ib_link");
  const up = s.status === "up";
  return {
    output: [
      `CA 'mlx5_0'`,
      "\tCA type: MT4129",
      "\tNumber of ports: 1",
      "\tPort 1:",
      `\t\tState: ${up ? "Active" : "Down"}`,
      `\t\tPhysical state: ${up ? "LinkUp" : "Polling"}`,
      `\t\tRate: ${up ? Number(link.props.gbps ?? 400) : 10}`,
      `\t\tLink flaps: ${s.flaps}`,
    ].join("\n"),
    exitCode: 0,
  };
}

export function dcgmi(
  world: WorldPort,
  host: { readonly id: string },
  args: readonly string[],
): ShellOut {
  const id = serverOf(world, host);
  if (!id) return { output: "Error: Unable to connect to the DCGM host engine", exitCode: 1 };
  if (args[0] !== "diag") return subcommandGap(DCGMI, args[0]);
  const gpus = Accel.gpusOf(world.index, id);
  const lines = gpus.map((g, i) => {
    const s = world.stateAs(g.id, "gpu");
    const verdict = s.status === "down" ? "Fail" : s.throttled || s.xidErrors > 0 ? "Warn" : "Pass";
    return `GPU ${i}: Software/Deployment ${verdict}${s.status === "down" ? " (Xid errors detected)" : s.throttled ? " (thermal throttling)" : ""}`;
  });
  return { output: ["Successfully ran diagnostic for group.", ...lines].join("\n"), exitCode: 0 };
}
