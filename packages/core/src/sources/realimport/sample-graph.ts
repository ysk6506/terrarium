/**
 * A small graph shaped like cloud_topology, with fictional names (REQ-010). It powers the import
 * preview ("샘플 그래프로 미리보기") and the tests, and it is deliberately as untidy as a real graph:
 * racks placed by relationship or only by floor_info, an ESXi host with no physical server, a server
 * with no location, both PART_OF and PORT_OF, NicPort and NICPort, a legacy direct CONNECTS_TO, a
 * switch from another domain, virtual switching the simulator does not model, and an unknown label.
 */
import type { SourceNode, SourceRelationship } from "./port";

export interface GraphDump {
  readonly nodes: SourceNode[];
  readonly relationships: SourceRelationship[];
}

class Graph implements GraphDump {
  readonly nodes: SourceNode[] = [];
  readonly relationships: SourceRelationship[] = [];
  private seq = 0;

  node(label: string, props: Record<string, unknown>): string {
    const id = String(++this.seq);
    this.nodes.push({ id, labels: [label], props });
    return id;
  }

  rel(type: string, from: string, to: string, props: Record<string, unknown> = {}): void {
    this.relationships.push({ type, from, to, props });
  }
}

const FLOOR = "H1>DSR동_C타워>3F";
const two = (n: number) => String(n).padStart(2, "0");

function facility(g: Graph) {
  const dc = g.node("DataCenter", { name: "DSR동_C타워", site: "H1" });
  const rooms = ["A", "B"].map((x) => {
    const id = g.node("ServerRoom", {
      name: `3F_${x}_Datacenter`,
      floor_info: `${FLOOR}_${x}_Datacenter`,
    });
    g.rel("LOCATED_IN", id, dc);
    return id;
  });
  return { rooms };
}

function racks(g: Graph, rooms: string[]) {
  const out: Array<{ id: string; name: string; room: string; row: number }> = [];
  for (const [r, room] of rooms.entries()) {
    const x = r === 0 ? "A" : "B";
    for (let row = 1; row <= 2; row++)
      for (let no = 1; no <= 3; no++) {
        const name = `${x}${two(row)}-${two(no)}`;
        const id = g.node("RACK", {
          name,
          floor_info: `${FLOOR}_${x}_Datacenter`,
          rack_row: row,
          rack_no: no,
        });
        // Half the racks are tied to their room by a relationship, the rest only by floor_info.
        if (no !== 2) g.rel("LOCATED_IN", id, room);
        out.push({ id, name, room, row });
      }
  }
  return out;
}

function cooling(g: Graph, roomA: string, rackList: ReturnType<typeof racks>) {
  for (const row of [1, 2]) {
    const id = g.node("HVAC", {
      name: `HVAC-3F-A-${row}`,
      floor_info: `${FLOOR}_A_Datacenter`,
      rack_rows: [row],
      model: "CRAH 100kW",
    });
    if (row === 1) g.rel("LOCATED_IN", id, roomA);
    for (const rack of rackList.filter((r) => r.room === roomA && r.row === row))
      g.rel("COOLED_BY", rack.id, id);
  }
}

function network(g: Graph, rackList: ReturnType<typeof racks>) {
  const spines = [1, 2].map((n) =>
    g.node("NetworkSwitch", {
      name: `dsr3-spine-0${n}`,
      topology_type: "SPINE",
      x_service_tier_upper: "FABRIC",
      rack_name: "A01-01",
      u_position: 40 + n,
    }),
  );
  g.node("NetworkSwitch", {
    name: "bd-tor-07",
    topology_type: "HADOOP-TOR",
    x_service_tier_upper: "BIGDATA",
  });
  const tors = new Map<string, string>();
  for (const rack of rackList) {
    const tor = g.node("NetworkSwitch", {
      name: `tor-${rack.name.toLowerCase()}`,
      topology_type: "TOR",
      x_service_tier_upper: "CLOUD",
      rack_name: rack.name,
      u_position: 42,
    });
    for (const spine of spines) g.rel("UPLINKS_TO", tor, spine);
    tors.set(rack.id, tor);
  }
  return tors;
}

interface Hosts {
  readonly esxi: string[];
  readonly storage: string[];
}

function servers(g: Graph, rackList: ReturnType<typeof racks>, tors: Map<string, string>): Hosts {
  const hosts: Hosts = { esxi: [], storage: [] };
  let n = 0;
  for (const rack of rackList) {
    const tor = tors.get(rack.id) as string;
    const count = rack.name.endsWith("01") ? 2 : 3;
    for (let i = 1; i <= count; i++) {
      n++;
      const hostname = `dsr3-${rack.name.toLowerCase()}-${two(i)}`;
      const location =
        i === 1
          ? { rack_name: rack.name, u_position: `U${i * 4}-U${i * 4 + 1}` }
          : { rack_name: rack.name, u_position: i * 4, u_height: 2 };
      const server = g.node("PhysicalServer", {
        name: hostname,
        model: "PowerEdge R750",
        serial: `SN${10_000 + n}`,
        ...location,
      });
      const esxi = g.node("ESXiHost", { name: `${hostname}.esx.internal` });
      g.rel("HOSTED_ON", esxi, server);
      hosts.esxi.push(esxi);
      const nicLabel = n % 2 === 0 ? "NicPort" : "NICPort";
      const nic = g.node(nicLabel, { name: "vmnic0" });
      g.rel(n % 3 === 0 ? "PORT_OF" : "PART_OF", nic, server);
      g.rel("USES_INTERFACE", esxi, nic);
      const port = g.node("SwitchPort", { name: `Ethernet${i}/1` });
      g.rel(n % 2 === 0 ? "PORT_OF" : "PART_OF", port, tor);
      g.rel("CONNECTS_TO", nic, port);
    }
  }
  const storage = g.node("PhysicalServer", {
    name: "dsr3-pflex-01",
    role: "storage",
    rack_name: "A01-01",
    u_position: 10,
    u_height: 2,
  });
  g.rel("CONNECTS_TO", storage, tors.get(rackList[0]?.id as string) as string, {
    port: "Ethernet20/1",
  });
  hosts.storage.push(storage);
  // A host the loader knows only from vCenter, and a server whose location was never recorded.
  hosts.esxi.push(g.node("ESXiHost", { name: "dsr3-orphan-esx.esx.internal" }));
  g.node("PhysicalServer", { name: "dsr3-unknown-01", model: "PowerEdge R650" });
  return hosts;
}

function virtualisation(g: Graph, hosts: Hosts) {
  const vc = g.node("VCenter", { name: "vcsa-dsr3" });
  const cluster = g.node("Cluster", { name: "CL-DSR3-A" });
  g.rel("MANAGED_BY", cluster, vc);
  const ds = g.node("Datastore", { name: "pflex-ds-01" });
  const vol = g.node("StorageVolume", { name: "vol-01" });
  g.rel("PROVIDES_VOLUME", hosts.storage[0] as string, vol);
  g.rel("BACKS", vol, ds);
  hosts.esxi.forEach((esxi, i) => {
    g.rel("MEMBER_OF", esxi, cluster);
    for (let k = 1; k <= 2; k++) {
      const vm = g.node("VM", {
        name: `vm-app-${two(i + 1)}-${k}`,
        net_0_ip: `10.20.${i}.${k}`,
        net_0_portgroup: "PG-App",
      });
      g.rel("RUNS_ON", vm, esxi);
      g.rel("USES_DATASTORE", vm, ds);
    }
  });
  const vds = g.node("VDS", {
    config_name: "VDS-Backend",
    capability_nicTeamingPolicy: "loadbalance_srcid",
  });
  g.node("PortGroup", { config_name: "PG-App", vlan_id: 120 });
  g.rel("USES_VSWITCH", hosts.esxi[0] as string, vds);
  const lb = g.node("LoadBalancer", { name: "lb-dsr3-01" });
  g.rel("MONITORED_BY", lb, vc);
}

/** The sample graph; a fresh copy each call. */
export function sampleGraph(): GraphDump {
  const g = new Graph();
  const { rooms } = facility(g);
  const rackList = racks(g, rooms);
  cooling(g, rooms[0] as string, rackList);
  const tors = network(g, rackList);
  const hosts = servers(g, rackList, tors);
  virtualisation(g, hosts);
  return g;
}
