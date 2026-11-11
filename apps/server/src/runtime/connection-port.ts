/**
 * A stored connection built into the port experiments talk through: the connector of its protocol checks the fields and the
 * address, and the sealed secrets and headers are opened only here, for the one request they ride on.
 */
import { parseWith } from "@terrarium/core/contract";
import type { ConnectionRecord, HarnessPort } from "@terrarium/core/experiments";
import { connectorOf } from "../adapters";
import {
  checkFields,
  fail,
  given,
  messageOf,
  problem,
  reveal,
  withHeaders,
} from "./connection-form";
import type { ConnectionsOptions } from "./connection-options";

export function portFor(record: ConnectionRecord, options: ConnectionsOptions): HarnessPort {
  const { id, name } = record;
  const connector = connectorOf(record.connector);
  if (!connector) return fail([problem("connector", `연결 방식 '${record.connector}'을 몰라요`)]);
  if (!connector.spec.fromScreen)
    fail([problem("connector", "이 연결 방식은 서버 설정 파일에서만 더할 수 있어요")]);
  const identity = { id, name, description: record.description ?? "" };
  const parsed = parseWith(connector.schema, {
    ...given(record.config),
    ...identity,
    kind: record.connector,
  });
  if (!parsed.ok) return fail(parsed.issues.map((i) => problem(i.path ?? "", i.message)));
  const values = parsed.value as Record<string, unknown>;
  checkFields(connector, values, options.connect.env, options.allowedHosts);
  const { secrets, headers } = reveal(record, options.box);
  try {
    return connector.connect(values, {
      ...options.connect,
      fetch: withHeaders(options.connect.fetch, headers),
      ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    });
  } catch (err) {
    return fail([problem("", messageOf(err))]);
  }
}
