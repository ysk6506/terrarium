/**
 * What the home page says first, for someone who has never heard of Terrarium. Each line stands on its own: it says
 * what this place is (a pretend data center) and what you do with it (see how an AI copes, and compare), before it
 * says anything clever. Terrarium exists to find which LLM, which agent setup and which tools work best together,
 * from one problem to running a whole data center, so the lines come at that from different sides. The page shows
 * one at random each time it opens.
 *
 * Written the way Toss writes (ADR-0050): a title that takes one breath and asks what the reader wonders; a lede of
 * two short sentences; no jargon (no 하네스, no 툴, no 장애: say 문제 or what actually happens); no boasting.
 */
export interface Headline {
  readonly title: string;
  readonly lede: string;
}

export const HEADLINES: readonly Headline[] = [
  {
    title: "AI에게 데이터센터를 맡겨도 될까요?",
    lede: "테라리움은 가상의 데이터센터예요. 냉방기가 멈추고 전원이 나가도 AI가 잘 해내는지, 점수로 알려 줘요.",
  },
  {
    title: "AI도 실전 전에 연습이 필요해요",
    lede: "여기는 가상의 데이터센터예요. 진짜 일을 맡기기 전에 문제 상황을 미리 겪게 해 보고, 얼마나 잘 해내는지 점수로 확인해요.",
  },
  {
    title: "어떤 AI가 가장 잘할까요?",
    lede: "가상의 데이터센터에서 같은 문제를 여러 AI에게 똑같이 내요. 누가 원인을 잘 찾고 잘 대응하는지 점수로 비교해요.",
  },
  {
    title: "하나만 바꾸면 점수가 달라질까요?",
    lede: "가상의 데이터센터에서 같은 상황을 두고, AI 모델이든 구성이든 하나만 바꿔 다시 돌려 봐요. 무엇이 점수를 바꿨는지 알 수 있어요.",
  },
  {
    title: "문제가 생기면 AI는 어떻게 할까요?",
    lede: "서버가 꺼지고 온도가 오르는 일을 가상의 데이터센터에 만들어요. AI가 무엇을 보고 무엇을 했는지 전부 기록하고 점수를 매겨요.",
  },
  {
    title: "어디까지 맡겨도 될지, 점수로 봐요",
    lede: "가상의 데이터센터에서 작은 문제부터 운영 전체까지 차례로 내 봐요. AI가 어디까지 해내는지 점수로 보여 줘요.",
  },
];

/** One headline, chosen by `random` (a number from 0 up to but not including 1). */
export function pickHeadline(random: () => number = Math.random): Headline {
  const at = Math.min(HEADLINES.length - 1, Math.floor(random() * HEADLINES.length));
  return HEADLINES[at] as Headline;
}

/** The three steps under the headline. "세계" and "하네스" are said in plain words once, here, and nowhere else on the home page. */
export interface Start {
  readonly page: "worlds" | "scenarios" | "newExperiment";
  readonly title: string;
  readonly body: string;
}

export const STARTS: readonly Start[] = [
  {
    page: "worlds",
    title: "데이터센터를 지어요",
    body: "세계는 가상의 데이터센터예요. 사업장에서 랙까지 끌어다 놓아 지어요.",
  },
  {
    page: "scenarios",
    title: "일어날 일을 그려요",
    body: "팬이 멈추고 차단기가 내려가는 순서를 블록으로 잇고, 점수 기준을 정해요.",
  },
  {
    page: "newExperiment",
    title: "AI를 시험해요",
    body: "AI 모델, 모델을 움직이는 프로그램(하네스), 툴을 골라 여러 번 돌려 비교해요.",
  },
];
