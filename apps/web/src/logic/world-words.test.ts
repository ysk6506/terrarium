/**
 * 글 잣대 검사 (REQ-077, ADR-0083, 용어집): the words a person reads while making a world are held to the style
 * rules, so a sentence written later cannot slip back into "장애", "데이터 홀" or a stack of "~할 수 있어요".
 */
import { Catalog } from "@terrarium/core/catalog";
import { SITE_PRESETS } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { builder, experiment, howWords, SETTING_DEFS } from ".";
import { nextStep, TOUR_STEPS, tourLabel } from "./next-step";
import {
  DETAIL_GROUPS,
  makeLabel,
  POWER_CHOICES,
  SCALE_LABELS,
  STAGES,
  scaleChoices,
} from "./worldgen-scale";

const catalog = new Catalog();
const small = builder.smallStart({ name: "내 사업장", siteName: "내 사업장" }, catalog);
const view: builder.ToolView = { buildings: 0, forSale: 4, rooms: 0, roomFull: true };

/** Everything a person reads, as data. */
function dataTexts(): string[] {
  const index = new BlueprintIndex(small);
  const room = index.ofKind("room")[0]?.id ?? "";
  const levels: builder.Level[] = [
    { kind: "site" },
    { kind: "floor", id: "f" },
    { kind: "room", id: room },
  ];
  const cards = [{ kind: "site" }, { kind: "room", id: room }].flatMap((level) => {
    const card = builder.describePick(
      small,
      index,
      catalog,
      level as builder.Level,
      undefined,
      false,
    );
    return [card.name, card.status, card.primary?.label ?? "", card.primary?.why ?? ""];
  });
  const scales = SITE_PRESETS.flatMap((p) => [
    makeLabel(p.id),
    ...scaleChoices(p.id).flatMap((c) => [c.label, c.about, c.result]),
  ]);
  return [
    ...levels.flatMap((l) => builder.bundleTexts(builder.toolsFor(l, catalog, view))),
    ...levels.flatMap((l) =>
      builder.bundleTexts(builder.toolsFor(l, catalog, { ...view, roomFull: false, rooms: 2 })),
    ),
    ...howWords.howTexts(),
    ...Object.values(SCALE_LABELS),
    ...scales,
    ...STAGES,
    ...DETAIL_GROUPS.flatMap((g) => [g.title, ...g.fields.flatMap((f) => [f.label, f.help])]),
    ...POWER_CHOICES.map((p) => p.label),
    nextStep(index, false).label,
    ...TOUR_STEPS.map((_, i) => tourLabel(i)),
    ...cards,
    ...builder
      .hudItems(builder.levelStats(index, catalog, { kind: "site" }))
      .map((i) => `${i.label} ${i.value}`),
    ...SETTING_DEFS.flatMap((d) => [d.label, d.help, ...d.options.map((o) => o.label)]),
    builder.saveStatus(
      { mine: true, dirty: false, saving: false, errors: 0 },
      "2026-11-06T09:00:00Z",
      Date.now(),
    ),
    "곧 저장돼요",
  ];
}

interface ImportMetaGlob {
  glob(patterns: string[], options: object): unknown;
}

const SCREENS = [
  "ui/pages/new-world.tsx",
  "ui/pages/world-forms.tsx",
  "ui/pages/world-details.tsx",
  "ui/pages/new-site-form.tsx",
  "ui/pages/settings.tsx",
  "ui/builder/NextChip.tsx",
  "ui/builder/PickCard.tsx",
  "ui/builder/Toolbox.tsx",
  "ui/builder/BuilderBar.tsx",
  "ui/builder/Inspector.tsx",
  "ui/builder/FillPanel.tsx",
  "ui/pages/experiment-steps.tsx",
];

/** The source of every screen the check reads (vite hands it over as text; the list is the same as SCREENS). */
const SOURCES = (import.meta as unknown as ImportMetaGlob).glob(
  [
    "../ui/pages/new-world.tsx",
    "../ui/pages/world-forms.tsx",
    "../ui/pages/world-details.tsx",
    "../ui/pages/new-site-form.tsx",
    "../ui/pages/settings.tsx",
    "../ui/builder/NextChip.tsx",
    "../ui/builder/PickCard.tsx",
    "../ui/builder/Toolbox.tsx",
    "../ui/builder/BuilderBar.tsx",
    "../ui/builder/Inspector.tsx",
    "../ui/builder/FillPanel.tsx",
    "../ui/pages/experiment-steps.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** The Korean sentences written in a screen's source: the text between tags and the string props. */
function screenTexts(file: string): string[] {
  const source = (SOURCES[`../${file}`] ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const jsx = [...source.matchAll(/>([^<>{}]*[가-힣][^<>{}]*)</g)].map((m) => m[1] ?? "");
  const strings = [
    ...source.matchAll(/(["`])((?:(?!\1)[^\\\n]|\\.)*[가-힣](?:(?!\1)[^\\\n]|\\.)*)\1/g),
  ].map((m) => m[2] ?? "");
  return [...jsx, ...strings].map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/장애/, '"장애" 대신 "고장"이나 "문제"'],
  [/데이터 ?홀/, '"데이터 홀" 대신 "서버룸"'],
  [/먹이는 설비|식히는 설비/, '"먹이는/식히는 설비" 대신 "전기/냉방"'],
  [/타일/, "타일 수는 보이지 않는다(㎡만)"],
  [/상세 모델링/, "성능 손잡이는 화면에 없다"],
  [/\bseed\b|시드/, '"시드" 대신 "같은 세계 다시 만들기 번호"'],
  [/\d{4,}(?![\d,]*\s*(?:px|ms|%))/, "네 자리 이상 숫자는 쉼표를 찍는다"],
  [
    /[「“"'‘][가-힣 ]{2,12}[」”"'’] ?(?:버튼|을 누르|를 누르)/,
    "따옴표 속 버튼 이름 대신 버튼이 있는 자리를 말한다",
  ],
];

function problems(text: string): string[] {
  const found = FORBIDDEN.filter(([rule]) => rule.test(text)).map(([, why]) => why);
  if ((text.match(/수 있어요/g) ?? []).length > 1) found.push('"~할 수 있어요"를 겹쳐 쓰지 않는다');
  if (/수 있어요[^.]*수 있어요/.test(text)) found.push('"~할 수 있어요"가 한 문장에 둘');
  return found;
}

describe("글 잣대: 해요체, 숫자와 단위, 시스템 말 금지, 버튼은 결과 [REQ-077]", () => {
  test("the words that come from data pass every rule", () => {
    const bad = dataTexts().flatMap((t) => problems(t).map((why) => `${t} → ${why}`));
    expect(bad).toEqual([]);
  });

  test("the experiment form starts on the recommended number of runs, and says the range when it is out", () => {
    expect(experiment.emptyDraft().runs).toBe(howWords.RECOMMENDED_RUNS);
    expect(howWords.RUNS_RECOMMEND).toBe("권장 5번");
    expect(howWords.runsRange(20)).toBe("몇 번 돌릴지는 1~20번 사이로 정해 주세요");
    expect(howWords.RUNS_HELP).toMatch(
      /^같은 시나리오를 여러 번 돌리면 운이 아니라 실력인지 알 수 있어요\./,
    );
  });

  test("the rules catch what they are for", () => {
    expect(problems("장비 장애가 났어요")).toHaveLength(1);
    expect(problems("데이터 홀 3개")).toHaveLength(1);
    expect(problems("랙 10502대")).toHaveLength(1);
    expect(problems("랙 10,502대")).toEqual([]);
    expect(problems("눌러서 볼 수 있어요. 고칠 수 있어요")).toHaveLength(1);
    expect(problems('"채우기" 버튼을 누르세요')).toHaveLength(1);
    expect(problems("서버룸 채우기")).toEqual([]);
  });

  test.each(SCREENS)("the words written in %s pass every rule", (file) => {
    expect(screenTexts(file).length).toBeGreaterThan(1);
    const bad = screenTexts(file).flatMap((t) => problems(t).map((why) => `${t} → ${why}`));
    expect(bad).toEqual([]);
  });

  test("a sentence about a thing ends in 요 and has one fact: no run-on with a middle dot of two sentences", () => {
    const sentences = [
      ...howWords.howTexts(),
      ...DETAIL_GROUPS.flatMap((g) => g.fields.map((f) => f.help)),
    ];
    for (const text of sentences.filter((t) => t.length > 14)) {
      expect(text.trim()).toMatch(/요\.?$|있어요$|[가-힣]$/);
      expect(text.split(/[.]/).filter((s) => s.trim()).length).toBeLessThanOrEqual(3);
    }
  });

  test("a button says what it does: the big buttons and the main ones end in the result", () => {
    const mains = [
      "건물 올리기",
      "서버룸 만들기",
      "랙 놓기",
      "냉방기 놓기",
      "서버룸 채우기",
      "서버룸 넓히기",
      "돌려 보기",
      "작은 사업장 만들기",
      makeLabel("hwaseong"),
    ];
    for (const label of mains) expect(label).not.toMatch(/^(만들기|확인|저장|생성하기|적용)$/);
    expect(mains.every((l) => /[가-힣]/.test(l))).toBe(true);
  });
});
