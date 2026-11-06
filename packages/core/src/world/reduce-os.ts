/**
 * The reducers of the operating-system and service commands (ADR-0091): what `host.act`, `service.failover`,
 * `service.restart` and `vm.migrate` do to the state. The world hands itself over as an `OsWorld`.
 */
import { failoverCluster, promote, restartDatabase, startRestore, switchPath } from "./db-act";
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

const dbContext = (world: OsWorld) => ({
  world,
  t: world.time(),
  dropFault: (id: string) => world.dropFault(id),
});

export function reduceHostAndService(world: OsWorld, command: WorldCommand): void {
  const ctx: ServiceActContext = {
    world,
    t: world.time(),
    host: (id) => hostContext(world, id),
  };
  switch (command.type) {
    case "host.act":
      actOnHost(hostContext(world, command.target), command.action, command.arg);
      if (command.action === "restart" && command.arg === "postgresql")
        restartDatabase(dbContext(world), command.target);
      return;
    case "db.promote":
      promote(dbContext(world), command.target);
      return;
    case "db.failover":
      failoverCluster(dbContext(world), command.target);
      return;
    case "db.restore":
      startRestore(dbContext(world), command.target, command.backup);
      return;
    case "storage.path_switch":
      switchPath(dbContext(world), command.target);
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
