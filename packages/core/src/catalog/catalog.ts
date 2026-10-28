import { ConflictError, InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import { BUILTIN_MODELS, DEFAULT_MODEL_BY_KIND } from "./builtin";
import type { EquipmentModel, ModelKind } from "./models";

type ModelOf<K extends ModelKind> = Extract<EquipmentModel, { kind: K }>;

/** The equipment models a world may use. Built-ins plus any custom models registered at runtime. */
export class Catalog {
  private readonly models = new Map<string, EquipmentModel>();

  constructor(models: readonly EquipmentModel[] = BUILTIN_MODELS) {
    for (const model of models) this.register(model);
  }

  register(model: EquipmentModel): void {
    if (this.models.has(model.id))
      throw new ConflictError(`model ${model.id} is already registered`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(model.id))
      throw new InvalidValueError(`model id ${model.id} must be lower-case kebab-case`);
    this.models.set(model.id, model);
  }

  has(id: string): boolean {
    return this.models.has(id);
  }

  get(id: string): EquipmentModel {
    const model = this.models.get(id);
    if (!model) throw new NotFoundError(`unknown equipment model '${id}'`);
    return model;
  }

  /** A model of the given kind, or a NotFoundError naming what was expected. */
  getOf<K extends ModelKind>(id: string, kind: K): ModelOf<K> {
    const model = this.get(id);
    if (model.kind !== kind)
      throw new InvalidValueError(`model '${id}' is a ${model.kind}, expected ${kind}`);
    return model as ModelOf<K>;
  }

  list(kind?: ModelKind): EquipmentModel[] {
    return [...this.models.values()]
      .filter((m) => kind === undefined || m.kind === kind)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Map a model name found in an import (e.g. "PowerEdge R760") to a known model: exact id, then a
   * case-insensitive name match, then the default for the kind. Returns whether it was a guess.
   */
  resolve(kind: ModelKind, hint: string | undefined): { model: EquipmentModel; guessed: boolean } {
    if (hint) {
      if (this.models.has(hint) && this.get(hint).kind === kind)
        return { model: this.get(hint), guessed: false };
      const lowered = hint.toLowerCase();
      const byName = this.list(kind).find((m) => m.name.toLowerCase() === lowered);
      if (byName) return { model: byName, guessed: false };
    }
    return { model: this.get(DEFAULT_MODEL_BY_KIND[kind]), guessed: true };
  }
}
