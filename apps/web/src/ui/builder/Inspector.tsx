/**
 * The right panel (REQ-077, ADR-0083): the pick card on top — one thing, one line, one main button — and under it
 * three folded sections: 크기와 모양, 냉방과 전기, 돈. A rack also shows its front, a parcel its land, and
 * every pick can be removed. The numbers of the whole level are not here: they are the line over the 3D view.
 */

import { withJosa } from "@terrarium/core/kernel";
import type { Entity, LinkKind } from "@terrarium/core/world";
import { isSizeLocked, LINK_LABELS, MODELLED_KINDS } from "@terrarium/core/world";
import type { ReactNode } from "react";
import { builder, celsius, count, won } from "../../logic";
import { Button, Note, NumberField, Segmented, SelectField } from "../kit";
import { LandList, ParcelPanel, PurposeField } from "./LandPanel";
import { PickCardView } from "./PickCard";
import { RackPanel } from "./RackPanel";
import { PowerLine, RealSizeNote, SourcesPanel } from "./RealSizePanel";
import { carriesServices, ServiceFields, SupportedServices } from "./ServicePanel";
import { SizePanel } from "./SizePanel";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

/** A folded section of the panel; `fold` lets the rest of the page open it (widening a full room). */
function Fold({
  fold,
  title,
  children,
}: {
  readonly fold: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <details className="panel-fold" data-fold={fold}>
      <summary>{title}</summary>
      <div className="stack panel-fold-body">{children}</div>
    </details>
  );
}

function Links({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { index } = b.state;
  const kinds = builder
    .linkKindsFrom(entity.kind, entity)
    .filter((k) => k !== "member_of" && k !== "managed_by");
  if (kinds.length === 0) return null;
  return (
    <div className="stack">
      <h3>연결</h3>
      {kinds.map((kind) => (
        <LinkKindRow
          key={kind}
          kind={kind}
          entity={entity}
          b={b}
          links={index.outgoing(entity.id, kind)}
        />
      ))}
    </div>
  );
}

function LinkKindRow({
  kind,
  entity,
  b,
  links,
}: {
  readonly kind: LinkKind;
  readonly entity: Entity;
  readonly b: Builder;
  readonly links: ReturnType<Builder["state"]["index"]["outgoing"]>;
}) {
  const { index } = b.state;
  const options = builder
    .candidates(index, catalog, entity.id, kind)
    .slice(0, 12)
    .map((c) => ({ value: c.entity.id, label: `${c.entity.name} (${c.metres.toFixed(0)} m)` }));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="small" style={{ fontWeight: 600 }}>
        {LINK_LABELS[kind]}
      </div>
      {links.length === 0 && <div className="tiny muted">아직 없어요</div>}
      {links.map((l) => (
        <div key={l.id} className="row small" style={{ justifyContent: "space-between" }}>
          <button
            type="button"
            className="btn btn-quiet btn-small"
            onClick={() => b.setSelected([l.to])}
          >
            {index.find(l.to)?.name ?? l.to}
          </button>
          <Button
            size="small"
            kind="quiet"
            icon="close"
            aria-label={`${index.find(l.to)?.name ?? l.to} 연결 끊기`}
            onClick={() => b.apply((bp) => builder.unlink(bp, l.id))}
          />
        </div>
      ))}
      {options.length > 0 && (
        <SelectField
          label={`${LINK_LABELS[kind]} 연결 더하기`}
          value={undefined}
          placeholder="가까운 것부터"
          options={options}
          onChange={(to) => b.apply((bp) => builder.link(bp, kind, entity.id, to))}
        />
      )}
    </div>
  );
}

function rackOf(b: Builder, entity: Entity): Entity | undefined {
  const parent = entity.parentId ? b.state.index.find(entity.parentId) : undefined;
  return parent?.kind === "rack" ? parent : undefined;
}

/** What the thing is for and where it stands: purpose, the unit it is mounted at, which aisle it is. */
function ShapeFields({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const rack = rackOf(b, entity);
  return (
    <>
      <PurposeField entity={entity} b={b} />
      {entity.placement?.type === "unit" && rack && entity.kind !== "pdu" && (
        <NumberField
          label="달린 자리 (맨 아래 U)"
          value={entity.placement.u}
          min={1}
          max={builder.unitsOf(rack, catalog)}
          unit="U"
          onChange={(u) =>
            u !== undefined && b.apply((bp) => builder.remount(bp, catalog, entity.id, u))
          }
        />
      )}
      {entity.kind === "containment" && (
        <Segmented
          label="복도 종류"
          value={entity.props.aisle === "hot" ? "hot" : "cold"}
          options={[
            { value: "cold", label: "냉복도" },
            { value: "hot", label: "열복도" },
          ]}
          onChange={(v) => b.apply((bp) => builder.setProp(bp, entity.id, "aisle", v))}
        />
      )}
    </>
  );
}

/** The model to choose among, with what each costs: money lives in the 돈 section. */
function ModelField({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const models = MODELLED_KINDS.has(entity.kind) ? catalog.list(entity.kind as never) : [];
  if (models.length <= 1) return null;
  return (
    <SelectField
      label="모델"
      value={entity.modelId}
      options={models.map((m) => ({ value: m.id, label: `${m.name} (${won(m.costM)})` }))}
      onChange={(id) => b.apply((bp) => builder.setModel(bp, catalog, entity.id, id))}
    />
  );
}

function wireRack(b: Builder, rackId: string): void {
  const r = builder.autoWireRack(b.state.blueprint, catalog, rackId);
  b.apply(() => r, r.added > 0 ? `케이블 ${r.added}개를 이었어요` : "더 이을 케이블이 없어요");
}

function wireRoom(b: Builder, roomId: string): void {
  const r = builder.autoWireRoom(b.state.blueprint, catalog, roomId);
  b.apply(() => r, r.added > 0 ? `케이블 ${r.added}개를 이었어요` : "더 이을 케이블이 없어요");
}

function EntityActions({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { level } = b.state;
  const rack = rackOf(b, entity);
  const turns = entity.placement?.type === "spot";
  if (!rack && !turns && entity.kind !== "rack") return null;
  return (
    <div className="row">
      {rack && (
        <Button size="small" onClick={() => b.setSelected([rack.id])}>
          {withJosa(rack.name, "으로")} 돌아가기
        </Button>
      )}
      {turns && (
        <Button
          size="small"
          icon="rotate"
          onClick={() => b.apply((bp) => builder.rotate(bp, catalog, level, entity.id))}
        >
          돌리기
        </Button>
      )}
      {entity.kind === "rack" && (
        <Button size="small" icon="wand" onClick={() => wireRack(b, entity.id)}>
          자동 배선
        </Button>
      )}
    </div>
  );
}

function RemoveBlock({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const inside = b.state.index.descendants(entity.id).length;
  return (
    <div className="builder-block">
      <Button
        kind="danger"
        size="small"
        icon="trash"
        onClick={() => b.apply((bp) => builder.remove(bp, [entity.id]))}
      >
        지우기
      </Button>
      {inside > 0 && (
        <p className="tiny muted" style={{ marginTop: 6 }}>
          안에 든 {count(inside)}개와 그 케이블도 함께 지워져요.
        </p>
      )}
    </div>
  );
}

function MoneyFold({ cost, children }: { readonly cost: number; readonly children?: ReactNode }) {
  return (
    <Fold fold="money" title="돈">
      <p className="small" data-testid="money">
        들인 돈 <b>{won(cost)}</b>
      </p>
      {children}
    </Fold>
  );
}

/** Whether a pick has a size, a mount height or an aisle to set. */
const hasShape = (e: Entity): boolean =>
  e.kind === "room" ||
  e.kind === "building" ||
  e.kind === "containment" ||
  e.placement?.type === "unit";

/** The folded sections of one picked thing: 크기와 모양, 냉방과 전기, 돈. */
function EntityFolds({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { index } = b.state;
  const sized = entity.kind === "room" || entity.kind === "building";
  const fits = builder.handlesFit(index, b.state.level, entity);
  const linked = builder.linkKindsFrom(entity.kind, entity).length > 0;
  const shaped = hasShape(entity);
  const priced = entity.kind !== "parcel" && entity.kind !== "service";
  return (
    <>
      {shaped && (
        <Fold fold="size" title="크기와 모양">
          <ShapeFields entity={entity} b={b} />
          {sized && <RealSizeNote entity={entity} b={b} />}
          {fits && <SizePanel entity={entity} b={b} />}
        </Fold>
      )}
      {(entity.kind === "room" || linked) && (
        <Fold fold="power" title="냉방과 전기">
          {entity.kind === "room" && <SourcesPanel room={entity} b={b} />}
          <Links entity={entity} b={b} />
        </Fold>
      )}
      {priced && (
        <MoneyFold cost={builder.costOf(index, catalog, entity)}>
          <ModelField entity={entity} b={b} />
        </MoneyFold>
      )}
      {entity.kind !== "parcel" && <RemoveBlock entity={entity} b={b} />}
    </>
  );
}

/** One picked thing: its card, what it holds, and its folds. */
function EntityPanel({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { preview } = b.state;
  const heat = preview?.heat.get(entity.id);
  return (
    <>
      <PickCardView b={b} entity={entity} />
      {heat !== undefined && preview && (
        <div className="builder-block small">
          흡기 {celsius(heat)} ({Math.round(preview.seconds / 60)}분 돌린 뒤)
        </div>
      )}
      <EntityActions entity={entity} b={b} />
      {entity.kind === "rack" && <RackPanel rack={entity} b={b} />}
      {carriesServices(entity) && <SupportedServices entity={entity} b={b} />}
      {entity.kind === "service" && <ServiceFields entity={entity} b={b} />}
      {entity.kind === "parcel" && <ParcelPanel entity={entity} b={b} />}
      <EntityFolds entity={entity} b={b} />
    </>
  );
}

function Floors({ b, buildingId }: { readonly b: Builder; readonly buildingId: string }) {
  const { index, level } = b.state;
  const building = index.entity(buildingId);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="small" style={{ fontWeight: 600 }}>
        {building.name}의 층
      </div>
      <div className="row">
        {builder.floorsOf(index, buildingId).map((f) => (
          <Button
            key={f.id}
            size="small"
            kind={builder.sameLevel(level, { kind: "floor", id: f.id }) ? "primary" : "plain"}
            onClick={() => b.go({ kind: "floor", id: f.id })}
          >
            {f.name}
          </Button>
        ))}
        {isSizeLocked(building) ? (
          <span className="small muted">실제 층수예요</span>
        ) : (
          <Button
            size="small"
            icon="plus"
            onClick={() => b.apply((bp) => builder.addFloor(bp, buildingId), "층을 올렸어요")}
          >
            층 더하기
          </Button>
        )}
      </div>
    </div>
  );
}

/** What a run found, in a line under the card: the hottest rack and the alarms. */
function RunResult({ b }: { readonly b: Builder }) {
  const { preview } = b.state;
  if (!preview?.hottest) return null;
  return (
    <div className="builder-block">
      <Note tone={preview.hottest.inletC > 27 ? "bad" : "good"}>
        {Math.round(preview.seconds / 60)}분 돌린 뒤 가장 더운 랙은 {preview.hottest.name}, 흡기{" "}
        {celsius(preview.hottest.inletC)}. 알람 {preview.alarms.length}건.
      </Note>
    </div>
  );
}

/** Nothing picked: the place being looked at. */
function LevelPanel({ b }: { readonly b: Builder }) {
  const { index, level } = b.state;
  const building = level.kind === "floor" ? index.enclosing(level.id, "building") : undefined;
  const stats = builder.levelStats(index, catalog, level);
  const sizeBuilding = building && builder.handlesFit(index, level, building);
  return (
    <>
      <PickCardView b={b} />
      <RunResult b={b} />
      {level.kind === "site" && (
        <div className="builder-block stack">
          <PowerLine b={b} />
        </div>
      )}
      {level.kind === "site" && <LandList b={b} />}
      {(building || level.kind === "room") && (
        <Fold fold="size" title="크기와 모양">
          {building && <Floors b={b} buildingId={building.id} />}
          <RealSizeNote b={b} />
          {level.kind === "room" && <SizePanel entity={index.entity(level.id)} b={b} />}
          {sizeBuilding && building && <SizePanel entity={building} b={b} />}
        </Fold>
      )}
      {level.kind === "room" && (
        <Fold fold="power" title="냉방과 전기">
          {stats.warnings.map((w) => (
            <Note key={w} tone="warn">
              {w}
            </Note>
          ))}
          <SourcesPanel room={index.entity(level.id)} b={b} />
          <div>
            <Button icon="wand" onClick={() => wireRoom(b, level.id)}>
              이 서버룸 자동 배선
            </Button>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              장비는 랙의 PDU A와 B로, 서버는 ToR 스위치로, 랙은 가까운 냉방기로, PDU는 서로 다른
              분전반으로, 분전반은 UPS로 이어요.
            </p>
          </div>
        </Fold>
      )}
      <MoneyFold cost={stats.costM} />
    </>
  );
}

export function Inspector({ b }: { readonly b: Builder }) {
  const { selected, index } = b.state;
  const entity = selected.length === 1 ? index.find(selected[0] as string) : undefined;
  return (
    <aside className="builder-side builder-side-right" aria-label="고른 것">
      {selected.length > 1 ? (
        <div className="builder-block stack">
          <h2 style={{ fontSize: 18 }}>{selected.length}개를 골랐어요</h2>
          <div className="row">
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
        </div>
      ) : entity ? (
        <EntityPanel entity={entity} b={b} />
      ) : (
        <LevelPanel b={b} />
      )}
    </aside>
  );
}
