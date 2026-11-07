/**
 * The reducers of the operating-system and service commands (ADR-0091): what `host.act`, `service.failover`,
 * `service.restart` and `vm.migrate` do to the state, and of the database, container and SDN layers above them. The
 * world hands itself over as an `OsWorld`.
 */
import {
  drainBackend,
  enableBackend,
  failoverRegion,
  resetBreaker,
  restartAppProcess,
  rollbackMesh,
} from "./app-act";
import { failoverCluster, promote, restartDatabase, startRestore, switchPath } from "./db-act";
import { actOnHost, type HostActContext } from "./host-os";
import { cordon, deletePod, drain, restartKubelet, rolloutRestart, scale } from "./k8s-act";
import type { HostOs } from "./os";
import { CNI_PROCESS, INGRESS_PROCESS } from "./sdn";
import {
  restartCni,
  restartIngress,
  restartIngressProcess,
  revertPolicy,
  setPolicy,
  syncSwitch,
  takeOver,
} from "./sdn-act";
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
    id,
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

const sdnContext = dbContext;

/** The container-layer commands (REQ-096): what each does to the state. */
function reduceK8s(world: OsWorld, command: WorldCommand): void {
  const ctx = dbContext(world);
  switch (command.type) {
    case "k8s.rollout_restart":
      rolloutRestart(ctx, command.target);
      return;
    case "k8s.scale":
      scale(ctx, command.target, command.replicas);
      return;
    case "k8s.cordon":
      cordon(ctx, command.target, command.on);
      return;
    case "k8s.drain":
      drain(ctx, command.target);
      return;
    case "k8s.delete_pod":
      deletePod(ctx, command.target, command.pod);
      return;
    default:
      return;
  }
}

/**
 * A restart of the process of a database, of a node's kubelet or containerd, of a CNI plug-in or of an ingress
 * ends the faults a restart can end.
 */
function afterRestart(world: OsWorld, command: Extract<WorldCommand, { type: "host.act" }>): void {
  if (command.action !== "restart") return;
  if (command.arg === "postgresql") restartDatabase(dbContext(world), command.target);
  if (command.arg === "kubelet" || command.arg === "containerd")
    restartKubelet(dbContext(world), command.target);
  if (command.arg === CNI_PROCESS) restartCni(sdnContext(world), command.target);
  if (command.arg === INGRESS_PROCESS) restartIngressProcess(sdnContext(world), command.target);
  if (command.arg) restartAppProcess(dbContext(world), command.target, command.arg);
}

/** The commands of the application layer (REQ-100); false when the command is not one of them. */
function reduceApp(world: OsWorld, command: WorldCommand): boolean {
  const ctx = dbContext(world);
  switch (command.type) {
    case "lb.drain":
      drainBackend(ctx, command.target);
      return true;
    case "lb.enable":
      enableBackend(ctx, command.target);
      return true;
    case "circuit.reset":
      resetBreaker(ctx, command.target);
      return true;
    case "mesh.rollback":
      rollbackMesh(ctx, command.target);
      return true;
    case "region.failover":
      failoverRegion(ctx, command.target);
      return true;
    default:
      return false;
  }
}

/** The commands of the overlay and the cloud-native layer (REQ-097); false when the command is not one of them. */
function reduceSdn(world: OsWorld, command: WorldCommand): boolean {
  const ctx = sdnContext(world);
  switch (command.type) {
    case "sdn.sync":
      syncSwitch(ctx, command.target);
      return true;
    case "sdn.failover":
      takeOver(ctx, command.target);
      return true;
    case "policy.set":
      setPolicy(ctx, command.target, command.rule);
      return true;
    case "policy.revert":
      revertPolicy(ctx, command.target);
      return true;
    case "ingress.restart":
      restartIngress(ctx, command.target);
      return true;
    default:
      return false;
  }
}

export function reduceHostAndService(world: OsWorld, command: WorldCommand): void {
  if (command.type.startsWith("k8s.")) {
    reduceK8s(world, command);
    return;
  }
  if (reduceSdn(world, command) || reduceApp(world, command)) return;
  const ctx: ServiceActContext = {
    world,
    t: world.time(),
    host: (id) => hostContext(world, id),
  };
  switch (command.type) {
    case "host.act":
      actOnHost(hostContext(world, command.target), command.action, command.arg, command.data);
      afterRestart(world, command);
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
