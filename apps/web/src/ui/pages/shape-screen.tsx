/**
 * The three "서비스부터" screens in one page (ADR-0107): a bar at the foot says where you are and what the next press
 * does. The last screen builds the world, says what came of it in one line, and offers to keep the shape as a template.
 */
import type { ShapedResult } from "@terrarium/core/sources/worldgen";
import { planShape, type ShapeSpec, shapeProblem } from "@terrarium/core/sources/worldgen";
import { type ReactNode, useMemo, useState } from "react";
import { advance, builtFact, recommendLine, retreat, type ShapeView, shapeView } from "../../logic";
import { messageOf, useApp } from "../context";
import { Button, TextField } from "../kit";
import { type Flow, type Step, useShapeFlow } from "./shape-flow";
import { LaddersStep } from "./shape-ladders";
import { useShapeMoss } from "./shape-moss";
import type { RowMeta } from "./shape-services";
import { ServicesStep } from "./shape-services";
import { SizeStep } from "./shape-size";

interface Start {
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly run: (worldId: string) => Promise<void>;
}

/** "실험 시작": one request on a built world, then the experiment's page. */
function useQuickStart(templateIds: readonly string[]): Start {
  const { api, navigate } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (worldId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const done = await api.call("quickExperiment", {
        params: { id: worldId },
        body: { templateIds: [...templateIds] },
      });
      navigate({ name: "experiment", id: done.experimentId });
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };
  return { busy, error, run };
}

interface Built {
  readonly worldId: string;
  readonly counts: ShapedResult["counts"];
}

/** The template row is one small link until it is wanted (REQ-108, ADR-0131). */
function SaveTemplate({
  spec,
  onError,
}: {
  readonly spec: Flow["spec"];
  readonly onError: (message: string) => void;
}) {
  const { api, toast } = useApp();
  const [name, setName] = useState(spec.name);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState(false);
  const save = async () => {
    try {
      await api.call("generateWorld", {
        body: { shape: spec, template: true, name: name.trim() || spec.name },
      });
      setSaved(true);
      toast("템플릿으로 저장했어요. 새 세계 첫 화면에서 다시 쓸 수 있어요");
    } catch (err) {
      onError(messageOf(err));
    }
  };
  return (
    <div className="we-save">
      {saved ? (
        <small className="muted">템플릿으로 저장했어요</small>
      ) : asking ? (
        <>
          <TextField label="템플릿 이름" value={name} onChange={setName} maxLength={80} />
          <Button data-moss-skip="세계 폼 안의 입력" onClick={() => void save()}>
            이 구성을 템플릿으로 저장
          </Button>
        </>
      ) : (
        <button
          type="button"
          className="we-link"
          data-moss-skip="세계 폼 안의 입력"
          onClick={() => setAsking(true)}
        >
          템플릿으로 저장
        </button>
      )}
    </div>
  );
}

function Done({
  built,
  flow,
  view,
  start,
}: {
  readonly built: Built;
  readonly flow: Flow;
  readonly view: ShapeView;
  readonly start: Start;
}) {
  const { navigate } = useApp();
  const [error, setError] = useState<string>();
  return (
    <section className="we-done" aria-label="세계를 다 지었어요">
      <h2>세계를 다 지었어요</h2>
      <p>{builtFact(flow.spec.name, view)}</p>
      <div className="we-plan">
        <div>
          <b>이렇게 시작해요</b>
          <br />
          <small>{recommendLine(view.scenarios)}</small>
        </div>
        <Button
          data-moss-skip="세계 폼 안의 입력"
          kind="quiet"
          onClick={() => navigate({ name: "newExperiment", worldId: built.worldId, quick: true })}
        >
          바꾸기
        </Button>
      </div>
      <div className="row">
        <Button
          data-moss-action="world-quick-start"
          kind="primary"
          busy={start.busy}
          onClick={() => void start.run(built.worldId)}
        >
          실험 시작
        </Button>
        <Button
          data-moss-skip="세계 폼 안의 입력"
          kind="quiet"
          onClick={() => navigate({ name: "world", id: built.worldId })}
        >
          세계 둘러보기
        </Button>
      </div>
      <SaveTemplate spec={flow.spec} onError={setError} />
      {(error || start.error) && (
        <p className="we-note" role="alert">
          {error ?? start.error}
        </p>
      )}
    </section>
  );
}

function Bar(props: {
  readonly flow: Flow;
  readonly sum: React.ReactNode;
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly nextLabel: string;
  readonly nextDisabled?: string | undefined;
  /** On the last screen: build the world and stop there (the primary press also starts the experiment). */
  readonly onMake?: () => void;
}) {
  return (
    <div className="we-bar" data-bottom-bar>
      <span className="we-bar-sum">{props.sum}</span>
      <span className="we-spacer" />
      <Button data-moss-skip="세계 폼 안의 입력" kind="quiet" onClick={props.onBack}>
        이전
      </Button>
      {props.onMake && (
        <Button
          data-moss-action="world-build"
          disabled={props.nextDisabled !== undefined}
          why={props.nextDisabled}
          onClick={props.onMake}
        >
          세계만 만들기
        </Button>
      )}
      {props.onMake ? (
        <Button
          kind="primary"
          data-moss-action="world-quick-start"
          busy={props.busy}
          disabled={props.nextDisabled !== undefined}
          why={props.nextDisabled}
          onClick={props.onNext}
        >
          {props.nextLabel}
        </Button>
      ) : (
        <Button
          kind="primary"
          data-moss-action="world-build"
          busy={props.busy}
          onClick={props.onNext}
        >
          {props.nextLabel}
        </Button>
      )}
    </div>
  );
}

/** Build the world the spec comes to, and keep what came of it. */
function useMake(spec: ShapeSpec, startedFrom?: string) {
  const { api, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [built, setBuilt] = useState<Built>();
  const [error, setError] = useState<string>();
  const make = async (): Promise<Built | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api.call("generateWorld", {
        body: { shape: spec, ...(startedFrom ? { startedFrom } : {}) },
      });
      const world = saved.world;
      const counts = (world.provenance?.counts ?? {}) as ShapedResult["counts"];
      const made = { worldId: world.id, counts };
      setBuilt(made);
      toast(`${world.name}을 만들었어요`);
      return made;
    } catch (err) {
      setError(messageOf(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, built, error, make };
}

/** The line at the foot of the bar: where the screen stands. */
function summaryOf(step: Step, spec: ShapeSpec, view: ShapeView): ReactNode {
  return {
    services: (
      <>
        <b>{spec.services.map((s) => s.name).join(" · ")}</b> · 시나리오 {view.scenarios}개
      </>
    ),
    ladders: (
      <>
        지금 모양:{" "}
        <b>
          {view.dotted.length > 0 ? `점선 ${view.dotted.length}층 포함` : "모두 흉내 낼 수 있어요"}
        </b>
      </>
    ),
    size: (
      <>
        세계 이름 <b>{spec.name}</b>
      </>
    ),
  }[step];
}

/** The bar's moves: 다음/이전 walk the screens (`short-flow`), and the last 다음 builds the world and starts the experiment. */
function useStepper(
  flow: Flow,
  make: () => Promise<Built | undefined>,
  quick: Start,
  onLeave: () => void,
) {
  const count = flow.spec.services.length;
  const at = { step: flow.step, ladder: flow.ladder };
  const startNow = async () => {
    const made = await make();
    if (made) await quick.run(made.worldId);
  };
  const go = (to: ReturnType<typeof advance> | ReturnType<typeof retreat>, leave: () => void) => {
    if (to === "make" || to === "leave") return leave();
    flow.setLadder(to.ladder);
    flow.go(to.step);
  };
  return {
    at,
    count,
    last: advance(at, count) === "make",
    startNow,
    onBack: () => go(retreat(at, count), onLeave),
    onNext: () => go(advance(at, count), () => void startNow()),
  };
}

function Problem({ text }: { readonly text: string | undefined }) {
  if (!text) return null;
  return (
    <p className="we-note" role="alert">
      {text}
    </p>
  );
}

/** Where the card of each added service came from, by key (the first one is IAP, "기본 제공"). */
function useMetas() {
  const [metas, setMetas] = useState<Readonly<Record<string, RowMeta>>>({});
  return {
    metas,
    setMeta: (key: string, meta: RowMeta) => setMetas((m) => ({ ...m, [key]: meta })),
  };
}

export function ShapeScreen({
  start,
  fromTemplate,
  startAt,
  startedFrom,
  onLeave,
}: {
  readonly start?: ShapeSpec;
  readonly fromTemplate: boolean;
  /** A template built "그대로" opens on the last screen. */
  readonly startAt?: Step;
  /** The template this world starts from, kept with the world so its popularity can count the start (REQ-101). */
  readonly startedFrom?: string;
  readonly onLeave: () => void;
}) {
  const flow = useShapeFlow(start, fromTemplate, startAt);
  const { spec } = flow;
  const view = useMemo(() => shapeView(spec), [spec]);
  const plan = useMemo(() => planShape(spec), [spec]);
  const problem = shapeProblem(spec);
  const { busy, built, error, make } = useMake(spec, startedFrom);
  const quick = useQuickStart(view.templateIds);
  const { metas, setMeta } = useMetas();
  const { last, onBack, onNext, startNow } = useStepper(flow, make, quick, onLeave);
  const sum = summaryOf(flow.step, spec, view);
  useShapeMoss({
    spec,
    flow,
    step: flow.step,
    last,
    problem,
    make: async () => void (await make()),
    quick: startNow,
  });
  if (built)
    return (
      <div className="we">
        <Done built={built} flow={flow} view={view} start={quick} />
      </div>
    );
  return (
    <div className="we" data-step={flow.step}>
      {flow.step === "services" && (
        <ServicesStep
          services={spec.services}
          scenarios={view.scenarios}
          metas={metas}
          onChange={flow.setServices}
          onMeta={setMeta}
        />
      )}
      {flow.step === "ladders" && <LaddersStep flow={flow} view={view} />}
      {flow.step === "size" && (
        <SizeStep
          services={spec.services}
          layers={spec.layers}
          plan={plan}
          servers={spec.servers}
          real={Boolean(spec.real)}
          onServers={flow.setServers}
          problem={problem}
        />
      )}
      <Problem text={error ?? quick.error} />
      <Bar
        flow={flow}
        sum={sum}
        busy={busy || quick.busy}
        onBack={onBack}
        onNext={onNext}
        nextLabel={last ? "실험 시작" : "다음"}
        nextDisabled={last ? problem : undefined}
        {...(last ? { onMake: () => void make() } : {})}
      />
    </div>
  );
}
