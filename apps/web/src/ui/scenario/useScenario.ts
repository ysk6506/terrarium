/**
 * The scenario editor's state: the document with undo, what is selected, live validation against the
 * world (the same validator the server runs), saving with a version check, and the dry run.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { DryRunView } from "@terrarium/core/contract";
import type { ScenarioRecord, WorldRecord } from "@terrarium/core/experiments";
import {
  type ExpectationKind,
  type PaletteItem,
  type ScenarioDoc,
  validateScenario,
} from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, builder, scenario } from "../../logic";
import { messageOf, useApp } from "../context";
import { useCalibration } from "./useCalibration";

export const catalog = new Catalog();

const CONFLICT =
  "그사이 다른 곳에서 이 시나리오가 바뀌었어요. 새로고침하면 바뀐 내용을 볼 수 있어요";

function useDoc(initial: ScenarioDoc) {
  const { toast } = useApp();
  const history = useRef(new builder.History<ScenarioDoc>(initial));
  const [doc, setDoc] = useState(initial);
  /** Apply a change; a refused one becomes a toast and changes nothing. */
  const change = useCallback(
    (make: (d: ScenarioDoc) => ScenarioDoc): boolean => {
      try {
        const next = make(history.current.current);
        history.current.push(next);
        setDoc(next);
        return true;
      } catch (err) {
        toast(messageOf(err), "bad");
        return false;
      }
    },
    [toast],
  );
  return {
    history,
    doc,
    change,
    undo: () => setDoc(history.current.undo()),
    redo: () => setDoc(history.current.redo()),
  };
}

function useSaving(initial: ScenarioRecord, current: () => ScenarioDoc) {
  const { api, toast, navigate } = useApp();
  const [record, setRecord] = useState(initial);
  const [saved, setSaved] = useState(initial.doc);
  const [saving, setSaving] = useState(false);
  const attempt = useCallback(
    async <T>(work: () => Promise<T>): Promise<T | undefined> => {
      setSaving(true);
      try {
        return await work();
      } catch (err) {
        toast(err instanceof ApiError && err.status === 409 ? CONFLICT : messageOf(err), "bad");
        return undefined;
      } finally {
        setSaving(false);
      }
    },
    [toast],
  );
  const save = useCallback(
    () =>
      attempt(async () => {
        const doc = current();
        const result = await api.call("updateScenario", {
          params: { id: record.id },
          body: { baseDigest: record.digest, doc },
        });
        setRecord(result.scenario);
        setSaved(doc);
        toast("저장했어요");
        return result.scenario;
      }),
    [api, record, toast, attempt, current],
  );
  const saveCopy = useCallback(
    () =>
      attempt(async () => {
        const doc = current();
        const result = await api.call("createScenario", {
          body: { worldId: record.worldId, doc, name: `${record.name} 사본`.slice(0, 80) },
        });
        setSaved(doc);
        toast("내 사본으로 저장했어요");
        navigate({ name: "scenario", id: result.scenario.id }, { replace: true });
        return undefined;
      }),
    [api, record, toast, navigate, attempt, current],
  );
  const rename = useCallback(
    async (name: string) => {
      if (name.trim() === "" || name === record.name) return;
      await attempt(async () => {
        const result = await api.call("updateScenario", {
          params: { id: record.id },
          body: { baseDigest: record.digest, name },
        });
        setRecord(result.scenario);
        toast("이름을 바꿨어요");
      });
    },
    [api, record, toast, attempt],
  );
  return { record, saved, saving, save, saveCopy, rename };
}

/**
 * The everyday edits on the selected block (beta feedback 19, 20): a new block goes right after it, and copy, paste,
 * duplicate and delete work on it. The copied block is kept here, not on the system clipboard, so it is the block
 * itself with its settings and nothing a text field could swallow.
 */
function useBlockEdits(
  doc: ScenarioDoc,
  change: (make: (d: ScenarioDoc) => ScenarioDoc) => boolean,
  selected: string | undefined,
  select: (id: string | undefined) => void,
) {
  const { toast } = useApp();
  const clip = useRef<scenario.Snippet | undefined>(undefined);
  const pick = (ids: readonly string[]) => select(ids[0]);
  const insert = (item: PaletteItem) => {
    let added: string | undefined;
    const ok = change((d) => {
      const r = scenario.insertBlock(d, item, selected);
      added = r.nodeId;
      return r.doc;
    });
    if (ok && added) select(added);
    return ok;
  };
  const addScore = (kind: ExpectationKind) => {
    let id: string | undefined;
    const ok = change((d) => {
      const r = scenario.addScoreLine(d, kind);
      id = r.id;
      return r.doc;
    });
    return ok ? id : undefined;
  };
  const copy = () => {
    const snippet = selected ? scenario.copyNodes(doc, [selected]) : undefined;
    if (!snippet) return toast("복사할 블록을 먼저 골라 주세요. 시작 블록은 복사할 수 없어요");
    clip.current = snippet;
    toast("복사했어요. Ctrl+V로 고른 블록 뒤에 붙여 넣어요");
  };
  const paste = () => {
    const snippet = clip.current;
    if (!snippet) return toast("복사해 둔 블록이 아직 없어요. 블록을 골라 Ctrl+C를 눌러 주세요");
    let ids: string[] = [];
    const ok = change((d) => {
      const r = scenario.pasteSnippet(d, snippet, selected);
      ids = r.nodeIds;
      return r.doc;
    });
    if (ok) pick(ids);
  };
  const duplicate = () => {
    if (!selected) return toast("복제할 블록을 먼저 골라 주세요");
    let ids: string[] = [];
    const ok = change((d) => {
      const r = scenario.duplicateNode(d, selected);
      ids = r.nodeIds;
      return r.doc;
    });
    if (ok) pick(ids);
  };
  const remove = () => {
    if (!selected) return;
    if (doc.nodes.find((n) => n.id === selected)?.type === "start")
      return toast("시작 블록은 지울 수 없어요");
    if (change((d) => scenario.removeAndMend(d, selected))) select(undefined);
  };
  return { insert, addScore, copy, paste, duplicate, remove };
}

export function useScenario(initial: ScenarioRecord, world: WorldRecord) {
  const { api, me, toast } = useApp();
  const edits = useDoc(initial.doc);
  const saving = useSaving(initial, () => edits.history.current.current);
  const index = useMemo(() => new BlueprintIndex(world.blueprint), [world]);
  const issues = useMemo(() => validateScenario(edits.doc, { index, catalog }), [edits.doc, index]);
  const [selected, setSelected] = useState<string>();
  const [dryRun, setDryRun] = useState<DryRunView>();
  const [running, setRunning] = useState(false);
  const mine = saving.record.owner === (me ?? "anonymous");
  const dirty = edits.doc !== saving.saved;
  // undo can take away the block that was selected
  useEffect(() => {
    if (selected && !edits.doc.nodes.some((n) => n.id === selected)) setSelected(undefined);
  }, [edits.doc, selected]);
  const blocks = useBlockEdits(edits.doc, edits.change, selected, setSelected);

  /** The dry run and the exam-paper check play what is saved, so unsaved changes are saved first (by the owner). */
  const ensureSaved = useCallback(
    async () => (dirty ? await saving.save() : saving.record),
    [dirty, saving],
  );
  const calibration = useCalibration(ensureSaved);
  const runDry = useCallback(async () => {
    setRunning(true);
    try {
      const saved = await ensureSaved();
      if (!saved) return;
      setDryRun(await api.call("dryRunScenario", { params: { id: saved.id }, body: { seed: 1 } }));
    } catch (err) {
      toast(messageOf(err), "bad");
    } finally {
      setRunning(false);
    }
  }, [api, ensureSaved, toast]);

  return {
    doc: edits.doc,
    record: saving.record,
    world,
    index,
    issues,
    selected,
    select: setSelected,
    change: edits.change,
    undo: edits.undo,
    redo: edits.redo,
    canUndo: edits.history.current.canUndo,
    canRedo: edits.history.current.canRedo,
    ...blocks,
    dirty,
    mine,
    saving: saving.saving,
    save: saving.save,
    saveCopy: saving.saveCopy,
    rename: saving.rename,
    dryRun,
    running,
    runDry,
    calibration,
  };
}

export type ScenarioEditor = ReturnType<typeof useScenario>;
