/**
 * Looking something up on behalf of a person (ADR-0174): the record, or "not found" when they may not see it. A thing
 * the viewer cannot see answers exactly as one that is not there, so nothing says that it exists. Runs, reports, diagnoses,
 * events, telemetry, exports, escalations and the streams follow the scope of their experiment (or, for a world's
 * activity, their world); they are looked up through the experiment or the world here and nowhere else.
 */
import type {
  Experiment,
  RunRecord,
  ScenarioRecord,
  ShareRecord,
  WorldRecord,
} from "@terrarium/core/experiments";
import { NotFoundError, withJosa } from "@terrarium/core/kernel";
import { must, type PlatformContext, type Viewer } from "./context";
import { canSee, mustSee, standing } from "./permissions";

export class Gate {
  constructor(private readonly ctx: PlatformContext) {}

  async world(viewer: Viewer, id: string): Promise<WorldRecord> {
    const world = must(await this.ctx.store.getWorld(id), `세계 ${id}`);
    mustSee(viewer, standing(world), `세계 ${id}`, { kind: "world", id, name: world.name });
    return world;
  }

  async scenario(viewer: Viewer, id: string): Promise<ScenarioRecord> {
    const scenario = must(await this.ctx.store.getScenario(id), `시나리오 ${id}`);
    mustSee(viewer, standing(scenario), `시나리오 ${id}`, {
      kind: "scenario",
      id,
      name: scenario.name,
    });
    return scenario;
  }

  async experiment(viewer: Viewer, id: string): Promise<Experiment> {
    const experiment = must(await this.ctx.store.getExperiment(id), `실험 ${id}`);
    mustSee(viewer, standing(experiment), `실험 ${id}`, {
      kind: "experiment",
      id,
      name: experiment.name,
    });
    return experiment;
  }

  /** Whether the experiment is there and the person may see it (for lists that follow an experiment's scope). */
  async canSeeExperiment(viewer: Viewer, id: string): Promise<boolean> {
    const experiment = await this.ctx.store.getExperiment(id);
    return experiment !== undefined && canSee(viewer, standing(experiment));
  }

  /** A run, through the experiment it belongs to. */
  async run(viewer: Viewer, id: string): Promise<{ run: RunRecord; experiment: Experiment }> {
    const run = must(await this.ctx.store.getRun(id), `실행 ${id}`);
    const experiment = await this.experiment(viewer, run.experimentId).catch(() => {
      throw new NotFoundError(`${withJosa(`실행 ${id}`, "을")} 찾을 수 없어요`);
    });
    return { run, experiment };
  }

  /** A share link, through its experiment: the people who may see the experiment may find out about its links' makers. */
  async share(
    viewer: Viewer,
    token: string,
  ): Promise<{ share: ShareRecord; experiment: Experiment }> {
    const share = must(await this.ctx.store.getShare(token), "공유 링크");
    const experiment = await this.experiment(viewer, share.experimentId).catch(() => {
      throw new NotFoundError("공유 링크를 찾을 수 없어요");
    });
    return { share, experiment };
  }
}
