/**
 * Worlds (REQ-009, REQ-033, REQ-035, REQ-077, REQ-094): the list, and the way to a new world, which is a page of its own
 * with the first question (what are you here to do) and two doors.
 */
import type { WorldOrigin, WorldSummary } from "@terrarium/core/experiments";
import { count, relativeTime } from "../../logic";
import { Go, useApp, useAsync, useNow } from "../context";
import { Empty, Failure, Loading, PageHead } from "../kit";

export const ORIGIN_LABELS: Readonly<Record<WorldOrigin, string>> = {
  builder: "직접 지음",
  worldgen: "생성",
  import: "현실에서 가져옴",
  sample: "예시",
  template: "템플릿",
};

function scale(w: WorldSummary): string {
  const racks = w.counts.rack ?? 0;
  const servers = w.counts.server ?? 0;
  if (racks === 0 && servers === 0) return "비어 있음";
  return `랙 ${count(racks)}대 · 서버 ${count(servers)}대`;
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
  const none = worlds.data?.length === 0;
  return (
    <div className="page">
      <PageHead
        title="세계"
        lede="에이전트가 일할 데이터센터예요. 사업장 그대로 만들거나, 작게 시작해서 직접 키워요."
        {...(none
          ? {}
          : {
              actions: (
                <Go to={{ name: "newWorld" }} className="btn btn-primary">
                  새 세계
                </Go>
              ),
            })}
      />
      {worlds.error && <Failure error={worlds.error} retry={worlds.reload} />}
      {!worlds.data && !worlds.error && <Loading />}
      {none && (
        <Empty
          title="아직 세계가 없어요"
          action={
            <Go to={{ name: "newWorld" }} className="btn btn-primary">
              새 세계 만들기
            </Go>
          }
        >
          세계를 만들면 에이전트가 일할 데이터센터가 생겨요.
        </Empty>
      )}
      {worlds.data && worlds.data.length > 0 && <WorldTable worlds={worlds.data} />}
    </div>
  );
}
