/**
 * Worlds (REQ-009, REQ-010, REQ-033, REQ-035): the list, and three ways to make one — build by hand on
 * a site, generate from a site preset and a few sizes, or read one from reality (read only, REQ-011).
 */
import type { WorldOrigin, WorldSummary } from "@terrarium/core/experiments";
import { SITE_PRESETS } from "@terrarium/core/sources/worldgen";
import { useState } from "react";
import { builder, count, relativeTime } from "../../logic";
import { Go, useApp, useAsync, useNow } from "../context";
import {
  Button,
  Dialog,
  Empty,
  Failure,
  Loading,
  PageHead,
  Segmented,
  SelectField,
  TextField,
} from "../kit";
import { GenerateForm, ImportForm } from "./world-forms";

export const ORIGIN_LABELS: Readonly<Record<WorldOrigin, string>> = {
  builder: "직접 지음",
  worldgen: "생성",
  import: "현실에서 가져옴",
  sample: "예시",
};

const SITE_OPTIONS = SITE_PRESETS.map((p) => ({
  value: p.id,
  label: `${p.name} (${p.land.w} × ${p.land.d} m)`,
}));

type Way = "build" | "generate" | "import";

function BuildForm({ onDone }: { readonly onDone: () => void }) {
  const { api, navigate, toast } = useApp();
  const [site, setSite] = useState<string>(SITE_PRESETS[0]?.id ?? "giheung");
  const preset = SITE_PRESETS.find((p) => p.id === site) ?? SITE_PRESETS[0];
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const create = async () => {
    if (!preset) return;
    setBusy(true);
    try {
      const title = name.trim() || `${preset.name} 새 세계`;
      const blueprint = builder.emptyWorld("new", title, preset.land, preset.name);
      const saved = await api.call("createWorld", { body: { name: title, blueprint } });
      toast("빈 부지를 만들었다. 왼쪽에서 건물을 고르고 땅 위를 끈다");
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
      <SelectField
        label="사업장"
        value={site}
        options={SITE_OPTIONS}
        onChange={setSite}
        help="부지 크기만 정해진 빈 땅에서 시작한다. 실제 배치도는 쓰지 않는다."
      />
      <TextField
        label="이름"
        value={name}
        placeholder={`${preset?.name ?? ""} 새 세계`}
        maxLength={80}
        onChange={setName}
        {...(error ? { error } : {})}
      />
      <div className="dialog-actions">
        <Button kind="primary" type="submit" busy={busy}>
          빈 부지에서 짓기
        </Button>
      </div>
    </form>
  );
}

function NewWorldDialog({ onClose }: { readonly onClose: () => void }) {
  const [way, setWay] = useState<Way>("build");
  return (
    <Dialog title="새 세계" onClose={onClose}>
      <div className="stack">
        <Segmented
          label="만드는 방법"
          value={way}
          options={[
            { value: "build", label: "직접 짓기" },
            { value: "generate", label: "사업장으로 생성" },
            { value: "import", label: "현실에서 가져오기" },
          ]}
          onChange={setWay}
        />
        {way === "build" && <BuildForm onDone={onClose} />}
        {way === "generate" && <GenerateForm onDone={onClose} />}
        {way === "import" && <ImportForm onDone={onClose} />}
      </div>
    </Dialog>
  );
}

function scale(w: WorldSummary): string {
  const racks = w.counts.rack ?? 0;
  const servers = w.counts.server ?? 0;
  if (racks === 0 && servers === 0) return "비어 있음";
  return `랙 ${count(racks)}, 서버 ${count(servers)}`;
}

function WorldTable({ worlds }: { readonly worlds: readonly WorldSummary[] }) {
  const now = useNow();
  const sorted = [...worlds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>만든 방법</th>
            <th>규모</th>
            <th>만든 사람</th>
            <th>고친 때</th>
            <th>
              <span className="sr-only">바로 가기</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((w) => (
            <tr key={w.id}>
              <td>
                <Go to={{ name: "world", id: w.id }}>{w.name}</Go>
              </td>
              <td>{ORIGIN_LABELS[w.origin]}</td>
              <td className="num">{scale(w)}</td>
              <td>{w.owner}</td>
              <td>{relativeTime(w.updatedAt, now)}</td>
              <td>
                <Go to={{ name: "scenarios", worldId: w.id }}>시나리오</Go>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorldsPage() {
  const { api } = useApp();
  const worlds = useAsync((signal) => api.call("listWorlds", { signal }), []);
  const [making, setMaking] = useState(false);
  return (
    <div className="page">
      <PageHead
        title="세계"
        lede="에이전트가 일할 데이터센터. 손으로 짓거나, 사업장 규모로 생성하거나, 현실의 구성 정보에서 읽어 온다."
        actions={
          <Button kind="primary" icon="plus" onClick={() => setMaking(true)}>
            새 세계
          </Button>
        }
      />
      {worlds.error && <Failure error={worlds.error} retry={worlds.reload} />}
      {!worlds.data && !worlds.error && <Loading />}
      {worlds.data?.length === 0 && (
        <Empty
          title="아직 세계가 없다"
          action={
            <Button kind="primary" onClick={() => setMaking(true)}>
              첫 세계 만들기
            </Button>
          }
        >
          빈 부지에 건물부터 지어 보거나, 사업장 프리셋으로 한 번에 생성한다.
        </Empty>
      )}
      {worlds.data && worlds.data.length > 0 && <WorldTable worlds={worlds.data} />}
      {making && <NewWorldDialog onClose={() => setMaking(false)} />}
    </div>
  );
}
