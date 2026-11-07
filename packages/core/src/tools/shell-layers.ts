/**
 * The commands other layers add to the shell (ADR-0117): `kubectl` and `crictl` of the container layer (REQ-096).
 * They are registered once, when the tool layer loads; the fake shell then finds them like its own commands. What
 * they print is made in `shell-k8s.ts`, from the state of the cluster the host is a node of.
 */
import {
  type ShellCmd as Cmd,
  type ShellCmdResult as R,
  registerShellCommand,
} from "@terrarium/core/world";
import { istioctl } from "./shell-app";
import { crictl, kubectl, type ShellOut } from "./shell-k8s";

const NOT_YET = /^이 (kubectl|crictl|istioctl) 명령은 아직 못 해요/;

/** The answer of a layer command in the shape of the shell; a thing it cannot do is listed as outside. */
function asR(c: Cmd, out: ShellOut): R {
  const failed = out.exitCode === 0 ? undefined : out.output;
  const outside =
    out.exitCode === 127
      ? c.name
      : failed && NOT_YET.test(failed)
        ? `${c.name} ${c.args.slice(0, 2).join(" ")}`
        : undefined;
  return {
    ...(failed
      ? { out: "", err: `${failed}\n` }
      : { out: out.output === "" ? "" : `${out.output}\n` }),
    code: out.exitCode,
    ...(outside ? { outside } : {}),
  };
}

registerShellCommand("kubectl", (c) => asR(c, kubectl(c.world, c.h.id, [c.name, ...c.args])));
registerShellCommand("crictl", (c) => asR(c, crictl(c.world, c.h.id, [c.name, ...c.args])));
registerShellCommand("istioctl", (c) => asR(c, istioctl(c.world, [c.name, ...c.args].slice(1))));
