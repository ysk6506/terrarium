/**
 * "저장해 두기" (ADR-0092 item 3) for tool sets and runbooks: give the set in front of you a name, bring a saved one
 * back, change it by saving under the same name, delete it (it can come back for seven days).
 */
import { useState } from "react";
import { presets as saved } from "../logic";
import { browserStore } from "./browser-store";
import { Button, Note } from "./kit";

const { PRESET_WORDS: W } = saved;

type Kind = saved.PresetKind;

/** Pick a saved set to bring back or delete. */
function Picker<T>({
  list,
  chosen,
  setChosen,
  onLoad,
  onDelete,
}: {
  readonly list: readonly saved.Preset<T>[];
  readonly chosen: string;
  readonly setChosen: (id: string) => void;
  readonly onLoad: (preset: saved.Preset<T>) => void;
  readonly onDelete: (preset: saved.Preset<T>) => void;
}) {
  const picked = list.find((p) => p.id === chosen);
  return (
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
      <Button size="small" disabled={!picked} why={W.PICK} onClick={() => picked && onLoad(picked)}>
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
  );
}

/** Name the set in front of you and keep it. */
function Namer({ onSave }: { readonly onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  const save = () => {
    onSave(name);
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

export function PresetBar<T>({
  kind,
  current,
  onLoad,
}: {
  readonly kind: Kind;
  /** The set in front of the person: what a save stores. */
  readonly current: T;
  readonly onLoad: (data: T, name: string) => void;
}) {
  const [version, setVersion] = useState(0);
  const [chosen, setChosen] = useState("");
  const store = browserStore();
  const now = () => new Date();
  const refresh = () => setVersion((v) => v + 1);
  void version;
  const list = saved.listPresets<T>(store, kind);
  const gone = saved.deletedPresets<T>(store, kind, now())[0];
  return (
    <fieldset className="preset-bar stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="sr-only">{W.TITLE[kind]}</legend>
      <Picker
        list={list}
        chosen={chosen}
        setChosen={setChosen}
        onLoad={(p) => onLoad(p.data, p.name)}
        onDelete={(p) => {
          saved.removePreset(store, kind, p.id, now());
          setChosen("");
          refresh();
        }}
      />
      <Namer
        onSave={(name) => {
          const made = saved.savePreset(store, kind, name, current, now());
          if (made) setChosen(made.id);
          refresh();
        }}
      />
      {gone && (
        <Note>
          <span>{W.undo(gone.name)}</span>{" "}
          <Button
            size="small"
            kind="quiet"
            onClick={() => {
              saved.restorePreset(store, kind, gone.id);
              refresh();
            }}
          >
            {W.UNDO}
          </Button>
        </Note>
      )}
    </fieldset>
  );
}
