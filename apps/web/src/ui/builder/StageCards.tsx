/**
 * The cards over the 3D view (ADR-0107 item 8), in place of the right panel: a rack's front with the card of the unit that
 * was pressed beside it, the small card of a server, the card of a service, and for everything else the detail card.
 * "어느 서버에서 돌아요?" is answered here: while a service is waiting, the next server picked gets it.
 */
import type { Entity } from "@terrarium/core/world";
import { useEffect, useState } from "react";
import { builder } from "../../logic";
import { Button } from "../kit";
import { EntityPanel, LevelPanel, ManyPicked } from "./DetailCard";
import { RackFront } from "./RackFront";
import { InsertCard, ServerCard, ServiceCard } from "./ServerCards";
import { rackOfPick } from "./StepBar";
import type { Builder } from "./useBuilder";

const HOSTS = new Set(["server", "vm", "storage"]);

/** The next server picked takes the service that is waiting (ADR-0107 item 8). */
function useHostPick(b: Builder) {
  const [serviceId, setServiceId] = useState<string>();
  const { selected, index } = b.state;
  useEffect(() => {
    if (!serviceId || selected.length !== 1) return;
    const one = index.find(selected[0] as string);
    if (!one || !HOSTS.has(one.kind)) return;
    b.apply(
      (bp) => ({
        ...builder.link(bp, "service_on", serviceId, one.id, { role: "active" }),
        select: [serviceId],
      }),
      `${index.find(serviceId)?.name ?? "서비스"}를 ${one.name}에 올렸어요`,
    );
    setServiceId(undefined);
  }, [serviceId, selected, index, b]);
  return { serviceId, setServiceId };
}

function Detail({ b }: { readonly b: Builder }) {
  const { selected, index } = b.state;
  const [open, setOpen] = useState(true);
  const entity = selected.length === 1 ? index.find(selected[0] as string) : undefined;
  return (
    <aside className="stage-detail" aria-label="고른 것">
      <button
        type="button"
        className="stage-detail-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "접기" : "자세히 ▸"}
      </button>
      {open &&
        (selected.length > 1 ? (
          <ManyPicked b={b} />
        ) : entity ? (
          <EntityPanel entity={entity} b={b} />
        ) : (
          <LevelPanel b={b} />
        ))}
    </aside>
  );
}

/** Which cards the pick calls for: the device in the rack, a service, a server outside any rack, or the detail card. */
function cardsFor(rack: Entity | undefined, one: Entity | undefined, at: number | undefined) {
  const inRack = one !== undefined && one.parentId === rack?.id && one.kind !== "rack";
  const device = inRack ? one : undefined;
  const service = one?.kind === "service" ? one : undefined;
  const loose = !rack && one && HOSTS.has(one.kind) ? one : undefined;
  const open = Boolean(device || service || loose || (rack && at !== undefined));
  return { device, service, loose, detail: !open };
}

function HostHint({ onStop }: { readonly onStop: () => void }) {
  return (
    <div className="stage-hint">
      <output>어느 서버에서 돌아요? 3D에서 서버를 눌러요</output>
      <Button size="small" onClick={onStop}>
        그만두기
      </Button>
    </div>
  );
}

function RackCards({
  rack,
  device,
  at,
  setAt,
  b,
}: {
  readonly rack: Entity;
  readonly device: Entity | undefined;
  readonly at: number | undefined;
  readonly setAt: (u: number | undefined) => void;
  readonly b: Builder;
}) {
  return (
    <div className="stage-rack">
      <RackFront
        rack={rack}
        b={b}
        at={device ? undefined : at}
        onPick={(u) => {
          b.setSelected([rack.id]);
          setAt(u);
        }}
      />
      {at !== undefined && !device && (
        <InsertCard rack={rack} at={at} b={b} onDone={() => setAt(undefined)} />
      )}
      {device && <ServerCard entity={device} b={b} />}
    </div>
  );
}

export function StageCards({ b }: { readonly b: Builder }) {
  const { selected, index } = b.state;
  const rack = rackOfPick(b);
  const [at, setAt] = useState<number>();
  const host = useHostPick(b);
  const one = selected.length === 1 ? index.find(selected[0] as string) : undefined;
  // A different rack is a different strip: the unit that was pressed is forgotten.
  // biome-ignore lint/correctness/useExhaustiveDependencies: forget the unit when the rack changes
  useEffect(() => setAt(undefined), [rack?.id]);
  const cards = cardsFor(rack, one, at);
  const { service, loose } = cards;
  return (
    <>
      {host.serviceId && <HostHint onStop={() => host.setServiceId(undefined)} />}
      {rack && <RackCards rack={rack} device={cards.device} at={at} setAt={setAt} b={b} />}
      {!rack && service && (
        <div className="stage-rack">
          <ServiceCard
            entity={service}
            b={b}
            picking={host.serviceId === service.id}
            onPick={(on) => host.setServiceId(on ? service.id : undefined)}
          />
        </div>
      )}
      {loose && (
        <div className="stage-rack">
          <ServerCard entity={loose} b={b} />
        </div>
      )}
      {cards.detail && <Detail b={b} />}
    </>
  );
}
