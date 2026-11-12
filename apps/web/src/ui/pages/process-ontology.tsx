/**
 * 이 세계를 E2E로 가려면 (REQ-112, ADR-0135, 목업 4의 #8): 세계의 시나리오 정의에서 코드가 뽑은 Object · Link · Action 요구와, 고른
 * 실험에서 그 액션을 실제로 누가 했는지. 이끼의 설명은 기본 모델이 있을 때만 나오고, 없으면 자리도 없어요.
 */
import type {
  OntologyAction,
  OntologyNeeds,
  OntologyUse,
  UsedAction,
} from "@terrarium/core/analysis";
import type { WorldOntologyView } from "@terrarium/core/contract";
import { useEffect, useState, useSyncExternalStore } from "react";
import { processCompare as pc } from "../../logic";
import { isAwake, MossAsk, subscribe } from "../../moss";
import { useApp, useAsync } from "../context";
import { download } from "../download";
import { Button, Empty, MenuButton, Section, SelectField } from "../kit";

const { ONTOLOGY_WORDS: W } = pc;
const SHOWN = 6;

const DOER_CLASS = {
  agent: "pl-tag-agent",
  approved: "pl-tag-approve",
  physical: "pl-tag-physical",
  handoff: "pl-tag-handoff",
  none: "pl-tag-handoff",
} as const;

const DOER_WORDS = {
  agent: "에이전트",
  approved: "승인 뒤",
  physical: "물리",
  handoff: "넘기기",
  none: "안 씀",
} as const;

function targetText(a: OntologyAction): string {
  return a.targets.map((t) => `${t.label} ${t.count}`).join(" · ") || "—";
}

function Needs({ needs, all }: { readonly needs: OntologyNeeds; readonly all: boolean }) {
  const rows = all ? needs.actions : needs.actions.slice(0, SHOWN);
  return (
    <section className="pt-card" aria-label={W.needs}>
      <h3>{W.needs}</h3>
      <div className="pc-lab">
        {W.counts(needs.objects.length, needs.links.length, needs.actions.length)}
      </div>
      <table className="po-table">
        <thead>
          <tr>
            <th>{W.cols.action}</th>
            <th>{W.cols.target}</th>
            <th>{W.cols.faults}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>{a.label}</td>
              <td>{targetText(a)}</td>
              <td>{pc.faultsText(a.faults.map((f) => f.label))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function UsedTable({ use, all }: { readonly use: OntologyUse; readonly all: boolean }) {
  const rows: readonly UsedAction[] = all ? use.actions : use.actions.slice(0, SHOWN);
  const b = use.byDoer;
  return (
    <section className="pt-card" aria-label={W.used}>
      <h3>{W.used}</h3>
      <div className="pc-lab">
        에이전트 {b.agent} · 승인 뒤 {b.approved} · 물리 {b.physical} · 넘기기 {b.handoff} · 한 번도
        안 씀 {b.none}
      </div>
      <table className="po-table">
        <thead>
          <tr>
            <th>{W.cols.action}</th>
            <th>{W.cols.who}</th>
            <th className="num">{W.cols.count}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                {a.label}
                {!a.needed && <span className="pl-note">{W.extra}</span>}
              </td>
              <td>
                <span className={`pl-tag ${DOER_CLASS[a.doer]}`}>{DOER_WORDS[a.doer]}</span>
              </td>
              <td className="num">{a.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="po-gap">
        <MossAsk question="키네틱 층은 뭐예요?">
          <b>{use.line}</b>
        </MossAsk>
      </div>
    </section>
  );
}

/** 이끼의 설명: 기본 모델이 있을 때만 묻고, 답이 없으면 자리도 두지 않는다. */
function MossExplains({ view }: { readonly view: WorldOntologyView }) {
  const { api } = useApp();
  const awake = useSyncExternalStore(subscribe, isAwake, isAwake);
  const [text, setText] = useState<string>();
  const use = view.use;
  const key = `${view.worldId}:${view.experimentId ?? ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: ask again only for another world or experiment
  useEffect(() => {
    setText(undefined);
    if (!awake || !use) return undefined;
    const controller = new AbortController();
    const state = {
      세계: view.worldName,
      "필요한 액션": view.needs.actions.slice(0, 12).map((a) => ({
        액션: a.label,
        "푸는 고장 수": a.faults.length,
        누가: DOER_WORDS[use.actions.find((u) => u.id === a.id)?.doer ?? "none"],
        한_수: use.actions.find((u) => u.id === a.id)?.total ?? 0,
      })),
      요약: use.line,
    };
    api
      .call("askMoss", {
        body: {
          screen: "experiment",
          question:
            "이 세계에서 어떤 액션을 승인으로 남기고 어떤 액션을 에이전트에게 맡길지 세 문장으로 설명해 줘요.",
          state,
          actions: [],
        },
        signal: controller.signal,
      })
      .then((a) => !controller.signal.aborted && a.answered && setText(a.answer))
      .catch(() => undefined);
    return () => controller.abort();
  }, [awake, key]);
  if (!awake || !text) return null;
  return (
    <div className="po-moss">
      <b>{W.moss}</b>
      {text}
    </div>
  );
}

function ExportMenu({
  view,
  rows,
}: {
  readonly view: WorldOntologyView;
  readonly rows: readonly pc.OntologyRow[];
}) {
  const save = (kind: "csv" | "json") => {
    const name = pc.fileName(view.worldName, kind);
    if (kind === "csv") download(name, pc.toCsv(rows), "text/csv;charset=utf-8");
    else download(name, pc.toJson(view.worldName, rows), "application/json");
  };
  return (
    <div className="po-export">
      <MenuButton
        label={W.export}
        icon="download"
        items={[
          { label: W.exportCsv, hint: "스프레드시트로 열어요", onSelect: () => save("csv") },
          { label: W.exportJson, hint: "다른 도구에 그대로 넘겨요", onSelect: () => save("json") },
        ]}
      />
    </div>
  );
}

export function WorldOntology({
  worldId,
  experimentId,
}: {
  readonly worldId: string;
  readonly experimentId: string;
}) {
  const { api } = useApp();
  const [picked, setPicked] = useState(experimentId);
  const [all, setAll] = useState(false);
  const data = useAsync(
    (signal) =>
      api.call("worldOntology", {
        params: { id: worldId },
        query: { experimentId: picked },
        signal,
      }),
    [worldId, picked],
  );
  const view = data.data;
  const rows = view ? pc.ontologyRows(view.needs, view.use) : [];
  if (!view) return null;
  const more = Math.max(
    Math.max(view.needs.actions.length, view.use?.actions.length ?? 0) - SHOWN,
    0,
  );
  return (
    <Section title={W.title}>
      <p className="small muted" style={{ marginTop: -4 }}>
        {W.sub(view.needs.scenarios)}
      </p>
      {view.needs.actions.length === 0 ? (
        <Empty title={W.none} />
      ) : (
        <>
          {view.experiments.length > 1 && (
            <div className="po-pick">
              <SelectField
                label={W.pick}
                value={picked}
                options={view.experiments.map((e) => ({ value: e.id, label: e.name }))}
                onChange={setPicked}
              />
            </div>
          )}
          <div className="po-cols">
            <Needs needs={view.needs} all={all} />
            {view.use ? <UsedTable use={view.use} all={all} /> : <Empty title={W.noExperiment} />}
          </div>
          {more > 0 && (
            <p style={{ marginTop: 10 }}>
              <Button
                kind="quiet"
                size="small"
                data-moss-skip="목록 펼치기"
                onClick={() => setAll((v) => !v)}
              >
                {all ? W.less : W.more(more)}
              </Button>
            </p>
          )}
          <MossExplains view={view} />
          <ExportMenu view={view} rows={rows} />
        </>
      )}
    </Section>
  );
}
