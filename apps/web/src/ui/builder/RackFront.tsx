/**
 * A rack's front, drawn over the 3D view (ADR-0107 item 8): the units as a strip of plates, a server a solid plate, an
 * empty run of units a dashed one. Pressing an empty run is how a server is put in ("서버 넣기" opens beside it);
 * pressing a plate picks that device. Power demand against one PDU is the line under it.
 */
import type { Entity } from "@terrarium/core/world";
import { rackStandardOf } from "@terrarium/core/world";
import { builder, watts } from "../../logic";
import { Meter } from "../kit";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

const U_PX = 11;

function Plate({
  slot,
  b,
  at,
  onPick,
}: {
  readonly slot: builder.Slot;
  readonly b: Builder;
  readonly at: number | undefined;
  readonly onPick: (u: number) => void;
}) {
  const top = slot.u + slot.height - 1;
  const device = slot.device;
  if (device) {
    const served = builder.servicesOnPlace(b.state.index, device.id).length > 0;
    return (
      <button
        type="button"
        className={`rf-u rf-srv${served ? " rf-svc" : ""}`}
        style={{ height: slot.height * U_PX }}
        aria-pressed={b.state.selected.includes(device.id)}
        aria-label={`${device.name}, ${slot.height}U${served ? ", 서비스가 올라가 있어요" : ""}`}
        onClick={() => b.setSelected([device.id])}
      />
    );
  }
  const label = slot.height === 1 ? `${slot.u}U` : `${slot.u}~${top}U`;
  return (
    <button
      type="button"
      className="rf-u rf-empty"
      style={{ height: Math.max(slot.height * U_PX, 9) }}
      aria-pressed={at !== undefined && at >= slot.u && at <= top}
      aria-label={`${label} 비어 있어요. 누르면 여기에 서버를 넣어요`}
      onClick={() => onPick(slot.u)}
    />
  );
}

export function RackFront({
  rack,
  b,
  at,
  onPick,
}: {
  readonly rack: Entity;
  readonly b: Builder;
  readonly at: number | undefined;
  readonly onPick: (u: number) => void;
}) {
  const ev = builder.elevation(b.state.index, catalog, rack.id);
  const unit = rackStandardOf(rack, catalog) === "orv3" ? "OU" : "U";
  const ratio = ev.supplyW > 0 ? ev.demandW / ev.supplyW : ev.demandW > 0 ? 2 : 0;
  return (
    <section className="rf" aria-label={`${rack.name} 정면`}>
      <h2 className="rf-name">{rack.name}</h2>
      <ol className="rf-strip">
        {ev.slots.map((slot) => (
          <li key={slot.device?.id ?? `free-${slot.u}`}>
            <Plate slot={slot} b={b} at={at} onPick={onPick} />
          </li>
        ))}
      </ol>
      <p className="tiny muted">
        {ev.units}
        {unit} 중 {ev.freeUnits}
        {unit}가 비어 있어요
      </p>
      <p className="tiny muted">
        최대 {watts(ev.demandW)} / PDU 한 대 {ev.supplyW > 0 ? watts(ev.supplyW) : "없음"}
      </p>
      <Meter ratio={ratio} label="랙 전력 여유" />
    </section>
  );
}
