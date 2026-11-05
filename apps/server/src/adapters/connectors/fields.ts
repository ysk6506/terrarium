/** The pieces every connector's settings are built from. */
import { z } from "zod";

export const Id = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
export const Url = z.string().url();
/** Name of an environment variable that holds a secret; the secret itself never sits in a file or a form. */
export const EnvName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
export const Description = z.string().max(300).default("");

/** The part of every connector's settings that says which one it is and what it is called. */
export const base = <K extends string>(kind: K) => ({
  kind: z.literal(kind),
  id: Id,
  name: z.string(),
  description: Description,
});
