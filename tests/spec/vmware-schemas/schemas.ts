/**
 * What the vCenter and vROps (Aria Operations) public API reference says each response looks like
 * (REQ-003, REQ-060, ADR-0058). The reference publishes these pages as HTML, not as a downloadable
 * OpenAPI file we could fetch, so each schema below is written out by hand from the page named above it
 * (see README.md for the pages and the date). Field names, required/optional marks and enumeration values
 * are the page's; where a page does not say, the schema says nothing (it does not guess a rule).
 */

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const bool = { type: "boolean" } as const;
const num = { type: "number" } as const;
const strings = { type: "array", items: str } as const;
const isoTime = { type: "string", format: "date-time" } as const;

const object = (
  properties: Record<string, object>,
  required: readonly string[] = [],
  additionalProperties = false,
) => ({ type: "object", properties, required, additionalProperties });

// ---- vSphere Automation API 8.0.3 (developer.broadcom.com/xapis/vsphere-automation-api/8.0.3) ----

/** vcenter/data-structures/VM_Summary: GET /api/vcenter/vm */
export const VM_SUMMARY = object(
  {
    vm: str,
    name: str,
    power_state: { enum: ["POWERED_OFF", "POWERED_ON", "SUSPENDED"] },
    cpu_count: int,
    memory_size_MiB: int,
  },
  ["vm", "name", "power_state"],
);

const address = (extra: Record<string, object> = {}) => object({ label: str, ...extra });
const device = (extra: Record<string, object>) =>
  object(
    {
      label: str,
      state: object({}, [], true),
      start_connected: bool,
      allow_guest_control: bool,
      ...extra,
    },
    [],
    true,
  );

/** vcenter/data-structures/VM_Info (page example): GET /api/vcenter/vm/{vm}. The map-valued parts are keyed by device id. */
export const VM_INFO = object(
  {
    guest_OS: str,
    name: str,
    identity: object({ name: str, bios_uuid: str, instance_uuid: str }),
    power_state: { enum: ["POWERED_OFF", "POWERED_ON", "SUSPENDED"] },
    instant_clone_frozen: bool,
    hardware: object({
      version: str,
      upgrade_policy: str,
      upgrade_version: str,
      upgrade_status: str,
      upgrade_error: object({}, [], true),
    }),
    boot: object({
      type: { enum: ["BIOS", "EFI"] },
      efi_legacy_boot: bool,
      network_protocol: str,
      delay: int,
      retry: bool,
      retry_delay: int,
      enter_setup_mode: bool,
    }),
    boot_devices: {
      type: "array",
      items: object({ type: str, nic: str, disks: strings }, ["type"]),
    },
    cpu: object(
      { count: int, cores_per_socket: int, hot_add_enabled: bool, hot_remove_enabled: bool },
      ["count", "cores_per_socket"],
    ),
    memory: object(
      {
        size_MiB: int,
        hot_add_enabled: bool,
        hot_add_increment_size_MiB: int,
        hot_add_limit_MiB: int,
      },
      ["size_MiB"],
    ),
    disks: { type: "object", additionalProperties: device({ type: str, capacity: int }) },
    nics: { type: "object", additionalProperties: device({ type: str, mac_address: str }) },
    cdroms: { type: "object", additionalProperties: device({ type: str }) },
    floppies: { type: "object", additionalProperties: device({}) },
    parallel_ports: { type: "object", additionalProperties: device({}) },
    serial_ports: { type: "object", additionalProperties: device({}) },
    sata_adapters: { type: "object", additionalProperties: address({ type: str, bus: int }) },
    scsi_adapters: { type: "object", additionalProperties: address({ type: str, sharing: str }) },
    nvme_adapters: { type: "object", additionalProperties: address({ bus: int }) },
  },
  [
    "guest_OS",
    "name",
    "power_state",
    "hardware",
    "boot",
    "boot_devices",
    "cpu",
    "memory",
    "disks",
    "nics",
    "cdroms",
    "floppies",
    "parallel_ports",
    "serial_ports",
    "sata_adapters",
    "scsi_adapters",
  ],
);

/** vcenter/data-structures/Host_Summary: GET /api/vcenter/host */
export const HOST_SUMMARY = object(
  {
    host: str,
    name: str,
    connection_state: { enum: ["CONNECTED", "DISCONNECTED", "NOT_RESPONDING"] },
    power_state: { enum: ["POWERED_ON", "POWERED_OFF", "STANDBY"] },
  },
  ["host", "name", "connection_state"],
);

/** vcenter/data-structures/Cluster_Summary: GET /api/vcenter/cluster */
export const CLUSTER_SUMMARY = object(
  { cluster: str, name: str, ha_enabled: bool, drs_enabled: bool },
  ["cluster", "name", "ha_enabled", "drs_enabled"],
);

/** vcenter/data-structures/Datastore_Summary: GET /api/vcenter/datastore */
export const DATASTORE_SUMMARY = object(
  {
    datastore: str,
    name: str,
    type: { enum: ["VMFS", "NFS", "NFS41", "CIFS", "VSAN", "VFFS", "VVOL"] },
    free_space: int,
    capacity: int,
  },
  ["datastore", "name", "type"],
);

/** data-structures/Cis Session Info: GET /api/session */
export const SESSION_INFO = object(
  { user: str, created_time: isoTime, last_accessed_time: isoTime },
  ["user", "created_time", "last_accessed_time"],
);

/** POST /api/session answers 201 with the new session token as a JSON string. */
export const SESSION_TOKEN = { type: "string", minLength: 1 } as const;

/** The /api error body: an error type and localizable messages (vapi std errors). */
export const VAPI_ERROR = object(
  {
    error_type: str,
    messages: {
      type: "array",
      items: object({ id: str, default_message: str, args: strings }, ["default_message"]),
    },
  },
  ["error_type"],
);

// ---- VCF / Aria Operations API (developer.broadcom.com/xapis/vcf-operations-api) ----

const link = object({ href: str, rel: str, name: str, description: str });
const pageInfo = object({ totalCount: int, page: int, pageSize: int }, [], true);

/** data-structures/resource: GET /suite-api/api/resources/{id} (also each item of resourceList) */
export const RESOURCE = object(
  {
    badges: { type: "array", items: object({}, [], true) },
    creationTime: int,
    credentialInstanceId: str,
    description: str,
    dtEnabled: bool,
    extension: object({}, [], true),
    geoLocation: object({}, [], true),
    identifier: { type: "string", format: "uuid" },
    links: { type: "array", items: link },
    monitoringInterval: int,
    monitoringIntervalSeconds: int,
    relatedResources: strings,
    resourceHealth: { enum: ["GREEN", "YELLOW", "ORANGE", "RED", "GREY"] },
    resourceHealthValue: num,
    resourceKey: object({
      name: str,
      adapterKindKey: str,
      resourceKindKey: str,
      resourceIdentifiers: {
        type: "array",
        items: object({
          identifierType: object({
            dataType: str,
            name: str,
            isPartOfUniqueness: bool,
            extension: object({}, [], true),
            links: { type: "array", items: link },
          }),
          value: str,
          links: { type: "array", items: link },
        }),
      },
    }),
    resourceStatusStates: {
      type: "array",
      items: object({
        adapterInstanceId: str,
        resourceState: str,
        resourceStatus: str,
        statusMessage: str,
      }),
    },
  },
  ["creationTime", "resourceHealth", "resourceHealthValue", "resourceKey", "resourceStatusStates"],
);

/** data-structures/resources: GET /suite-api/api/resources */
export const RESOURCES = object(
  {
    pageInfo,
    links: { type: "array", items: link },
    resourceList: { type: "array", items: RESOURCE },
  },
  ["resourceList"],
);

/** data-structures/alert: every field optional */
export const ALERT = object({
  alertId: { type: "string", format: "uuid" },
  resourceId: { type: "string", format: "uuid" },
  alertLevel: {
    enum: ["UNKNOWN", "NONE", "INFORMATION", "WARNING", "IMMEDIATE", "CRITICAL", "AUTO"],
  },
  type: str,
  subType: str,
  status: { enum: ["NEW", "ACTIVE", "UPDATED", "CANCELED"] },
  startTimeUTC: int,
  cancelTimeUTC: int,
  updateTimeUTC: int,
  suspendUntilTimeUTC: int,
  controlState: { enum: ["OPEN", "ASSIGNED", "SUSPENDED", "SUPPRESSED"] },
  statKey: str,
  ownerId: str,
  ownerName: str,
  alertDefinitionId: str,
  alertDefinitionName: str,
  alertImpact: str,
  extension: object({}, [], true),
  links: { type: "array", items: link },
});

/** data-structures/alerts: GET /suite-api/api/alerts */
export const ALERTS = object({
  alerts: { type: "array", items: ALERT },
  links: { type: "array", items: link },
  pageInfo,
});

/** data-structures/stat-list inside GET /suite-api/api/resources/{id}/stats/latest */
export const STATS_LATEST = object(
  {
    values: {
      type: "array",
      items: object(
        {
          resourceId: str,
          "stat-list": object({
            stat: {
              type: "array",
              items: object(
                {
                  timestamps: { type: "array", items: num },
                  statKey: object({ key: str }, ["key"]),
                  rollUpType: str,
                  intervalUnit: object({ quantifier: num, intervalType: str }),
                  data: { type: "array", items: num },
                },
                ["statKey"],
              ),
            },
          }),
        },
        ["resourceId"],
      ),
    },
  },
  ["values"],
);

/** POST /suite-api/api/auth/token/acquire: `validity` is the expiry as epoch milliseconds, `expiresAt` the same moment in words. */
export const ACQUIRED_TOKEN = object(
  { token: str, validity: int, expiresAt: str, roles: strings },
  ["token", "validity", "expiresAt", "roles"],
);
