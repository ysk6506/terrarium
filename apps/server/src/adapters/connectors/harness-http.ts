import { z } from "zod";
import { HttpHarness } from "../harness/http";
import { credential, credentialFields } from "./credential";
import { base, EnvName, Url } from "./fields";
import { defineConnector } from "./types";

export const HttpHarnessSchema = z
  .object({
    ...base("http"),
    /** Base URL of a harness speaking the Terrarium harness protocol (docs/design-docs/harness-protocol.md). */
    url: Url,
    tokenEnv: EnvName.optional(),
    telemetry: z.enum(["clickstack", "none"]).default("none"),
    pollSeconds: z.number().min(0.05).max(60).default(2),
  })
  .strict();

export type HttpHarnessConfig = z.output<typeof HttpHarnessSchema>;

/** A harness that speaks the Terrarium harness protocol over HTTP; its agents are discovered from `GET /agents`. */
export const harnessHttpConnector = defineConnector({
  spec: {
    kind: "http",
    label: "직접 만든 하네스 (테라리움 규격)",
    description:
      "테라리움이 정한 규격(에이전트 목록·실행 시작·상태·중지 엔드포인트 네 개)을 직접 구현한 하네스용이에요. LangGraph, OpenCode, OpenClaw 같은 기존 하네스는 위의 전용 연결을 써요.",
    scope: "harness",
    toolTransport: "mcp",
    toolGuide: [
      "시작 요청의 tools.mcpUrl 에 이 실행 전용 툴 주소가, tools.specs 에 툴 목록이 들어 있어요.",
      "하네스가 테라리움 서버 주소에 연결할 수 있어야 해요. 테라리움 주소가 localhost이면 서버 설정의 publicUrl 을 바꿔 주세요.",
    ],
    fromScreen: true,
    fields: [
      {
        key: "url",
        label: "하네스 주소",
        type: "url",
        required: true,
        placeholder: "https://harness.internal",
        help: "하네스의 기본 주소. 여기에 /agents, /runs를 붙여 불러요.",
      },
      ...credentialFields("token", "토큰", "HARNESS_TOKEN"),
      {
        key: "telemetry",
        label: "관측 데이터",
        type: "select",
        default: "none",
        options: [
          { value: "none", label: "없음" },
          { value: "clickstack", label: "ClickStack에서 읽을 수 있어요" },
        ],
        help: "하네스의 trace가 ClickStack에 쌓이면 분석에 토큰·모델 시간을 더해요.",
      },
      {
        key: "pollSeconds",
        label: "상태를 묻는 간격(초)",
        type: "number",
        default: 2,
      },
    ],
  },
  schema: HttpHarnessSchema,
  connect: (config, ctx) =>
    new HttpHarness(config, credential(ctx, "token", config.tokenEnv), ctx.fetch),
});
