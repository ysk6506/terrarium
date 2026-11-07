/**
 * The new world page (REQ-094, ADR-0107): the first question with two doors, then either "서비스부터" (three screens) or the
 * builder from the land up. A template opens the same three screens already filled ("조금 바꿔서"), or builds as it is.
 * Opened lazily: the planner and the ladders it measures with stay out of the first screen.
 */
import type { ShapeSpec } from "@terrarium/core/sources/worldgen";
import type { Page } from "../../logic";
import { useMossScreen } from "../../moss";
import { useApp, useAsync, usePageTitle } from "../context";
import { Failure, Loading } from "../kit";
import { ShapeScreen } from "./shape-screen";
import { WorldEntry } from "./world-entry";

type NewWorld = Extract<Page, { name: "newWorld" }>;

function FromTemplate({ id, change }: { readonly id: string; readonly change: boolean }) {
  const { api, navigate } = useApp();
  const world = useAsync((signal) => api.call("getWorld", { params: { id }, signal }), [id]);
  if (world.error) return <Failure error={world.error} retry={world.reload} />;
  if (!world.data) return <Loading />;
  const shape = world.data.provenance?.shape as ShapeSpec | undefined;
  if (!shape) return <Failure error={new Error("이 템플릿에는 저장된 구성이 없어요")} />;
  return (
    <ShapeScreen
      start={{ ...shape, name: `${shape.name} 사본` }}
      fromTemplate
      startedFrom={id}
      {...(change ? {} : { startAt: "size" as const })}
      onLeave={() => navigate({ name: "newWorld" })}
    />
  );
}

export function NewWorldPage({ page }: { readonly page: NewWorld }) {
  const { navigate } = useApp();
  usePageTitle("새 세계");
  useMossScreen("newWorld", {
    run: {
      "world-ladders": () => {
        navigate({ name: "newWorld", door: "service" });
        return "서비스부터 정하는 길로 갈게요. 층마다 모양을 고르는 사다리가 나와요";
      },
    },
  });
  if (page.template) return <FromTemplate id={page.template} change={Boolean(page.change)} />;
  if (page.door === "service")
    return <ShapeScreen fromTemplate={false} onLeave={() => navigate({ name: "newWorld" })} />;
  return <WorldEntry onService={() => navigate({ name: "newWorld", door: "service" })} />;
}
