/**
 * Worlds (REQ-009, REQ-010, REQ-033, REQ-035): the list, and three ways to make one — build by hand on
 * a site, generate from a site preset and a few sizes, or read one from reality (read only, REQ-011).
 */
import type { WorldOrigin, WorldSummary } from "@terrarium/core/experiments";
import { useState } from "react";
import { count, relativeTime } from "../../logic";
import { Go, useApp, useAsync, useNow } from "../context";
import { Button, Dialog, Empty, Failure, Loading, PageHead, Segmented } from "../kit";
import { SiteForm } from "./new-site-form";
import { GenerateForm, ImportForm } from "./world-forms";

export const ORIGIN_LABELS: Readonly<Record<WorldOrigin, string>> = {
  builder: "직접 지음",
  worldgen: "생성",
  import: "현실에서 가져옴",
  sample: "예시",
};

type Way = "build" | "generate" | "import";

function NewWorldDialog({ onClose }: { readonly onClose: () => void }) {
  const [way, setWay] = useState<Way>("build");
  return (
    <Dialog title="새 세계" onClose={onClose} wide={way === "build"}>
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
        {way === "build" && <SiteForm onDone={onClose} />}
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
                <Go to={{ name: "scenarios", worldId: w.id }}>
                  시나리오<span className="sr-only"> ({w.name})</span>
                </Go>
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
        lede="에이전트가 일할 데이터센터. 손으로 짓거나, 사업장 규모로 생성하거나, 현실의 구성 정보에서 읽어 와요."
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
          title="아직 세계가 없어요"
          action={
            <Button kind="primary" onClick={() => setMaking(true)}>
              첫 세계 만들기
            </Button>
          }
        >
          빈 부지에 건물부터 지어 보거나, 사업장 프리셋으로 한 번에 생성해요.
        </Empty>
      )}
      {worlds.data && worlds.data.length > 0 && <WorldTable worlds={worlds.data} />}
      {making && <NewWorldDialog onClose={() => setMaking(false)} />}
    </div>
  );
}
