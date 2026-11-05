/**
 * The builder's state: the blueprint with undo, where we look, what is selected, the tool in hand,
 * the running-world preview, and saving with a version check. Every change goes through logic.builder.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { WorldRecord } from "@terrarium/core/experiments";
import type { Rotation } from "@terrarium/core/spatial";
import {
  type Blueprint,
  BlueprintIndex,
  type Issue,
  validateBlueprint,
} from "@terrarium/core/world";
import { type MutableRefObject, useCallback, useMemo, useRef, useState } from "react";
import { ApiError, builder } from "../../logic";
import { messageOf, useApp } from "../context";

export type Tool = builder.Tool;

export const catalog = new Catalog();

export interface BuilderState {
  readonly world: WorldRecord;
  readonly blueprint: Blueprint;
  readonly index: BlueprintIndex;
  readonly level: builder.Level;
  readonly selected: readonly string[];
  readonly tool: Tool;
  readonly rotation: Rotation;
  readonly preview?: builder.Preview;
  readonly previewing: boolean;
  readonly issues: readonly Issue[];
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Whether the viewer made this world (only they can save over it). */
  readonly mine: boolean;
  /** Which piece of the selected room is chosen: none is the body, 0 the first piece (ADR-0080). */
  readonly piece?: number;
  /** The last edit that was refused, with the way on when there is one (a bigger building, more land). */
  readonly refusal?: Refused;
}

/** An edit that was not accepted: what to tell, and where to go from there. */
export interface Refused {
  readonly message: string;
  readonly way?: builder.Refusal["way"];
}

type History = MutableRefObject<builder.History<Blueprint>>;

/** "돌려 보기": the physics run in the browser, on demand, cleared by any edit. */
function usePreview(history: History) {
  const { toast } = useApp();
  const [preview, setPreview] = useState<builder.Preview>();
  const [previewing, setPreviewing] = useState(false);
  const run = useCallback(
    (stopped: ReadonlySet<string>) => {
      setPreviewing(true);
      // Let the button show it is working before the physics runs.
      setTimeout(() => {
        const result = builder.preview(
          history.current.current,
          catalog,
          builder.PREVIEW_SECONDS,
          stopped,
        );
        setPreviewing(false);
        if ("problems" in result) {
          const more = result.problems.length > 1 ? ` 외 ${result.problems.length - 1}건` : "";
          toast(`돌릴 수 없어요: ${result.problems[0] ?? ""}${more}`, "bad");
          return;
        }
        setPreview(result);
      }, 30);
    },
    [toast, history],
  );
  const runPreview = useCallback(() => {
    if (preview) return setPreview(undefined);
    run(new Set());
  }, [preview, run]);
  /** Run again with one cooling unit stopped, or started again ("멈춰 보기"). */
  const toggleUnit = useCallback(
    (id: string) => {
      const next = new Set(preview?.stopped ?? []);
      if (!next.delete(id)) next.add(id);
      run(next);
    },
    [preview, run],
  );
  const clearPreview = useCallback(() => setPreview(undefined), []);
  return { preview, previewing, runPreview, toggleUnit, clearPreview };
}

const CONFLICT = "그사이 다른 곳에서 이 세계가 바뀌었어요. 새로고침하면 바뀐 내용을 볼 수 있어요";

/** Saving over the world (owner), as a copy (anyone else), and renaming it. */
function useSaving(initial: WorldRecord, history: History) {
  const { api, toast, navigate } = useApp();
  const [world, setWorld] = useState(initial);
  const [saved, setSaved] = useState(initial.blueprint);
  const [saving, setSaving] = useState(false);
  const attempt = useCallback(
    async (work: () => Promise<void>) => {
      setSaving(true);
      try {
        await work();
      } catch (err) {
        toast(err instanceof ApiError && err.status === 409 ? CONFLICT : messageOf(err), "bad");
      } finally {
        setSaving(false);
      }
    },
    [toast],
  );
  const save = useCallback(
    () =>
      attempt(async () => {
        const blueprint = history.current.current;
        const result = await api.call("updateWorld", {
          params: { id: world.id },
          body: { baseDigest: world.digest, blueprint },
        });
        setWorld(result.world);
        setSaved(blueprint);
        toast("저장했어요");
      }),
    [api, world, toast, attempt, history],
  );
  const saveCopy = useCallback(
    () =>
      attempt(async () => {
        const blueprint = history.current.current;
        const result = await api.call("createWorld", {
          body: { name: `${world.name} 사본`.slice(0, 80), blueprint },
        });
        setSaved(blueprint);
        toast("내 사본으로 저장했어요");
        navigate({ name: "world", id: result.world.id }, { replace: true });
      }),
    [api, world, toast, navigate, attempt, history],
  );
  const renameWorld = useCallback(
    async (name: string) => {
      if (name.trim() === "" || name === world.name) return;
      await attempt(async () => {
        const result = await api.call("updateWorld", {
          params: { id: world.id },
          body: { baseDigest: world.digest, name },
        });
        setWorld(result.world);
        toast("이름을 바꿨어요");
      });
    },
    [api, world, toast, attempt],
  );
  return { world, saved, saving, save, saveCopy, renameWorld };
}

/** The blueprint with undo and redo; a refused edit becomes a toast and changes nothing. */
function useEdits(initial: Blueprint, clearPreview: () => void) {
  const { toast } = useApp();
  const history = useRef(new builder.History<Blueprint>(initial));
  const [blueprint, setBlueprint] = useState(initial);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<Refused>();
  const refuse = useCallback(
    (message: string, way?: Refused["way"]) => {
      setRefusal({ message, ...(way ? { way } : {}) });
      toast(message, "bad");
    },
    [toast],
  );
  const apply = useCallback(
    (make: (bp: Blueprint) => builder.Edit, done?: string): boolean => {
      try {
        const edit = make(history.current.current);
        history.current.push(edit.blueprint);
        setBlueprint(edit.blueprint);
        setSelected(edit.select);
        setRefusal(undefined);
        clearPreview();
        if (done) toast(done);
        return true;
      } catch (err) {
        refuse(messageOf(err), err instanceof builder.Refusal ? err.way : undefined);
        return false;
      }
    },
    [toast, clearPreview, refuse],
  );
  const step = (to: () => Blueprint) => {
    setBlueprint(to());
    clearPreview();
  };
  return {
    history,
    blueprint,
    selected,
    setSelected,
    refusal,
    refuse,
    clearRefusal: () => setRefusal(undefined),
    apply,
    undo: () => step(() => history.current.undo()),
    redo: () => step(() => history.current.redo()),
  };
}

export function useBuilder(initial: WorldRecord) {
  const { me } = useApp();
  const clear = useRef<() => void>(() => undefined);
  const edits = useEdits(initial.blueprint, () => clear.current());
  const { preview, previewing, runPreview, toggleUnit, clearPreview } = usePreview(edits.history);
  clear.current = clearPreview;
  const saving = useSaving(initial, edits.history);
  const index = useMemo(() => new BlueprintIndex(edits.blueprint), [edits.blueprint]);
  const issues = useMemo(() => validateBlueprint(edits.blueprint, catalog), [edits.blueprint]);
  const [level, setLevel] = useState<builder.Level>(() =>
    builder.startLevel(new BlueprintIndex(initial.blueprint)),
  );
  const [tool, setTool] = useState<Tool>({ kind: "select" });
  const [rotation, setRotation] = useState<Rotation>(0);
  const [piece, setPiece] = useState<number>();
  const { clearRefusal } = edits;
  const setSelected = useCallback(
    (ids: readonly string[]) => {
      edits.setSelected(ids);
      setPiece(undefined);
      clearRefusal();
    },
    [edits.setSelected, clearRefusal],
  );
  const go = useCallback(
    (next: builder.Level) => {
      setLevel(next);
      setSelected([]);
      setTool({ kind: "select" });
    },
    [setSelected],
  );
  const state: BuilderState = {
    world: saving.world,
    blueprint: edits.blueprint,
    index,
    level,
    selected: edits.selected,
    tool,
    rotation,
    ...(preview ? { preview } : {}),
    previewing,
    issues,
    dirty: edits.blueprint !== saving.saved,
    saving: saving.saving,
    canUndo: edits.history.current.canUndo,
    canRedo: edits.history.current.canRedo,
    mine: saving.world.owner === (me ?? "anonymous"),
    ...(piece !== undefined ? { piece } : {}),
    ...(edits.refusal ? { refusal: edits.refusal } : {}),
  };
  const { apply, undo, redo } = edits;
  const { save, saveCopy, renameWorld } = saving;
  return {
    state,
    apply,
    undo,
    redo,
    go,
    setSelected,
    setPiece,
    refuse: edits.refuse,
    setTool,
    setRotation,
    runPreview,
    toggleUnit,
    save,
    saveCopy,
    renameWorld,
  };
}

export type Builder = ReturnType<typeof useBuilder>;
