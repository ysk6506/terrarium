/**
 * Which management protocol each kind of equipment speaks (ADR-0057). Real equipment is not uniform: a
 * server has a Redfish BMC, a rack PDU or CDU has a Redfish controller, a UPS has an SNMP card (UPS-MIB),
 * and cooling and plant equipment is on the building's BACnet network. Asking the wrong protocol gets the
 * answer a real device gives: nothing there, with a hint of what does answer.
 */
import type { Entity, EntityKind } from "@terrarium/core/world";

export type Protocol = "redfish" | "snmp" | "bacnet" | "cli" | "eapi" | "nxapi";

const PROTOCOLS: Readonly<Partial<Record<EntityKind, readonly Protocol[]>>> = {
  server: ["redfish"],
  switch: ["snmp", "cli"],
  pdu: ["redfish"],
  power_panel: ["redfish", "bacnet"],
  ups: ["snmp", "bacnet"],
  cdu: ["redfish", "bacnet"],
  cooling_unit: ["bacnet"],
  chiller: ["bacnet"],
  generator: ["bacnet"],
};

const NAMES: Readonly<Record<Protocol, string>> = {
  redfish: "Redfish",
  snmp: "SNMP",
  bacnet: "BACnet",
  cli: "CLI (SSH)",
  eapi: "Arista eAPI",
  nxapi: "Cisco NX-API",
};

export const speaks = (kind: EntityKind, protocol: Protocol): boolean =>
  PROTOCOLS[kind]?.includes(protocol) ?? false;

/** The protocols `kind` answers on, for an error message. */
export const protocolsOf = (kind: EntityKind): readonly Protocol[] => PROTOCOLS[kind] ?? [];

/** Why a request got no answer: no such equipment, or equipment that does not speak this protocol. */
export function noService(entity: Entity | undefined, id: string, protocol: Protocol): string {
  if (!entity) return `no equipment '${id}'`;
  const other = protocolsOf(entity.kind).map((p) => NAMES[p]);
  const hint =
    other.length > 0 ? `; it speaks ${other.join(" and ")}` : "; it has no management interface";
  return `'${id}' (${entity.kind}) has no ${NAMES[protocol]} service${hint}`;
}
