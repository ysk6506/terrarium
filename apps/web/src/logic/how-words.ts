/**
 * 실험 만들기 3단계의 말 (REQ-077, 베타 피드백 10): every choice has one line that says why it is there, the choice
 * the product recommends is marked "권장", and what only an expert changes is folded under "고급 설정". The words are
 * kept here, apart from the screen, so a test can hold them to the style rules in the glossary.
 */
import { MIN_SEEDS_TO_RANK } from "@terrarium/core/analysis";
import { MAX_REPEATS } from "@terrarium/core/experiments";
import type { ToolCategory } from "@terrarium/core/tools";
import { toolTexts } from "./tool-words";

/** How many times a scenario is run when nobody says: enough to tell skill from luck, still quick. */
export const RECOMMENDED_RUNS = 5;
/** The fewest different situations that put an experiment on a benchmark's ranking. */
export const RANKING_SITUATIONS = MIN_SEEDS_TO_RANK;
/** How many times a seed is run when nobody says: the experiment looks as it always did. */
export const DEFAULT_REPEATS = 1;
/** The quick choices of how many times a seed is run. */
export const REPEAT_CHOICES: readonly number[] = [1, 3, 5];

export const RUNS_LABEL = "서로 다른 상황을 몇 개 돌릴까요";
export const RUNS_HELP = `상황이 다르면 고장이 나는 때와 사람들이 답하는 시간이 달라져요. ${RANKING_SITUATIONS}개부터 벤치마크 순위에 올라요.`;
export const RUNS_RECOMMEND = `권장 ${RECOMMENDED_RUNS}개`;
/** The error when the number is out of range. */
export const runsRange = (max: number): string => `몇 개 돌릴지는 1~${max}개 사이로 정해 주세요`;

export const REPEATS_LABEL = "같은 상황을 몇 번씩 돌릴까요";
export const REPEATS_HELP =
  "같은 상황을 여러 번 돌리면 에이전트가 같은 상황에서도 얼마나 흔들리는지 알 수 있어요. 평균과 순위는 서로 다른 상황의 수로 세요.";
/** The last of the quick choices: the box for any other number shows only when it is chosen. */
export const REPEATS_DIRECT = "직접";
export const REPEATS_DIRECT_LABEL = "몇 번씩인지 직접 정하기";
/** The error when the number of repeats is out of range. */
export const repeatsRange = (): string => `같은 상황은 1~${MAX_REPEATS}번 사이로 정해 주세요`;

export const TOOLS_TITLE = "에이전트가 쓸 도구";
export const TOOLS_LEDE =
  "에이전트가 장비를 살펴보고 고칠 때 부르는 도구예요. 권장 도구는 처음부터 켜 있어요.";

export interface ToolGroupWords {
  readonly help: string;
  /** Whether the group is on from the start, and so marked "권장". */
  readonly recommended: boolean;
}

export const RECOMMENDED = "권장";

export const TOOL_GROUP_WORDS: Readonly<Record<ToolCategory, ToolGroupWords>> = {
  observe: { help: "장비와 알람을 읽기만 해요. 아무것도 바꾸지 않아요.", recommended: true },
  protocol: {
    help: "Redfish·vCenter·vROps 같은 장비 API를 그대로 불러요. 그 API를 쓰는 에이전트를 시험할 때 켜요.",
    recommended: false,
  },
  act: { help: "전원을 끄고 켜거나 냉방기를 바꾸는 조치예요.", recommended: true },
  answer: { help: "진단을 제출해요. 늘 켜 있어요.", recommended: true },
};

export const ADVANCED_TITLE = "고급 설정";
export const ADVANCED_HELP = "처음에는 그대로 둬도 돼요. 시간이 흐르는 방식과 장비 API 버전이에요.";

export const LOCKSTEP_LABEL = "도구를 한 번 부르면 흐르는 시간";
export const LOCKSTEP_HELP = "권장 30초. 도구를 부를 때만 시간이 흘러서 결과가 늘 같아요.";
export const SPEED_LABEL = "시간이 흐르는 빠르기";
export const SPEED_HELP = "10배면 실제 1초에 10초가 흘러요.";
export const REALTIME_LABEL = "실제 시간으로 돌려요";
export const REALTIME_HELP = "권장은 꺼 두기예요. 켜면 돌릴 때마다 결과가 달라요.";
export const VERSION_HELP = "에이전트가 만나는 장비 API의 버전이에요. 권장은 기본이에요.";

/** Every sentence of the step, for the test that reads them against the style rules. */
export function howTexts(): string[] {
  return [
    RUNS_LABEL,
    RUNS_HELP,
    RUNS_RECOMMEND,
    runsRange(20),
    REPEATS_LABEL,
    REPEATS_HELP,
    REPEATS_DIRECT,
    REPEATS_DIRECT_LABEL,
    repeatsRange(),
    TOOLS_TITLE,
    TOOLS_LEDE,
    ...Object.values(TOOL_GROUP_WORDS).map((g) => g.help),
    ADVANCED_TITLE,
    ADVANCED_HELP,
    LOCKSTEP_LABEL,
    LOCKSTEP_HELP,
    SPEED_LABEL,
    SPEED_HELP,
    REALTIME_LABEL,
    REALTIME_HELP,
    VERSION_HELP,
    ...toolTexts(),
  ];
}
