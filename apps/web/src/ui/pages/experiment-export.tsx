/**
 * 내보내기 (REQ-038, ADR-0171): one question, "무엇을 내보낼까요", and only the answers the server already has. The
 * first lines of the chosen export are shown when they can be had from the same call that makes the file.
 */
import type { ExperimentView } from "@terrarium/core/contract";
import { useState } from "react";
import { resultExport } from "../../logic";
import { messageOf, useApp, useAsync } from "../context";
import { download } from "../download";
import { Button, Dialog } from "../kit";

type Choice = resultExport.ExportChoice;

/** The export's text from the server, by the same call that makes the file. */
function useText(id: string, choice: Choice) {
  const { api } = useApp();
  return useAsync(
    async (signal) => {
      if (choice.id === "diagnoses")
        return await api.call("experimentDiagnoses", { params: { id }, signal });
      const format = choice.id === "report-md" ? "md" : "text";
      return await api.call("experimentReport", { params: { id }, query: { format }, signal });
    },
    [id, choice.id],
  );
}

function Preview({ id, choice }: { readonly id: string; readonly choice: Choice }) {
  const text = useText(id, choice);
  const lines = text.data ? resultExport.previewLines(text.data) : [];
  return (
    <div className="exp-preview">
      <span className="tiny muted">이렇게 나와요 (처음 3줄)</span>
      <pre className="exp-lines">
        {text.error
          ? "미리 볼 수 없어요"
          : text.data === undefined
            ? "불러오는 중이에요"
            : lines.join("\n")}
      </pre>
    </div>
  );
}

function Choices({
  value,
  onChange,
}: {
  readonly value: resultExport.ExportId;
  readonly onChange: (id: resultExport.ExportId) => void;
}) {
  return (
    <fieldset className="exp-choices">
      <legend className="sr-only">내보낼 내용</legend>
      {resultExport.EXPORT_CHOICES.map((c) => (
        <label key={c.id} className="exp-choice" data-chosen={c.id === value ? "yes" : undefined}>
          <input
            type="radio"
            name="export-what"
            checked={c.id === value}
            onChange={() => onChange(c.id)}
          />
          <span className="exp-choice-text">
            <b>{c.title}</b>
            <span className="small muted">{c.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function ExportDialog({
  view,
  onClose,
}: {
  readonly view: ExperimentView;
  readonly onClose: () => void;
}) {
  const { api, toast } = useApp();
  const [which, setWhich] = useState<resultExport.ExportId>("report-html");
  const [busy, setBusy] = useState(false);
  const id = view.experiment.id;
  const choice = resultExport.EXPORT_CHOICES.find((c) => c.id === which) as Choice;
  const go = async () => {
    if (choice.how === "open") {
      window.open(api.url("experimentReport", { id }, { format: "html" }), "_blank", "noopener");
      return;
    }
    setBusy(true);
    try {
      const text =
        choice.id === "diagnoses"
          ? await api.call("experimentDiagnoses", { params: { id } })
          : await api.call("experimentReport", {
              params: { id },
              query: { format: choice.id === "report-md" ? "md" : "text" },
            });
      if (choice.how === "copy") {
        await navigator.clipboard.writeText(text);
        toast("보고서 글을 복사했어요");
      } else {
        const type = choice.id === "diagnoses" ? "application/x-ndjson" : "text/markdown";
        download(
          resultExport.exportFileName(view.experiment.name, choice),
          text,
          `${type};charset=utf-8`,
        );
      }
    } catch (err) {
      toast(messageOf(err), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="무엇을 내보낼까요"
      onClose={onClose}
      actions={
        <>
          <Button data-moss-skip="대화 상자 닫기" onClick={onClose}>
            닫기
          </Button>
          <Button
            kind="primary"
            busy={busy}
            data-moss-skip="고른 내보내기를 하는 단추"
            onClick={() => void go()}
          >
            {choice.action}
          </Button>
        </>
      }
    >
      <p className="small muted exp-sub">
        {view.experiment.name} · {view.experiment.snapshot.scenarioName} · 실행 {view.runs.length}번
      </p>
      <Choices value={which} onChange={setWhich} />
      {choice.preview && <Preview id={id} choice={choice} />}
    </Dialog>
  );
}
