/**
 * The tools of the SDN overlay and cloud-native network layers (REQ-097, ADR-0107 item 6): look at the controllers, push a
 * switch's configuration again, make the standby controller the active one, trace a path through the overlay, read the EVPN
 * sessions, list and revert network policies, look at and restart the ingress. They live in a file of their own, like the
 * database tools, and are added to the catalog at its end. All belong to the network team (domains.ts); every one is a tool
 * an operations team has (`common`) except the overlay trace, which only a few teams own (`rare`).
 */
import type { JsonSchema, ToolSpec } from "./catalog";
import type { ToolDoc } from "./docs";

type SdnSpec = Omit<ToolSpec, "realism" | "description" | "area">;

const obj = (properties: JsonSchema["properties"], required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
});
const str = (description: string) => ({ type: "string", description });

export const SDN_SPECS: readonly SdnSpec[] = [
  {
    name: "sdn_status",
    title: "SDN 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({
      controller: str(
        "SDN controller id; leave out to see every controller, the VTEPs and the segments",
      ),
    }),
  },
  {
    name: "sdn_sync",
    title: "스위치 설정 재동기화",
    category: "act",
    mutating: true,
    inputSchema: obj(
      { switch: str("Switch id (or its VTEP id) whose configuration is pushed again") },
      ["switch"],
    ),
  },
  {
    name: "sdn_failover",
    title: "SDN 컨트롤러 전환",
    category: "act",
    mutating: true,
    inputSchema: obj({
      controller: str(
        "Standby controller id to make the active one; leave out for the standby that is up",
      ),
    }),
  },
  {
    name: "overlay_trace",
    title: "오버레이 경로 추적",
    category: "observe",
    mutating: false,
    inputSchema: obj(
      {
        src: str("Server, VM or service id the traffic starts at"),
        dst: str("Server, VM or service id it goes to"),
      },
      ["src", "dst"],
    ),
  },
  {
    name: "evpn_sessions",
    title: "EVPN 세션",
    category: "observe",
    mutating: false,
    inputSchema: obj({ vtep: str("VTEP id or switch id; leave out to see every VTEP") }),
  },
  {
    name: "policy_list",
    title: "네트워크 정책 목록",
    category: "observe",
    mutating: false,
    inputSchema: obj({ ns: str("Only the policies of this namespace") }),
  },
  {
    name: "policy_revert",
    title: "네트워크 정책 되돌리기",
    category: "act",
    mutating: true,
    inputSchema: obj({ policy: str("Network policy id to put back to its previous rule") }, [
      "policy",
    ]),
  },
  {
    name: "ingress_status",
    title: "인그레스 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({ ingress: str("Only this ingress id; leave out to see every ingress") }),
  },
  {
    name: "ingress_restart",
    title: "인그레스 다시 시작",
    category: "act",
    mutating: true,
    inputSchema: obj({
      ingress: str("Ingress id; leave out to restart every ingress that is down"),
    }),
  },
];

const d = (doc: ToolDoc): ToolDoc => doc;

export const SDN_DOCS: Readonly<Record<string, ToolDoc>> = {
  sdn_status: d({
    area: "network",
    realism: "common",
    summary:
      "The SDN overlay at a glance: each controller (active or standby, up or down, switches it manages, configuration revision), each VTEP (EVPN session, revision, whether it is cut off) and each segment.",
    use: "a service on an overlay segment is down or slow, an alarm names a controller, a VTEP or a segment, or you want to know whether the controller is up before changing a switch.",
    notUse:
      "you want the path between two hosts (use overlay_trace), a switch's own BGP sessions (use network_cli) or the policies (use policy_list).",
    example: '{"controller":"sdn-ctl-1"}',
    cost: "low",
    costWhy: "one read of the overlay",
    details:
      "A controller that is down does not stop what is already configured: flows keep running (headless) and only new configuration cannot be pushed. `autoFailover.takesOverInSeconds` says when the standby takes over by itself (30 s after the active one went down). `stale: true` on a VTEP means its configuration is one revision behind.",
  }),
  sdn_sync: d({
    area: "network",
    realism: "common",
    summary:
      "Push the controller's configuration to one switch's VTEP again and reset its EVPN session. A VTEP that kept an old configuration, or a session that flaps, is put right.",
    use: "sdn_status shows a VTEP one revision behind (stale), or evpn_sessions shows a session that flaps, and the controller is up.",
    notUse:
      "the controller is down (it refuses: use sdn_failover first), or the cause is a cut underlay (use overlay_trace to find where).",
    example: '{"switch":"tor-a"}',
    cost: "low",
    costWhy: "one switch",
    details:
      "After a reset the session needs about 10 seconds to come up again. Pushing to a healthy VTEP changes nothing.",
  }),
  sdn_failover: d({
    area: "network",
    realism: "common",
    summary:
      "Make the standby SDN controller the active one. The new active controller pushes the whole configuration again, which also ends every failed sync.",
    use: "the active controller is down and you do not want to wait for the standby to notice (30 seconds), or a controller is unhealthy and you want to move to the other.",
    notUse:
      "there is no standby, or it is down too (check with sdn_status): only the network team can bring the controller back.",
    example: '{"controller":"sdn-ctl-2"}',
    cost: "medium",
    costWhy: "one change that moves the control plane of every switch",
  }),
  overlay_trace: d({
    area: "network",
    realism: "rare",
    summary:
      "Trace a path through the overlay from one host or service to another: the VTEP at each end, the tunnel, the underlay switches and cables between them, and the first place it breaks.",
    use: "two services on one segment cannot reach each other, or a segment is cut, and you want to know whether the break is in the VTEP, the EVPN session, the configuration or a cable of the underlay.",
    notUse:
      "you want the state of one controller or session (use sdn_status or evpn_sessions), or a plain ping (use network_cli).",
    example: '{"src":"srv-a1","dst":"srv-b1"}',
    cost: "medium",
    costWhy: "walks the underlay between two leaves",
    details:
      "`brokenAt` names the entity and says in words why. A host that is not on an overlay segment gets `overlay: false` and only the underlay path.",
  }),
  evpn_sessions: d({
    area: "network",
    realism: "common",
    summary:
      "The EVPN sessions of the VTEPs: state, how many times a session flapped, seconds until a session that lost its cause comes back, the spine neighbours and the configuration revision.",
    use: "a VTEP is cut off from its segment, an alarm says an EVPN session is down, or you suspect a session that comes and goes.",
    notUse:
      "you need the whole overlay (use sdn_status) or the raw BGP table of a switch (use network_cli).",
    example: '{"vtep":"vtep-tor-a"}',
    cost: "low",
    costWhy: "one VTEP or the list",
    details:
      "After what broke a session is gone, BGP needs 90 seconds to bring it back by itself (`reestablishInSeconds`).",
  }),
  policy_list: d({
    area: "network",
    realism: "common",
    summary:
      "The network policies: namespace, the service each guards, the caller it concerns, the rule now (allow or deny), the rule before the last change and when it changed.",
    use: "two services cannot reach each other although both are up, or something was deployed shortly before the trouble started.",
    notUse:
      "the cut is between hosts and not between services (use overlay_trace), or you want to change a policy (use policy_revert).",
    example: '{"ns":"payments"}',
    cost: "low",
    costWhy: "a short list",
  }),
  policy_revert: d({
    area: "network",
    realism: "common",
    summary:
      "Put a network policy back to the rule it had before its last change. The calls it blocked go through again.",
    use: "policy_list shows a policy that denies and was changed just before the trouble began.",
    notUse:
      "the policy has not changed since it was created (nothing to go back to), or the cut is somewhere else (use overlay_trace).",
    example: '{"policy":"np-portal-db"}',
    cost: "low",
    costWhy: "one policy",
  }),
  ingress_status: d({
    area: "network",
    realism: "common",
    summary:
      "The ingress controllers, the doors from outside to the services: state, the services behind each, the node it runs on, seconds until a restarted one is up.",
    use: "users outside cannot reach a service although it works from inside the cluster, or an alarm says an ingress is closed.",
    notUse:
      "the service itself is down (use service_status) or the cut is between services (use policy_list).",
    example: '{"ingress":"ingress-portal"}',
    cost: "low",
    costWhy: "a short list",
  }),
  ingress_restart: d({
    area: "network",
    realism: "common",
    summary:
      "Restart ingress controllers. A dead one is up again after about 20 seconds; requests from outside are refused until then.",
    use: "ingress_status shows an ingress that is down.",
    notUse:
      "the ingress is up (restarting it only interrupts requests), or the cut is between services (use policy_list).",
    example: '{"ingress":"svc-portal-ingress"}',
    cost: "low",
    costWhy: "a restart of the door, a few seconds of refused requests",
    details: "Leave `ingress` out to restart every ingress that is down.",
  }),
};
