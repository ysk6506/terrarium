/** Wraps a reader so that every command is refused: the shape of a connection to reality (REQ-008). */
import type { Catalog } from "@terrarium/core/catalog";
import { ReadOnlyViolationError } from "@terrarium/core/kernel";
import type { EntityKind } from "./blueprint";
import type { Fault } from "./faults";
import type { BlueprintIndex } from "./graph";
import type { NetPatch } from "./net-config";
import type { Alarm, EntityState, StateOf } from "./state";
import type { WorldCommand, WorldEvent, WorldPort, WorldReader } from "./world";

export class ReadOnlyWorldPort implements WorldPort {
  constructor(private readonly reader: WorldReader) {}

  get index(): BlueprintIndex {
    return this.reader.index;
  }

  get catalog(): Catalog {
    return this.reader.catalog;
  }

  time = (): number => this.reader.time();
  outdoorC = (): number => this.reader.outdoorC();
  stateOf = (id: string): EntityState => this.reader.stateOf(id);
  stateAs = <K extends EntityKind>(id: string, kind: K): StateOf<K> =>
    this.reader.stateAs(id, kind);
  linkUp = (linkId: string): boolean => this.reader.linkUp(linkId);
  linkAdminDown = (linkId: string, end?: "from" | "to"): boolean =>
    this.reader.linkAdminDown(linkId, end);
  netconf = (switchId: string): NetPatch | undefined => this.reader.netconf(switchId);
  hasNetconf = (): boolean => this.reader.hasNetconf();
  netEpoch = (): number => this.reader.netEpoch();
  faults = (): Fault[] => this.reader.faults();
  faultsOn = (target: string): readonly Fault[] => this.reader.faultsOn(target);
  alarms = (): Alarm[] => this.reader.alarms();
  events = (sinceSeq?: number): WorldEvent[] => this.reader.events(sinceSeq);
  lastSeq = (): number => this.reader.lastSeq();

  apply(command: WorldCommand): WorldEvent {
    throw new ReadOnlyViolationError(
      `this world mirrors a real system and is read-only (refused ${command.type})`,
    );
  }
}
