/**
 * vCenter facade: a subset of the vSphere Automation REST API (/api), plus the deprecated /rest API
 * with `{ value }` envelopes when the profile is vCenter 7.0 (REQ-003, REQ-004).
 */
import { InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import type { ProfileRegistry, VcenterProfile } from "@terrarium/core/profiles";
import type { Entity, WorldPort } from "@terrarium/core/world";
import {
  dispatch,
  type FacadeRequest,
  type FacadeResponse,
  json,
  noContent,
  Router,
  simTimeIso,
  stableUuid,
} from "./http";

export function vcenterError(status: number, message: string): FacadeResponse {
  const type =
    status === 404
      ? "NOT_FOUND"
      : status === 400
        ? "INVALID_ARGUMENT"
        : status === 401
          ? "UNAUTHENTICATED"
          : "ERROR";
  return json(status, {
    error_type: type,
    messages: [{ id: `vapi.${type.toLowerCase()}`, default_message: message, args: [] }],
  });
}

const hostOf = (world: WorldPort, vm: Entity): string | undefined =>
  world.index.outgoing(vm.id, "runs_on")[0]?.to;

function hostConnection(world: WorldPort, hostId: string): "CONNECTED" | "NOT_RESPONDING" {
  const s = world.stateAs(hostId, "server");
  const links = world.index.outgoing(hostId, "network");
  const reachable =
    links.length === 0 ||
    links.some((l) => world.linkUp(l.id) && world.stateAs(l.to, "switch").powered);
  return s.powered && s.adminOn && reachable ? "CONNECTED" : "NOT_RESPONDING";
}

function vmSummary(world: WorldPort, vm: Entity) {
  const s = world.stateAs(vm.id, "vm");
  return {
    vm: vm.id,
    name: vm.name,
    power_state: s.running ? "POWERED_ON" : "POWERED_OFF",
    cpu_count: Number(vm.props.cpuCount ?? 4),
    memory_size_MiB: Number(vm.props.memoryGiB ?? 16) * 1024,
  };
}

/**
 * GET /api/vcenter/vm/{vm}: the fields the API reference marks required. The world does not model a VM's
 * disks, network cards or other devices, so those maps are empty (a real VM always has some). A VM's host is
 * not part of this answer in the real API either: it is found with the `hosts` filter of the VM list.
 */
function vmDetail(world: WorldPort, vm: Entity) {
  const summary = vmSummary(world, vm);
  const uuid = stableUuid(vm.id);
  return {
    name: summary.name,
    power_state: summary.power_state,
    guest_OS: String(vm.props.guestOs ?? "RHEL_9_64"),
    identity: { name: vm.name, bios_uuid: uuid, instance_uuid: stableUuid(`${vm.id}:instance`) },
    instant_clone_frozen: false,
    hardware: { version: "VMX_19", upgrade_policy: "NEVER", upgrade_status: "NONE" },
    boot: { type: "BIOS", delay: 0, retry: false, retry_delay: 10000, enter_setup_mode: false },
    boot_devices: [],
    cpu: {
      count: summary.cpu_count,
      cores_per_socket: 1,
      hot_add_enabled: false,
      hot_remove_enabled: false,
    },
    memory: { size_MiB: summary.memory_size_MiB, hot_add_enabled: false },
    disks: {},
    nics: {},
    cdroms: {},
    floppies: {},
    parallel_ports: {},
    serial_ports: {},
    sata_adapters: {},
    scsi_adapters: {},
  };
}

function listVms(world: WorldPort, query: Readonly<Record<string, string>>) {
  const names = query.names?.split(",");
  const states = query.power_states?.split(",");
  const hosts = query.hosts?.split(",");
  return world.index
    .ofKind("vm")
    .map((vm) => ({ vm, summary: vmSummary(world, vm) }))
    .filter(({ summary }) => !names || names.includes(summary.name))
    .filter(({ summary }) => !states || states.includes(summary.power_state))
    .filter(({ vm }) => !hosts || hosts.includes(hostOf(world, vm) ?? ""))
    .map(({ summary }) => summary);
}

function listHosts(world: WorldPort) {
  return world.index
    .ofKind("server")
    .filter(
      (s) =>
        world.index.outgoing(s.id, "member_of").length > 0 ||
        world.index.incoming(s.id, "runs_on").length > 0,
    )
    .map((host) => {
      const s = world.stateAs(host.id, "server");
      return {
        host: host.id,
        name: host.name,
        connection_state: hostConnection(world, host.id),
        power_state: s.powered && s.adminOn ? "POWERED_ON" : "POWERED_OFF",
      };
    });
}

function powerAction(world: WorldPort, vmId: string, action: string | undefined): FacadeResponse {
  const vm = world.index.find(vmId);
  if (!vm || vm.kind !== "vm") throw new NotFoundError(`no VM '${vmId}'`);
  const cause = `vcenter:${vmId}:${action}`;
  if (action === "start") world.apply({ type: "power.set", target: vmId, on: true }, cause);
  else if (action === "stop") world.apply({ type: "power.set", target: vmId, on: false }, cause);
  else if (action === "reset") {
    world.apply({ type: "power.set", target: vmId, on: false }, cause);
    world.apply({ type: "power.set", target: vmId, on: true }, cause);
  } else throw new InvalidValueError("action must be start, stop or reset");
  return noContent();
}

function routes(world: WorldPort, profile: VcenterProfile): Router {
  const getVm = (id: string): Entity => {
    const vm = world.index.find(id);
    if (!vm || vm.kind !== "vm") throw new NotFoundError(`no VM '${id}'`);
    return vm;
  };
  const router = new Router()
    .on("POST", "/api/session", () =>
      json(201, `vmware-api-session-${stableUuid("session").slice(0, 8)}`),
    )
    .on("GET", "/api/session", () =>
      json(200, {
        user: "terrarium@vsphere.local",
        created_time: simTimeIso(0),
        last_accessed_time: simTimeIso(world.time()),
      }),
    )
    .on("GET", "/api/vcenter/vm", (q) => json(200, listVms(world, q.query)))
    .on("GET", "/api/vcenter/vm/:vm", (_q, p) => json(200, vmDetail(world, getVm(p.vm as string))))
    .on("POST", "/api/vcenter/vm/:vm/power", (q, p) =>
      powerAction(world, p.vm as string, q.query.action),
    )
    .on("GET", "/api/vcenter/host", () => json(200, listHosts(world)))
    .on("GET", "/api/vcenter/cluster", () =>
      json(
        200,
        world.index
          .ofKind("cluster")
          .map((c) => ({ cluster: c.id, name: c.name, ha_enabled: true, drs_enabled: true })),
      ),
    )
    .on("GET", "/api/vcenter/datastore", () =>
      json(
        200,
        world.index.ofKind("datastore").map((d) => ({
          datastore: d.id,
          name: d.name,
          type: String(d.props.type ?? "VSAN"),
          capacity: 368 * 2 ** 40,
          free_space: 140 * 2 ** 40,
        })),
      ),
    );
  if (profile.legacyRest) {
    router
      .on("POST", "/rest/com/vmware/cis/session", () =>
        json(200, { value: `vmware-api-session-${stableUuid("session").slice(0, 8)}` }),
      )
      .on("GET", "/rest/vcenter/vm", (q) => json(200, { value: listVms(world, q.query) }))
      .on("GET", "/rest/vcenter/vm/:vm", (_q, p) =>
        json(200, { value: vmDetail(world, getVm(p.vm as string)) }),
      )
      .on("GET", "/rest/vcenter/host", () => json(200, { value: listHosts(world) }));
  }
  return router;
}

export class VcenterFacade {
  constructor(
    private readonly world: WorldPort,
    private readonly profiles: ProfileRegistry,
    private readonly profileKey?: string,
  ) {}

  handle(req: FacadeRequest): FacadeResponse {
    return dispatch(
      routes(this.world, this.profiles.get("vcenter", this.profileKey)),
      req,
      vcenterError,
    );
  }
}
