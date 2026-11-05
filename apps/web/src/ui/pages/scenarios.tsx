/**
 * Scenarios (REQ-033, REQ-034): the list (all, or one world's), and starting a new one from a template
 * that fits the world or from an empty canvas.
 */
import type { ScenarioRecord, WorldSummary } from "@terrarium/core/experiments";
import { TEMPLATE_GROUPS } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { type KeyboardEvent, useRef, useState } from "react";
import { relativeTime, scenario } from "../../logic";
import { Go, messageOf, useApp, useAsync, useNow } from "../context";
import { Button, Dialog, Empty, Failure, Loading, Note, PageHead, SelectField } from "../kit";

const KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/** The template cards: one radio group, grouped, with the cards the world cannot use shown and explained. */
function StartCards({
  groups,
  chosen,
  onPick,
}: {
  readonly groups: readonly scenario.StartGroup[];
  readonly chosen: string;
  readonly onPick: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const move = (ev: KeyboardEvent<HTMLDivElement>) => {
    const step = KEYS[ev.key];
    if (!step) return;
    ev.preventDefault();
    const next = scenario.stepStart(groups, chosen, step);
    onPick(next);
    box.current?.querySelector<HTMLElement>(`[data-start="${next}"]`)?.focus();
  };
  return (
    <div
      ref={box}
      className="start-cards"
      role="radiogroup"
      aria-label="시작점"
      tabIndex={-1}
      onKeyDown={move}
    >
      {groups.map((g) => (
        <section key={g.id} className="start-group">
          {g.label && <h3 className="start-group-title">{g.label}</h3>}
          {g.cards.map((c) => (
            // biome-ignore lint/a11y/useSemanticElements: a card with text is not a bare radio input
            <button
              key={c.id}
              type="button"
              role="radio"
              data-start={c.id}
              className={`start-card${c.id === scenario.EMPTY_START ? " start-card-quiet" : ""}`}
              aria-checked={c.id === chosen}
              aria-disabled={c.unavailable ? true : undefined}
              tabIndex={c.id === chosen ? 0 : -1}
              onClick={() => !c.unavailable && onPick(c.id)}
            >
              <span className="start-card-head">
                <b>{c.name}</b>
                {c.difficulty && <span className="tag">{c.difficulty}</span>}
              </span>
              <span className="small muted">{c.unavailable ?? c.summary}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function NewScenarioDialog({
  worlds,
  worldId,
  onClose,
}: {
  readonly worlds: readonly WorldSummary[];
  readonly worldId?: string;
  readonly onClose: () => void;
}) {
  const { api, navigate } = useApp();
  const [world, setWorld] = useState(worldId ?? worlds[0]?.id);
  const [picked, setPicked] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const detail = useAsync(
    (signal) =>
      world ? api.call("getWorld", { params: { id: world }, signal }) : Promise.resolve(undefined),
    [world],
  );
  const index = detail.data ? new BlueprintIndex(detail.data.blueprint) : undefined;
  const groups = scenario.startGroups(TEMPLATE_GROUPS, index);
  const start = scenario.chosenStart(groups, picked);
  const create = async () => {
    if (!world) return;
    setBusy(true);
    try {
      const saved = await api.call("createScenario", {
        body:
          start === scenario.EMPTY_START
            ? { worldId: world }
            : { worldId: world, templateId: start },
      });
      onClose();
      navigate({ name: "scenario", id: saved.scenario.id });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const several = worlds.length > 1;
  return (
    <Dialog
      title="새 시나리오"
      onClose={onClose}
      actions={
        <Button
          kind="primary"
          busy={busy}
          disabled={!world || !index}
          why={world ? "세계를 불러오고 있어요" : "시나리오를 만들 세계를 먼저 골라 주세요"}
          onClick={() => void create()}
        >
          만들고 편집하기
        </Button>
      }
    >
      <div className="stack">
        {several ? (
          <SelectField
            label="세계"
            value={world}
            options={worlds.map((w) => ({ value: w.id, label: w.name }))}
            onChange={setWorld}
            help="시나리오는 한 세계의 장비를 대상으로 해요."
          />
        ) : (
          <p className="small muted">시나리오는 한 세계의 장비를 대상으로 해요.</p>
        )}
        <StartCards groups={groups} chosen={start} onPick={setPicked} />
        {error && <Note tone="bad">{error}</Note>}
      </div>
    </Dialog>
  );
}

function ScenarioTable({
  scenarios,
  worlds,
}: {
  readonly scenarios: readonly ScenarioRecord[];
  readonly worlds: readonly WorldSummary[];
}) {
  const now = useNow();
  const worldName = (id: string) => worlds.find((w) => w.id === id)?.name ?? id;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>세계</th>
            <th className="num">블록</th>
            <th className="num">채점 항목</th>
            <th>만든 사람</th>
            <th>고친 때</th>
            <th>
              <span className="sr-only">바로 가기</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {[...scenarios]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((s) => (
              <tr key={s.id}>
                <td>
                  <Go to={{ name: "scenario", id: s.id }}>{s.name}</Go>
                </td>
                <td>{worldName(s.worldId)}</td>
                <td className="num">{s.doc.nodes.length}</td>
                <td className="num">{s.doc.expectations.length}</td>
                <td>{s.owner}</td>
                <td>{relativeTime(s.updatedAt, now)}</td>
                <td>
                  <Go to={{ name: "newExperiment", scenarioId: s.id }}>
                    실험하기<span className="sr-only"> ({s.name})</span>
                  </Go>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

interface ScenarioData {
  readonly scenarios: readonly ScenarioRecord[];
  readonly worlds: readonly WorldSummary[];
}

function ScenarioBody({
  data,
  onMake,
}: {
  readonly data: ScenarioData;
  readonly onMake: () => void;
}) {
  if (data.worlds.length === 0)
    return (
      <Empty
        title="먼저 세계가 있어야 해요"
        action={<Go to={{ name: "worlds" }}>세계 만들러 가기</Go>}
      >
        시나리오는 한 세계의 장비를 대상으로 해요.
      </Empty>
    );
  if (data.scenarios.length === 0)
    return (
      <Empty
        title="아직 시나리오가 없어요"
        action={
          <Button kind="primary" onClick={onMake}>
            첫 시나리오 만들기
          </Button>
        }
      >
        팬 고장, 냉방 정지 같은 템플릿에서 시작하면 블록과 채점표가 미리 채워져요.
      </Empty>
    );
  return <ScenarioTable scenarios={data.scenarios} worlds={data.worlds} />;
}

function WorldFilter({
  worlds,
  worldId,
}: {
  readonly worlds: readonly WorldSummary[];
  readonly worldId: string | undefined;
}) {
  const { navigate } = useApp();
  if (worlds.length === 0) return null;
  const options = [
    { value: "", label: "모든 세계" },
    ...worlds.map((w) => ({ value: w.id, label: w.name })),
  ];
  return (
    <div style={{ maxWidth: 320, marginBottom: 16 }}>
      <SelectField
        label="세계로 거르기"
        value={worldId ?? ""}
        options={options}
        onChange={(v) =>
          navigate({ name: "scenarios", ...(v ? { worldId: v } : {}) }, { replace: true })
        }
      />
    </div>
  );
}

export function ScenariosPage() {
  const { api, page } = useApp();
  const worldId = page.name === "scenarios" ? page.worldId : undefined;
  const data = useAsync(
    async (signal): Promise<ScenarioData> => {
      const [scenarios, worlds] = await Promise.all([
        api.call("listScenarios", { query: worldId ? { worldId } : {}, signal }),
        api.call("listWorlds", { signal }),
      ]);
      return { scenarios, worlds };
    },
    [worldId],
  );
  const [making, setMaking] = useState(false);
  const worlds = data.data?.worlds ?? [];
  return (
    <div className="page">
      <PageHead
        title="시나리오"
        lede="세계에 일어날 일과, 에이전트가 무엇을 해야 점수를 받는지. 블록을 끌어다 놓아 만들어요."
        actions={
          <Button
            kind="primary"
            icon="plus"
            disabled={worlds.length === 0}
            why="세계가 있어야 시나리오를 만들 수 있어요"
            onClick={() => setMaking(true)}
          >
            새 시나리오
          </Button>
        }
      />
      <WorldFilter worlds={worlds} worldId={worldId} />
      {data.error && <Failure error={data.error} retry={data.reload} />}
      {!data.data && !data.error && <Loading />}
      {data.data && <ScenarioBody data={data.data} onMake={() => setMaking(true)} />}
      {making && (
        <NewScenarioDialog
          worlds={worlds}
          {...(worldId ? { worldId } : {})}
          onClose={() => setMaking(false)}
        />
      )}
    </div>
  );
}
