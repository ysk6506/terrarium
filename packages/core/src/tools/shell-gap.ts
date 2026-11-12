/**
 * The gaps of the layer commands of the shell (`kubectl`, `crictl`, `istioctl`, `dcgmi`; ADR-0184). Each has a
 * list of what the real tool knows; a subcommand on that list that the fake does not do is a gap (the real tool would run
 * it), a word on no list is a mistake the real tool also rejects and gets the tool's own error text, with no hint.
 */
import { type GapNotice, gapText } from "@terrarium/core/world";

export interface ShellOut {
  readonly output: string;
  readonly exitCode: number;
  /** Set when the real tool does what was asked and the fake does not. */
  readonly gap?: GapNotice;
}

/** What the fake does of a tool: how it reads in the hint, a command that works, and the real subcommands. */
export interface LayerTool {
  readonly tool: string;
  readonly supported: string;
  readonly example: string;
  readonly real: ReadonlySet<string>;
}

const words = (s: string): ReadonlySet<string> => new Set(s.split(" "));

export const KUBECTL: LayerTool = {
  tool: "kubectl",
  supported: "get nodes|pods|deployments [-n <ns>], describe node <name>",
  example: "kubectl get pods",
  real: words(
    "annotate api-resources api-versions apply attach auth autoscale certificate cluster-info completion config cordon cp create debug delete describe diff drain edit events exec explain expose get kustomize label logs options patch plugin port-forward proxy replace rollout run scale set taint top uncordon version wait",
  ),
};

export const CRICTL: LayerTool = {
  tool: "crictl",
  supported: "ps",
  example: "crictl ps",
  real: words(
    "attach checkpoint completion config create exec exec-sync images img imagefsinfo info inspect inspecti inspectp logs pods port-forward ps pull rm rmi rmp run runp start stats statsp status stop stopp update version",
  ),
};

export const ISTIOCTL: LayerTool = {
  tool: "istioctl",
  supported: "proxy-status (ps)",
  example: "istioctl proxy-status",
  real: words(
    "admin analyze authz bug-report completion create-remote-secret dashboard experimental help install kube-inject manifest operator proxy-config proxy-status ps remote-clusters tag uninstall upgrade validate verify-install version waypoint x ztunnel-config",
  ),
};

export const DCGMI: LayerTool = {
  tool: "dcgmi",
  supported: "diag",
  example: "dcgmi diag -r 1",
  real: words(
    "config diag discovery dmon group health help introspect modules nvlink policy profile stats test topo fieldgroup",
  ),
};

/** `kubectl get`/`describe` resource types the real kubectl knows (names and the short names). */
export const KUBECTL_RESOURCES: ReadonlySet<string> = words(
  "pods pod po services service svc deployments deployment deploy nodes node no namespaces namespace ns configmaps configmap cm secrets secret ingresses ingress ing daemonsets daemonset ds statefulsets statefulset sts replicasets replicaset rs jobs job cronjobs cronjob cj events event ev persistentvolumes persistentvolume pv persistentvolumeclaims persistentvolumeclaim pvc endpoints endpoint ep horizontalpodautoscalers hpa serviceaccounts serviceaccount sa networkpolicies networkpolicy netpol storageclasses storageclass sc roles role rolebindings rolebinding clusterroles clusterrole clusterrolebindings clusterrolebinding customresourcedefinitions crd crds",
);

/** The gap notice of a real thing the fake lacks: the `terrarium:` lines only, since the real tool would run it. */
export function layerGap(t: LayerTool, feature: string, what: string, exitCode = 1): ShellOut {
  const gap = { tool: t.tool, feature, what, supported: t.supported, example: t.example };
  return { output: gapText(gap), exitCode, gap };
}

/** A subcommand the fake does not do: a gap when the real tool has it, the tool's own error when no tool has it. */
export function subcommandGap(t: LayerTool, sub: string | undefined): ShellOut {
  if (sub === undefined || sub === "") return { output: `Usage: ${t.tool} [command]`, exitCode: 1 };
  if (!t.real.has(sub))
    return { output: `Error: unknown command "${sub}" for "${t.tool}"`, exitCode: 1 };
  return layerGap(t, sub, sub);
}
