/**
 * 서비스부터 ① (REQ-104, ADR-0127): a list of rows, not a form. Each row is name · one line · who made the card (with
 * their titles) · 잠김/공유됨. Nothing is typed free-hand: "+ 서비스 더하기" opens the catalog, and the only thing a
 * row lets you change is its name. No money on this screen; the damage numbers come with the experiment.
 */
import type { ServiceCardView } from "@terrarium/core/contract";
import { cardOfKey, type ServiceDraft, SHAPE_LIMITS } from "@terrarium/core/sources/worldgen";
import { catalogCard } from "@terrarium/core/world";
import { useState } from "react";
import { messageOf, useApp } from "../context";
import { Button } from "../kit";
import { TitlePills } from "../titles";
import { type Picked, ServiceSheet } from "./service-sheet";
import { Editable } from "./shape-edit";

/** Where a row's card came from, kept beside the draft by key. */
export interface RowMeta {
  readonly owner: string;
  readonly titles: ServiceCardView["ownerTitles"];
  readonly shared: boolean;
  readonly line: string;
}

const IAP_LINE = "쿠버네티스 플랫폼 · 오케스트레이터 → 도메인 에이전트 → 그래프 DB";

function lineOf(s: ServiceDraft, meta?: RowMeta): string {
  if (meta) return meta.line;
  if (s.key === "iap") return IAP_LINE;
  return catalogCard(cardOfKey(s.key))?.line ?? s.gives;
}

/** "내 카드로 저장" and then "공유하기": the card is private until its owner shares it, and always locked. */
function useSavedCard(draft: ServiceDraft, cardId: string | undefined) {
  const { api, toast } = useApp();
  const [saved, setSaved] = useState<ServiceCardView>();
  const attempt = async (what: () => Promise<void>) => {
    try {
      await what();
    } catch (err) {
      toast(messageOf(err));
    }
  };
  const save = () =>
    attempt(async () => {
      if (!cardId) return;
      setSaved(
        await api.call("createServiceCard", {
          body: { name: draft.name, card: cardId, shared: false },
        }),
      );
      toast("내 카드로 저장했어요. 공유하기 전에는 나만 봐요");
    });
  const share = () =>
    attempt(async () => {
      if (!saved) return;
      setSaved(
        await api.call("updateServiceCard", { params: { id: saved.id }, body: { shared: true } }),
      );
      toast("공유했어요. 다른 사람의 카탈로그에도 보여요");
    });
  return { saved, save, share };
}

function Acts(props: {
  readonly canSave: boolean;
  readonly canShare: boolean;
  readonly onSave: () => void;
  readonly onShare: () => void;
  readonly onRemove?: () => void;
}) {
  return (
    <div className="we-svc-acts">
      {props.canSave && (
        <Button data-moss-skip="세계 폼 안의 입력" size="small" kind="quiet" onClick={props.onSave}>
          내 카드로 저장
        </Button>
      )}
      {props.canShare && (
        <Button
          data-moss-skip="세계 폼 안의 입력"
          size="small"
          kind="quiet"
          onClick={props.onShare}
        >
          공유하기
        </Button>
      )}
      {props.onRemove && (
        <Button
          data-moss-skip="세계 폼 안의 입력"
          size="small"
          kind="quiet"
          onClick={props.onRemove}
        >
          빼기
        </Button>
      )}
    </div>
  );
}

function Row(props: {
  readonly draft: ServiceDraft;
  readonly meta: RowMeta | undefined;
  readonly first: boolean;
  readonly onRename: (name: string) => void;
  readonly onRemove?: () => void;
}) {
  const { draft, meta } = props;
  const builtIn = catalogCard(cardOfKey(draft.key));
  const { saved, save, share } = useSavedCard(draft, builtIn?.id);
  const owner = meta?.owner ?? "기본 제공";
  return (
    <div className={`we-svc${props.first ? " on" : ""}`}>
      <div className="we-svc-name">
        <b>
          <Editable
            label="서비스 이름"
            value={draft.name}
            onCommit={(v) => props.onRename(String(v))}
          />
        </b>
        <small>{lineOf(draft, meta)}</small>
      </div>
      <div className="we-svc-who">
        {owner}
        {meta && <TitlePills who={meta.owner} titles={meta.titles} />}
      </div>
      <div className="we-svc-flags">
        <span>잠김</span>
        {(saved?.shared ?? meta?.shared) && <span>공유됨</span>}
      </div>
      <Acts
        canSave={Boolean(builtIn) && !saved}
        canShare={Boolean(saved) && !saved?.shared}
        onSave={() => void save()}
        onShare={() => void share()}
        {...(props.onRemove ? { onRemove: props.onRemove } : {})}
      />
    </div>
  );
}

/** The list without service `i`, and without the calls that led to it. */
function without(list: readonly ServiceDraft[], i: number): ServiceDraft[] {
  const gone = list[i]?.key;
  return list
    .filter((_, k) => k !== i)
    .map((s) => {
      if (!s.calls?.includes(gone as string)) return s;
      const { calls, ...rest } = s;
      const kept = calls.filter((c) => c !== gone);
      return kept.length > 0 ? { ...rest, calls: kept } : rest;
    });
}

export function ServicesStep({
  services,
  scenarios,
  metas,
  onChange,
  onMeta,
}: {
  readonly services: readonly ServiceDraft[];
  readonly scenarios: number;
  readonly metas: Readonly<Record<string, RowMeta>>;
  readonly onChange: (next: readonly ServiceDraft[]) => void;
  readonly onMeta: (key: string, meta: RowMeta) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const full = services.length >= SHAPE_LIMITS.services.max;
  const add = (p: Picked) => {
    onChange([...services, p.draft]);
    onMeta(p.draft.key, p.meta);
    setSheet(false);
  };
  return (
    <>
      <div className="we-qhead">
        <h1>무엇을 떠받치는 세계인가요?</h1>
        <span className="we-step">1 / 3</span>
      </div>
      <p className="we-sub">
        IAP가 이미 골라져 있어요. 더 올릴 서비스가 있으면 카탈로그에서 고르세요. 이름만 바꿀 수
        있고, 피해 숫자는 실험을 만들 때 정해요.
      </p>
      <div className="we-svcs">
        {services.map((s, i) => (
          <Row
            key={s.key}
            draft={s}
            meta={metas[s.key]}
            first={i === 0}
            onRename={(name) => onChange(services.map((x, k) => (k === i ? { ...x, name } : x)))}
            {...(services.length > 1 ? { onRemove: () => onChange(without(services, i)) } : {})}
          />
        ))}
        <button
          type="button"
          className="we-svc add"
          disabled={full}
          data-moss-skip="세계 폼 안의 입력"
          onClick={() => setSheet(true)}
        >
          {full ? `서비스는 ${SHAPE_LIMITS.services.max}개까지예요` : "+ 서비스 더하기"}
        </button>
      </div>
      <p className="we-foot">
        시나리오 <b>{scenarios}개</b>가 따라와요
      </p>
      {sheet && (
        <ServiceSheet
          taken={services.map((s) => s.key)}
          onPick={add}
          onClose={() => setSheet(false)}
        />
      )}
    </>
  );
}
