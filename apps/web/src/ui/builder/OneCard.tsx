/**
 * The one card (REQ-102, ADR-0123): it appears only when something is picked. A name, one line of how the thing stands,
 * for a rack its front as a strip, and what can be done with it: 돌리기 · 자동 배선 · 서버 넣기 · 지우기. 지우기 asks
 * once, inline, when there is something inside. A room or a building has its own facts and, on request, its size boxes.
 */
import { withJosa } from "@terrarium/core/kernel";
import type { Entity } from "@terrarium/core/world";
import { isSizeLocked } from "@terrarium/core/world";
import { useEffect, useRef, useState } from "react";
import { builder, count } from "../../logic";
import { useMossActions } from "../../moss";
import { Button } from "../kit";
import { NameBox, PrimaryAction } from "./CardParts";
import { ParcelPanel, PurposeField } from "./LandPanel";
import { RealSizeNote } from "./RealSizePanel";
import { InsertCard } from "./ServerCards";
import { SizePanel } from "./SizePanel";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";
import { takeSizeAsk } from "./widen";

function wire(b: Builder, r: ReturnType<typeof builder.autoWireRack>): void {
  b.apply(() => r, r.added > 0 ? `케이블 ${r.added}개를 이었어요` : "더 이을 케이블이 없어요");
}

/** The rack's front as a strip: a device is a solid cell, a free run a dashed one; left is the bottom unit. */
function Strip(props: {
  readonly rack: Entity;
  readonly b: Builder;
  readonly at: number | undefined;
  readonly onPick: (u: number) => void;
}) {
  const { rack, b } = props;
  const cells = builder.stripOf(b.state.index, catalog, rack.id);
  return (
    <ol className="uu" aria-label={`${rack.name} 정면`}>
      {cells.map((c) => {
        const free = !c.device;
        const served = c.device && builder.servicesOnPlace(b.state.index, c.device.id).length > 0;
        const top = c.u + c.height - 1;
        const label = c.height === 1 ? `${c.u}U` : `${c.u}~${top}U`;
        return (
          <li key={c.device?.id ?? `free-${c.u}`} style={{ flexGrow: c.height }}>
            <button
              type="button"
              className={`uu-c${free ? " e" : ""}${served ? " svc" : ""}`}
              aria-pressed={
                free ? props.at !== undefined && props.at >= c.u && props.at <= top : false
              }
              aria-label={
                free
                  ? `${label} 비어 있어요. 누르면 여기에 서버를 넣어요`
                  : `${c.device?.name}, ${c.height}U${served ? ", 서비스가 올라가 있어요" : ""}`
              }
              onClick={() => (c.device ? b.setSelected([c.device.id]) : props.onPick(c.u))}
            />
          </li>
        );
      })}
    </ol>
  );
}

/** "지우기": at once when nothing is inside, else one line that says what goes with it. */
function RemoveButton({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const inside = b.state.index.descendants(entity.id).length;
  const [asking, setAsking] = useState(false);
  const remove = () => b.apply((bp) => builder.remove(bp, [entity.id]));
  if (!asking)
    return (
      <Button
        kind="danger"
        size="small"
        icon="trash"
        data-moss-skip="지우기는 자리에서 한 번 더 묻는 사람 몫이에요"
        onClick={() => (inside > 0 ? setAsking(true) : remove())}
      >
        지우기
      </Button>
    );
  return (
    <div className="ocard-ask" role="alert">
      <p>안에 든 {count(inside)}개와 케이블도 같이 지워져요 —</p>
      <Button
        kind="danger"
        size="small"
        data-moss-skip="지우기는 자리에서 한 번 더 묻는 사람 몫이에요"
        onClick={remove}
      >
        지우기
      </Button>
      <Button
        size="small"
        kind="quiet"
        data-moss-skip="묻는 줄을 닫을 뿐 아무것도 바꾸지 않아요"
        onClick={() => setAsking(false)}
      >
        그만
      </Button>
    </div>
  );
}

/** The floors of a building, to look at one, and one more on top. */
function Floors({ b, building }: { readonly b: Builder; readonly building: Entity }) {
  const { index, level } = b.state;
  return (
    <div className="row ocard-floors">
      {builder.floorsOf(index, building.id).map((f) => (
        <Button
          key={f.id}
          size="small"
          kind={builder.sameLevel(level, { kind: "floor", id: f.id }) ? "primary" : "plain"}
          data-moss-skip="층을 보는 보기 조작"
          onClick={() => b.go({ kind: "floor", id: f.id })}
        >
          {f.name}
        </Button>
      ))}
      {!isSizeLocked(building) && (
        <Button
          size="small"
          icon="plus"
          data-moss-skip="3D 위에서 짓는 일은 사람 몫이에요"
          onClick={() => b.apply((bp) => builder.addFloor(bp, building.id), "층을 올렸어요")}
        >
          층 더하기
        </Button>
      )}
    </div>
  );
}

/** The card's own doings, which are also what 이끼 can do for you while the card is up (REQ-103). */
function useCardMoss(b: Builder, entity: Entity, onInsert: () => void) {
  const { level } = b.state;
  const rotate = () => b.apply((bp) => builder.rotate(bp, catalog, level, entity.id));
  const autoWire = () =>
    wire(
      b,
      entity.kind === "rack"
        ? builder.autoWireRack(b.state.blueprint, catalog, entity.id)
        : builder.autoWireRoom(b.state.blueprint, catalog, entity.id),
    );
  const room = entity.kind === "rack" || entity.kind === "room";
  useMossActions("world", {
    ...(entity.placement?.type === "spot" ? { "builder-rotate": rotate } : {}),
    ...(room ? { "builder-auto-wire": autoWire } : {}),
    ...(entity.kind === "rack" ? { "builder-add-server": onInsert } : {}),
  });
  return { rotate, autoWire };
}

function Actions(props: {
  readonly entity: Entity;
  readonly b: Builder;
  readonly sizing: boolean;
  readonly onSize: () => void;
  readonly onInsert: () => void;
}) {
  const { entity, b } = props;
  const { index } = b.state;
  const turns = entity.placement?.type === "spot";
  const sized = entity.kind === "room" || entity.kind === "building";
  const parent = entity.parentId ? index.find(entity.parentId) : undefined;
  const inRack = parent?.kind === "rack" ? parent : undefined;
  const { rotate, autoWire } = useCardMoss(b, entity, props.onInsert);
  return (
    <div className="acts">
      <PrimaryAction b={b} entity={entity} />
      {inRack && (
        <Button
          size="small"
          data-moss-skip="고르는 것을 옮기는 보기 조작"
          onClick={() => b.setSelected([inRack.id])}
        >
          {withJosa(inRack.name, "으로")} 돌아가기
        </Button>
      )}
      {turns && (
        <Button size="small" icon="rotate" data-moss-action="builder-rotate" onClick={rotate}>
          돌리기
        </Button>
      )}
      {(entity.kind === "rack" || entity.kind === "room") && (
        <Button size="small" icon="wand" data-moss-action="builder-auto-wire" onClick={autoWire}>
          자동 배선
        </Button>
      )}
      {entity.kind === "rack" && (
        <Button
          size="small"
          icon="plus"
          data-moss-action="builder-add-server"
          onClick={props.onInsert}
        >
          서버 넣기
        </Button>
      )}
      {sized && (
        <Button
          size="small"
          aria-expanded={props.sizing}
          data-moss-skip="크기 칸을 여는 보기 조작이고 크기는 사람이 적어요"
          onClick={props.onSize}
        >
          크기 바꾸기
        </Button>
      )}
      {entity.kind !== "parcel" && <RemoveButton entity={entity} b={b} />}
    </div>
  );
}

export function OneCard({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const { index, preview } = b.state;
  const [at, setAt] = useState<number>();
  const [sizing, setSizing] = useState(() => takeSizeAsk());
  const card = useRef<HTMLElement>(null);
  const rack = entity.kind === "rack";
  const firstFree = () => builder.stripOf(index, catalog, entity.id).find((c) => !c.device);
  useEffect(() => {
    if (sizing) card.current?.querySelector<HTMLInputElement>('[data-testid="size-w"]')?.focus();
  }, [sizing]);
  return (
    <section
      className="rf-card ocard"
      aria-label={`${entity.name} 카드`}
      data-testid="pick-card"
      ref={card}
    >
      <NameBox entity={entity} b={b} />
      <p className="fact" data-testid="pick-status">
        {builder.factLine(index, catalog, entity, preview)}
      </p>
      {rack && <Strip rack={entity} b={b} at={at} onPick={setAt} />}
      {entity.kind === "parcel" && <ParcelPanel entity={entity} b={b} />}
      {at !== undefined && rack && (
        <InsertCard rack={entity} at={at} b={b} onDone={() => setAt(undefined)} />
      )}
      {entity.kind === "building" && <Floors b={b} building={entity} />}
      {sizing && (
        <div className="ocard-size">
          <PurposeField entity={entity} b={b} />
          <RealSizeNote entity={entity} b={b} />
          <SizePanel entity={entity} b={b} />
        </div>
      )}
      <Actions
        entity={entity}
        b={b}
        sizing={sizing}
        onSize={() => setSizing((s) => !s)}
        onInsert={() => setAt((cur) => cur ?? firstFree()?.u)}
      />
    </section>
  );
}
