/**
 * The small cards of the builder (ADR-0107 item 8). "서버 넣기" opens beside the empty unit that was pressed: three kinds
 * with their price and power, one button. A server's card is small: what it carries, what feeds it, where it is cabled,
 * and two things to do: change its service, take it out. A service's card says where it runs and lets the person point at
 * a server in the 3D view to put it there.
 */

import { gpuOf, mountOfModel, plannedGpus, type RackMountedKind } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import type { Entity, ServiceKind } from "@terrarium/core/world";
import {
  rackStandardOf,
  SERVICE_KIND_LABELS,
  SERVICE_KINDS,
  serviceDef,
} from "@terrarium/core/world";
import { useState } from "react";
import { builder, won } from "../../logic";
import { Button, NumberField, Segmented, SelectField } from "../kit";
import { NameBox } from "./CardParts";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

const MOUNT_KINDS: readonly RackMountedKind[] = ["server", "switch", "storage", "pdu"];
const GROUPS: Readonly<Record<RackMountedKind, string>> = {
  server: "서버",
  switch: "스위치",
  storage: "스토리지",
  pdu: "수직 PDU (뒤쪽, 0U)",
};

/** Every model the rack can take, for "다른 모델": models of the rack's own standard only. */
function otherModels(rack: Entity) {
  const standard = rackStandardOf(rack, catalog);
  return MOUNT_KINDS.flatMap((kind) =>
    catalog
      .list(kind)
      .filter((m) => mountOfModel(m) === standard)
      .map((m) => ({ value: m.id, label: `${m.name} (${won(m.costM)})`, group: GROUPS[kind] })),
  );
}

/** What the chosen GPU server carries, and which chip is coming but cannot be placed yet. */
function GpuNote({ modelId }: { readonly modelId: string }) {
  const model = catalog.has(modelId) ? catalog.get(modelId) : undefined;
  const gpu = model?.kind === "server" ? gpuOf(model) : undefined;
  if (!gpu || model?.kind !== "server") return null;
  const next = plannedGpus()[0];
  return (
    <p className="tiny muted">
      {gpu.name} {model.gpus}장 · {gpu.memoryType} {gpu.memoryGiB}GB · 장당 {gpu.tdpW}W
      {next ? ` · 도입 예정: ${next.name} (${next.year}년)` : ""}
    </p>
  );
}

export function InsertCard({
  rack,
  at,
  b,
  onDone,
}: {
  readonly rack: Entity;
  readonly at: number;
  readonly b: Builder;
  readonly onDone: () => void;
}) {
  const options = builder.insertOptions(catalog, rack).filter((o) => o.fits);
  const [kind, setKind] = useState<string>(options[0]?.modelId ?? "");
  const [other, setOther] = useState<string>();
  const modelId = other ?? kind;
  const ev = builder.elevation(b.state.index, catalog, rack.id);
  const mount = () => {
    b.apply((bp) => ({
      ...builder.mountDevice(bp, catalog, rack.id, modelId, at),
      select: [rack.id],
    }));
    onDone();
  };
  return (
    <section className="rf-card" aria-label="서버 넣기" aria-live="polite">
      <h3>서버 넣기</h3>
      <p className="tiny muted">
        {rack.name} · {at}U 자리 · 위로 {ev.freeUnits}U 비어 있어요
      </p>
      <div className="rf-opts" role="radiogroup" aria-label="넣을 종류">
        {options.map((o) => (
          // biome-ignore lint/a11y/useSemanticElements: a choice among three cards, one of them on
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={other === undefined && kind === o.modelId}
            className="rf-opt"
            onClick={() => {
              setKind(o.modelId);
              setOther(undefined);
            }}
          >
            <span>
              {o.label} {o.height}U<small>{o.detail}</small>
            </span>
            <span>{won(o.costM)}</span>
          </button>
        ))}
      </div>
      <GpuNote modelId={modelId} />
      <details className="fold">
        <summary>다른 모델 고르기</summary>
        <SelectField
          label="달 장비"
          value={other ?? modelId}
          options={otherModels(rack)}
          onChange={setOther}
        />
      </details>
      <div className="row">
        <Button kind="primary" icon="plus" onClick={mount}>
          여기에 넣기
        </Button>
        <Button kind="quiet" onClick={onDone}>
          그만두기
        </Button>
      </div>
    </section>
  );
}

/** "서비스 바꾸기": pick one of the world's services to run here, or add a new one. */
function ChangeService({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { index } = b.state;
  const here = new Set(builder.servicesOnPlace(index, entity.id).map((s) => s.id));
  const others = index.ofKind("service").filter((s) => !here.has(s.id));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {others.slice(0, 8).map((s) => (
        <Button
          key={s.id}
          size="small"
          onClick={() =>
            b.apply(
              (bp) => builder.link(bp, "service_on", s.id, entity.id, { role: "active" }),
              `${s.name}를 올렸어요`,
            )
          }
        >
          {s.name} 올리기
        </Button>
      ))}
      <Button
        size="small"
        icon="plus"
        onClick={() => b.apply((bp) => builder.addService(bp, entity.id), "서비스를 더했어요")}
      >
        새 서비스 더하기
      </Button>
    </div>
  );
}

export function ServerCard({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { index } = b.state;
  const facts = builder.serverFacts(index, catalog, entity);
  const [changing, setChanging] = useState(false);
  const rack = entity.parentId ? index.find(entity.parentId) : undefined;
  const at = entity.placement?.type === "unit" ? entity.placement.u : undefined;
  return (
    <section className="rf-card ocard" aria-label={`${entity.name} 카드`}>
      <NameBox entity={entity} b={b} />
      <p className="fact">
        {facts.model}
        {rack && at !== undefined ? ` · ${rack.name} ${at}U` : ""}
      </p>
      <dl className="rf-kv">
        <dt>서비스</dt>
        <dd>
          {facts.services.length === 0
            ? "없음"
            : facts.services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="we-edit"
                  onClick={() => b.setSelected([s.id])}
                >
                  {s.name}
                </button>
              ))}
        </dd>
        <dt>전원</dt>
        <dd>{facts.power}</dd>
        <dt>스위치</dt>
        <dd>{facts.switches}</dd>
      </dl>
      {changing && <ChangeService entity={entity} b={b} />}
      <div className="row">
        {rack && (
          <Button size="small" onClick={() => b.setSelected([rack.id])}>
            {withJosa(rack.name, "으로")} 돌아가기
          </Button>
        )}
        <Button size="small" onClick={() => setChanging((c) => !c)} aria-expanded={changing}>
          서비스 바꾸기
        </Button>
        <Button
          size="small"
          kind="danger"
          icon="trash"
          onClick={() => b.apply((bp) => builder.remove(bp, [entity.id]))}
        >
          빼기
        </Button>
      </div>
    </section>
  );
}

/** Where a service runs: each place, active or standby, and a way to take it off. */
function ServiceHosts({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { index } = b.state;
  const hosts = index
    .outgoing(entity.id, "service_on")
    .map((l) => ({ link: l, place: index.find(l.to) }));
  return (
    <>
      <h3>어느 서버에서 돌아요?</h3>
      {hosts.length === 0 && <p className="tiny muted">아직 어디에서도 돌지 않아요</p>}
      {hosts.map(({ link, place }) => (
        <div key={link.id} className="row small">
          <button
            type="button"
            className="we-edit"
            onClick={() => place && b.setSelected([place.id])}
          >
            {place?.name ?? link.to}
          </button>
          <span className="muted">{link.props.role === "standby" ? "대기" : "활성"}</span>
          <Button
            size="small"
            kind="quiet"
            icon="close"
            aria-label={`${place?.name ?? link.to}에서 빼기`}
            onClick={() => b.apply((bp) => builder.unlink(bp, link.id))}
          />
        </div>
      ))}
    </>
  );
}

/** A service: its kind, what a stop costs, where it runs, and "어느 서버에서 돌아요?" (point at a server in the 3D view). */
export function ServiceCard({
  entity,
  b,
  picking,
  onPick,
}: {
  readonly entity: Entity;
  readonly b: Builder;
  readonly picking: boolean;
  readonly onPick: (on: boolean) => void;
}) {
  const def = serviceDef(entity);
  return (
    <section className="rf-card ocard" aria-label={`${entity.name} 서비스 카드`}>
      <NameBox entity={entity} b={b} />
      <Segmented
        label="서비스 종류"
        value={def.kind}
        options={SERVICE_KINDS.map((k) => ({ value: k, label: SERVICE_KIND_LABELS[k] }))}
        onChange={(k: ServiceKind) =>
          b.apply((bp) => builder.setProp(bp, entity.id, "serviceKind", k))
        }
      />
      {def.kind === "batch" ? (
        <NumberField
          label="멈추면 늦어지는 시간"
          value={def.harm.delayHours}
          min={0}
          unit="시간"
          onChange={(v) =>
            v !== undefined && b.apply((bp) => builder.setProp(bp, entity.id, "delayHours", v))
          }
        />
      ) : (
        <NumberField
          label="멈추면 시간당 피해(추정)"
          value={def.harm.perHourKrw}
          min={0}
          unit="원"
          help={
            def.harm.perHourKrw
              ? `한 시간에 ${won(def.harm.perHourKrw / 1_000_000)}쯤으로 어림한 값이에요`
              : undefined
          }
          onChange={(v) =>
            v !== undefined && b.apply((bp) => builder.setProp(bp, entity.id, "harmPerHourKrw", v))
          }
        />
      )}
      <p className="tiny muted">이 피해 값은 어림한 추정이에요. 실제 사업장에 맞게 고쳐 주세요.</p>
      <ServiceHosts entity={entity} b={b} />
      <div className="row">
        <Button chosen={picking} size="small" onClick={() => onPick(!picking)}>
          {picking ? "3D에서 서버를 눌러요" : "서버 찍어서 올리기"}
        </Button>
        <Button
          size="small"
          kind="danger"
          icon="trash"
          onClick={() => b.apply((bp) => builder.remove(bp, [entity.id]))}
        >
          서비스 지우기
        </Button>
      </div>
    </section>
  );
}
