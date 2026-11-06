/**
 * The reducers of the operating-system and service commands (ADR-0091): what `host.act`, `service.failover`,
 * `service.restart` and `vm.migrate` do to the state. The world hands itself over as an `OsWorld`.
 */
import { actOnHost, type HostActContext } from "./host-os";
import type { HostOs } from "./os";
import { failover, restartService, type ServiceActContext } from "./service-act";
import type { WorldCommand, WorldReader } from "./world";

/** The part of a world the reducers need beyond reading it. */
export interface OsWorld extends WorldReader {
  ensureHostOs(id: string): HostOs;
  moveVm(id: string, host: string): void;
  dropFault(faultId: string): void;
}

function hostContext(world: OsWorld, id: string): HostActContext {
  return {
    t: world.time(),
    os: world.ensureHostOs(id),
    faults: world.faultsOn(id),
    removeFault: (faultId) => world.dropFault(faultId),
  };
}

export function reduceHostAndService(world: OsWorld, command: WorldCommand): void {
  const ctx: ServiceActContext = {
    world,
    t: world.time(),
    host: (id) => hostContext(world, id),
  };
  switch (command.type) {
    case "host.act":
      actOnHost(hostContext(world, command.target), command.action, command.arg);
      return;
    case "service.failover":
      failover(ctx, command.target);
      return;
    case "service.restart":
      restartService(ctx, command.target);
      return;
    case "vm.migrate":
      world.moveVm(command.target, command.host);
      return;
    default:
      return;
  }
}
