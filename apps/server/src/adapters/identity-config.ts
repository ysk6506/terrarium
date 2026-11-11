/**
 * The `identity` block of the config file (ADR-0174). With `header`, the server believes the company's SSO
 * proxy: the header names the signed-in login, and the proxy proves it is the proxy with a shared secret
 * (kept in the environment, never in this file). Without `header`, people type their own name, which is for one
 * person developing locally. Administrators come from a list of logins or an SSO group; in the typed-name
 * mode, only from an admin token the environment holds (ADR-0152).
 */
import { z } from "zod";
import { EnvName } from "./connectors/fields";

/** An HTTP header name, lower-cased as Node hands it over. */
const HeaderName = z
  .string()
  .toLowerCase()
  .regex(/^[a-z0-9-]{1,80}$/, "헤더 이름은 영문 소문자·숫자·-만 써요");

export const IdentitySchema = z
  .object({
    /** Header the SSO proxy sets with the login id; setting it turns the proxy mode on. */
    header: HeaderName.optional(),
    /** Environment variable that holds the secret the proxy sends with every request. Required in the proxy mode. */
    proxySecretEnv: EnvName.optional(),
    /** Header the proxy sends the secret in. */
    secretHeader: HeaderName.default("x-terrarium-proxy-secret"),
    /** Header with the name to show (the login id is shown when there is none). */
    nameHeader: HeaderName.optional(),
    /** Header with the SSO groups, separated by commas. */
    groupsHeader: HeaderName.optional(),
    /** Proxy mode: logins that are administrators. */
    admins: z.array(z.string().min(1).max(100)).max(200).default([]),
    /** Proxy mode: whoever is in this SSO group is an administrator. */
    adminGroup: z.string().min(1).max(100).optional(),
    /** Typed-name mode: environment variable that holds the admin token. Without it nobody is an administrator. */
    adminTokenEnv: EnvName.optional(),
    /** Typed-name mode: header the admin token is sent in. */
    adminTokenHeader: HeaderName.default("x-terrarium-admin-token"),
  })
  .strict()
  .default({});

export type IdentityConfig = z.output<typeof IdentitySchema>;
