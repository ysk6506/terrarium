/**
 * The name a person gave, kept in this browser (ADR-0028). Storage can be missing or refuse (private
 * windows, blocked site data), so every access is guarded; without storage the name lasts the visit.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = "terrarium.user";
const NAME = /^[^\p{Cc}\s][^\p{Cc}]{0,39}$/u;

/** Why a name cannot be used, or undefined when it can. */
export function nameProblem(raw: string): string | undefined {
  const name = raw.trim();
  if (name === "") return "이름을 적어 주세요";
  if (name.length > 40) return "40자 이하로 적어 주세요";
  if (!NAME.test(name)) return "줄바꿈이나 제어 문자는 쓸 수 없어요";
  return undefined;
}

export class Identity {
  private memory: string | undefined;

  constructor(private readonly store: KeyValueStore | undefined) {}

  get name(): string | undefined {
    if (this.memory !== undefined) return this.memory;
    try {
      const saved = this.store?.getItem(KEY) ?? undefined;
      this.memory = saved && !nameProblem(saved) ? saved : undefined;
    } catch {
      this.memory = undefined;
    }
    return this.memory;
  }

  set(raw: string): void {
    const problem = nameProblem(raw);
    if (problem) throw new Error(problem);
    this.memory = raw.trim();
    try {
      this.store?.setItem(KEY, this.memory);
    } catch {
      // kept for this visit only
    }
  }

  forget(): void {
    this.memory = undefined;
    try {
      this.store?.removeItem(KEY);
    } catch {
      // nothing to forget
    }
  }
}
