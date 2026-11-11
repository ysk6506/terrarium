/**
 * 서비스부터 ① (REQ-104, ADR-0127): a list of rows, not a form. Each row is name · one line · who made the card (with
 * their titles) · 잠김/공유됨. Nothing is typed free-hand: "+ 서비스 더하기" opens the catalog, and the only thing a
 * row lets you change is its name. No money on this screen; the damage numbers come with the experiment.
 */
import {
  cardOfKey,
  loadOf,
  type ServiceDraft,
  SHAPE_LIMITS,
} from "@terrarium/core/sources/worldgen";
import { catalogCard, loadText, type ServiceLoad } from "@terrarium/core/world";
import { useState } from "react";
import { noServicesReason, type RowMeta, removeService } from "../../logic";
import { messageOf, useApp } from "../context";
import { Button } from "../kit";
import { TitlePills } from "../titles";
import { LoadSheet } from "./load-sheet";
import { type Picked, ServiceSheet } from "./service-sheet";
import { Editable } from "./shape-edit";

export type { RowMeta };

const IAP_LINE = "쿠버네티스 플랫폼 · 오케스트레이터 → 도메인 에이전트 → 그래프 DB";

function lineOf(s: ServiceDraft, meta?: RowMeta): string {
  if (meta) return meta.line;
  if (s.key === "iap") return IAP_LINE;
  return catalogCard(cardOfKey(s.key))?.line ?? s.gives;
}

/**
 * "내 카드로 저장" and then "공유하기": the card is private until its owner shares it, and always locked (ADR-0131). Saving is a request to
 * the server at that moment (`POST /api/service-cards`), with the name and the numbers as they stand; the id it comes back
 * with is kept beside the row (and in the draft), so the row still knows it is saved after another menu.
 */
function useSavedCard(
  draft: ServiceDraft,
  cardId: string | undefined,
  meta: RowMeta | undefined,
  onMeta: (meta: RowMeta) => void,
) {
  const { api, toast } = useApp();
  const base: RowMeta = meta ?? {
    owner: "기본 제공",
    titles: [],
    shared: false,
    line: lineOf(draft),
  };
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
      const view = await api.call("createServiceCard", {
        body: {
          name: draft.name,
          card: cardId,
          ...(draft.load ? { load: draft.load } : {}),
          shared: false,
        },
      });
      onMeta({ ...base, savedId: view.id, shared: view.shared });
      toast("내 카드로 저장했어요. 공유하기 전에는 나만 봐요");
    });
  const share = () =>
    attempt(async () => {
      if (!base.savedId) return;
      const view = await api.call("updateServiceCard", {
        params: { id: base.savedId },
        body: { shared: true },
      });
      onMeta({ ...base, shared: view.shared });
      toast("공유했어요. 다른 사람의 카탈로그에도 보여요");
    });
  return { savedId: base.savedId, shared: base.shared, save, share };
}

function Acts(props: {
  readonly canSave: boolean;
  readonly canShare: boolean;
  readonly onSave: () => void;
  readonly onShare: () => void;
  readonly onNumbers: () => void;
  readonly onRemove?: () => void;
}) {
  return (
    <div className="we-svc-acts">
      <Button
        data-moss-skip="세계 폼 안의 입력"
        size="small"
        kind="quiet"
        onClick={props.onNumbers}
      >
        숫자 고치기
      </Button>
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

/** Who made the card, and whether it is locked, saved or shared. */
function Who({
  meta,
  shared,
  saved,
}: {
  readonly meta: RowMeta | undefined;
  readonly shared: boolean;
  readonly saved: boolean;
}) {
  return (
    <>
      <div className="we-svc-who">
        {meta?.owner ?? "기본 제공"}
        {meta && <TitlePills who={meta.owner} titles={meta.titles} />}
      </div>
      <div className="we-svc-flags">
        <span>잠김</span>
        {(shared || saved) && <span>{shared ? "공유됨" : "저장됨"}</span>}
      </div>
    </>
  );
}

function Row(props: {
  readonly draft: ServiceDraft;
  readonly meta: RowMeta | undefined;
  readonly first: boolean;
  readonly onRename: (name: string) => void;
  readonly onMeta: (meta: RowMeta) => void;
  readonly onLoad: (load: ServiceLoad) => void;
  readonly onRemove?: () => void;
}) {
  const { draft, meta } = props;
  const builtIn = catalogCard(cardOfKey(draft.key));
  const { savedId, shared, save, share } = useSavedCard(draft, builtIn?.id, meta, props.onMeta);
  const [numbers, setNumbers] = useState(false);
  const load = loadOf(draft);
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
        <small className="we-svc-load" data-testid="svc-load">
          {loadText(load)}
        </small>
      </div>
      <Who meta={meta} shared={shared} saved={Boolean(savedId)} />
      <Acts
        canSave={Boolean(builtIn) && !savedId}
        canShare={Boolean(savedId) && !shared}
        onSave={() => void save()}
        onShare={() => void share()}
        onNumbers={() => setNumbers(true)}
        {...(props.onRemove ? { onRemove: props.onRemove } : {})}
      />
      {numbers && (
        <LoadSheet
          name={draft.name}
          load={load}
          onApply={(next) => {
            props.onLoad(next);
            setNumbers(false);
          }}
          onClose={() => setNumbers(false)}
        />
      )}
    </div>
  );
}

/** "이어서 할까요?" over screen ① when the world of an earlier visit was found (REQ-109). */
function Resume(props: {
  readonly step: "services" | "ladders" | "size";
  readonly onContinue: () => void;
  readonly onRestart: () => void;
}) {
  const where = { services: "서비스 고르기", ladders: "층 고르기", size: "서버 놓기" }[props.step];
  return (
    <output className="we-resume" data-testid="resume-line">
      <span>하던 세계를 그대로 두었어요. 이어서 할까요?</span>
      <Button
        data-moss-skip="세계 폼 안의 입력"
        size="small"
        kind="quiet"
        onClick={props.onContinue}
      >
        {props.step === "services" ? "이어서 하기" : `${where}부터 이어서`}
      </Button>
      <Button
        data-moss-skip="세계 폼 안의 입력"
        size="small"
        kind="quiet"
        onClick={props.onRestart}
      >
        처음부터 하기
      </Button>
    </output>
  );
}

/** Under the list: how many scenarios follow, or why 다음 waits when no service is left. */
function Foot({ count, scenarios }: { readonly count: number; readonly scenarios: number }) {
  if (count === 0)
    return (
      <output className="we-note" data-testid="no-services">
        {noServicesReason(0)}
      </output>
    );
  return (
    <p className="we-foot">
      시나리오 <b>{scenarios}개</b>가 따라와요
    </p>
  );
}

export function ServicesStep({
  services,
  scenarios,
  metas,
  resume,
  onChange,
  onMeta,
}: {
  readonly resume?:
    | {
        readonly step: "services" | "ladders" | "size";
        readonly onContinue: () => void;
        readonly onRestart: () => void;
      }
    | undefined;
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
  const rename = (i: number, name: string) =>
    onChange(services.map((x, k) => (k === i ? { ...x, name } : x)));
  return (
    <>
      {resume && <Resume {...resume} />}
      <div className="we-qhead">
        <h1>무엇을 떠받치는 세계인가요?</h1>
        <span className="we-step">1 / 3</span>
      </div>
      <p className="we-sub">
        세계가 떠받칠 서비스를 골라요. 처음에는 IAP가 들어 있고, 빼도 돼요. 카탈로그에서 더하거나 내
        카드를 골라도 돼요. 이름과 받는 숫자만 바꿀 수 있고, 피해 숫자는 실험을 만들 때 정해요.
      </p>
      <div className="we-svcs">
        {services.map((s, i) => (
          <Row
            key={s.key}
            draft={s}
            meta={metas[s.key]}
            first={i === 0}
            onRename={(name) => rename(i, name)}
            onMeta={(m) => onMeta(s.key, m)}
            onLoad={(load) => onChange(services.map((x, k) => (k === i ? { ...x, load } : x)))}
            onRemove={() => onChange(removeService(services, i))}
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
      <Foot count={services.length} scenarios={scenarios} />
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
