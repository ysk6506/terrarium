import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MossAsk, setAwake } from "../../moss";

describe("the ? marks follow the default model [REQ-103]", () => {
  const draw = () =>
    renderToStaticMarkup(
      createElement(
        MossAsk,
        { question: "이 실행이 왜 30점이에요?" } as Parameters<typeof MossAsk>[0],
        createElement("b", null, "30점"),
      ),
    );

  test("asleep, MossAsk draws only its child; awake, the child comes with its ? mark", () => {
    setAwake(false);
    expect(draw()).toBe("<b>30점</b>");
    setAwake(true);
    expect(draw()).toContain('class="moss-q"');
    expect(draw()).toContain("<b>30점</b>");
    setAwake(false);
  });
});
