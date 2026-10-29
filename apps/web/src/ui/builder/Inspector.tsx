/**
 * The right panel: the selected thing (name, model, place, cables, rack front), or — with nothing
 * selected — the level's totals, warnings and problems. Problems link to what they are about.
 */

import { withJosa } from "@terrarium/core/kernel";
import type { Entity, LinkKind } from "@terrarium/core/world";
import { KIND_LABELS, LINK_LABELS, MODELLED_KINDS } from "@terrarium/core/world";
import { useEffect, useState } from "react";
import { builder, celsius, count, watts, won } from "../../logic";
import { Button, Figures, Note, NumberField, Segmented, SelectField } from "../kit";
import { RackPanel } from "./RackPanel";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

function NameBox({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const [name, setName] = useState(entity.name);
  useEffect(() => setName(entity.name), [entity.name]);
  const commit = () => name !== entity.name && b.apply((bp) => builder.rename(bp, entity.id, name));
  return (
    <input
      className="input"
      aria-label="이름"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ fontSize: 17, fontWeight: 650 }}
    />
  );
}

function Links({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { index } = b.state;
  const kinds = builder
    .linkKindsFrom(entity.kind)
    .filter((k) => k !== "member_of" && k !== "managed_by");
  if (kinds.length === 0) return null;
  return (
    <div className="builder-block">
      <h3>연결</h3>
      <div className="stack">
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
      {links.length === 0 && <div className="tiny muted">아직 없다</div>}
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
          label={`${LINK_LABELS[kind]} 연결 추가`}
          value={undefined}
          placeholder="가까운 것부터"
          options={options}
          onChange={(to) => b.apply((bp) => builder.link(bp, kind, entity.id, to))}
        />
      )}
    </div>
  );
}

const ENTERABLE = new Set(["building", "room", "floor"]);

function rackOf(b: Builder, entity: Entity): Entity | undefined {
  const parent = entity.parentId ? b.state.index.find(entity.parentId) : undefined;
  return parent?.kind === "rack" ? parent : undefined;
}

/** Model, rack unit and aisle: what can be changed about the thing itself. */
function EntityFields({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const models = MODELLED_KINDS.has(entity.kind) ? catalog.list(entity.kind as never) : [];
  const rack = rackOf(b, entity);
  return (
    <>
      {models.length > 1 && (
        <SelectField
          label="모델"
          value={entity.modelId}
          options={models.map((m) => ({ value: m.id, label: `${m.name} (${won(m.costM)})` }))}
          onChange={(id) => b.apply((bp) => builder.setModel(bp, catalog, entity.id, id))}
        />
      )}
      {entity.placement?.type === "unit" && rack && entity.kind !== "pdu" && (
        <NumberField
          label="달린 자리 (맨 아래 U)"
          value={entity.placement.u}
          min={1}
          max={builder.unitsOf(rack)}
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

function wireRack(b: Builder, rackId: string): void {
  const r = builder.autoWireRack(b.state.blueprint, catalog, rackId);
  b.apply(() => r, r.added > 0 ? `케이블 ${r.added}개를 이었다` : "더 이을 케이블이 없다");
}

function EntityActions({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { index, level } = b.state;
  const rack = rackOf(b, entity);
  return (
    <div className="row">
      {ENTERABLE.has(entity.kind) && (
        <Button size="small" kind="primary" onClick={() => b.go(builder.levelOf(index, entity.id))}>
          들어가기
        </Button>
      )}
      {rack && (
        <Button size="small" onClick={() => b.setSelected([rack.id])}>
          {withJosa(rack.name, "으로")} 돌아가기
        </Button>
      )}
      {entity.placement?.type === "spot" && (
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
          안에 든 {count(inside)}개와 그 케이블도 함께 지워진다.
        </p>
      )}
    </div>
  );
}

function EntityPanel({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { preview } = b.state;
  const heat = preview?.heat.get(entity.id);
  return (
    <>
      <div className="builder-block stack">
        <NameBox entity={entity} b={b} />
        <div className="tiny muted">
          {KIND_LABELS[entity.kind]} ({entity.id})
        </div>
        {heat !== undefined && preview && (
          <div className="small">
            흡기 {celsius(heat)} (가동 {Math.round(preview.seconds / 60)}분 뒤)
          </div>
        )}
        <EntityFields entity={entity} b={b} />
        <EntityActions entity={entity} b={b} />
      </div>
      {entity.kind === "rack" && <RackPanel rack={entity} b={b} />}
      <Links entity={entity} b={b} />
      <RemoveBlock entity={entity} b={b} />
    </>
  );
}

function IssuesBlock({ b }: { readonly b: Builder }) {
  const { issues, index } = b.state;
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === "error");
  const shown = [...errors, ...issues.filter((i) => i.severity === "warning")].slice(0, 30);
  return (
    <div className="builder-block">
      <h3>
        고칠 곳 {errors.length > 0 ? `${errors.length}건` : ""}
        {issues.length - errors.length > 0 ? `, 조언 ${issues.length - errors.length}건` : ""}
      </h3>
      <ul className="issues">
        {shown.map((i, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: issues have no ids of their own
          <li key={n}>
            <button
              type="button"
              className={`issue${i.severity === "error" ? " issue-error" : ""}`}
              onClick={() => {
                if (!i.entityId || !index.find(i.entityId)) return;
                b.go(builder.levelOf(index, i.entityId));
                setTimeout(() => b.setSelected([i.entityId as string]), 0);
              }}
            >
              <span className="issue-mark" />
              <span>
                {i.message}
                <br />
                <span className="muted">{i.fix}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function wireRoom(b: Builder, roomId: string): void {
  const r = builder.autoWireRoom(b.state.blueprint, catalog, roomId);
  b.apply(() => r, r.added > 0 ? `케이블 ${r.added}개를 이었다` : "더 이을 케이블이 없다");
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
        <Button
          size="small"
          icon="plus"
          onClick={() => b.apply((bp) => builder.addFloor(bp, buildingId), "층을 올렸다")}
        >
          층 추가
        </Button>
      </div>
    </div>
  );
}

function LevelTotals({ b }: { readonly b: Builder }) {
  const { index, level, preview } = b.state;
  const stats = builder.levelStats(index, catalog, level);
  return (
    <>
      <Figures
        items={[
          { label: "들인 돈", value: won(stats.costM) },
          { label: "랙", value: count(stats.racks) },
          { label: "서버", value: count(stats.servers) },
        ]}
      />
      <div className="small">
        평소 발열 <b>{watts(stats.itTypicalW)}</b>, 냉방 용량 <b>{stats.coolingKw} kW</b>
      </div>
      {stats.warnings.map((w) => (
        <Note key={w} tone="warn">
          {w}
        </Note>
      ))}
      {preview?.hottest && (
        <Note tone={preview.hottest.inletC > 27 ? "bad" : "good"}>
          가동 {Math.round(preview.seconds / 60)}분 뒤 가장 더운 랙은 {preview.hottest.name}, 흡기{" "}
          {celsius(preview.hottest.inletC)}. 알람 {preview.alarms.length}건.
        </Note>
      )}
    </>
  );
}

function LevelPanel({ b }: { readonly b: Builder }) {
  const { index, level } = b.state;
  const crumb = builder.crumbs(index, level).at(-1);
  const building = level.kind === "floor" ? index.enclosing(level.id, "building") : undefined;
  return (
    <>
      <div className="builder-block stack">
        <h2 style={{ fontSize: 18 }}>{crumb?.label}</h2>
        <LevelTotals b={b} />
        {level.kind === "room" && (
          <div>
            <Button icon="wand" onClick={() => wireRoom(b, level.id)}>
              이 서버룸 자동 배선
            </Button>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              장비는 랙의 PDU A와 B로, 서버는 ToR 스위치로, 랙은 가까운 냉방기로, PDU는 서로 다른
              분전반으로, 분전반은 UPS로 잇는다.
            </p>
          </div>
        )}
        {building && <Floors b={b} buildingId={building.id} />}
      </div>
      <IssuesBlock b={b} />
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
          <h2 style={{ fontSize: 18 }}>{selected.length}개를 골랐다</h2>
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
              고르기 취소
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
