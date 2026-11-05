/**
 * vROps / Aria Operations facade: a subset of the suite-api — resources, latest stats and alerts
 * (REQ-003). Resource identifiers are stable UUIDs derived from entity ids.
 */
import { NotFoundError } from "@terrarium/core/kernel";
import type { ProfileRegistry, VropsProfile } from "@terrarium/core/profiles";
import type { Entity, WorldPort } from "@terrarium/core/world";
import {
  dispatch,
  type FacadeRequest,
  type FacadeResponse,
  json,
  Router,
  SIM_EPOCH_MS,
  simTimeMs,
  stableUuid,
} from "./http";

const KIND: Partial<Record<Entity["kind"], string>> = {
  vm: "VirtualMachine",
  server: "HostSystem",
  cluster: "ClusterComputeResource",
  datastore: "Datastore",
  vcenter: "VMwareAdapter Instance",
};

const LEVEL: Record<string, string> = { warning: "WARNING", critical: "CRITICAL" };

/** A token is good for six hours. */
const TOKEN_LIFETIME_MS = 6 * 60 * 60 * 1000;

const EXPIRY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

/** `expiresAt` the way the reference shows it: "Friday, August 5, 2016 6:22:05 PM UTC". */
const expiryText = (ms: number): string =>
  `${EXPIRY_FORMAT.format(new Date(ms)).replace(" at ", " ")} UTC`;

export function vropsError(status: number, message: string): FacadeResponse {
  return json(status, { message, httpStatusCode: status, apiErrorCode: status });
}

function resources(world: WorldPort): Entity[] {
  return world.index
    .all()
    .filter(
      (e) =>
        KIND[e.kind] !== undefined &&
        (e.kind !== "server" || world.index.outgoing(e.id, "member_of").length > 0),
    );
}

/** vROps health colour and its 0 to 100 value (the badge score): green is 100, red 0. */
const HEALTH = {
  ok: { colour: "GREEN", value: 100 },
  warning: { colour: "YELLOW", value: 50 },
  critical: { colour: "RED", value: 0 },
} as const;

function resource(world: WorldPort, entity: Entity) {
  const health = HEALTH[world.stateOf(entity.id).health];
  return {
    identifier: stableUuid(entity.id),
    creationTime: SIM_EPOCH_MS,
    resourceKey: {
      name: entity.name,
      adapterKindKey: "VMWARE",
      resourceKindKey: KIND[entity.kind],
      resourceIdentifiers: [
        {
          identifierType: {
            name: "VMEntityObjectID",
            dataType: "STRING",
            isPartOfUniqueness: true,
          },
          value: entity.id,
        },
      ],
    },
    resourceHealth: health.colour,
    resourceHealthValue: health.value,
    resourceStatusStates: [
      {
        adapterInstanceId: stableUuid("adapter"),
        resourceStatus: "DATA_RECEIVING",
        resourceState: "STARTED",
      },
    ],
  };
}

/** Latest stat values of an entity, by vROps stat key. */
function stats(world: WorldPort, entity: Entity, profile: VropsProfile): Array<[string, number]> {
  const s = world.stateOf(entity.id);
  if (s.kind === "vm") {
    return [
      [profile.cpuStatKey, Math.round(s.cpuUsage * 1000) / 10],
      ["mem|usage_average", s.running ? Math.round(s.memUtil * 1000) / 10 : 0],
      ["sys|poweredOn", s.running ? 1 : 0],
    ];
  }
  if (s.kind === "server") {
    const model = world.catalog.getOf(entity.modelId ?? "", "server");
    const util =
      model.maxPowerW > model.idlePowerW
        ? (s.powerW - model.idlePowerW) / (model.maxPowerW - model.idlePowerW)
        : 0;
    return [
      [profile.cpuStatKey, Math.round(Math.max(0, util) * 1000) / 10],
      ["power|power_average", Math.round(s.powerW)],
      ["sys|poweredOn", s.powered && s.adminOn ? 1 : 0],
    ];
  }
  return [["badge|health", s.health === "ok" ? 100 : s.health === "warning" ? 50 : 0]];
}

function routes(world: WorldPort, profile: VropsProfile): Router {
  const byUuid = (id: string): Entity => {
    const found = resources(world).find((e) => stableUuid(e.id) === id);
    if (!found) throw new NotFoundError(`no resource '${id}'`);
    return found;
  };
  return new Router()
    .on("POST", "/suite-api/api/auth/token/acquire", () => {
      const expires = simTimeMs(world.time()) + TOKEN_LIFETIME_MS;
      return json(200, {
        token: `${profile.tokenScheme}-${stableUuid("token")}`,
        validity: expires,
        expiresAt: expiryText(expires),
        roles: [],
      });
    })
    .on("GET", "/suite-api/api/resources", (q) => {
      const kind = q.query.resourceKind;
      const list = resources(world)
        .filter((e) => !kind || KIND[e.kind] === kind)
        .map((e) => resource(world, e));
      return json(200, {
        pageInfo: { totalCount: list.length, page: 0, pageSize: list.length },
        resourceList: list,
      });
    })
    .on("GET", "/suite-api/api/resources/:id", (_q, p) =>
      json(200, resource(world, byUuid(p.id as string))),
    )
    .on("GET", "/suite-api/api/resources/:id/stats/latest", (_q, p) => {
      const entity = byUuid(p.id as string);
      const stat = stats(world, entity, profile).map(([key, value]) => ({
        timestamps: [simTimeMs(world.time())],
        statKey: { key },
        data: [value],
      }));
      return json(200, { values: [{ resourceId: p.id, "stat-list": { stat } }] });
    })
    .on("GET", "/suite-api/api/alerts", () => {
      const known = new Set(resources(world).map((e) => e.id));
      const alerts = world
        .alarms()
        .filter((a) => known.has(a.entityId))
        .map((a) => ({
          alertId: stableUuid(a.id),
          resourceId: stableUuid(a.entityId),
          alertLevel: LEVEL[a.severity],
          status: "ACTIVE",
          alertDefinitionName: a.message,
          alertDefinitionId: `AlertDefinition-Terrarium-${a.code}`,
          controlState: "OPEN",
          startTimeUTC: simTimeMs(a.since),
        }));
      return json(200, { pageInfo: { totalCount: alerts.length }, alerts });
    });
}

export class VropsFacade {
  constructor(
    private readonly world: WorldPort,
    private readonly profiles: ProfileRegistry,
    private readonly profileKey?: string,
  ) {}

  handle(req: FacadeRequest): FacadeResponse {
    return dispatch(
      routes(this.world, this.profiles.get("vrops", this.profileKey)),
      req,
      vropsError,
    );
  }
}
