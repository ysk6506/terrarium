/**
 * A rack's front, drawn top-down like the label on a real rack: devices as dark plates, free units
 * as gaps you can click to mount into. Power demand is shown against what one PDU can carry.
 */
import {
  DEFAULT_MODEL_BY_KIND,
  gpuOf,
  mountOfModel,
  plannedGpus,
  type RackMountedKind,
  type RackStandard,
} from "@terrarium/core/catalog";
import { type Entity, rackStandardOf } from "@terrarium/core/world";
import { useState } from "react";
import { builder, watts, won } from "../../logic";
import { Button, Meter, SelectField } from "../kit";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

const U_PX = 13;
const MOUNT_KINDS: readonly RackMountedKind[] = ["server", "switch", "storage", "pdu"];
const GROUPS: Readonly<Record<RackMountedKind, string>> = {
  server: "서버",
  switch: "스위치",
  storage: "스토리지",
  pdu: "수직 PDU (뒤쪽, 0U)",
};

const unitName = (standard: RackStandard): string => (standard === "orv3" ? "OU" : "U");

/** What can be mounted in a rack of this standard: models built for it, nothing else fits. */
const optionsFor = (standard: RackStandard) =>
  MOUNT_KINDS.flatMap((kind) =>
    catalog
      .list(kind)
      .filter((m) => mountOfModel(m) === standard)
      .map((m) => ({
        value: m.id,
        label: `${m.name}${"uHeight" in m && m.uHeight > 0 ? ` ${m.uHeight}${unitName(standard)}` : ""} (${won(m.costM)})`,
        group: GROUPS[kind],
      })),
  );

/** What the chosen GPU server carries, and which chip is coming but cannot be placed yet. */
function GpuNote({ modelId }: { readonly modelId: string }) {
  const model = catalog.get(modelId);
  const gpu = model.kind === "server" ? gpuOf(model) : undefined;
  if (!gpu || model.kind !== "server") return null;
  const next = plannedGpus()[0];
  return (
    <p className="tiny muted">
      {gpu.name} {model.gpus}장 · {gpu.memoryType} {gpu.memoryGiB}GB · 장당 {gpu.tdpW}W
      {next ? ` · 도입 예정: ${next.name} (${next.year}년)` : ""}
    </p>
  );
}

function SlotButton({
  slot,
  b,
  at,
  onPick,
}: {
  readonly slot: builder.Slot;
  readonly b: Builder;
  readonly at?: number;
  readonly onPick: (u: number) => void;
}) {
  const top = slot.u + slot.height - 1;
  const device = slot.device;
  if (device)
    return (
      <button
        type="button"
        className="u-slot u-slot-device"
        style={{ height: slot.height * U_PX }}
        aria-pressed={b.state.selected.includes(device.id)}
        onClick={() => b.setSelected([device.id])}
      >
        <span className="u-no">{top}</span>
        {device.name}
      </button>
    );
  const label = slot.height === 1 ? `U${slot.u}` : `U${top}–${slot.u}`;
  return (
    <button
      type="button"
      className="u-slot"
      style={{ height: Math.max(slot.height * U_PX, 16) }}
      aria-pressed={at !== undefined && at >= slot.u && at <= top}
      title={`${label} 비어 있어요. 누르면 여기에 달아요`}
      onClick={() => onPick(slot.u)}
    >
      <span className="u-no">{top}</span>
      {slot.height > 1 ? `${slot.height}U 비어 있음` : "비어 있음"}
    </button>
  );
}

function PowerLine({ ev }: { readonly ev: builder.Elevation }) {
  const ratio = ev.supplyW > 0 ? ev.demandW / ev.supplyW : ev.demandW > 0 ? 2 : 0;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="small">
        장비 최대 전력 {watts(ev.demandW)} / PDU 한 대 {ev.supplyW > 0 ? watts(ev.supplyW) : "없음"}
      </div>
      <Meter ratio={ratio} label="랙 전력 여유" />
      {ev.supplyW === 0 && ev.demandW > 0 && (
        <div className="tiny muted">수직 PDU를 달아야 장비에 전기가 가요.</div>
      )}
    </div>
  );
}

function MountForm({
  rack,
  b,
  at,
  onClear,
}: {
  readonly rack: Entity;
  readonly b: Builder;
  readonly at?: number;
  readonly onClear: () => void;
}) {
  const standard = rackStandardOf(rack, catalog);
  const options = optionsFor(standard);
  const [picked, setModelId] = useState<string>(DEFAULT_MODEL_BY_KIND.server);
  // A model of the other standard cannot be mounted here: fall back to the first one that fits.
  const modelId = options.some((o) => o.value === picked)
    ? picked
    : (options[0]?.value ?? DEFAULT_MODEL_BY_KIND.server);
  const pdu = catalog.get(modelId).kind === "pdu" && catalog.getOf(modelId, "pdu").uHeight === 0;
  const mount = () =>
    b.apply((bp) => {
      const edit = builder.mountDevice(bp, catalog, rack.id, modelId, pdu ? undefined : at);
      // Stay on the rack so several devices can be mounted one after another.
      return { ...edit, select: [rack.id] };
    }) && onClear();
  return (
    <>
      <SelectField label="달 장비" value={modelId} options={options} onChange={setModelId} />
      <GpuNote modelId={modelId} />
      <div className="row">
        <Button kind="primary" size="small" icon="plus" onClick={mount}>
          {at === undefined || pdu ? "빈 곳에 달기" : `U${at}에 달기`}
        </Button>
        {at !== undefined && (
          <Button size="small" kind="quiet" onClick={onClear}>
            자리 선택 풀기
          </Button>
        )}
      </div>
    </>
  );
}

export function RackPanel({ rack, b }: { readonly rack: Entity; readonly b: Builder }) {
  const ev = builder.elevation(b.state.index, catalog, rack.id);
  const [at, setAt] = useState<number>();
  return (
    <div className="builder-block stack">
      <h3 style={{ marginBottom: 0 }}>
        랙 정면 {ev.units}
        {unitName(rackStandardOf(rack, catalog))}, 빈 곳 {ev.freeUnits}
        {unitName(rackStandardOf(rack, catalog))}
      </h3>
      <PowerLine ev={ev} />
      <ol className="elevation" aria-label={`${rack.name} 정면, 위에서부터`}>
        {ev.slots.map((slot) => (
          <li key={slot.device?.id ?? `free-${slot.u}`}>
            <SlotButton slot={slot} b={b} {...(at !== undefined ? { at } : {})} onPick={setAt} />
          </li>
        ))}
      </ol>
      {ev.pdus.length > 0 && (
        <div className="row small">
          뒤쪽
          {ev.pdus.map((p) => (
            <Button key={p.id} size="small" onClick={() => b.setSelected([p.id])}>
              {p.name}
            </Button>
          ))}
        </div>
      )}
      <MountForm
        rack={rack}
        b={b}
        {...(at !== undefined ? { at } : {})}
        onClear={() => setAt(undefined)}
      />
    </div>
  );
}
