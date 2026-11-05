import { z } from "zod";
import { ScriptedHarness } from "../harness/scripted";
import { base } from "./fields";
import { defineConnector } from "./types";

const schema = z
  .object({ ...base("scripted"), name: z.string().default("내장 기준 에이전트") })
  .strict();

/** The rule-based baseline agents that ship with Terrarium. Always there; nothing to fill in. */
export const scriptedConnector = defineConnector({
  spec: {
    kind: "scripted",
    label: "내장 기준 에이전트",
    description:
      "테라리움에 들어 있는 규칙 기반 에이전트. 다른 에이전트와 비교할 바닥과 잣대가 돼요.",
    scope: "harness",
    toolTransport: "in-process",
    toolGuide: ["테라리움 안에서 직접 툴을 써요. 따로 할 일이 없어요."],
    fields: [],
    fromScreen: false,
  },
  schema,
  connect: (config) => new ScriptedHarness(config.id, config.name),
});
