import { describe, expect, test } from "vitest";
import { fileName } from "./export";

describe("내려받는 파일 이름 [REQ-112]", () => {
  test("[REQ-112] 한글 세계 이름은 그대로 파일 이름이 되고, 파일 이름에 못 쓰는 글자만 바뀐다", () => {
    expect(fileName("화성 A동", "csv")).toBe("화성-A동-ontology.csv");
    expect(fileName("화성/A동: 1*", "json")).toBe("화성-A동-1-ontology.json");
  });
});
