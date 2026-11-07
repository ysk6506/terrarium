/**
 * The card over the 3D view (REQ-102, ADR-0123, ADR-0107 item 8): one card, and only when something is picked — a rack,
 * a room or a building gets the one card, a server its small card, a service its card, several things the one thing to
 * do with them. "어느 서버에서 돌아요?" is answered here: while a service is waiting, the next server picked gets it.
 */
import { useEffect, useState } from "react";
import { builder } from "../../logic";
import { Button } from "../kit";
import { OneCard } from "./OneCard";
import { ServerCard, ServiceCard } from "./ServerCards";
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

/** Several things picked: the one thing to do with them. */
function ManyPicked({ b }: { readonly b: Builder }) {
  const { selected } = b.state;
  return (
    <section className="rf-card ocard" aria-label="고른 것 여럿">
      <h3>{selected.length}개를 골랐어요</h3>
      <div className="acts">
        <Button
          kind="danger"
          size="small"
          icon="trash"
          onClick={() => b.apply((bp) => builder.remove(bp, selected))}
        >
          모두 지우기
        </Button>
        <Button size="small" onClick={() => b.setSelected([])}>
          선택 풀기
        </Button>
      </div>
    </section>
  );
}

export function StageCards({ b }: { readonly b: Builder }) {
  const { selected, index } = b.state;
  const host = useHostPick(b);
  const one = selected.length === 1 ? index.find(selected[0] as string) : undefined;
  return (
    <>
      {host.serviceId && <HostHint onStop={() => host.setServiceId(undefined)} />}
      {selected.length > 1 && <ManyPicked b={b} />}
      {one?.kind === "service" && (
        <ServiceCard
          entity={one}
          b={b}
          picking={host.serviceId === one.id}
          onPick={(on) => host.setServiceId(on ? one.id : undefined)}
        />
      )}
      {one && HOSTS.has(one.kind) && <ServerCard entity={one} b={b} />}
      {one && one.kind !== "service" && !HOSTS.has(one.kind) && (
        <OneCard key={one.id} entity={one} b={b} />
      )}
    </>
  );
}
