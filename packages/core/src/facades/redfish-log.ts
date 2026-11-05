/**
 * The event log of a server's BMC: the log service and its entries (REQ-002). Entries are the alarms
 * raised on this server, stamped with simulated time.
 */
import { simTimeIso } from "./http";
import { type BmcContext, ids } from "./redfish-resources";

const SEVERITY: Record<string, string> = { warning: "Warning", critical: "Critical" };

const logBase = (ctx: BmcContext): string => `${ctx.base}/Systems/${ids(ctx).system}/LogServices`;

export function logServices(ctx: BmcContext): Record<string, unknown> {
  return {
    "@odata.id": logBase(ctx),
    "@odata.type": "#LogServiceCollection.LogServiceCollection",
    Name: "Log Service Collection",
    Members: [{ "@odata.id": `${logBase(ctx)}/EventLog` }],
    "Members@odata.count": 1,
  };
}

export function logService(ctx: BmcContext): Record<string, unknown> {
  const base = `${logBase(ctx)}/EventLog`;
  return {
    "@odata.id": base,
    "@odata.type": "#LogService.v1_9_0.LogService",
    Id: "EventLog",
    Name: "Event Log",
    LogEntryType: "Event",
    OverWritePolicy: "WrapsWhenFull",
    ServiceEnabled: true,
    DateTime: simTimeIso(ctx.world.time()),
    Status: { State: "Enabled", Health: "OK" },
    Entries: { "@odata.id": `${base}/Entries` },
  };
}

type Entry = Record<string, unknown>;

/** The alarms raised on this server, and its thermal shutdowns, as log entries. */
function entries(ctx: BmcContext): Entry[] {
  const base = `${logBase(ctx)}/EventLog/Entries`;
  return ctx.world
    .events()
    .filter(
      (e) =>
        (e.type === "alarm.raise" && e.alarm.entityId === ctx.server.id) ||
        (e.type === "thermal.shutdown" && e.target === ctx.server.id),
    )
    .map((e) => ({
      "@odata.id": `${base}/${e.seq}`,
      "@odata.type": "#LogEntry.v1_15_0.LogEntry",
      Id: String(e.seq),
      Name: `Event ${e.seq}`,
      Created: simTimeIso(e.t),
      EntryType: "Event",
      Severity: e.type === "alarm.raise" ? (SEVERITY[e.alarm.severity] ?? "OK") : "Critical",
      Message:
        e.type === "alarm.raise"
          ? e.alarm.message
          : `${ctx.server.name} thermal protection shutdown`,
      MessageId:
        e.type === "alarm.raise"
          ? `Terrarium.1.0.${e.alarm.code}`
          : "Terrarium.1.0.thermal_shutdown",
    }));
}

/** Event log entries: alarms raised or cleared on this server, from the world's event log. */
export function eventLog(ctx: BmcContext): Record<string, unknown> {
  const all = entries(ctx);
  return {
    "@odata.id": `${logBase(ctx)}/EventLog/Entries`,
    "@odata.type": "#LogEntryCollection.LogEntryCollection",
    Name: "Log Service Collection",
    Members: all,
    "Members@odata.count": all.length,
  };
}

/** One entry, by the sequence number its link carries. */
export function eventLogEntry(ctx: BmcContext, id: string): Entry | undefined {
  return entries(ctx).find((e) => e.Id === id);
}
