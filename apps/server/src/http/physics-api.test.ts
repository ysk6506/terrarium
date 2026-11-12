import { DEFAULT_FINGERPRINT } from "@terrarium/core/physics/slots";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import {
  HANEUL,
  JIMIN,
  recipe,
  seed,
  settled,
  testPlatform,
} from "../runtime/test-support/platform";
import { buildApp } from "./app";

function setup() {
  const t = testPlatform();
  const app = buildApp({ platform: t.platform });
  const send = async (method: string, url: string, body?: unknown, who = "haneul") => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: { "x-terrarium-user": encodeURIComponent(who) },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: r.statusCode, body: r.json() };
  };
  return { ...t, send };
}

const HOT = { base: "v1", params: { "thermal.room.roomHeightM": 1 } };

describe("the physics slots and a world's physics profile over HTTP [REQ-113]", () => {
  test("GET /api/physics/slots lists the slots with their numbers, units, defaults and ranges", async () => {
    const { send } = setup();
    const { status, body } = await send("GET", "/api/physics/slots");
    expect(status).toBe(200);
    expect(body.bases).toEqual(["v1"]);
    expect(body.slots).toHaveLength(13);
    const room = body.slots.find((s: { id: string }) => s.id === "thermal.room");
    expect(room.ko).toBe("방 공기와 랙 흡기");
    expect(room.scopes).toContain("rack");
    const height = room.params.find((p: { name: string }) => p.name === "roomHeightM");
    expect(height).toMatchObject({ unit: "m", default: 3, min: 1, max: 20 });
    const protection = body.slots.find((s: { id: string }) => s.id === "power.protection");
    expect(protection.curves.map((c: { name: string }) => c.name)).toContain("tripTimeCurve");
  });

  test("a world starts on the default physics, v1", async () => {
    const { platform, send } = setup();
    const { world } = await platform.worlds.create(HANEUL, {
      name: "물리",
      blueprint: sampleBlueprint(),
    });
    const { status, body } = await send("GET", `/api/worlds/${world.id}/physics`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      worldId: world.id,
      digest: world.digest,
      fingerprint: DEFAULT_FINGERPRINT,
      isDefault: true,
      profile: { base: "v1" },
    });
  });

  test("saving a profile makes a new version of the world with another fingerprint; saving the default puts it back", async () => {
    const { platform, send } = setup();
    const { world } = await platform.worlds.create(HANEUL, {
      name: "물리",
      blueprint: sampleBlueprint(),
    });
    const saved = await send("PUT", `/api/worlds/${world.id}/physics`, {
      profile: HOT,
      baseDigest: world.digest,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.isDefault).toBe(false);
    expect(saved.body.fingerprint).toMatch(/^v1\+[0-9a-f]{12}$/);
    expect(saved.body.digest).not.toBe(world.digest);
    const read = await send("GET", `/api/worlds/${world.id}/physics`);
    expect(read.body).toMatchObject({ fingerprint: saved.body.fingerprint, profile: HOT });
    const record = await send("GET", `/api/worlds/${world.id}`);
    expect(record.body.blueprint.physics).toEqual(HOT);
    const back = await send("PUT", `/api/worlds/${world.id}/physics`, {
      profile: { base: "v1" },
      baseDigest: saved.body.digest,
    });
    expect(back.body).toMatchObject({ fingerprint: "v1", isDefault: true, digest: world.digest });
    expect((await send("GET", `/api/worlds/${world.id}`)).body.blueprint.physics).toBeUndefined();
  });

  test("a profile that cannot be used is refused with every problem in Korean; a stale version and a stranger are refused too", async () => {
    const { platform, send } = setup();
    const { world } = await platform.worlds.create(HANEUL, {
      name: "물리",
      blueprint: sampleBlueprint(),
    });
    const url = `/api/worlds/${world.id}/physics`;
    const bad = await send("PUT", url, {
      profile: { base: "v1", params: { "thermal.room.nope": 1, "thermal.room.roomHeightM": 99 } },
      baseDigest: world.digest,
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain("알 수 없는 숫자 'thermal.room.nope'");
    expect(JSON.stringify(bad.body)).toContain("허용 범위 1~20");
    const stale = await send("PUT", url, { profile: HOT, baseDigest: "old" });
    expect(stale.status).toBe(409);
    const stranger = await send("PUT", url, { profile: HOT, baseDigest: world.digest }, JIMIN.name);
    expect(stranger.status).toBe(403);
    expect((await send("GET", `/api/worlds/w-404/physics`)).status).toBe(404);
  });

  test("an experiment keeps the fingerprint of the physics it ran on, and the run result says it too", async () => {
    const { platform, send } = setup();
    const { world, scenario } = await seed(platform);
    const saved = await send("PUT", `/api/worlds/${world.id}/physics`, {
      profile: HOT,
      baseDigest: world.digest,
    });
    const created = await platform.experiments.create(HANEUL, {
      name: "물리 실험",
      recipe: recipe(world.id, scenario.id, { runs: 1 }),
    });
    expect(created.experiment.snapshot.physics).toBe(saved.body.fingerprint);
    const done = await settled(platform, HANEUL, created.experiment.id);
    expect(done.status).toBe("completed");
    const plain = await seed(platform);
    const other = await platform.experiments.create(HANEUL, {
      name: "기본 물리 실험",
      recipe: recipe(plain.world.id, plain.scenario.id, { runs: 1 }),
    });
    expect(other.experiment.snapshot.physics).toBe("v1");
    expect(other.experiment.benchmarkKey).not.toBe(created.experiment.benchmarkKey);
  });
});
