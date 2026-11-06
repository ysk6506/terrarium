/**
 * "어떤 하네스인가요?" (REQ-051, beta feedback 14): a card for each kind of harness, with what it asks for and which tool
 * address it uses. Pressing one opens the connection form with that kind already chosen, so the form shows only the
 * fields that kind needs.
 */
import type { ConnectorSpec } from "@terrarium/core/contract";
import { ADDRESS_LABELS, addressKind, KIND_CARDS, SLOT_CONNECTORS } from "../../logic";

interface Card {
  readonly kind: string;
  readonly name: string;
  readonly asks: string;
  readonly address: string;
}

/** The cards for the kinds the server can connect from the screen: the usual six first, then the rest. */
function cardsOf(connectors: readonly ConnectorSpec[]): Card[] {
  const addressOf = (c: ConnectorSpec) =>
    ADDRESS_LABELS[
      addressKind({
        toolTransport: c.toolTransport,
        mcpSlot: SLOT_CONNECTORS.includes(c.kind) ? c.kind : undefined,
      })
    ];
  const known = KIND_CARDS.flatMap((k) => {
    const spec = connectors.find((c) => c.kind === k.kind);
    return spec ? [{ ...k, address: addressOf(spec) }] : [];
  });
  const rest = connectors
    .filter((c) => !KIND_CARDS.some((k) => k.kind === c.kind))
    .map((c) => ({ kind: c.kind, name: c.label, asks: "그 밖의 방식", address: addressOf(c) }));
  return [...known, ...rest];
}

export function KindCards({
  connectors,
  onPick,
  picked,
}: {
  readonly connectors: readonly ConnectorSpec[];
  readonly onPick: (kind: string) => void;
  readonly picked?: string;
}) {
  return (
    <fieldset className="kind-cards">
      <legend className="sr-only">하네스 종류</legend>
      {cardsOf(connectors).map((c) => (
        <button
          key={c.kind}
          type="button"
          className="kind-card"
          aria-pressed={picked === c.kind}
          onClick={() => onPick(c.kind)}
        >
          <b>{c.name}</b>
          <span>{c.asks}</span>
          <small>{c.address}</small>
        </button>
      ))}
    </fieldset>
  );
}
