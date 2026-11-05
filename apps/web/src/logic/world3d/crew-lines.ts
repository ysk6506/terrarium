/**
 * What the people in the server room say when you click them (REQ-074, ADR-0078): a few lines for each
 * situation, in 해요체, light and a little witty. No names, no real people, no company, no emoji and no
 * exclamation marks, and never a word that says something was fixed: people only look, walk and wait; the
 * scenario and the agents are the ones that change the world. `{device}` is the name of the machine.
 */
import type { CrewSituation } from "./crew";

export const CREW_LINES: Readonly<Record<CrewSituation, readonly string[]>> = {
  patrol: [
    "순찰 중이에요. 오늘은 조용하네요",
    "랙 사이를 한 바퀴 도는 중이에요",
    "LED가 다 초록이면 마음이 편해요",
    "복도가 시원해서 걷기는 좋아요. 발은 좀 시려요",
    "팬 소리가 오늘도 한결같네요",
  ],
  going: [
    "{device}, 알람이 떴어요. 가 볼게요",
    "{device} 쪽이에요. 뛰진 않고 걸어가요",
    "{device}, 또 멈췄나 봐요. 가 볼게요",
    "알람 소리 들었어요. 지금 가는 길이에요",
  ],
  working: [
    "{device} 앞에서 살펴보는 중이에요",
    "노트북 열고 로그를 보는 중이에요",
    "랙 문을 열어 봤어요. 아직 뭐라 말하긴 일러요",
    "지금은 보기만 해요. 손은 아직 안 댔어요",
  ],
  agent: [
    "에이전트가 끄라고 해서 끄는 중이에요. 맞겠죠?",
    "에이전트가 시킨 대로 하는 중이에요. 이유는 저도 궁금해요",
    "에이전트 말대로 {device} 앞에 왔어요. 믿어 볼게요",
    "시키는 대로 하는 중이에요. 책임은 에이전트가 져요",
  ],
  manager: [
    "관제실에서 다 보고 있어요",
    "화면이 전부 초록이면 커피를 마셔요",
    "알람이 울리면 제일 먼저 알아요. 그게 제 일이에요",
    "모니터 속 그래프랑 눈싸움 중이에요",
  ],
  technician: [
    "연락받고 왔어요. {device}부터 볼게요",
    "공구 가방은 늘 무거워요",
    "급하다고 해서 왔어요. 상태부터 확인할게요",
    "{device} 앞이에요. 열어 보고 말씀드릴게요",
  ],
};

export interface Speaker {
  readonly id: number;
}

/** The `n`th thing this person says in this situation: the lines go round, and two people start at different ones. */
export function lineFor(
  person: Speaker,
  situation: CrewSituation,
  n: number,
  device?: string,
): string {
  const lines = CREW_LINES[situation];
  const line = lines[(((person.id + n) % lines.length) + lines.length) % lines.length] as string;
  return line.replaceAll("{device}", device ?? "이 장비");
}
