import { z } from "zod";
import { credential, credentialFields } from "../connectors/credential";
import { EnvName, Url } from "../connectors/fields";
import { ClickStackAdapter } from "./clickstack";
import { defineTelemetry } from "./types";

const schema = z
  .object({
    kind: z.literal("clickstack"),
    url: Url,
    database: z.string().min(1).max(100).default("default"),
    user: z.string().min(1).max(100).default("default"),
    passwordEnv: EnvName.optional(),
    tracesTable: z.string().min(1).max(100).default("otel_traces"),
    logsTable: z.string().min(1).max(100).default("otel_logs"),
  })
  .strict();

/** ClickStack as the form asks for it: one flat list of settings. */
export const clickStackKind = defineTelemetry({
  spec: {
    kind: "clickstack",
    label: "ClickStack",
    description:
      "하네스의 트레이스가 ClickStack(ClickHouse)에 쌓일 때 골라요. 모델 호출, 토큰, 모델이 답한 시간을 실행 결과에 더해요.",
    key: "하네스가 실행마다 받는 traceparent의 트레이스 번호로 찾아요. 하네스가 자기 번호를 쓰면 스팬의 run_id 속성으로 찾아요.",
    fields: [
      {
        key: "url",
        label: "ClickHouse 주소",
        type: "url",
        required: true,
        placeholder: "http://clickhouse.internal:8123",
        help: "ClickHouse의 HTTP 주소예요. 보통 8123 포트예요.",
      },
      { key: "user", label: "사용자", type: "text", default: "default" },
      ...credentialFields("password", "비밀번호", "CLICKHOUSE_PASSWORD"),
      { key: "database", label: "데이터베이스", type: "text", default: "default", advanced: true },
      {
        key: "tracesTable",
        label: "트레이스 테이블",
        type: "text",
        default: "otel_traces",
        advanced: true,
      },
      {
        key: "logsTable",
        label: "로그 테이블",
        type: "text",
        default: "otel_logs",
        advanced: true,
      },
    ],
  },
  schema,
  create: (config, ctx) =>
    new ClickStackAdapter(
      {
        kind: "clickstack",
        name: "ClickStack",
        url: config.url,
        database: config.database,
        user: config.user,
        ...(config.passwordEnv ? { passwordEnv: config.passwordEnv } : {}),
        tables: { traces: config.tracesTable, logs: config.logsTable },
      },
      credential(ctx, "password", config.passwordEnv),
      ctx.fetch,
    ),
});
