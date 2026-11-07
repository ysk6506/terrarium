/**
 * 숫자나 용어 옆의 작은 "?" (REQ-103, ADR-0124): 누르면 그 질문이 채워진 채로 이끼가 열리고 바로 물어봐요.
 * 결과·사다리·설정·실험 화면의 숫자와 용어는 모두 이걸로 감싸요 (`moss` 검사의 MOSS004).
 */
import { withJosa } from "@terrarium/core/kernel";
import type { ReactNode } from "react";
import { openMoss } from "./store";

export function MossAsk({
  question,
  children,
}: {
  /** 이끼에게 물을 말. 예: "이 실행이 왜 30점이에요?" */
  readonly question: string;
  readonly children: ReactNode;
}) {
  return (
    <span className="moss-ask">
      {children}
      <button
        type="button"
        className="moss-q"
        aria-label={`이끼에게 묻기: ${question}`}
        title={question}
        data-moss-skip="이끼에게 묻는 작은 물음표"
        onClick={() => openMoss({ question, send: true })}
      >
        ?
      </button>
    </span>
  );
}

/** 용어나 숫자 이름만 있을 때 묻는 말: "복구 점수가 뭐예요?" */
export const termQuestion = (term: string): string => `${withJosa(term.trim(), "이")} 뭐예요?`;

/** 값이 있는 숫자를 묻는 말: `numberQuestion("이 실행", "30점")` → "이 실행이 왜 30점이에요?" */
export const numberQuestion = (subject: string, value: string): string =>
  `${withJosa(subject.trim(), "이")} 왜 ${withJosa(value.trim(), "이에요")}?`;
