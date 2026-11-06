/**
 * "저장해 두기" (ADR-0092 item 3, ADR-0112) for instructions, tool sets and runbooks: give what is in front of you a
 * name, bring a saved one back, rename it, delete it (it can come back for seven days). They live on the server, for
 * the person, so any browser has them; what an older browser kept is moved there once.
 */
import { useEffect, useState } from "react";
import { presets as saved } from "../logic";
import { browserStore } from "./browser-store";
import { useApp, useAsync } from "./context";
import { Button, Note } from "./kit";

const { PRESET_WORDS: W } = saved;

type Kind = saved.PresetKind;

/** This browser's old copies are moved once per page load, whichever bar asks first. */
let moving: Promise<boolean> | undefined;

/** The saved things of one kind and what can be done with them. */
function usePresetList(kind: Kind) {
  const { api, toast } = useApp();
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    moving ??= saved.moveLegacy(browserStore(), (items) =>
      api.call("importPresets", { body: { items } }),
    );
    void moving.then((did) => did && setMoved(true));
  }, [api]);
  const list = useAsync(
    (signal) => api.call("listPresets", { query: { kind }, signal }),
    [api, kind, moved],
  );
  const fail = (err: unknown) => toast((err as Error).message, "bad");
  const act = async (job: () => Promise<unknown>) => {
    try {
      await job();
    } catch (err) {
      fail(err);
    }
    list.reload();
  };
  return {
    presets: list.data?.presets ?? [],
    gone: list.data?.deleted[0],
    moved,
    save: (name: string, body: string) =>
      act(() => api.call("savePreset", { body: { kind, name, body } })),
    rename: (id: string, name: string) =>
      act(() => api.call("renamePreset", { params: { id }, body: { name } })),
    remove: (id: string) => act(() => api.call("deletePreset", { params: { id } })),
    restore: (id: string) => act(() => api.call("restorePreset", { params: { id } })),
  };
}

/** Another name for the one that is picked. */
function Renamer({ onRename }: { readonly onRename: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="row preset-row">
      <input
        className="input"
        aria-label={W.NEW_NAME}
        placeholder={W.NEW_NAME}
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        size="small"
        kind="quiet"
        disabled={name.trim() === ""}
        why={W.NEW_NAME}
        onClick={() => {
          onRename(name.trim());
          setName("");
        }}
      >
        {W.RENAME}
      </Button>
    </div>
  );
}

/** Pick a saved one to bring back, rename or delete. */
function Picker({
  list,
  chosen,
  setChosen,
  onLoad,
  onDelete,
  onRename,
}: {
  readonly list: readonly saved.PresetView[];
  readonly chosen: string;
  readonly setChosen: (id: string) => void;
  readonly onLoad: (preset: saved.PresetView) => void;
  readonly onDelete: (preset: saved.PresetView) => void;
  readonly onRename: (preset: saved.PresetView, name: string) => void;
}) {
  const picked = list.find((p) => p.id === chosen);
  return (
    <>
      <div className="row preset-row">
        <label className="field-inline">
          <span className="small">{W.PICK}</span>
          <select
            className="input"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            aria-label={W.PICK}
          >
            <option value="">{list.length === 0 ? W.NONE : W.PICK}</option>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="small"
          disabled={!picked}
          why={W.PICK}
          onClick={() => picked && onLoad(picked)}
        >
          {W.LOAD}
        </Button>
        <Button
          size="small"
          kind="quiet"
          disabled={!picked}
          why={W.PICK}
          onClick={() => picked && onDelete(picked)}
        >
          {W.DELETE}
        </Button>
      </div>
      {picked && <Renamer onRename={(name) => onRename(picked, name)} />}
    </>
  );
}

/** Name what is in front of you and keep it. */
function Namer({ onSave }: { readonly onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  const save = () => {
    onSave(name.trim());
    setName("");
  };
  return (
    <div className="row preset-row">
      <input
        className="input"
        aria-label={W.NAME}
        placeholder={W.NAME}
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim() !== "" && save()}
      />
      <Button size="small" disabled={name.trim() === ""} why={W.NAME} onClick={save}>
        {W.SAVE}
      </Button>
    </div>
  );
}

export function PresetBar<K extends Kind>({
  kind,
  current,
  onLoad,
}: {
  readonly kind: K;
  /** What is in front of the person: what a save stores. */
  readonly current: saved.PresetData[K];
  readonly onLoad: (data: saved.PresetData[K], name: string) => void;
}) {
  const [chosen, setChosen] = useState("");
  const p = usePresetList(kind);
  return (
    <fieldset
      className="preset-bar stack"
      style={{ border: 0, padding: 0, margin: 0 }}
      data-testid={`presets-${kind}`}
    >
      <legend className="sr-only">{W.TITLE[kind]}</legend>
      <Picker
        list={p.presets}
        chosen={chosen}
        setChosen={setChosen}
        onLoad={(preset) => {
          const data = saved.decode(kind, preset.body);
          if (data !== undefined) onLoad(data, preset.name);
        }}
        onDelete={(preset) => {
          setChosen("");
          void p.remove(preset.id);
        }}
        onRename={(preset, name) => void p.rename(preset.id, name)}
      />
      <Namer onSave={(name) => void p.save(name, saved.encode(kind, current))} />
      {p.moved && <Note>{W.MOVED}</Note>}
      {p.gone && (
        <Note>
          <span>{W.undo(p.gone.name)}</span>{" "}
          <Button size="small" kind="quiet" onClick={() => p.gone && void p.restore(p.gone.id)}>
            {W.UNDO}
          </Button>
        </Note>
      )}
    </fieldset>
  );
}
