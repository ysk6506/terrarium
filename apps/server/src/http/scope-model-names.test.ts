/**
 * Model names (ADR-0179): a name is unique among a person's own registrations and among those made for everyone, so a
 * clash never tells that someone else's private model exists.
 */
import { describe, expect, test } from "vitest";
import { OLIVIA, OMAR, scopedApp } from "./test-support/scoped-app";

const model = (name: string, extra: object = {}) => ({
  name,
  kind: "openai",
  baseUrl: "https://llm.test/v1",
  apiKey: `sk-${name}-secret-0001`,
  ...extra,
});

describe("[REQ-054] a model name does not give away someone's private model", () => {
  test("[REQ-054] two people may each keep a private model of the same name; one person may not repeat theirs", async () => {
    const s = scopedApp();
    const first = await s.send(OLIVIA, "POST", "/api/models", model("공용 이름"));
    expect(first.status).toBe(200);
    // no clash with her private one: the answer is the same as if it did not exist
    expect((await s.send(OMAR, "POST", "/api/models", model("공용 이름"))).status).toBe(200);
    expect((await s.send(OLIVIA, "POST", "/api/models", model("공용 이름"))).status).toBe(409);
    await s.close();
  });

  test("[REQ-054] among models made for everyone a name is still one, and widening a private one is refused when it would be a second", async () => {
    const s = scopedApp();
    const made = (who: typeof OLIVIA, name: string, extra: object = {}) =>
      s.send(who, "POST", "/api/models", model(name, extra));
    expect((await made(OLIVIA, "모두의 이름", { scope: "everyone" })).status).toBe(200);
    expect((await made(OMAR, "모두의 이름", { scope: "everyone" })).status).toBe(409);
    // the same name kept private is allowed (the other is seen by all, so nothing is given away)
    const mine = await made(OMAR, "모두의 이름");
    expect(mine.status).toBe(200);
    const widen = await s.send(OMAR, "PUT", `/api/models/${mine.body.id}/scope`, {
      scope: "everyone",
    });
    expect(widen.status).toBe(409);
    await s.close();
  });

  test("[REQ-054] renaming follows the same rule", async () => {
    const s = scopedApp();
    await s.send(OLIVIA, "POST", "/api/models", model("A"));
    const b = await s.send(OLIVIA, "POST", "/api/models", model("B"));
    await s.send(OMAR, "POST", "/api/models", model("C"));
    expect((await s.send(OLIVIA, "PATCH", `/api/models/${b.body.id}`, { name: "A" })).status).toBe(
      409,
    );
    expect((await s.send(OLIVIA, "PATCH", `/api/models/${b.body.id}`, { name: "C" })).status).toBe(
      200,
    );
    await s.close();
  });
});
