/** The small helpers the connection dialog's request is made from. */
import type {
  ConnectionView,
  ConnectorSpec,
  TelemetryAdapterList,
  UpdateConnectionRequest,
} from "@terrarium/core/contract";
import {
  blankForm,
  type blankTraces,
  type ConnectionForm,
  configOf,
  headersOf,
  metadataOf,
  settingsOf,
  tracesRequest,
} from "../../logic";
import type { useApp } from "../context";
import type { useSharingChoice } from "../scope";

/** What the sharing question starts from when a connection is changed: how it is shared now, and who made it. */
export const sharingOf = (existing: ConnectionView | undefined) =>
  existing
    ? { ...existing.sharing, ...(existing.owner ? { owner: existing.owner } : {}) }
    : undefined;

/** Another protocol keeps what is the same for every one: the name, the description and where the traces go. */
export const switchedForm = (chosen: ConnectorSpec, f: ConnectionForm): ConnectionForm => ({
  ...blankForm(chosen),
  name: f.name,
  description: f.description,
  ...(f.traces ? { traces: f.traces } : {}),
});

/** Where the traces go, for the request; left out when the server's list of tools did not load. */
export const tracesPart = (
  list: TelemetryAdapterList | undefined,
  traces: ReturnType<typeof blankTraces>,
) => (list ? { traces: tracesRequest(list, traces, settingsOf) } : ({} as Record<string, never>));

/** The name, the description and the labels a person writes. */
export const namesOf = (form: ConnectionForm) => ({
  name: form.name.trim(),
  description: form.description.trim(),
  metadata: metadataOf(form.metadata),
});

/** The address, the token and the headers as the server takes them. */
export const wireOf = (s: ConnectorSpec, form: ConnectionForm) => ({
  config: configOf(s, form),
  headers: headersOf(form.headers),
});

type SharingChoice = ReturnType<typeof useSharingChoice>;

/** Makes the connection with who may see it, or changes it, and then changes who may see it through its one route. */
export async function submit(
  api: ReturnType<typeof useApp>["api"],
  existing: ConnectionView | undefined,
  made: {
    readonly kind: string;
    readonly common: UpdateConnectionRequest & { readonly name: string };
  },
  sharing: SharingChoice,
) {
  if (!existing)
    return api.call("createConnection", {
      body: { connector: made.kind, ...made.common, ...sharing.forCreate },
    });
  const done = await api.call("updateConnection", {
    params: { id: existing.id },
    body: made.common,
    ...(sharing.reason ? { reason: sharing.reason } : {}),
  });
  await sharing.applyTo(existing.id);
  return done;
}
