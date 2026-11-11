/**
 * Who may see a record, in the requests and the views (ADR-0174, permissions.md section 3). A body that makes or changes
 * something may carry `scope` and `group`; the server refuses a `group` scope without a group the person belongs to.
 */
import { SCOPES, type Scope } from "@terrarium/core/experiments";
import { z } from "zod";

/** The two fields a create or update body may carry. Left out on create: the resource's usual default. */
export const ScopeFields = {
  scope: z.enum(SCOPES).optional(),
  /** The group (one of the person's own) a `group` scope is shared with. */
  group: z.string().trim().min(1).max(100).optional(),
};

/** Changing only who can see an experiment. */
export const ScopeBody = z.object({ scope: z.enum(SCOPES), group: ScopeFields.group }).strict();
export type ScopeRequest = z.output<typeof ScopeBody>;

/** What a view of a connection or model says about who sees it (their own `scope` field means something else on a connection). */
export interface SharingView {
  readonly scope: Scope;
  readonly group?: string;
  /** Whether the person asking may change it: the maker and admins. */
  readonly canChange: boolean;
}
