/**
 * The catalog sheet (REQ-104, ADR-0127): the ten built-in cards and the cards people shared (and my own). A card is a
 * name, one line, who made it with their titles, and 잠김/공유됨. Pressing one adds a service of that fixed shape.
 */
import type { ServiceCardView } from "@terrarium/core/contract";
import { draftFromCard, type ServiceDraft } from "@terrarium/core/sources/worldgen";
import { type CatalogCard, catalogCard, SERVICE_CATALOG } from "@terrarium/core/world";
import { messageOf, useApp, useAsync } from "../context";
import { Button, Dialog } from "../kit";
import type { RowMeta } from "./shape-services";

export interface Picked {
  readonly draft: ServiceDraft;
  readonly meta: RowMeta;
}

const BUILT_IN = "기본 제공";

function Item(props: {
  readonly name: string;
  readonly line: string;
  readonly owner: string;
  readonly titles?: ServiceCardView["ownerTitles"];
  readonly flags: readonly string[];
  readonly onPick: () => void;
  /** Only on somebody else's card: copy it into a card of my own. */
  readonly onCopy?: () => void;
}) {
  return (
    <div className="we-ci-box">
      <button
        type="button"
        className="we-ci"
        data-moss-skip="세계 폼 안의 입력"
        onClick={props.onPick}
      >
        <b>{props.name}</b>
        <small>{props.line}</small>
        <span className="we-ci-who">
          {props.owner}
          {props.titles && props.titles.length > 0 && (
            <span className="we-ci-titles">
              {props.titles.slice(0, 2).map((t) => (
                <em key={t.key}>{t.label}</em>
              ))}
            </span>
          )}
        </span>
        {props.flags.length > 0 && <span className="we-ci-flags">{props.flags.join(" · ")}</span>}
      </button>
      {props.onCopy && (
        <button
          type="button"
          className="we-link"
          data-moss-skip="세계 폼 안의 입력"
          onClick={props.onCopy}
        >
          복사해서 내 카드로
        </button>
      )}
    </div>
  );
}

const builtInMeta = (c: CatalogCard): RowMeta => ({
  owner: BUILT_IN,
  titles: [],
  shared: false,
  line: c.line,
});

function savedPick(v: ServiceCardView, taken: readonly string[]): Picked | undefined {
  const base = catalogCard(v.card);
  if (!base) return undefined;
  return {
    draft: draftFromCard(base, taken, {
      name: v.name,
      ...(v.harm ? { harm: v.harm } : {}),
      ...(v.load ? { load: v.load } : {}),
    }),
    meta: {
      owner: v.owner,
      titles: v.ownerTitles,
      shared: v.shared,
      line: base.line,
      savedId: v.id,
    },
  };
}

export function ServiceSheet({
  taken,
  onPick,
  onClose,
}: {
  readonly taken: readonly string[];
  readonly onPick: (p: Picked) => void;
  readonly onClose: () => void;
}) {
  const { api, identity, toast } = useApp();
  const cards = useAsync((signal) => api.call("listServiceCards", { signal }), []);
  // somebody else's card is locked: copying it makes a card of my own that I can change and share
  const copy = async (v: ServiceCardView) => {
    try {
      await api.call("copyServiceCard", { params: { id: v.id }, body: {} });
      toast("내 카드로 복사했어요. 공유하기 전에는 나만 봐요");
      cards.reload();
    } catch (err) {
      toast(messageOf(err));
    }
  };
  const pickBuiltIn = (c: CatalogCard) =>
    onPick({ draft: draftFromCard(c, taken), meta: builtInMeta(c) });
  const pickSaved = (v: ServiceCardView) => {
    const picked = savedPick(v, taken);
    if (picked) onPick(picked);
  };
  return (
    <Dialog
      title="어떤 서비스를 더할까요?"
      wide
      onClose={onClose}
      actions={
        <Button data-moss-skip="세계 폼 안의 입력" kind="quiet" onClick={onClose}>
          닫기
        </Button>
      }
    >
      <p className="we-sub">
        기본 제공과 사람들이 공유한 카드예요. 모양은 정해져 있고, 카드는 늘 잠겨 있어서 남의 카드는
        복사해서 내 카드로 써요.
      </p>
      <div className="we-cat">
        {SERVICE_CATALOG.map((c) => (
          <Item
            key={c.id}
            name={c.name}
            line={c.line}
            owner={BUILT_IN}
            flags={["잠김"]}
            onPick={() => pickBuiltIn(c)}
          />
        ))}
        {(cards.data ?? []).map((v) => (
          <Item
            key={v.id}
            name={v.name}
            line={catalogCard(v.card)?.line ?? ""}
            owner={v.owner === identity.name ? `${v.owner} (나)` : v.owner}
            titles={v.ownerTitles}
            flags={["잠김", v.shared ? "공유됨" : "나만 봐요"]}
            onPick={() => pickSaved(v)}
            {...(v.canEdit ? {} : { onCopy: () => void copy(v) })}
          />
        ))}
      </div>
    </Dialog>
  );
}
