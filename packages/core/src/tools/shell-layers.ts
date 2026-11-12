/**
 * The commands other layers add to the shell (ADR-0117): `kubectl` and `crictl` of the container layer (REQ-096).
 * They are registered once, when the tool layer loads; the fake shell then finds them like its own commands. What
 * they print is made in `shell-k8s.ts`, from the state of the cluster the host is a node of.
 */
import {
  type ShellCmd as Cmd,
  gapOf,
  gapText,
  type ShellCmdResult as R,
  registerShellCommand,
} from "@terrarium/core/world";
import { dcgmi, ibstat, nvidiaSmi } from "./shell-accel";
import { istioctl } from "./shell-app";
import type { ShellOut } from "./shell-gap";
import { crictl, kubectl } from "./shell-k8s";

/**
 * The answer of a layer command in the shape of the shell. A gap (the real tool does it, the fake does not) gets the
 * `terrarium:` lines (ADR-0184); `command not found` (a host that is not a node) stays plain and is listed as outside.
 */
function asR(c: Cmd, out: ShellOut): R {
  const failed = out.exitCode === 0 ? undefined : out.output;
  if (out.gap)
    return {
      out: "",
      err: `${gapText(out.gap)}\n`,
      code: out.exitCode,
      gap: gapOf(out.gap),
      outside: `${c.name} ${c.args.slice(0, 2).join(" ")}`,
    };
  return {
    ...(failed
      ? { out: "", err: `${failed}\n` }
      : { out: out.output === "" ? "" : `${out.output}\n` }),
    code: out.exitCode,
    ...(out.exitCode === 127 ? { outside: c.name } : {}),
  };
}

registerShellCommand("kubectl", (c) => asR(c, kubectl(c.world, c.h.id, [c.name, ...c.args])));
registerShellCommand("crictl", (c) => asR(c, crictl(c.world, c.h.id, [c.name, ...c.args])));
registerShellCommand("istioctl", (c) => asR(c, istioctl(c.world, [c.name, ...c.args].slice(1))));
registerShellCommand("nvidia-smi", (c) => asR(c, nvidiaSmi(c.world, c.h, c.args)));
registerShellCommand("ibstat", (c) => asR(c, ibstat(c.world, c.h)));
registerShellCommand("dcgmi", (c) => asR(c, dcgmi(c.world, c.h, c.args)));
