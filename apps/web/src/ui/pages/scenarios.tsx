/**
 * Scenarios (REQ-033, REQ-034): the list (all, or one world's), and starting a new one from a template
 * that fits the world or from an empty canvas.
 */
import type { ScenarioWithScope } from "@terrarium/core/contract";
import type { WorldSummary } from "@terrarium/core/experiments";
import { TEMPLATE_GROUPS } from "@terrarium/core/scenario";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  matchesFilter,
  relativeTime,
  type ScopeFilter,
  type ScopeValue,
  START_SCOPE,
  scenario,
  scopeBody,
} from "../../logic";
import { scenariosState, useMossRead } from "../../moss";
import { Go, messageOf, useApp, useAsync, useNow } from "../context";
import { Button, Dialog, Empty, Failure, Loading, Note, PageHead, SelectField } from "../kit";
import {
  FilterEmpty,
  ScopeAsk,
  ScopeButton,
  ScopeFilterBar,
  ScopeTag,
  useOwnerName,
} from "../scope";

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
              {c.domains && <span className="tiny">{c.domains}</span>}
              {c.note && (
                <span className="tiny" style={{ color: "var(--warn)" }}>
                  {c.note}
                </span>
              )}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * The templates whose cause the tools a real team has never get to in this world (ADR-0091 item 4). Each is played
 * in a short session, one after another so the page stays usable, and only for a world small enough to play here.
 */
function useNoCommonPath(blueprint: Blueprint | undefined): ReadonlySet<string> {
  const [found, setFound] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setFound(new Set());
    if (!blueprint || !scenario.canProbe(blueprint)) return undefined;
    const templates = TEMPLATE_GROUPS.flatMap((g) => g.templates);
    const no = new Set<string>();
    let next = 0;
    let stopped = false;
    const step = () => {
      const template = templates[next++];
      if (stopped || !template) return;
      try {
        if (scenario.reachesAnswer(blueprint, template) === false)
          setFound(new Set(no.add(template.id)));
      } catch {
        // a template that cannot be played here says nothing about the tools
      }
      setTimeout(step, 0);
    };
    const timer = setTimeout(step, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [blueprint]);
  return found;
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
  const { api, navigate, meta } = useApp();
  const [world, setWorld] = useState(worldId ?? worlds[0]?.id);
  const [picked, setPicked] = useState<string>();
  const [sharing, setSharing] = useState<ScopeValue>({ scope: START_SCOPE.scenario });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const detail = useAsync(
    (signal) =>
      world ? api.call("getWorld", { params: { id: world }, signal }) : Promise.resolve(undefined),
    [world],
  );
  const index = detail.data ? new BlueprintIndex(detail.data.blueprint) : undefined;
  const noCommonPath = useNoCommonPath(detail.data?.blueprint);
  const groups = scenario.startGroups(TEMPLATE_GROUPS, index, noCommonPath);
  const start = scenario.chosenStart(groups, picked);
  const create = async () => {
    if (!world) return;
    setBusy(true);
    try {
      const shared = scopeBody(sharing, meta?.user.groups ?? []);
      const saved = await api.call("createScenario", {
        body:
          start === scenario.EMPTY_START
            ? { worldId: world, ...shared }
            : { worldId: world, templateId: start, ...shared },
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
          data-moss-skip="편집기에서 직접"
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
        <ScopeAsk value={sharing} onChange={setSharing} />
        {error && <Note tone="bad">{error}</Note>}
      </div>
    </Dialog>
  );
}

function ScenarioTable({
  scenarios,
  worlds,
  onChanged,
}: {
  readonly scenarios: readonly ScenarioWithScope[];
  readonly worlds: readonly WorldSummary[];
  readonly onChanged: () => void;
}) {
  const now = useNow();
  const ownerOf = useOwnerName();
  const worldName = (id: string) => worlds.find((w) => w.id === id)?.name ?? id;
  return (
    <div className="table-wrap">
      <table className="table scenarios-table">
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
                <td className="sc-name">
                  <Go to={{ name: "scenario", id: s.id }}>{s.name}</Go>
                  <ScopeTag item={s} />
                </td>
                <td className="sc-world">{worldName(s.worldId)}</td>
                <td className="num sc-blocks">{s.doc.nodes.length}</td>
                <td className="num sc-checks">{s.doc.expectations.length}</td>
                <td className="sc-owner">{ownerOf(s.owner)}</td>
                <td className="sc-when">{relativeTime(s.updatedAt, now)}</td>
                <td>
                  <Go to={{ name: "newExperiment", scenarioId: s.id }}>
                    실험하기<span className="sr-only"> ({s.name})</span>
                  </Go>
                  {" · "}
                  <Go to={{ name: "scenarioProcess", id: s.id }}>
                    지금 방식<span className="sr-only"> ({s.name})</span>
                  </Go>
                  {s.canChangeScope && (
                    <>
                      {" · "}
                      <ScopeButton
                        kind="scenario"
                        id={s.id}
                        name={s.name}
                        owner={s.owner}
                        current={{
                          scope: s.scope ?? "everyone",
                          ...(s.group ? { group: s.group } : {}),
                        }}
                        onChanged={onChanged}
                      />
                    </>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

interface ScenarioData {
  readonly scenarios: readonly ScenarioWithScope[];
  readonly worlds: readonly WorldSummary[];
}

function ScenarioBody({
  data,
  onMake,
  onChanged,
}: {
  readonly data: ScenarioData;
  readonly onMake: () => void;
  readonly onChanged: () => void;
}) {
  const { me } = useApp();
  const [who, setWho] = useState<ScopeFilter>("all");
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
          <Button data-moss-skip="편집기에서 직접" kind="primary" onClick={onMake}>
            첫 시나리오 만들기
          </Button>
        }
      >
        팬 고장, 냉방 정지 같은 템플릿에서 시작하면 블록과 채점표가 미리 채워져요.
      </Empty>
    );
  const shown = data.scenarios.filter((s) => matchesFilter(who, s, me));
  return (
    <>
      <div className="scope-filter-row">
        <ScopeFilterBar value={who} onChange={setWho} />
      </div>
      {shown.length === 0 ? (
        <FilterEmpty filter={who} onClear={() => setWho("all")} />
      ) : (
        <ScenarioTable scenarios={shown} worlds={data.worlds} onChanged={onChanged} />
      )}
    </>
  );
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
        api.call("listWorlds", { query: { sort: "new" }, signal }),
      ]);
      return { scenarios, worlds };
    },
    [worldId],
  );
  const [making, setMaking] = useState(false);
  const worlds = data.data?.worlds ?? [];
  useMossRead("scenarios", () => scenariosState(data.data?.scenarios ?? []));
  return (
    <div className="page">
      <PageHead
        title="시나리오"
        lede="세계에 일어날 일과, 에이전트가 무엇을 해야 점수를 받는지. 블록을 끌어다 놓아 만들어요."
        actions={
          <Button
            data-moss-skip="편집기에서 직접"
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
      {data.data && (
        <ScenarioBody data={data.data} onMake={() => setMaking(true)} onChanged={data.reload} />
      )}
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
