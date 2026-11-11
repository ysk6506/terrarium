/**
 * The list of services of a world in progress (REQ-111, ADR-0134): any of them may be taken out, IAP too, so a person's own
 * card can go through the ladders and the sizing alone. These are the pure pieces the screens follow.
 */
import { withJosa } from "@terrarium/core/kernel";
import { DEFAULT_SHAPE, type ServiceDraft } from "@terrarium/core/sources/worldgen";

/** The list without service `i`, and without the calls that led to it. */
export function removeService(list: readonly ServiceDraft[], i: number): ServiceDraft[] {
  const gone = list[i]?.key;
  return list
    .filter((_, k) => k !== i)
    .map((s) => {
      if (!s.calls?.includes(gone as string)) return s;
      const { calls, ...rest } = s;
      const kept = calls.filter((c) => c !== gone);
      return kept.length > 0 ? { ...rest, calls: kept } : rest;
    });
}

/** What the second screen asks about the service at `at` of `count` ("웹 API는 어떻게 돌리나요?" · "서비스 1 / 1"). */
export function ladderHead(
  name: string,
  at: number,
  count: number,
): { readonly title: string; readonly badge: string } {
  return {
    title: `${withJosa(name, "는")} 어떻게 돌리나요?`,
    badge: `서비스 ${at + 1} / ${count}`,
  };
}

/** Why the first screen cannot go on, or undefined: a world needs at least one service. */
export const noServicesReason = (count: number): string | undefined =>
  count === 0 ? "서비스를 하나는 골라야 다음으로 갈 수 있어요" : undefined;

/**
 * The name a world gets while its name has not been touched: "IAP 실험용" belongs to IAP, so a world without IAP is named
 * after its first service ("내 정산 웹 실험용"). A name the person typed, or a template's, stays.
 */
export function worldNameFor(
  name: string,
  services: ReadonlyArray<Pick<ServiceDraft, "key" | "name">>,
): string {
  const head = services[0];
  if (name !== DEFAULT_SHAPE.name || !head || head.key === "iap") return name;
  return `${head.name} 실험용`;
}
