/**
 * "사업장 그대로" (REQ-077, ADR-0083): which site, how big, and what comes out — then one button that says what it
 * makes. The other numbers are folded under "더 정하기" in three groups (world-details.tsx). While the server builds
 * the world the button works and a line names the stage; the server does not report progress, so the stage follows time.
 */
import type { CampusSpec, SiteId } from "@terrarium/core/sources/worldgen";
import { SITE_PRESETS } from "@terrarium/core/sources/worldgen";
import { useEffect, useMemo, useState } from "react";
import { count, worldScale } from "../../logic";
import { messageOf, useApp } from "../context";
import { Button, Note } from "../kit";
import { useSharingChoice } from "../scope";
import { OutlineView } from "./site-pad";
import { WorldDetails } from "./world-details";

type Form = {
  readonly site: SiteId;
  readonly scale: worldScale.ScaleId;
  readonly changes: Partial<CampusSpec>;
  readonly name: string;
};

const START: Form = {
  site: worldScale.DEFAULT_SITE,
  scale: worldScale.DEFAULT_SCALE,
  changes: {},
  name: "",
};

/** The site's buildings in a line: "팹 7동 · 연구동 3동 · 데이터센터 1동". */
function mixText(site: SiteId): string {
  const spec = worldScale.scaleSpec(site, "real");
  const parts = [
    spec.fabs > 0 ? `팹 ${spec.fabs}동` : "",
    spec.labs > 0 ? `연구동 ${spec.labs}동` : "",
    spec.buildings > 0 ? `데이터센터 ${spec.buildings}동` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function SiteCards({
  site,
  onPick,
}: {
  readonly site: SiteId;
  readonly onPick: (s: SiteId) => void;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <b className="small">어느 사업장인가요?</b>
      <div className="site-cards" role="radiogroup" aria-label="사업장">
        {SITE_PRESETS.map((p) => (
          // biome-ignore lint/a11y/useSemanticElements: a card with a picture and text is not a bare radio input
          <button
            key={p.id}
            type="button"
            role="radio"
            className="site-card"
            aria-checked={p.id === site}
            tabIndex={p.id === site ? 0 : -1}
            onClick={() => onPick(p.id)}
          >
            <OutlineView outline={p.outline} />
            <b>{p.name}</b>
            <span className="tiny muted">{mixText(p.id)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ScaleChoices(props: {
  readonly choices: readonly worldScale.ScaleChoice[];
  readonly scale: worldScale.ScaleId;
  readonly onPick: (s: worldScale.ScaleId) => void;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <b className="small">얼마나 크게 만들까요?</b>
      <div className="scale-cards" role="radiogroup" aria-label="규모">
        {props.choices.map((c) => (
          // biome-ignore lint/a11y/useSemanticElements: a card with two lines is not a bare radio input
          <button
            key={c.id}
            type="button"
            role="radio"
            className="scale-card"
            aria-checked={c.id === props.scale}
            tabIndex={c.id === props.scale ? 0 : -1}
            onClick={() => props.onPick(c.id)}
          >
            <b>{c.label}</b>
            <span className="small muted">{c.about}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The stage the server is at, named from time: a server that says nothing of its progress still moves the words. */
function useStage(busy: boolean, racks: number): string | undefined {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return setElapsed(0);
    const from = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - from), 400);
    return () => window.clearInterval(timer);
  }, [busy]);
  return busy ? worldScale.stageAt(elapsed, racks) : undefined;
}

const resultText = (
  preset: string | undefined,
  changes: object,
  size: ReturnType<typeof worldScale.sizeOf>,
): string =>
  preset && !Object.keys(changes).length
    ? preset
    : `${worldScale.sizeText(size)} — 정한 대로 만들어요`;

function ResultLine({ text }: { readonly text: string }) {
  return (
    <p className="result-line" aria-live="polite" data-testid="world-result">
      {text}
    </p>
  );
}

export function CampusForm({ onDone }: { readonly onDone: () => void }) {
  const { api, navigate, toast } = useApp();
  const [form, setForm] = useState<Form>(START);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const sharing = useSharingChoice("world");
  const choices = useMemo(() => worldScale.scaleChoices(form.site), [form.site]);
  const scale = choices.find((c) => c.id === form.scale) ?? choices[choices.length - 1];
  const base = scale?.spec ?? worldScale.scaleSpec(form.site, "real");
  const name = form.name.trim() || `${worldScale.siteName(form.site)} 세계`;
  const spec: CampusSpec = useMemo(
    () => ({ ...base, ...form.changes, name }),
    [base, form.changes, name],
  );
  const size = useMemo(() => worldScale.sizeOf(spec), [spec]);
  const problem = worldScale.specProblem(spec);
  const stage = useStage(busy, size.racks);
  const set = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));
  const make = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api.call("generateWorld", {
        body: { campus: spec, ...sharing.forCreate },
      });
      toast(`${saved.world.name}을 만들었어요. 랙 ${count(saved.stats.rack ?? 0)}대예요`);
      onDone();
      navigate({ name: "world", id: saved.world.id });
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void make();
      }}
    >
      <SiteCards
        site={form.site}
        onPick={(site) => set({ site, changes: {}, scale: worldScale.DEFAULT_SCALE })}
      />
      <ScaleChoices
        choices={choices}
        scale={scale?.id ?? "real"}
        onPick={(next) => set({ scale: next, changes: {} })}
      />
      <ResultLine text={resultText(scale?.result, form.changes, size)} />
      <WorldDetails
        spec={spec}
        onChange={(changes) => set({ changes: { ...form.changes, ...changes } })}
        name={form.name}
        onName={(name) => set({ name })}
        placeholder={`${worldScale.siteName(form.site)} 세계`}
      />
      {sharing.field}
      {problem && <Note tone="bad">{problem}</Note>}
      {error && <Note tone="bad">{error}</Note>}
      {stage && <output className="small muted">{stage}</output>}
      <div className="dialog-actions">
        <Button
          data-moss-skip="세계 폼 안의 입력"
          kind="primary"
          type="submit"
          busy={busy}
          disabled={problem !== undefined}
          {...(problem ? { why: problem } : {})}
        >
          {worldScale.makeLabel(form.site)}
        </Button>
      </div>
    </form>
  );
}
