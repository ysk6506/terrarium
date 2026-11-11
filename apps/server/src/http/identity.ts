/**
 * Who is asking, as a slot (REQ-033, ADR-0044, ADR-0174). Every route asks one `Authenticator`; which one is a
 * choice made once, at start. Two are built in: the company's SSO proxy, which the server believes only when it
 * sends its shared secret, and a name people type when there is no proxy, which is for one person developing
 * locally. A sign-in the server checks itself (OIDC, SAML, a bearer token from the company's identity provider)
 * is a third that plugs into the same slot and changes nothing else: write the class, return it from
 * `authenticatorOf`, give it a place in the `identity` settings.
 *
 * Out of its reach on purpose: the per-run tool endpoints (`/mcp/runs/:runId/:token`) and shared report
 * links (`/r/:token`). Their secret is in the address, and the programs and people who use them have no
 * browser session to sign in with.
 */
import type { IncomingHttpHeaders } from "node:http";
import { UnauthenticatedError } from "@terrarium/core/contract";
import { InvalidValueError, josa } from "@terrarium/core/kernel";
import type { FastifyInstance } from "fastify";
import type { IdentityConfig } from "../adapters";
import type { Viewer } from "../runtime";
import { type IdentitySettings, proxyViewer, selfViewer } from "./viewer";

/** What an authenticator may look at. Headers carry cookies and bearer tokens alike. */
export interface AuthRequest {
  readonly headers: IncomingHttpHeaders;
}

export type IdentityMode = "proxy" | "self-declared";

export interface Authenticator {
  /** Names the method in logs and settings. */
  readonly kind: string;
  /** Whether the method believes a proxy or a typed name. A method that checks a sign-in itself counts as `proxy`. */
  readonly mode?: IdentityMode;
  /**
   * The person asking. Throws `UnauthenticatedError` (401) when the method does not know the caller, or
   * `UnavailableError` (503) when the identity provider cannot be reached. Only the typed-name method lets a
   * caller who said nothing through (as `ANONYMOUS`), because it keeps nobody out. May be asynchronous:
   * checking a token may mean fetching the provider's keys.
   */
  authenticate(req: AuthRequest): Viewer | Promise<Viewer>;
  /** Routes of the sign-in flow itself (the provider's callback, logout), added to the server once. */
  mount?(app: FastifyInstance): void;
}

export const modeOf = (auth: Authenticator): IdentityMode =>
  auth.mode ?? (auth.kind === "self-declared" ? "self-declared" : "proxy");

/** The two methods that need no more than the request's headers (ADR-0028, ADR-0174). */
export function headerAuthenticator(settings: IdentitySettings): Authenticator {
  if (!settings.header)
    return {
      kind: "self-declared",
      mode: "self-declared",
      authenticate: (req) => selfViewer(req.headers, settings),
    };
  return {
    kind: "proxy-header",
    mode: "proxy",
    authenticate(req) {
      const viewer = proxyViewer(req.headers, settings);
      // The same words for every reason: a caller learns nothing about which part was wrong.
      if (!viewer) throw new UnauthenticatedError("로그인이 필요해요");
      return viewer;
    },
  };
}

function secretOf(env: NodeJS.ProcessEnv, name: string | undefined): string | undefined {
  return name === undefined ? undefined : env[name];
}

/** The proxy mode needs the shared secret; without it any caller could say who they are, so the server does not start. */
function proxyProblem(identity: IdentityConfig, secret: string | undefined): string | undefined {
  const { header, proxySecretEnv } = identity;
  if (!header) return undefined;
  if (proxySecretEnv === undefined)
    return (
      `problem: 프록시 방식(identity.header: ${header})인데 프록시의 비밀 값을 어디서 읽을지 정하지 않았어요. ` +
      "fix: identity.proxySecretEnv에 비밀 값이 든 환경 변수의 이름을 적으세요. 비밀 값 자체는 설정 파일에 적지 않아요."
    );
  if (secret === undefined || secret === "")
    return (
      `problem: 프록시 방식인데 환경 변수 ${proxySecretEnv}${josa(proxySecretEnv, "이")} 없거나 비어 있어요. ` +
      `fix: 환경 변수 ${proxySecretEnv}에 프록시와 나눌 비밀 값을 넣고 다시 시작하세요.`
    );
  return undefined;
}

/** The settings the viewer readers use: the config's `identity` block with the secrets read from the environment. */
export function settingsOf(identity: IdentityConfig, env: NodeJS.ProcessEnv): IdentitySettings {
  const secret = secretOf(env, identity.proxySecretEnv);
  const problem = proxyProblem(identity, secret);
  if (problem) throw new InvalidValueError(problem);
  const adminToken = secretOf(env, identity.adminTokenEnv);
  if (!identity.header && identity.adminTokenEnv && !adminToken)
    throw new InvalidValueError(
      `problem: 환경 변수 ${identity.adminTokenEnv}${josa(identity.adminTokenEnv, "이")} 없거나 비어 있어요 (identity.adminTokenEnv가 이 이름을 가리켜요). ` +
        `fix: 환경 변수 ${identity.adminTokenEnv}에 관리자 토큰을 넣거나, identity.adminTokenEnv를 지우세요. 지우면 관리자는 없어요.`,
    );
  return {
    ...identity,
    // the typed-name mode has no way to prove who is on the list, so only a token makes an administrator there
    admins: identity.header ? identity.admins : [],
    ...(secret ? { secret } : {}),
    ...(adminToken && !identity.header ? { adminToken } : {}),
  };
}

/** The method the settings ask for. The one place a new method is added to. */
export function authenticatorOf(
  identity: IdentityConfig,
  env: NodeJS.ProcessEnv = process.env,
): Authenticator {
  return headerAuthenticator(settingsOf(identity, env));
}
