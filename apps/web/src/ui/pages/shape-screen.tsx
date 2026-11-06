/**
 * The three "서비스부터" screens in one page (ADR-0107): a bar at the foot says where you are and what the next press
 * does. The last screen builds the world, says what came of it in one line, and offers to keep the shape as a template.
 */
import type { ShapedResult } from "@terrarium/core/sources/worldgen";
import { planShape, type ShapeSpec, shapeProblem } from "@terrarium/core/sources/worldgen";
import { type ReactNode, useMemo, useState } from "react";
import { type ShapeView, shapeView, worldScale } from "../../logic";
import { messageOf, useApp } from "../context";
import { Button, TextField } from "../kit";
import { type Flow, STEPS, type Step, useShapeFlow } from "./shape-flow";
import { LaddersStep } from "./shape-ladders";
import { ServicesStep } from "./shape-services";
import { SizeStep } from "./shape-size";
import { WorkloadStep } from "./shape-workload";

interface Built {
  readonly worldId: string;
  readonly counts: ShapedResult["counts"];
}

function Done({
  built,
  flow,
  scenarios,
}: {
  readonly built: Built;
  readonly flow: Flow;
  readonly scenarios: number;
}) {
  const { api, navigate, toast } = useApp();
  const [name, setName] = useState(flow.spec.name);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    try {
      await api.call("generateWorld", {
        body: { shape: flow.spec, template: true, name: name.trim() || flow.spec.name },
      });
      setSaved(true);
      toast("템플릿으로 저장했어요. 새 세계 첫 화면에서 다시 쓸 수 있어요");
    } catch (err) {
      setError(messageOf(err));
    }
  };
  return (
    <>
      <output className="we-done">
        ✓ &nbsp;{worldScale.doneLine(built.counts, flow.spec.services, scenarios)}
      </output>
      <div className="we-save">
        <TextField label="템플릿 이름" value={name} onChange={setName} maxLength={80} />
        <Button disabled={saved} onClick={() => void save()}>
          {saved ? "템플릿으로 저장했어요" : "이 구성을 템플릿으로 저장"}
        </Button>
      </div>
      {error && (
        <p className="we-note" role="alert">
          {error}
        </p>
      )}
      <div className="we-bar">
        <span className="we-bar-sum">
          세계 이름 <b>{flow.spec.name}</b>
        </span>
        <span className="we-spacer" />
        <Button onClick={() => navigate({ name: "world", id: built.worldId })}>
          세계 둘러보기
        </Button>
        <Button
          kind="primary"
          onClick={() => navigate({ name: "newExperiment", worldId: built.worldId })}
        >
          바로 실험 만들기
        </Button>
      </div>
    </>
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
}) {
  return (
    <div className="we-bar">
      <span className="we-bar-sum">{props.sum}</span>
      <span className="we-spacer" />
      <Button kind="quiet" onClick={props.onBack}>
        이전
      </Button>
      <Button
        kind="primary"
        busy={props.busy}
        disabled={props.nextDisabled !== undefined}
        why={props.nextDisabled}
        onClick={props.onNext}
      >
        {props.nextLabel}
      </Button>
    </div>
  );
}

const NEXT: Readonly<Record<Step, Step | undefined>> = {
  services: "ladders",
  ladders: "work",
  work: "size",
  size: undefined,
};
const BACK: Readonly<Record<Step, Step | undefined>> = {
  services: undefined,
  ladders: "services",
  work: "ladders",
  size: "work",
};

/** Build the world the spec comes to, and keep what came of it. */
function useMake(spec: ShapeSpec) {
  const { api, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [built, setBuilt] = useState<Built>();
  const [error, setError] = useState<string>();
  const make = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api.call("generateWorld", { body: { shape: spec } });
      const world = saved.world;
      const counts = (world.provenance?.counts ?? {}) as ShapedResult["counts"];
      setBuilt({ worldId: world.id, counts });
      toast(`${world.name}을 만들었어요`);
    } catch (err) {
      setError(messageOf(err));
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
          {view.dotted.length > 0
            ? `점선 ${view.dotted.length}층 포함`
            : "모두 흉내 낼 수 있는 모양"}
        </b>
      </>
    ),
    work: <>일감을 정하고 나면 서버 수를 물어요</>,
    size: (
      <>
        세계 이름 <b>{spec.name}</b>
      </>
    ),
  }[step];
}

export function ShapeScreen({
  start,
  fromTemplate,
  startAt,
  onLeave,
}: {
  readonly start?: ShapeSpec;
  readonly fromTemplate: boolean;
  /** A template built "그대로" opens on the last screen. */
  readonly startAt?: Step;
  readonly onLeave: () => void;
}) {
  const flow = useShapeFlow(start, fromTemplate, startAt);
  const { spec } = flow;
  const view = useMemo(() => shapeView(spec), [spec]);
  const plan = useMemo(() => planShape(spec), [spec]);
  const problem = shapeProblem(spec);
  const { busy, built, error, make } = useMake(spec);
  const at = STEPS.indexOf(flow.step);
  const next = NEXT[flow.step];
  const back = BACK[flow.step];
  const sum = summaryOf(flow.step, spec, view);
  if (built)
    return (
      <div className="we">
        <Done built={built} flow={flow} scenarios={view.scenarios} />
      </div>
    );
  return (
    <div className="we" data-step={STEPS[at]}>
      {flow.step === "services" && (
        <ServicesStep
          services={spec.services}
          scenarios={view.scenarios}
          onChange={flow.setServices}
        />
      )}
      {flow.step === "ladders" && (
        <LaddersStep flow={flow} view={view} title={spec.services[0]?.name ?? "서비스"} />
      )}
      {flow.step === "work" && (
        <WorkloadStep services={spec.services} view={view} onChange={flow.setServices} />
      )}
      {flow.step === "size" && (
        <SizeStep
          services={spec.services}
          layers={spec.layers}
          plan={plan}
          servers={spec.servers}
          real={Boolean(spec.real)}
          onServers={flow.setServers}
          onServices={flow.setServices}
          problem={problem}
        />
      )}
      {error && (
        <p className="we-note" role="alert">
          {error}
        </p>
      )}
      <Bar
        flow={flow}
        sum={sum}
        busy={busy}
        onBack={() => (back ? flow.go(back) : onLeave())}
        onNext={() => (next ? flow.go(next) : void make())}
        nextLabel={next ? "다음" : "세계 만들기"}
        nextDisabled={next ? undefined : problem}
      />
    </div>
  );
}
