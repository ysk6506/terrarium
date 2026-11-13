/**
 * 감사 기록 (ADR-0193, ADR-0198, permissions.md section 6): what was done to what, by whom, and what was refused. An administrator
 * reads the whole log, narrows it, and downloads what is narrowed; anyone else reads what happened to their own things. It only
 * reads: nothing here changes or removes an entry. This is one of the two screens drawn with Astryx (debt TD-0007).
 */
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { AUDIT_LABELS, type AuditEntryView, type AuditOwnView } from "@terrarium/core/contract";
import type { AuditOutcome } from "@terrarium/core/experiments";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auditScreen, isAdmin, peopleNames } from "../../logic";
import { AstryxScope } from "../astryx";
import { Go, messageOf, useApp, usePageTitle } from "../context";
import { download } from "../download";
import { Failure, PageHead } from "../kit";

const {
  atText,
  changeLines,
  draws,
  fileName,
  kindWord,
  narrowed,
  NO_FILTERS,
  OUTCOME_FILTERS,
  OUTCOME_WORDS,
  pageLine,
  PERIODS,
  queryOf,
  reasonGiven,
  targetText,
} = auditScreen;

type Row = AuditEntryView | AuditOwnView;

const isFull = (r: Row): r is AuditEntryView => "subject" in r;
const whoOf = (r: Row) => (isFull(r) ? r.subject.name : r.who.name);

const OUTCOME_BADGE: Readonly<Record<AuditOutcome, "success" | "warning" | "error">> = {
  allowed: "success",
  denied: "warning",
  failed: "error",
};

function WhatCell({ row }: { readonly row: Row }) {
  const lines = isFull(row) ? changeLines(row) : [];
  const reason = isFull(row) ? reasonGiven(row) : undefined;
  return (
    <div className="audit-what">
      <Text weight="medium">{row.label}</Text>
      <Text size="sm" color="secondary">
        {targetText(row as AuditEntryView)}
      </Text>
      {lines.map((l) => (
        <Text key={l} size="sm" color="secondary">
          {l}
        </Text>
      ))}
      {reason && (
        <Text size="sm" color="secondary">
          까닭: {reason}
        </Text>
      )}
    </div>
  );
}

function OutcomeCell({ row }: { readonly row: Row }) {
  const why = isFull(row) ? row.reasonLabel : undefined;
  return (
    <div className="audit-outcome">
      <Badge variant={OUTCOME_BADGE[row.outcome]} label={OUTCOME_WORDS[row.outcome]} />
      {why && draws(row as AuditEntryView) && (
        <Text size="sm" color="secondary">
          {why}
        </Text>
      )}
    </div>
  );
}

function Filters({
  filters,
  onChange,
  admin,
}: {
  readonly filters: auditScreen.AuditFilters;
  readonly onChange: (f: auditScreen.AuditFilters) => void;
  readonly admin: boolean;
}) {
  const { meta } = useApp();
  const names = useMemo(() => peopleNames(meta), [meta]);
  const people = [
    { value: "", label: "모든 사람" },
    ...[...names].map(([id, name]) => ({ value: id, label: name })),
  ];
  const actions = [
    { value: "", label: "모든 일" },
    ...Object.entries(AUDIT_LABELS).map(([value, label]) => ({ value, label })),
  ];
  const kinds = [
    { value: "", label: "모든 종류" },
    ...Object.keys(auditScreen.KIND_WORDS).map((value) => ({ value, label: kindWord(value) })),
  ];
  return (
    <div className="audit-filters">
      <SegmentedControl
        label="기간"
        value={filters.period}
        onChange={(v) => onChange({ ...filters, period: v as auditScreen.Period })}
      >
        {PERIODS.map((p) => (
          <SegmentedControlItem key={p.value} value={p.value} label={p.label} />
        ))}
      </SegmentedControl>
      <SegmentedControl
        label="결과"
        value={filters.outcome}
        onChange={(v) => onChange({ ...filters, outcome: v as AuditOutcome | "" })}
      >
        {OUTCOME_FILTERS.map((o) => (
          <SegmentedControlItem key={o.value || "all"} value={o.value} label={o.label} />
        ))}
      </SegmentedControl>
      <div className="audit-selects">
        {admin && (
          <Selector
            label="누가"
            options={people}
            value={filters.subject}
            hasSearch
            onChange={(v) => onChange({ ...filters, subject: v })}
          />
        )}
        <Selector
          label="무슨 일"
          options={actions}
          value={filters.action}
          hasSearch
          onChange={(v) => onChange({ ...filters, action: v })}
        />
        <Selector
          label="무엇에"
          options={kinds}
          value={filters.kind}
          onChange={(v) => onChange({ ...filters, kind: v })}
        />
      </div>
    </div>
  );
}

function useAuditList(admin: boolean, filters: auditScreen.AuditFilters) {
  const { api } = useApp();
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [next, setNext] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const generation = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      const mine = ++generation.current;
      setLoading(true);
      setError(undefined);
      try {
        const query = { ...queryOf(filters, Date.now()), limit: 50, ...(cursor ? { cursor } : {}) };
        const { subject: _who, ...own } = query;
        const page = await (admin
          ? api.call("listAudit", { query })
          : api.call("listAuditMine", { query: own }));
        if (mine !== generation.current) return;
        setRows((old) => (cursor ? [...old, ...page.entries] : page.entries));
        setNext(page.next);
      } catch (err) {
        if (mine === generation.current) setError(err as Error);
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    [api, admin, filters],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, next, loading, error, more: () => void load(next), retry: () => void load() };
}

type TableRow = Row & Record<string, unknown>;

const COLUMNS = [
  { key: "at", header: "때", renderCell: (r: TableRow) => <Text size="sm">{atText(r.at)}</Text> },
  { key: "who", header: "누가", renderCell: (r: TableRow) => <Text size="sm">{whoOf(r)}</Text> },
  { key: "what", header: "무엇을", renderCell: (r: TableRow) => <WhatCell row={r} /> },
  { key: "outcome", header: "결과", renderCell: (r: TableRow) => <OutcomeCell row={r} /> },
];

/** Saves the rows that fit the filters as a file (admin only). */
function useExport(filters: auditScreen.AuditFilters) {
  const { api, toast } = useApp();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const text = await api.call("exportAudit", { query: queryOf(filters, Date.now()) });
      download(fileName(Date.now()), String(text), "application/x-ndjson");
    } catch (err) {
      toast(messageOf(err), "bad");
    } finally {
      setSaving(false);
    }
  };
  return { saving, save: () => void save() };
}

function CountBar(props: {
  readonly list: ReturnType<typeof useAuditList>;
  readonly admin: boolean;
  readonly filters: auditScreen.AuditFilters;
}) {
  const { list, admin } = props;
  const out = useExport(props.filters);
  return (
    <div className="audit-bar">
      <Text size="sm" color="secondary" aria-live="polite">
        {list.loading && list.rows.length === 0
          ? "불러오는 중이에요"
          : pageLine(list.rows.length, list.next !== undefined)}
      </Text>
      {admin && (
        <Button
          variant="secondary"
          size="sm"
          label="조건에 맞는 기록 파일로 받기"
          isLoading={out.saving}
          onClick={out.save}
        />
      )}
    </div>
  );
}

function AuditBody({ admin }: { readonly admin: boolean }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const list = useAuditList(admin, filters);
  return (
    <div className="audit">
      <Filters filters={filters} onChange={setFilters} admin={admin} />
      {narrowed(filters) && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            label="거르기 모두 풀기"
            onClick={() => setFilters(NO_FILTERS)}
          />
        </div>
      )}
      <CountBar list={list} admin={admin} filters={filters} />
      {list.error && (
        <Banner
          status="error"
          title="기록을 불러오지 못했어요"
          description={list.error.message}
          endContent={
            <Button variant="secondary" size="sm" label="다시 불러오기" onClick={list.retry} />
          }
        />
      )}
      {list.rows.length > 0 && (
        <Table
          data={list.rows as unknown as TableRow[]}
          columns={COLUMNS}
          idKey="id"
          density="compact"
          dividers="rows"
          verticalAlign="top"
          aria-label="감사 기록"
        />
      )}
      {list.next !== undefined && (
        <div>
          <Button
            variant="secondary"
            label="더 보기"
            isLoading={list.loading}
            onClick={list.more}
          />
        </div>
      )}
    </div>
  );
}

export function AuditPage() {
  const { meta } = useApp();
  const admin = isAdmin(meta);
  usePageTitle(admin ? "감사 기록" : "내 것에 있던 일");
  return (
    <div className="page">
      <PageHead
        crumbs={<Go to={{ name: "settings" }}>설정</Go>}
        title={admin ? "감사 기록" : "내 것에 있던 일"}
        lede={
          admin
            ? "누가 무엇을 했는지, 무엇이 막혔는지 남아 있어요. 고치거나 지울 수 없고, 보관 기간이 지나면 저절로 정리돼요."
            : "내가 만든 것에 누가 언제 무엇을 했는지 보여요."
        }
      />
      {meta ? (
        <AstryxScope>
          <AuditBody admin={admin} />
        </AstryxScope>
      ) : (
        <Failure error={new Error("누구인지 아직 모르겠어요. 잠시 뒤에 다시 열어 주세요")} />
      )}
    </div>
  );
}
