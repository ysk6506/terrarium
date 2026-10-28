/** Error types shared by every unit. Each carries a stable `code` for API responses. */
export class TerrariumError extends Error {
  readonly code: string = "terrarium_error";
  /** HTTP status the server should use when this error reaches a client. */
  readonly status: number = 500;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** An argument or stored value breaks a rule (bad id, out-of-range number, ...). */
export class InvalidValueError extends TerrariumError {
  override readonly code = "invalid_value";
  override readonly status = 400;
}

/** A referenced entity, model, scenario or experiment does not exist. */
export class NotFoundError extends TerrariumError {
  override readonly code = "not_found";
  override readonly status = 404;
}

/** The request is valid but conflicts with current state (duplicate id, wrong lifecycle state). */
export class ConflictError extends TerrariumError {
  override readonly code = "conflict";
  override readonly status = 409;
}

/** The operation is not supported by this profile, model, source or capability set. */
export class UnsupportedError extends TerrariumError {
  override readonly code = "unsupported";
  override readonly status = 422;
}

/** Something tried to write to reality. Terrarium only ever reads real systems (REQ-011). */
export class ReadOnlyViolationError extends TerrariumError {
  override readonly code = "read_only_violation";
  override readonly status = 403;
}

/** Normalize anything thrown into a TerrariumError (unknown errors keep their message). */
export function asTerrariumError(error: unknown): TerrariumError {
  if (error instanceof TerrariumError) return error;
  return new TerrariumError(error instanceof Error ? error.message : String(error));
}
