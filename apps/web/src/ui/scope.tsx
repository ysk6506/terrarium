/**
 * The one question about who can see a thing (ADR-0198, permissions.md sections 3 and 7): asked where a thing is made, asked
 * again where it is changed (the one route `PUT /api/<kind>/:id/scope`, ADR-0179), and answered as a quiet tag in lists. The
 * answers are 나만 / 우리 파트 / 모두; 우리 파트 is not offered to someone who is in no group.
 */
import type { Scope } from "@terrarium/core/experiments";
import { useId, useMemo, useState } from "react";
import {
  emptyFilterText,
  groupsOf,
  isAdmin,
  ownerName,
  peopleNames,
  SCOPE_FILTER_LABEL,
  SCOPE_LABELS,
  SCOPE_QUESTION,
  type ScopedKind,
  type ScopeFilter,
  type ScopeValue,
  START_SCOPE,
  sameScope,
  scopeBody,
  scopeFilters,
  scopeOptions,
  scopeSentence,
  scopeTag,
} from "../logic";
import { useAction, useApp } from "./context";
import { Segmented, SelectField, TextField } from "./fields";
import { Button, Dialog } from "./kit";

/** "누가 볼 수 있나요", as radios: the answer and, under it, what it means. The group is asked only when there is a choice. */
export function ScopeAsk({
  value,
  onChange,
  help,
}: {
  readonly value: ScopeValue;
  readonly onChange: (v: ScopeValue) => void;
  readonly help?: string;
}) {
  const { meta } = useApp();
  const groups = groupsOf(meta);
  const name = useId();
  const options = scopeOptions(groups, value);
  const pick = (scope: Scope) =>
    onChange(scopeBody({ scope, ...(value.group ? { group: value.group } : {}) }, groups));
  return (
    <fieldset className="scope-ask">
      <legend className="field-label">{SCOPE_QUESTION}</legend>
      <div className="scope-ask-options">
        {options.map((o) => (
          <label key={o.value} className="scope-ask-option">
            <input
              type="radio"
              name={name}
              checked={value.scope === o.value}
              onChange={() => pick(o.value)}
            />
            <span>
              <b>{o.label}</b>
              <span className="small muted">{o.help}</span>
            </span>
          </label>
        ))}
      </div>
      {value.scope === "group" && groups.length > 1 && (
        <SelectField
          label="어느 그룹과 나눌까요"
          value={value.group ?? groups[0]}
          options={groups.map((g) => ({ value: g, label: g }))}
          onChange={(g) => onChange({ scope: "group", group: g })}
        />
      )}
      {help && <p className="small muted scope-ask-help">{help}</p>}
    </fieldset>
  );
}

/** The quiet tag a list puts on a thing, only when it is not for everyone. */
export function ScopeTag({
  item,
}: {
  readonly item: { readonly scope?: Scope; readonly group?: string };
}) {
  const text = scopeTag(item);
  if (!text) return null;
  return (
    <span className="tag tag-scope" title={scopeSentence(item)}>
      {text}
    </span>
  );
}

/** An administrator changing what is another person's says why; the audit log keeps the words (permissions.md section 6). */
export function useAdminReason(owner: string | undefined): {
  readonly needed: boolean;
  readonly reason: string;
  readonly field: React.ReactNode;
  readonly ready: boolean;
} {
  const { meta, me } = useApp();
  const [reason, setReason] = useState("");
  const needed = isAdmin(meta) && owner !== undefined && owner !== me;
  const field = needed ? (
    <TextField
      label="고치는 까닭"
      value={reason}
      onChange={setReason}
      maxLength={200}
      help="이 사람의 것을 관리자로서 고쳐요. 적은 까닭은 감사 기록에 남아요."
    />
  ) : null;
  return { needed, reason, field, ready: !needed || reason.trim() !== "" };
}

type ScopeRoute =
  | "setWorldScope"
  | "setScenarioScope"
  | "setExperimentScope"
  | "setConnectionScope"
  | "setModelScope";

const ROUTE_OF: Readonly<Record<ScopedKind, ScopeRoute>> = {
  world: "setWorldScope",
  scenario: "setScenarioScope",
  experiment: "setExperimentScope",
  connection: "setConnectionScope",
  model: "setModelScope",
};

/** The way to change it: a button that says the question and shows the present answer, and the dialog behind it. */
export function ScopeButton({
  kind,
  id,
  name,
  owner,
  current,
  onChanged,
}: {
  readonly kind: ScopedKind;
  readonly id: string;
  readonly name: string;
  readonly owner?: string;
  readonly current: ScopeValue;
  readonly onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        data-moss-skip="누가 볼 수 있는지는 사람이 정해요"
        size="small"
        aria-label={`${name}: ${SCOPE_QUESTION} 바꾸기`}
        onClick={() => setOpen(true)}
      >
        {SCOPE_QUESTION}
      </Button>
      {open && (
        <ScopeDialog
          kind={kind}
          id={id}
          name={name}
          {...(owner ? { owner } : {})}
          current={current}
          onClose={() => setOpen(false)}
          onChanged={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function ScopeDialog({
  kind,
  id,
  name,
  owner,
  current,
  onClose,
  onChanged,
}: {
  readonly kind: ScopedKind;
  readonly id: string;
  readonly name: string;
  readonly owner?: string;
  readonly current: ScopeValue;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const { api, meta } = useApp();
  const { busy, run } = useAction();
  const [value, setValue] = useState<ScopeValue>(current);
  const why = useAdminReason(owner);
  const same = sameScope(value, current);
  const save = async () => {
    const body = scopeBody(value, groupsOf(meta));
    const done = await run(
      () =>
        api.call(ROUTE_OF[kind], {
          params: { id },
          body,
          ...(why.needed ? { reason: why.reason } : {}),
        }),
      `누가 볼 수 있는지 바꿨어요: ${SCOPE_LABELS[body.scope]}`,
    );
    if (done) onChanged();
  };
  return (
    <Dialog
      title={`'${name}'을 누가 볼 수 있나요`}
      onClose={onClose}
      actions={
        <>
          <Button data-moss-skip="폼과 대화상자 안" onClick={onClose}>
            그대로 두기
          </Button>
          <Button
            data-moss-skip="폼과 대화상자 안"
            kind="primary"
            busy={busy}
            disabled={same || !why.ready}
            why={same ? "지금과 같아요" : "까닭을 적어 주세요"}
            onClick={() => void save()}
          >
            이렇게 바꾸기
          </Button>
        </>
      }
    >
      <div className="stack">
        <ScopeAsk value={value} onChange={setValue} />
        {why.field}
      </div>
    </Dialog>
  );
}

/** A creator's name as lists say it: the name they go by, or the id the record holds when the server has not heard it. */
export function useOwnerName(): (owner: string) => string {
  const { meta } = useApp();
  const names = useMemo(() => peopleNames(meta), [meta]);
  return (owner) => ownerName(owner, names);
}

/** 전부 / 내 것 / 우리 파트 / 모두: narrows a list by who made it and who can see it. 우리 파트 only when there are groups. */
export function ScopeFilterBar({
  value,
  onChange,
}: {
  readonly value: ScopeFilter;
  readonly onChange: (v: ScopeFilter) => void;
}) {
  const { meta } = useApp();
  return (
    <>
      <span className="small muted">{SCOPE_QUESTION}</span>
      <Segmented
        label={SCOPE_FILTER_LABEL}
        value={value}
        options={scopeFilters(groupsOf(meta).length > 0)}
        onChange={onChange}
      />
    </>
  );
}

/** What a narrowed list says when nothing is left: the reason, and the way back. */
export function FilterEmpty({
  filter,
  onClear,
}: {
  readonly filter: ScopeFilter;
  readonly onClear: () => void;
}) {
  return (
    <p className="small muted">
      {emptyFilterText(filter)}{" "}
      <Button data-moss-skip="세부 조절" size="small" kind="quiet" onClick={onClear}>
        전부 보기
      </Button>
    </p>
  );
}

export interface SharingChoice {
  /** The question and, for an administrator changing another person's thing, the reason: drawn once in the form. */
  readonly field: React.ReactNode;
  /** The fields a create request carries. */
  readonly forCreate: ScopeValue;
  /** The reason is given when one is asked for. */
  readonly ready: boolean;
  /** The reason to send with the change, when one was asked for. */
  readonly reason: string | undefined;
  /** After an existing thing was saved: the one route that changes who sees it, only when the answer changed. */
  applyTo(id: string): Promise<void>;
}

/**
 * The question as a form uses it (ADR-0198): where a thing is made it starts at the kind's usual answer; where it is changed it
 * starts at the present one. The form saves the thing as it always did and then calls `applyTo`, so changing who sees it still
 * goes through the one route (ADR-0179) and never through the edit route.
 */
export function useSharingChoice(
  kind: ScopedKind,
  existing?: { readonly owner?: string; readonly scope: Scope; readonly group?: string },
): SharingChoice {
  const { api, meta } = useApp();
  const was: ScopeValue | undefined = existing
    ? { scope: existing.scope, ...(existing.group ? { group: existing.group } : {}) }
    : undefined;
  const [value, setValue] = useState<ScopeValue>(was ?? { scope: START_SCOPE[kind] });
  const why = useAdminReason(existing?.owner);
  const forCreate = scopeBody(value, groupsOf(meta));
  const field = (
    <>
      <ScopeAsk
        value={value}
        onChange={setValue}
        {...(!existing && (kind === "connection" || kind === "model")
          ? { help: "자격 증명이 딸려 있어서 처음에는 나만으로 시작해요." }
          : {})}
      />
      {why.field}
    </>
  );
  return {
    field,
    forCreate,
    ready: why.ready,
    reason: why.needed ? why.reason : undefined,
    async applyTo(id) {
      if (!was || sameScope(forCreate, was)) return;
      await api.call(ROUTE_OF[kind], {
        params: { id },
        body: forCreate,
        ...(why.needed ? { reason: why.reason } : {}),
      });
    },
  };
}
