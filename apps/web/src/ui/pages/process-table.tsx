/**
 * "지금 하는 방식" (REQ-112, ADR-0135, 목업 4의 #7): 시나리오 하나에서 사람이 지금 어떻게 일하는지 한 줄씩 적는 표. 적은 값은
 * 측정값이 아니고, 결과 화면에서 "지금 하는 방식(적은 값)"으로만 나와요. 한 화면에 한 질문: 누가 뭘 하나요?
 */
import type { CurrentProcessView } from "@terrarium/core/contract";
import { type Dispatch, type SetStateAction, useState } from "react";
import { processCompare as pc } from "../../logic";
import { useMossScreen } from "../../moss";
import { Go, messageOf, useApp, useAsync, useLeaveGuard, usePageTitle } from "../context";
import { Button, Failure, Loading, Note, PageHead } from "../kit";

const { TABLE_WORDS: W } = pc;

type Change = (patch: Partial<Omit<pc.DraftRow, "key">>) => void;
interface CellProps {
  readonly n: number;
  readonly row: pc.DraftRow;
  readonly readOnly: boolean;
  readonly onChange: Change;
}

function TimeCell({ n, row, readOnly, onChange }: CellProps) {
  return (
    <div className="pt-cell pt-time">
      <input
        className="input"
        inputMode="decimal"
        aria-label={`${n}번 단계 걸리는 시간`}
        aria-invalid={pc.issuesOf(row).includes("time")}
        placeholder="10"
        value={row.amount}
        disabled={readOnly}
        onChange={(e) => onChange({ amount: e.target.value })}
      />
      <select
        className="select"
        aria-label={`${n}번 단계 시간 단위`}
        value={row.unit}
        disabled={readOnly}
        onChange={(e) => onChange({ unit: e.target.value as pc.TimeUnit })}
      >
        <option value="분">분</option>
        <option value="시간">시간</option>
      </select>
    </div>
  );
}

function KindCell({ n, row, readOnly, onChange }: CellProps) {
  return (
    <div className="pt-cell">
      <select
        className={`select pt-kind pt-kind-${row.kind}`}
        aria-label={`${n}번 단계 종류`}
        value={row.kind}
        disabled={readOnly}
        onChange={(e) => onChange({ kind: e.target.value as pc.DraftRow["kind"] })}
      >
        {pc.KIND_CHOICES.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RowTools(props: {
  readonly n: number;
  readonly first: boolean;
  readonly last: boolean;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const { n } = props;
  return (
    <div className="pt-tools">
      <Button
        kind="quiet"
        size="small"
        icon="up"
        aria-label={`${n}번 단계 위로`}
        data-moss-skip="표 편집"
        disabled={props.first}
        onClick={() => props.onMove(-1)}
      />
      <Button
        kind="quiet"
        size="small"
        icon="up"
        className="pt-down"
        aria-label={`${n}번 단계 아래로`}
        data-moss-skip="표 편집"
        disabled={props.last}
        onClick={() => props.onMove(1)}
      />
      <Button
        kind="quiet"
        size="small"
        icon="trash"
        aria-label={`${n}번 단계 지우기`}
        data-moss-skip="표 편집"
        onClick={props.onRemove}
      />
    </div>
  );
}

function RowView({
  row,
  index,
  count,
  readOnly,
  showIssues,
  onChange,
  onRemove,
  onMove,
}: {
  readonly row: pc.DraftRow;
  readonly index: number;
  readonly count: number;
  readonly readOnly: boolean;
  readonly showIssues: boolean;
  readonly onChange: (patch: Partial<Omit<pc.DraftRow, "key">>) => void;
  readonly onRemove: () => void;
  readonly onMove: (by: -1 | 1) => void;
}) {
  const n = index + 1;
  const issues = showIssues ? pc.issuesOf(row) : [];
  const bad = (field: pc.RowIssue) => issues.includes(field);
  return (
    <div className="pt-row">
      <span className="pt-n">{n}</span>
      <div className="pt-cell">
        <input
          className="input"
          aria-label={`${n}번 단계 누가`}
          aria-invalid={bad("who")}
          placeholder={W.whoHint}
          maxLength={40}
          value={row.who}
          disabled={readOnly}
          onChange={(e) => onChange({ who: e.target.value })}
        />
      </div>
      <div className="pt-cell">
        <input
          className="input"
          aria-label={`${n}번 단계 무엇을`}
          aria-invalid={bad("what")}
          placeholder={W.whatHint}
          maxLength={120}
          value={row.what}
          disabled={readOnly}
          onChange={(e) => onChange({ what: e.target.value })}
        />
      </div>
      <TimeCell n={n} row={row} readOnly={readOnly} onChange={onChange} />
      <KindCell n={n} row={row} readOnly={readOnly} onChange={onChange} />
      {!readOnly && (
        <RowTools
          n={n}
          first={index === 0}
          last={index === count - 1}
          onMove={onMove}
          onRemove={onRemove}
        />
      )}
      {issues.length > 0 && (
        <p className="pt-issue" role="alert">
          {issues.map((i) => pc.ISSUE_WORDS[i]).join(" · ")}
        </p>
      )}
    </div>
  );
}

function TableHead() {
  return (
    <div className="pt-row pt-head" aria-hidden="true">
      <span>{pc.TABLE_WORDS.head.n}</span>
      <span>{pc.TABLE_WORDS.head.who}</span>
      <span>{pc.TABLE_WORDS.head.what}</span>
      <span>{pc.TABLE_WORDS.head.time}</span>
      <span>{pc.TABLE_WORDS.head.kind}</span>
      <span />
    </div>
  );
}

type Draft = ReturnType<typeof pc.draftOf>;

/** Why the save button is off, in words ("고친 곳이 없어요" when nothing changed). */
function whyOff(dirty: boolean, draft: Draft): string | undefined {
  if (!dirty) return "고친 곳이 없어요";
  if (draft.canSave) return undefined;
  return draft.incomplete > 0 ? W.left(draft.incomplete) : W.empty;
}

/** Saving the draft: the request, the toast, and the busy flag the button shows. */
function useSaver(
  view: CurrentProcessView,
  draft: Draft,
  after: (saved: CurrentProcessView) => void,
) {
  const { api, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const save = async () => {
    setTried(true);
    if (!draft.canSave) throw new Error(draft.incomplete > 0 ? W.left(draft.incomplete) : W.empty);
    setBusy(true);
    try {
      const saved = await api.call("putCurrentProcess", {
        params: { id: view.scenarioId },
        body: { steps: [...draft.steps] },
      });
      after(saved);
      setTried(false);
      toast(W.saved);
      return W.saved;
    } finally {
      setBusy(false);
    }
  };
  const press = () => void save().catch((err) => toast(messageOf(err), "bad"));
  return { busy, tried, save, press };
}

type SetRows = Dispatch<SetStateAction<ReturnType<typeof pc.rowsOf>>>;

function TableCard({
  rows,
  setRows,
  readOnly,
  tried,
}: {
  readonly rows: ReturnType<typeof pc.rowsOf>;
  readonly setRows: SetRows;
  readonly readOnly: boolean;
  readonly tried: boolean;
}) {
  return (
    <div className="pt-card">
      <div className="pt-grid">
        <TableHead />
        {rows.map((row, i) => (
          <RowView
            key={row.key}
            row={row}
            index={i}
            count={rows.length}
            readOnly={readOnly}
            showIssues={tried}
            onChange={(patch) => setRows((r) => pc.change(r, row.key, patch))}
            onRemove={() => setRows((r) => pc.remove(r, row.key))}
            onMove={(by) => setRows((r) => pc.move(r, row.key, by))}
          />
        ))}
      </div>
      {!readOnly && (
        <Button
          kind="quiet"
          className="pt-add"
          data-moss-action="process-add-step"
          disabled={rows.length >= pc.MAX_ROWS}
          why={W.full}
          onClick={() => setRows((r) => pc.add(r))}
        >
          {W.add}
        </Button>
      )}
    </div>
  );
}

function Screen({
  view,
  onSaved,
}: {
  readonly view: CurrentProcessView;
  readonly onSaved: (v: CurrentProcessView) => void;
}) {
  const [rows, setRows] = useState(() => pc.rowsOf(view.steps));
  const { navigate } = useApp();
  const draft = pc.draftOf(rows);
  const dirty = JSON.stringify(draft.steps) !== JSON.stringify(view.steps) || draft.incomplete > 0;
  const saver = useSaver(view, draft, (saved) => {
    onSaved(saved);
    setRows(pc.rowsOf(saved.steps));
  });
  usePageTitle(view.scenarioName);
  useLeaveGuard(
    dirty && view.canEdit ? "저장하지 않고 나가면 적은 것이 사라져요. 그래도 나갈까요?" : undefined,
  );
  useMossScreen("scenarioProcess", {
    read: () => ({
      시나리오: view.scenarioName,
      단계: draft.steps,
      요약: pc.numbersLine(draft.numbers),
    }),
    run: {
      "process-add-step": () => {
        if (!view.canEdit) throw new Error(W.readOnly(view.owner ?? "다른 사람"));
        if (rows.length >= pc.MAX_ROWS) throw new Error(W.full);
        setRows((r) => pc.add(r));
        return "빈 단계를 한 줄 더했어요";
      },
      "process-experiment": () => {
        if (!view.written || dirty) throw new Error("먼저 지금 하는 방식을 저장해 주세요");
        navigate({ name: "newExperiment", scenarioId: view.scenarioId });
        return "이 시나리오로 실험을 만들러 가요";
      },
      "process-save": async () => {
        if (!view.canEdit) throw new Error(W.readOnly(view.owner ?? "다른 사람"));
        if (!dirty) throw new Error("고친 곳이 없어요");
        return saver.save();
      },
    },
    summary: () => pc.numbersLine(draft.numbers),
  });
  const readOnly = !view.canEdit;
  return (
    <div className="page">
      <PageHead
        crumbs={<Go to={{ name: "scenarios" }}>시나리오</Go>}
        title={W.title(view.scenarioName)}
        lede={W.sub}
      />
      {readOnly && <Note>{W.readOnly(view.owner ?? "다른 사람")}</Note>}
      <TableCard rows={rows} setRows={setRows} readOnly={readOnly} tried={saver.tried} />
      <div className="pt-foot">
        <span className="pt-sum" aria-live="polite">
          {W.summaryLead}{" "}
          <b>
            {draft.steps.length > 0 ? pc.numbersLine(draft.numbers) : "아직 적은 단계가 없어요"}
          </b>
        </span>
        {view.written && !dirty && (
          <Go
            to={{ name: "newExperiment", scenarioId: view.scenarioId }}
            className="btn"
            data-moss-action="process-experiment"
          >
            {W.next}
          </Go>
        )}
        {!readOnly && (
          <Button
            kind="primary"
            busy={saver.busy}
            disabled={!dirty || !draft.canSave}
            why={whyOff(dirty, draft)}
            data-moss-action="process-save"
            onClick={saver.press}
          >
            {W.save}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ScenarioProcessPage({ id }: { readonly id: string }) {
  const { api } = useApp();
  const data = useAsync(
    (signal) => api.call("getCurrentProcess", { params: { id }, signal }),
    [id],
  );
  if (data.error)
    return (
      <div className="page">
        <Failure error={data.error} retry={data.reload} />
      </div>
    );
  if (!data.data || data.data.scenarioId !== id)
    return (
      <div className="page">
        <Loading lines={4} />
      </div>
    );
  return <Screen key={id} view={data.data} onSaved={data.set} />;
}
