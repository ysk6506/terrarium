/**
 * The configuration blocks of the scenario editor (REQ-068): things a person does to the network or a PDU,
 * on purpose or by mistake. Each one is an ordinary operator command (a shut port, a VLAN on a port, a shut
 * gateway interface, a shut BGP neighbor, a deleted route, a switched-off outlet), so an agent undoes it with
 * the same commands, and the scoring can tell a fix from a bystander's change. net-blocks.ts runs and checks them.
 */
import type { MistakeType } from "@terrarium/core/world";
import type { BlockSpec, NetPick, ParamSpec } from "./blocks";

const sw: ParamSpec = { name: "target", label: "스위치", kind: "entity", kinds: ["switch"] };

const flag = (name: string, label: string, help: string): ParamSpec => ({
  name,
  label,
  kind: "boolean",
  default: true,
  help,
});

/** A choice that depends on the switch (or PDU) picked above it, offered from what that device really has. */
const pick = (name: string, label: string, kind: NetPick, help: string): ParamSpec => ({
  name,
  label,
  kind: "net_pick",
  pick: kind,
  dependsOn: "target",
  help,
});

const block = (
  type: string,
  label: string,
  description: string,
  params: readonly ParamSpec[],
  needsAnyOf: BlockSpec["needsAnyOf"] = ["switch"],
): BlockSpec => ({
  type,
  category: "operation",
  label,
  description,
  hasInput: true,
  outputs: ["next"],
  params,
  status: "supported",
  needsAnyOf,
});

export const NET_BLOCK_SPECS: readonly BlockSpec[] = [
  block(
    "port_admin",
    "스위치 포트 끄기/켜기",
    "스위치의 포트 하나를 관리자가 끄거나(shutdown) 다시 켜요(no shutdown). 포트는 그 포트에 케이블로 이어진 장비로 골라요.",
    [
      sw,
      pick("peer", "포트 건너편 장비", "cabled_peer", "이 장비로 가는 케이블이 꽂힌 포트예요."),
      flag(
        "down",
        "끄기",
        "끄면 그 케이블로는 통신이 안 돼요. 켜면 되살아나요(고장으로 끊긴 케이블은 그대로예요).",
      ),
    ],
  ),
  block(
    "port_vlan",
    "포트 VLAN 바꾸기",
    "스위치 포트를 다른 VLAN의 접근 포트로 바꿔요. 서버가 엉뚱한 VLAN에 들어가면 게이트웨이에 연결하지 못해요.",
    [
      sw,
      pick(
        "peer",
        "포트 건너편 장비",
        "cabled_peer",
        "이 장비로 가는 케이블이 꽂힌 포트를 바꿔요.",
      ),
      {
        name: "vlan",
        label: "VLAN 번호",
        kind: "number",
        min: 1,
        max: 4094,
        unit: "번",
        default: 999,
        integer: true,
        help: "스위치에 없는 번호를 넣으면 그 VLAN에는 아무도 없어서 서버가 갇혀요.",
      },
    ],
  ),
  block(
    "svi_admin",
    "VLAN 인터페이스 끄기/켜기",
    "스위치의 VLAN 인터페이스(SVI)를 끄거나 켜요. 서버들의 게이트웨이가 이 인터페이스라서 꺼지면 그 VLAN은 밖으로 못 나가요.",
    [
      sw,
      pick(
        "vlan",
        "VLAN 인터페이스",
        "svi_vlan",
        "이 스위치에 있는 VLAN 인터페이스 중에서 골라요.",
      ),
      flag("down", "끄기", "끄면 shutdown, 켜면 no shutdown이에요."),
    ],
  ),
  block(
    "bgp_admin",
    "BGP 이웃 끄기/켜기",
    "BGP 이웃 하나를 끄거나 켜요. 끄면 그 이웃에게 배운 경로가 사라지고, 남은 길로 돌아가거나 길을 잃어요.",
    [
      sw,
      pick("peer", "BGP 이웃", "bgp_peer", "케이블로 이어진 위쪽 스위치(스파인)예요."),
      flag("down", "끄기", "끄면 neighbor … shutdown, 켜면 no neighbor … shutdown이에요."),
    ],
  ),
  block(
    "route_del",
    "정적 경로 지우기",
    "스위치의 정적 경로 하나를 지워요. 그쪽으로 가는 패킷이 길을 잃어요.",
    [sw, pick("route", "지울 경로", "static_route", "이 스위치에 손으로 적힌 경로 중에서 골라요.")],
  ),
  block(
    "outlet_set",
    "PDU 콘센트 끄기/켜기",
    "PDU의 콘센트 하나를 끄거나 켜요. 끄면 거기 꽂힌 장비가 그쪽 전원을 잃어요(전원이 둘이면 다른 쪽으로 버텨요).",
    [
      { name: "target", label: "전원 분배기(PDU)", kind: "entity", kinds: ["pdu"] },
      pick("outlet", "콘센트", "outlet", "꽂힌 장비의 이름으로 골라요."),
      { name: "on", label: "켜기", kind: "boolean", default: false, help: "끄려면 끄세요." },
    ],
    ["pdu"],
  ),
];

/** The block types above, for the runner and the validator to pick them out. */
export const NET_BLOCK_TYPES: ReadonlySet<string> = new Set(NET_BLOCK_SPECS.map((b) => b.type));

/** The mistake each block makes, so a scenario that scores a diagnosis of it is not told the answer is never caused. */
export const MISTAKE_OF_BLOCK: Readonly<Record<string, MistakeType>> = {
  port_admin: "port_shutdown",
  port_vlan: "port_vlan_mismatch",
  svi_admin: "svi_shutdown",
  bgp_admin: "bgp_neighbor_shutdown",
  route_del: "route_missing",
  outlet_set: "outlet_off",
};
