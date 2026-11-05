/** Tokens and passwords of a connection: typed on the screen, or the name of a variable the server has. */
import type { ConnectorField } from "@terrarium/core/contract";
import { secret } from "../secret";
import type { ConnectContext } from "./types";

/**
 * The credential called `key`: the one typed on the screen, else the one in the named environment variable,
 * else none. Naming a variable the server lacks is an error that says which one.
 */
export function credential(
  ctx: ConnectContext,
  key: string,
  envName: string | undefined,
): string | undefined {
  return ctx.secrets?.[key] ?? secret(ctx.env, envName);
}

/** The two fields of a form that stand for one credential: type it, or point at a variable. */
export function credentialFields(
  key: string,
  label: string,
  envPlaceholder: string,
  help?: string,
): ConnectorField[] {
  return [
    {
      key,
      label,
      type: "secret",
      help: help ?? "입력하면 서버에 암호화해서 저장하고, 저장한 뒤에는 다시 보여 주지 않아요.",
    },
    {
      key: `${key}Env`,
      label: `또는 서버 환경 변수 이름`,
      type: "env",
      advanced: true,
      placeholder: envPlaceholder,
      help: `${label}을 직접 쓰는 대신, 서버를 관리하는 사람이 환경 변수로 넣어 둔 것을 가리켜요. 둘 중 하나만 써요.`,
    },
  ];
}
