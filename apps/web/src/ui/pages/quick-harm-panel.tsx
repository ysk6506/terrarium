/** 바꾸기에서 고치는 "멈추면 시간당 피해" (REQ-104, ADR-0127): 서비스마다, 멈추는 방식마다 한 칸. 만 원 단위. */
import type { WorldRecord } from "@terrarium/core/experiments";
import { harmRows } from "../../logic";
import { NumberField } from "../kit";

export type HarmEdits = Readonly<Record<string, readonly number[]>>;

export function QuickHarm({
  world,
  edits,
  onChange,
}: {
  readonly world: WorldRecord;
  readonly edits: HarmEdits;
  readonly onChange: (next: HarmEdits) => void;
}) {
  const rows = harmRows(world.blueprint);
  if (rows.length === 0) return null;
  return (
    <section className="stack" aria-label="멈추면 시간당 피해">
      <h2 style={{ fontSize: 18 }}>멈추면 시간당 피해</h2>
      <p className="small muted">
        사고 비용은 멈춘 시간에 이 값을 곱해요. 바꾸면 이 세계의 서비스 값이 바뀌어요.
      </p>
      {rows.map((r) => (
        <div key={r.entityId} className="stack" style={{ gap: 6 }}>
          <b>{r.service}</b>
          {r.tiers.map((t, i) => (
            <NumberField
              key={t.name}
              label={t.name}
              value={Math.round((edits[r.entityId]?.[i] ?? t.perHourKrw) / 10_000)}
              min={0}
              step={10}
              unit="만 원/시간"
              onChange={(v) => {
                if (v === undefined) return;
                const base = edits[r.entityId] ?? r.tiers.map((x) => x.perHourKrw);
                onChange({
                  ...edits,
                  [r.entityId]: base.map((x, k) => (k === i ? v * 10_000 : x)),
                });
              }}
            />
          ))}
        </div>
      ))}
    </section>
  );
}
