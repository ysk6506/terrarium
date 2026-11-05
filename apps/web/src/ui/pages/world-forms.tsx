/**
 * Making a world without building it: generate one from a site preset and a few sizes (REQ-009), or
 * read one from a configured reality source such as the FalkorDB knowledge graph (REQ-010, REQ-011).
 */

import { withJosa } from "@terrarium/core/kernel";
import type { ImportReport } from "@terrarium/core/sources/realimport";
import {
  CHOICE_FIELD_LABELS,
  CHOICE_LABELS,
  DEFAULT_WORLDGEN,
  MAX_RACKS,
  rackCount,
  SITE_PRESETS,
  type SiteId,
  specProblems,
  WORLDGEN_FIELDS,
  type WorldgenSpec,
} from "@terrarium/core/sources/worldgen";
import { useState } from "react";
import { count } from "../../logic";
import { messageOf, useApp } from "../context";
import { Button, Check, Note, NumberField, SelectField, TextField } from "../kit";

const SITE_OPTIONS = SITE_PRESETS.map((p) => ({ value: p.id, label: p.name }));
type ChoiceKey = keyof typeof CHOICE_LABELS;
const CHOICE_KEYS = Object.keys(CHOICE_LABELS) as ChoiceKey[];

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function WorldgenFields({
  spec,
  set,
}: {
  readonly spec: WorldgenSpec;
  readonly set: <K extends keyof WorldgenSpec>(key: K, value: WorldgenSpec[K]) => void;
}) {
  return (
    <div className="grid-2">
      {WORLDGEN_FIELDS.map((f) => (
        <NumberField
          key={f.key}
          label={f.label}
          value={spec[f.key]}
          min={f.min}
          max={f.max}
          step={f.integer ? 1 : 0.05}
          {...(f.unit !== "비율" ? { unit: f.unit } : {})}
          onChange={(v) => v !== undefined && set(f.key, v)}
        />
      ))}
      {CHOICE_KEYS.map((key) => (
        <SelectField
          key={key}
          label={CHOICE_FIELD_LABELS[key]}
          value={String(spec[key])}
          options={Object.entries(CHOICE_LABELS[key]).map(([value, label]) => ({ value, label }))}
          onChange={(v) => set(key, v as never)}
        />
      ))}
      <NumberField
        label="시드"
        value={spec.seed}
        min={0}
        step={1}
        onChange={(v) => v !== undefined && set("seed", Math.round(v))}
        help="같은 시드면 같은 세계가 나와요."
      />
    </div>
  );
}

export function GenerateForm({ onDone }: { readonly onDone: () => void }) {
  const { api, navigate, toast } = useApp();
  const [spec, setSpec] = useState<WorldgenSpec>({
    ...DEFAULT_WORLDGEN,
    site: "hwaseong",
    seed: 1,
  });
  const { busy, error, submit } = useSubmit();
  const problems = specProblems(spec);
  const racks = rackCount(spec);
  const set = <K extends keyof WorldgenSpec>(key: K, value: WorldgenSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));
  const go = () =>
    submit(async () => {
      const saved = await api.call("generateWorld", { body: { spec } });
      toast(
        `${saved.world.name}: 랙 ${count(saved.stats.rack ?? 0)}개, 서버 ${count(saved.stats.server ?? 0)}대를 만들었어요`,
      );
      onDone();
      navigate({ name: "world", id: saved.world.id });
    });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <SelectField
        label="사업장"
        value={spec.site}
        options={SITE_OPTIONS}
        onChange={(v) => set("site", v as SiteId)}
      />
      <WorldgenFields spec={spec} set={set} />
      <p className="small">
        랙 {count(racks)}개 (최대 {count(MAX_RACKS)}개)
      </p>
      {problems.map((p) => (
        <Note key={p} tone="bad">
          {p}
        </Note>
      ))}
      {error && <Note tone="bad">{error}</Note>}
      <div className="dialog-actions">
        <Button
          kind="primary"
          type="submit"
          busy={busy}
          disabled={problems.length > 0}
          why={problems[0]}
        >
          생성하기
        </Button>
      </div>
    </form>
  );
}

function reportText(report: ImportReport): string {
  const n = (k: keyof ImportReport["entities"]) => count(report.entities[k] ?? 0);
  const assumed =
    report.assumptions.length > 0
      ? ` 가정한 것 ${report.assumptions.length}가지는 세계 정보에 남아요`
      : "";
  return `랙 ${n("rack")}개, 서버 ${n("server")}대, VM ${n("vm")}개를 읽었어요.${assumed}`;
}

export function ImportForm({ onDone }: { readonly onDone: () => void }) {
  const { api, navigate, toast, meta } = useApp();
  const sources = (meta?.sources ?? []).filter((s) => s.configured);
  const [source, setSource] = useState(sources[0]?.id);
  const [name, setName] = useState("");
  const [rooms, setRooms] = useState("");
  const [assume, setAssume] = useState({ power: true, cooling: true });
  const { busy, error, submit } = useSubmit();
  const roomList = rooms
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const go = () =>
    submit(async () => {
      if (!source) return;
      const saved = await api.call("importWorld", {
        body: {
          source,
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(roomList.length ? { rooms: roomList } : {}),
          assume,
        },
      });
      toast(`${withJosa(saved.world.name, "을")} 가져왔어요. ${reportText(saved.report)}`);
      onDone();
      navigate({ name: "world", id: saved.world.id });
    });
  if (sources.length === 0)
    return (
      <Note tone="warn">
        설정된 현실 소스가 없어요. 서버 설정의 sources에 FalkorDB 같은 소스를 더하면 여기에 나와요.
      </Note>
    );
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <Note>
        현실은 읽기만 해요. 가져온 세계는 사본이라 무엇을 해도 실제 장비에는 영향이 없어요.
      </Note>
      <SelectField
        label="소스"
        value={source}
        options={sources.map((s) => ({ value: s.id, label: s.name }))}
        onChange={setSource}
      />
      <TextField label="이름 (선택)" value={name} maxLength={80} onChange={setName} />
      <TextField
        label="가져올 서버룸 (선택, 쉼표로 구분)"
        value={rooms}
        onChange={setRooms}
        help="비워 두면 전부 가져와요. 큰 그래프는 서버룸을 골라야 빨라요."
      />
      <Check
        label="전원 계통이 없으면 가정해서 채워요"
        checked={assume.power}
        onChange={(power) => setAssume((a) => ({ ...a, power }))}
      />
      <Check
        label="냉방 설비가 없으면 가정해서 채워요"
        checked={assume.cooling}
        onChange={(cooling) => setAssume((a) => ({ ...a, cooling }))}
      />
      {error && <Note tone="bad">{error}</Note>}
      <div className="dialog-actions">
        <Button kind="primary" type="submit" busy={busy}>
          가져오기
        </Button>
      </div>
    </form>
  );
}
