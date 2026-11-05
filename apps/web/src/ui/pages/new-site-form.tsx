/**
 * A new site to build on (REQ-048): its shape is a preset's, a rectangle of a chosen size, or one drawn on a pad,
 * with or without land for sale beside it. The button says what is wrong with the shape while it cannot be made.
 */

import { SITE_PRESETS } from "@terrarium/core/sources/worldgen";
import type { Point } from "@terrarium/core/spatial";
import { LAND_MARKETS, landMarket, PYEONG_M2 } from "@terrarium/core/world";
import { useState } from "react";
import { builder, count, won } from "../../logic";
import { useApp } from "../context";
import { Button, Check, Note, NumberField, Segmented, SelectField, TextField } from "../kit";
import { OutlineView, SitePad } from "./site-pad";

type Shape = "preset" | "size" | "draw";

const PRESET_OPTIONS = SITE_PRESETS.map((p) => ({
  value: p.id,
  label: `${p.name} (${p.land.w} × ${p.land.d} m)`,
}));

const MARKET_OPTIONS = LAND_MARKETS.map((m) => ({
  value: m.id,
  label: `${m.label} · 평당 ${won(m.perM2M * PYEONG_M2)}`,
}));

type Shaping = ReturnType<typeof useShape>;

/** The outline a choice of shape gives. */
function outlineFor(
  shape: Shape,
  preset: (typeof SITE_PRESETS)[number] | undefined,
  size: { readonly w: number | undefined; readonly d: number | undefined },
  points: Point[],
) {
  if (shape === "preset") return preset?.outline ?? [];
  if (shape === "size") return builder.rectangleOutline(size.w ?? 0, size.d ?? 0);
  return points;
}

function useShape() {
  const [shape, setShape] = useState<Shape>("preset");
  const [presetId, setPresetId] = useState<string>(SITE_PRESETS[0]?.id ?? "giheung");
  const [w, setW] = useState<number | undefined>(600);
  const [d, setD] = useState<number | undefined>(400);
  const [points, setPoints] = useState<Point[]>([]);
  const [picked, setPicked] = useState<string>();
  const preset = SITE_PRESETS.find((p) => p.id === presetId) ?? SITE_PRESETS[0];
  const outline = outlineFor(shape, preset, { w, d }, points);
  const missing = shape === "size" && (w === undefined || d === undefined);
  const problem = missing ? "가로와 세로를 적어 주세요" : builder.outlineProblem(outline);
  // Land costs what it costs around the campus whose shape is copied, unless a place is picked.
  const market = picked ?? (shape === "preset" ? (preset?.id ?? "general") : "general");
  return {
    ...{ market, shape, presetId, preset, w, d, points, outline, problem },
    ...{ setMarket: setPicked, setShape, setPresetId, setW, setD, setPoints },
  };
}

function Measure({ outline }: { readonly outline: readonly Point[] }) {
  if (outline.length < 3) return null;
  const area = builder.outlineArea(outline);
  const box = builder.outlineBounds(outline);
  return (
    <p className="small">
      넓이 {count(Math.round(area))}㎡ (약 {count(Math.round(area / PYEONG_M2))}평), 가로{" "}
      {count(Math.round(box.w))} m × 세로 {count(Math.round(box.d))} m
    </p>
  );
}

/** Where the price comes from, and how far to trust it. */
function marketHelp(id: string): string {
  const m = landMarket(id);
  const basis =
    m.basis === "reported" ? "기사나 공고에서 확인한 값이에요" : "찾은 값으로 추정한 값이에요";
  return `${basis}. ${m.note}`;
}

const SHAPE_OPTIONS = [
  { value: "preset", label: "사업장 모양 따라 하기" },
  { value: "size", label: "크기로 정하기" },
  { value: "draw", label: "직접 그리기" },
] as const;

function SizeFields({ s }: { readonly s: Shaping }) {
  return (
    <div className="row">
      <NumberField
        label="가로"
        value={s.w}
        min={50}
        max={3000}
        step={10}
        unit="m"
        onChange={s.setW}
      />
      <NumberField
        label="세로"
        value={s.d}
        min={50}
        max={3000}
        step={10}
        unit="m"
        onChange={s.setD}
      />
    </div>
  );
}

function DrawFields({ s }: { readonly s: Shaping }) {
  const none = s.points.length === 0;
  return (
    <>
      <SitePad points={s.points} onChange={s.setPoints} />
      <div className="row">
        <Button
          size="small"
          disabled={none}
          why="찍은 점이 아직 없어요"
          onClick={() => s.setPoints(s.points.slice(0, -1))}
        >
          마지막 점 지우기
        </Button>
        <Button
          size="small"
          disabled={none}
          why="찍은 점이 아직 없어요"
          onClick={() => s.setPoints([])}
        >
          다시 그리기
        </Button>
      </div>
      <p className="tiny muted">
        땅의 모서리를 순서대로 눌러서 점을 찍어요. 점이 3개를 넘으면 모양이 닫혀요. 10 m 칸에
        맞춰져요.
      </p>
    </>
  );
}

/** The shape of the land: a campus's, a rectangle, or drawn. */
function ShapeFields({ s }: { readonly s: Shaping }) {
  return (
    <>
      <Segmented
        label="사업장의 모양"
        value={s.shape}
        options={SHAPE_OPTIONS}
        onChange={s.setShape}
      />
      {s.shape === "preset" && (
        <>
          <SelectField
            label="사업장"
            value={s.presetId}
            options={PRESET_OPTIONS}
            onChange={s.setPresetId}
            help="지도에서 옮긴 대략의 모양만 써요. 건물은 하나도 없는 빈 땅에서 시작해요."
          />
          <OutlineView outline={s.outline} />
        </>
      )}
      {s.shape === "size" && <SizeFields s={s} />}
      {s.shape === "draw" && <DrawFields s={s} />}
      <Measure outline={s.outline} />
      {s.problem && s.outline.length >= 3 && <Note tone="bad">{s.problem}</Note>}
    </>
  );
}

interface SaleProps {
  readonly s: Shaping;
  readonly forSale: boolean;
  readonly onForSale: (on: boolean) => void;
}

/** Land for sale beside the site, and whose prices it is sold at. */
function SaleFields({ s, forSale, onForSale }: SaleProps) {
  const box = s.problem ? undefined : builder.outlineBounds(s.outline);
  const sale = box ? builder.forSaleTotal(Math.ceil(box.w), Math.ceil(box.d), s.market) : undefined;
  return (
    <>
      <Check label="사업장 바깥에 팔고 있는 땅도 두기" checked={forSale} onChange={onForSale} />
      {forSale && (
        <SelectField
          label="땅값 기준"
          value={s.market}
          options={MARKET_OPTIONS}
          onChange={s.setMarket}
          help={marketHelp(s.market)}
        />
      )}
      {forSale && sale && (
        <p className="tiny muted">
          동쪽과 남쪽에 땅이 {sale.count}곳 생겨요. 모두 사면 {won(sale.priceM)}이에요. 사야 그 위에
          건물을 지을 수 있어요.
        </p>
      )}
    </>
  );
}

export function SiteForm({ onDone }: { readonly onDone: () => void }) {
  const { api, navigate, toast } = useApp();
  const s = useShape();
  const [forSale, setForSale] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const siteName = s.shape === "preset" ? (s.preset?.name ?? "새 사업장") : "새 사업장";
  const create = async () => {
    setBusy(true);
    try {
      const title = name.trim() || `${siteName} 새 세계`;
      const blueprint = builder.newSite({
        name: title,
        siteName,
        outline: s.outline,
        forSale,
        market: s.market,
      });
      const saved = await api.call("createWorld", { body: { name: title, blueprint } });
      toast("사업장을 만들었어요. 왼쪽에서 건물을 골라 내 땅 위를 끌어 보세요");
      onDone();
      navigate({ name: "world", id: saved.world.id });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <ShapeFields s={s} />
      <SaleFields s={s} forSale={forSale} onForSale={setForSale} />
      <TextField
        label="이름"
        value={name}
        placeholder={`${siteName} 새 세계`}
        maxLength={80}
        onChange={setName}
        {...(error ? { error } : {})}
      />
      <div className="dialog-actions">
        <Button
          kind="primary"
          type="submit"
          busy={busy}
          disabled={s.problem !== undefined}
          {...(s.problem ? { why: s.problem } : {})}
        >
          이 모양으로 만들기
        </Button>
      </div>
    </form>
  );
}
