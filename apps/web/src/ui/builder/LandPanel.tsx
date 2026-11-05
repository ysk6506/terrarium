/**
 * The land and what things are for (REQ-043, REQ-048): the parcels of a site with what they cost and a
 * button to buy them, and the purpose of a building or a room.
 */
import {
  BUILDING_PURPOSE_LABELS,
  BUILDING_PURPOSES,
  buildingPurposeOf,
  type Entity,
  PYEONG_M2,
  ROOM_PURPOSE_LABELS,
  ROOM_PURPOSES,
  roomPurposeOf,
} from "@terrarium/core/world";
import { builder, count, won } from "../../logic";
import { Button, SelectField } from "../kit";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

function BuyButton({ parcel, b }: { readonly parcel: builder.ParcelView; readonly b: Builder }) {
  return (
    <Button
      size="small"
      aria-label={`${parcel.name}, ${won(parcel.priceM)}에 사기`}
      onClick={() =>
        b.apply(
          (bp) => builder.buyParcel(bp, parcel.id),
          `${parcel.name}을 샀어요. 이제 건물을 지을 수 있어요`,
        )
      }
    >
      {won(parcel.priceM)}에 사기
    </Button>
  );
}

/** One parcel selected in the 3D view: whose it is, how big, and what it costs. */
export function ParcelPanel({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const parcel = builder.parcelViews(b.state.index, catalog).find((p) => p.id === entity.id);
  if (!parcel) return null;
  return (
    <div className="builder-block stack">
      <h3>{parcel.owned ? "내 땅" : "팔고 있는 땅"}</h3>
      <p className="small">
        넓이 {count(parcel.areaM2)}㎡ (약 {count(Math.round(parcel.areaM2 / PYEONG_M2))}평)
        {!parcel.owned && `, 값 ${won(parcel.priceM)}`}
      </p>
      {!parcel.owned && parcel.areaM2 > 0 && (
        <p className="tiny muted">평당 {won((parcel.priceM / parcel.areaM2) * PYEONG_M2)}</p>
      )}
      {parcel.owned ? (
        <p className="tiny muted">이 땅 위에 건물과 설비를 놓아요.</p>
      ) : (
        <>
          <BuyButton parcel={parcel} b={b} />
          <p className="tiny muted">사야 이 땅 위에 건물을 지어요. 산 땅값은 돈에 더해져요.</p>
        </>
      )}
    </div>
  );
}

/** The land of the whole site: the parcels for sale, each with its price and a way to buy it. */
export function LandList({ b }: { readonly b: Builder }) {
  const parcels = builder.parcelViews(b.state.index, catalog);
  const forSale = parcels.filter((p) => !p.owned);
  if (parcels.length === 0) return null;
  return (
    <div className="builder-block stack">
      <h3>땅</h3>
      {forSale.length === 0 ? (
        <p className="small">팔고 있는 땅은 모두 샀어요.</p>
      ) : (
        <ul className="list-plain stack" style={{ gap: 8 }}>
          {forSale.map((p) => (
            <li key={p.id} className="stack" style={{ gap: 4 }}>
              <button type="button" className="link-button" onClick={() => b.setSelected([p.id])}>
                {p.name}
              </button>
              <span className="tiny muted">넓이 {count(p.areaM2)}㎡</span>
              <BuyButton parcel={p} b={b} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What a building or a room is for. A data hall stays the default for rooms, a data centre for buildings. */
export function PurposeField({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  if (entity.kind === "building")
    return (
      <SelectField
        label="용도"
        value={buildingPurposeOf(entity)}
        options={BUILDING_PURPOSES.map((p) => ({ value: p, label: BUILDING_PURPOSE_LABELS[p] }))}
        onChange={(v) => b.apply((bp) => builder.setProp(bp, entity.id, "purpose", v))}
      />
    );
  if (entity.kind === "room")
    return (
      <SelectField
        label="용도"
        value={roomPurposeOf(entity)}
        options={ROOM_PURPOSES.map((p) => ({ value: p, label: ROOM_PURPOSE_LABELS[p] }))}
        onChange={(v) => b.apply((bp) => builder.setProp(bp, entity.id, "purpose", v))}
      />
    );
  return null;
}
