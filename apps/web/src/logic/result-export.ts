/**
 * "무엇을 내보낼까요" (ADR-0171): one question, and only the answers the server already has. Each choice is one of
 * the server's own exports of an experiment (the report in three forms, the diagnosis records); a choice with no
 * endpoint behind it is not offered.
 */

export type ExportId = "report-html" | "report-md" | "report-text" | "diagnoses";

export interface ExportChoice {
  readonly id: ExportId;
  readonly title: string;
  readonly hint: string;
  /** The button that does it. */
  readonly action: string;
  /** What the button does with it: open in a tab, save as a file, or copy as text. */
  readonly how: "open" | "save" | "copy";
  /** The file's name ending when it is saved. */
  readonly file?: string;
  /** Whether the first lines can be shown (a page of HTML cannot). */
  readonly preview: boolean;
}

export const EXPORT_CHOICES: readonly ExportChoice[] = [
  {
    id: "report-html",
    title: "보고서 한 장 (HTML)",
    hint: "한 파일로 저장해 메일에 붙일 수 있어요. 새 창에서 열려요.",
    action: "보고서 열기",
    how: "open",
    preview: false,
  },
  {
    id: "report-md",
    title: "보고서 글 (Markdown)",
    hint: "위키나 문서 도구에 붙여 넣기 좋아요.",
    action: "Markdown 내려받기",
    how: "save",
    file: "보고서.md",
    preview: true,
  },
  {
    id: "report-text",
    title: "보고서 글 (복사)",
    hint: "메신저에 붙여 넣기 좋아요.",
    action: "글로 복사",
    how: "copy",
    preview: true,
  },
  {
    id: "diagnoses",
    title: "진단 기록 (JSON)",
    hint: "끝난 실행마다 한 줄. 에이전트가 낸 진단과 정답, 세계·시나리오 버전이 줄마다 JSON이에요.",
    action: "진단 기록 내려받기",
    how: "save",
    file: "진단-기록.jsonl",
    preview: true,
  },
];

/** The first lines of an export, each cut to a width, with a mark where one was cut. */
export function previewLines(text: string, lines = 3, width = 110): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, lines)
    .map((l) => (l.length > width ? `${l.slice(0, width)}…` : l));
}

/** The file name a saved export gets: the experiment's name, then what it is. */
export function exportFileName(experiment: string, choice: ExportChoice): string {
  const base = experiment.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "실험";
  return `${base}-${choice.file ?? "내보내기"}`;
}
