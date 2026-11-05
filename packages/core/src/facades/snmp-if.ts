/**
 * IF-MIB (RFC 2863) for a switch (REQ-002, ADR-0057): one interface per port, up when its link is up.
 * The ports and their names are the ones the switch's CLI shows (netos-model.ts), and `ifAdminStatus` can
 * be set to shut or open a port. Interface counters are not modelled by the world, so they are defined but
 * not populated.
 */
import { manufacturerOf } from "@terrarium/core/catalog";
import type { Entity, WorldReader } from "@terrarium/core/world";
import { osOf, type PortView, portsOf } from "./netos-model";
import type { ErrorStatus, Mib, MibObject, MibVar } from "./snmp-core";
import { MibBuilder, merge, type Overlay, object, systemMib, writableText } from "./snmp-mibs";

const M = "IF-MIB";
const T = "1.3.6.1.2.1.2.2.1";
const X = "1.3.6.1.2.1.31.1.1.1";

const ADMIN = { 1: "up", 2: "down", 3: "testing" };
const OPER = {
  1: "up",
  2: "down",
  3: "testing",
  4: "unknown",
  5: "dormant",
  6: "notPresent",
  7: "lowerLayerDown",
};

const OBJECTS: readonly MibObject[] = [
  object(`${M}::ifNumber`, "1.3.6.1.2.1.2.1", "INTEGER"),
  object(`${M}::ifIndex`, `${T}.1`, "INTEGER"),
  object(`${M}::ifDescr`, `${T}.2`, "OCTET STRING"),
  object(`${M}::ifType`, `${T}.3`, "INTEGER"),
  object(`${M}::ifMtu`, `${T}.4`, "INTEGER"),
  object(`${M}::ifSpeed`, `${T}.5`, "Gauge32"),
  object(`${M}::ifAdminStatus`, `${T}.7`, "INTEGER", "read-write", ADMIN),
  object(`${M}::ifOperStatus`, `${T}.8`, "INTEGER", "read-only", OPER),
  object(`${M}::ifInOctets`, `${T}.10`, "Counter32"),
  object(`${M}::ifOutOctets`, `${T}.16`, "Counter32"),
  object(`${M}::ifName`, `${X}.1`, "OCTET STRING"),
  object(`${M}::ifHighSpeed`, `${X}.15`, "Gauge32"),
  object(`${M}::ifAlias`, `${X}.18`, "OCTET STRING", "read-write"),
];

const ETHERNET_CSMACD = 6;
const MTU = 1500;
const MAX_GAUGE32 = 4_294_967_295;

/** ifAdminStatus: 1 (up) and 2 (down) are settable; `testing` is not supported. */
function adminSetter(port: PortView, shut: (port: PortView, down: boolean) => void): MibVar["set"] {
  return {
    check: (value): ErrorStatus => (value === 1 || value === 2 ? "noError" : "wrongValue"),
    apply: (value) => shut(port, value === 2),
  };
}

export function ifMib(
  world: WorldReader,
  entity: Entity,
  overlay: Overlay,
  shut: (port: PortView, down: boolean) => void,
): Mib {
  const model = world.catalog.getOf(entity.modelId ?? "", "switch");
  const ports = portsOf(world, entity, osOf(entity, model), overlay);
  const b = new MibBuilder(OBJECTS).scalar("ifNumber", ports.length);
  for (const port of ports) {
    const n = port.n;
    b.add("ifIndex", [n], n)
      .add("ifDescr", [n], port.name)
      .add("ifType", [n], ETHERNET_CSMACD)
      .add("ifMtu", [n], MTU)
      .add("ifSpeed", [n], Math.min(MAX_GAUGE32, model.portSpeedGbps * 1e9))
      .add("ifAdminStatus", [n], port.shut ? 2 : 1, adminSetter(port, shut))
      .add("ifOperStatus", [n], port.up ? 1 : 2)
      .add("ifName", [n], port.name)
      .add("ifHighSpeed", [n], model.portSpeedGbps * 1000)
      .add("ifAlias", [n], port.description, writableText(overlay, `ifAlias.${n}`, 64));
  }
  return merge(
    systemMib(
      world,
      entity,
      {
        description: `${manufacturerOf(model)} ${model.name}`,
        objectId: "1.2",
        services: model.role === "spine" ? 6 : 2,
      },
      overlay,
    ),
    b.build(),
  );
}
