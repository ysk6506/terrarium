/** Name lookup of the fake network (ADR-0117): which names resolve, to which host, and whether a given resolver answers. */

import { serviceDef } from "../service";
import { hostVerdict, switchAlive } from "../service-health";
import type { WorldReader } from "../world";
import { ipOf, type OsHost } from "./host";
import { DEAD_RESOLVER, RESOLVERS } from "./layout";

export interface Resolved {
  readonly id: string;
  /** The service the name stands for, if it names one. */
  readonly service?: string;
}

/** A name a person types for a thing in the world: its id or name, or a service's process, with or without a domain. */
export function resolveName(world: WorldReader, name: string): Resolved | undefined {
  const bare = (name.split(".")[0] ?? "").toLowerCase();
  const direct = world.index
    .all()
    .find((e) => e.id.toLowerCase() === bare || e.name.toLowerCase() === bare);
  if (direct && direct.kind !== "service") return { id: direct.id };
  for (const s of world.index.ofKind("service")) {
    if (
      serviceDef(s).process.toLowerCase() === bare ||
      s.id.toLowerCase() === bare ||
      s.id.replace(/^svc-/, "").toLowerCase() === bare
    )
      return { id: world.stateAs(s.id, "service").runsOn[0] ?? s.id, service: s.id };
  }
  return direct ? { id: direct.id, service: direct.id } : undefined;
}

/** The address a name resolves to. */
export const addressOf = (world: WorldReader, found: Resolved): string => ipOf(world, found.id);

/** A service with the default conditions, to ask how a place is doing without a particular service in mind. */
const PROBE = serviceDef({ id: "probe", kind: "service", name: "probe", props: {} });

/** Whether something answers a ping: a switch that carries, a host that is on. */
export function pingable(world: WorldReader, id: string): boolean {
  const kind = world.index.entity(id).kind;
  if (kind === "switch") return switchAlive(world, id);
  if (kind !== "server" && kind !== "vm" && kind !== "storage") return true;
  const dead = hostVerdict(world, id, PROBE);
  return !(
    dead.state === "dead" &&
    ["power", "off", "reboot", "network", "os_down", "hardware"].includes(dead.cause ?? "")
  );
}

export const IP = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The resolver the host's resolv.conf names first. */
export function resolverOf(resolvConf: string | undefined): string {
  return /^nameserver\s+(\S+)/m.exec(resolvConf ?? "")?.[1] ?? RESOLVERS[0] ?? DEAD_RESOLVER;
}

/** Whether a resolver answers: the ones in the data centre do, a dead one does not. */
export const resolverAnswers = (server: string): boolean => RESOLVERS.includes(server);

export const hostDnsOk = (h: OsHost): boolean => h.os.dnsOk;
