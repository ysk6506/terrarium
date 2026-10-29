/**
 * Equipment families a generated hall draws from (REQ-045). A family is what one purchasing round
 * might buy together: servers, rack, top-of-rack switch, PDU, pod spine and storage. A "mixed" campus
 * picks a family per pod; a "single" one keeps a hall to one family.
 */
export interface Family {
  readonly id: string;
  readonly servers: readonly string[];
  readonly gpuServers: readonly string[];
  readonly rack: string;
  readonly tor: string;
  readonly spine: string;
  readonly pdu: string;
  readonly storage: string;
}

export const FAMILIES: readonly Family[] = [
  {
    id: "generic",
    servers: ["srv-1u-compute", "srv-2u-compute"],
    gpuServers: ["srv-4u-gpu"],
    rack: "rack-42u-std",
    tor: "sw-tor-48x25g",
    spine: "sw-spine-32x100g",
    pdu: "pdu-17kw",
    storage: "stor-2u-24bay",
  },
  {
    id: "halcyon",
    servers: ["hc-r1u-gen6", "hc-r2u-gen6", "hc-m2u-4tb"],
    gpuServers: ["ax-2u-4gpu", "ax-4u-8gpu-air"],
    rack: "rw-42u-wide",
    tor: "nf-tor-48x10g",
    spine: "nf-spine-64x100g",
    pdu: "vp-22kw-metered",
    storage: "ok-2u-unified",
  },
  {
    id: "hanbit",
    servers: ["hb-1u-kr", "hb-2u-kr", "nv-a1u-arm", "nv-s1u-ocp"],
    gpuServers: ["ax-2u-4gpu"],
    rack: "rw-48u-std",
    tor: "al-tor-32x100g",
    spine: "al-spine-32x400g",
    pdu: "pdu-17kw",
    storage: "fs-2u-nvme",
  },
  {
    id: "cobaltica",
    servers: ["cb-2u4n", "hc-r2u-gen6", "hb-2u-kr"],
    gpuServers: ["ax-4u-8gpu-air"],
    rack: "rw-42u-wide",
    tor: "al-tor-32x100g",
    spine: "nf-spine-64x100g",
    pdu: "vp-22kw-metered",
    storage: "ok-2u-unified",
  },
];

/** Servers built for direct liquid cooling, and for a tank. */
export const DLC_SERVERS = ["ax-4u-8gpu-dlc", "ax-2u-4gpu-dlc", "hc-r1u-dlc"] as const;
export const TANK_SERVERS = ["sm-2u-imm", "sm-4u-gpu-imm"] as const;

export const DLC_RACKS = ["aq-48u-dlc", "aq-52u-dlc-hd"] as const;
export const TANKS = ["sm-tank-12u", "sm-tank-24u", "sm-tank-48u"] as const;
export const RDHX_RACK = "aq-45u-rdhx";

/** Rack PDUs for high-density racks, by how much one can carry (largest last). */
export const HEAVY_PDUS = ["vp-35kw-hd", "rp-60kw-busbar"] as const;
