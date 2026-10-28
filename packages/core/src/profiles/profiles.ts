/**
 * Per product-version behaviour variants (REQ-004, ADR-0007). A profile key names a product version,
 * e.g. "bmc-gen14/4.40". Differences between equipment *models* belong in the catalog instead.
 */
import { NotFoundError } from "@terrarium/core/kernel";

export type Protocol = "redfish" | "vcenter" | "vrops";

export interface RedfishProfile {
  readonly protocol: "redfish";
  readonly key: string;
  readonly product: string;
  readonly version: string;
  readonly redfishVersion: string;
  /** How member ids look: `System.Embedded.1` (embedded), `1` (numeric) or the entity id. */
  readonly idStyle: "embedded" | "numeric" | "entity";
  /** Legacy Chassis/Thermal + Power, newer ThermalSubsystem + PowerSubsystem, or both. */
  readonly thermalSchema: "legacy" | "subsystem" | "both";
  readonly resetTypes: readonly string[];
  readonly supportsEventLog: boolean;
}

export interface VcenterProfile {
  readonly protocol: "vcenter";
  readonly key: string;
  readonly product: string;
  readonly version: string;
  /** vSphere 7.0 still answers the deprecated /rest API with `{ value: ... }` envelopes. */
  readonly legacyRest: boolean;
}

export interface VropsProfile {
  readonly protocol: "vrops";
  readonly key: string;
  readonly product: string;
  readonly version: string;
  readonly tokenScheme: "vRealizeOpsToken" | "OpsToken";
  /** Stat key used for CPU usage in percent. */
  readonly cpuStatKey: string;
}

export type Profile = RedfishProfile | VcenterProfile | VropsProfile;

export const BUILTIN_PROFILES: readonly Profile[] = [
  {
    protocol: "redfish",
    key: "bmc-gen14/4.40",
    product: "BMC Gen14",
    version: "4.40",
    redfishVersion: "1.6.0",
    idStyle: "embedded",
    thermalSchema: "legacy",
    resetTypes: ["On", "ForceOff", "GracefulShutdown", "GracefulRestart", "PushPowerButton", "Nmi"],
    supportsEventLog: true,
  },
  {
    protocol: "redfish",
    key: "bmc-gen16/7.10",
    product: "BMC Gen16",
    version: "7.10",
    redfishVersion: "1.17.0",
    idStyle: "embedded",
    thermalSchema: "both",
    resetTypes: [
      "On",
      "ForceOff",
      "GracefulShutdown",
      "GracefulRestart",
      "ForceRestart",
      "PowerCycle",
    ],
    supportsEventLog: true,
  },
  {
    protocol: "redfish",
    key: "bmc-lite/2.80",
    product: "BMC Lite",
    version: "2.80",
    redfishVersion: "1.13.0",
    idStyle: "numeric",
    thermalSchema: "subsystem",
    resetTypes: ["On", "ForceOff", "ForceRestart"],
    supportsEventLog: false,
  },
  {
    protocol: "vcenter",
    key: "vcenter/7.0",
    product: "vCenter Server",
    version: "7.0",
    legacyRest: true,
  },
  {
    protocol: "vcenter",
    key: "vcenter/8.0",
    product: "vCenter Server",
    version: "8.0",
    legacyRest: false,
  },
  {
    protocol: "vrops",
    key: "vrops/8.10",
    product: "vRealize Operations",
    version: "8.10",
    tokenScheme: "vRealizeOpsToken",
    cpuStatKey: "cpu|usage_average",
  },
  {
    protocol: "vrops",
    key: "aria-ops/8.18",
    product: "Aria Operations",
    version: "8.18",
    tokenScheme: "OpsToken",
    cpuStatKey: "cpu|usage_average",
  },
] as const; // prettier-ignore

export const DEFAULT_PROFILE: Readonly<Record<Protocol, string>> = {
  redfish: "bmc-gen16/7.10",
  vcenter: "vcenter/8.0",
  vrops: "aria-ops/8.18",
};

type ProfileOf<P extends Protocol> = Extract<Profile, { protocol: P }>;

export class ProfileRegistry {
  private readonly profiles = new Map<string, Profile>();

  constructor(profiles: readonly Profile[] = BUILTIN_PROFILES) {
    for (const profile of profiles) this.profiles.set(profile.key, profile);
  }

  list(protocol?: Protocol): Profile[] {
    return [...this.profiles.values()]
      .filter((p) => protocol === undefined || p.protocol === protocol)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** The profile for `key`, or the protocol's default when `key` is undefined. */
  get<P extends Protocol>(protocol: P, key?: string): ProfileOf<P> {
    const wanted = key ?? DEFAULT_PROFILE[protocol];
    const profile = this.profiles.get(wanted);
    if (!profile || profile.protocol !== protocol)
      throw new NotFoundError(`no ${protocol} profile '${wanted}'`);
    return profile as ProfileOf<P>;
  }
}

/** Member id of the n-th (1-based) resource in a collection, in this profile's style. */
export function memberId(
  profile: RedfishProfile,
  kind: "System" | "Chassis" | "Manager",
  entityId: string,
  ordinal = 1,
): string {
  if (profile.idStyle === "embedded")
    return kind === "Manager" ? `iDRAC.Embedded.${ordinal}` : `${kind}.Embedded.${ordinal}`;
  if (profile.idStyle === "numeric") return String(ordinal);
  return entityId;
}
