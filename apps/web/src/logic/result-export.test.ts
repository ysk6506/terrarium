import { ROUTES } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { EXPORT_CHOICES, exportFileName, previewLines } from "./result-export";

describe("what can be exported [REQ-038]", () => {
  test("[REQ-038] every choice has a server export behind it: the report in three forms, the diagnosis records", () => {
    expect(EXPORT_CHOICES.map((c) => c.id)).toEqual([
      "report-html",
      "report-md",
      "report-text",
      "diagnoses",
    ]);
    expect(ROUTES.experimentReport.path).toBe("/api/experiments/:id/report");
    expect(ROUTES.experimentDiagnoses.path).toBe("/api/experiments/:id/diagnoses");
    // a saved one has a file name, a copied or opened one does not need it
    for (const c of EXPORT_CHOICES) expect(c.how === "save" ? c.file : "ok").toBeTruthy();
  });

  test("[REQ-038] the first lines are shown cut to a width, without empty lines", () => {
    const lines = previewLines(`\n{"a":1}\n\n${"x".repeat(200)}\nthird\nfourth\n`);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('{"a":1}');
    expect(lines[1]?.endsWith("…")).toBe(true);
    expect(lines[1]?.length).toBe(111);
    expect(previewLines("")).toEqual([]);
  });

  test("[REQ-038] a saved file is named after the experiment and what it holds", () => {
    const md = EXPORT_CHOICES.find((c) => c.id === "report-md");
    expect(md && exportFileName("연습 에이전트 / 냉방기", md)).toBe(
      "연습-에이전트-냉방기-보고서.md",
    );
    expect(md && exportFileName("///", md)).toBe("실험-보고서.md");
  });
});
