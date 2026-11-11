/**
 * `pnpm tsx scripts/validate-physics-profile.ts <profile.json> [--only <text>]` (REQ-113, ADR-0137): checks a physics profile
 * (the file holds a `PhysicsProfile` as JSON) and then plays the reference solution (REQ-110) on every sheet with it; sheets
 * where the reference no longer scores 100 are listed: on that physics they cannot be solved for full marks.
 */
import { readFileSync } from "node:fs";
import { type PhysicsProfile, profileProblems } from "@terrarium/core/physics/slots";
import { validateProfileAgainstReference } from "../tests/spec/test-support/reference-profile";

const say = (line: string): void => void process.stdout.write(`${line}\n`);

const [file, flag, text] = process.argv.slice(2);
if (!file) {
  say(
    "쓰는 법: pnpm tsx scripts/validate-physics-profile.ts <프로필.json> [--only <시나리오 이름 일부>]",
  );
  process.exit(2);
}
const profile = JSON.parse(readFileSync(file, "utf8")) as PhysicsProfile;
const problems = profileProblems(profile);
if (problems.length > 0) {
  say("프로필을 쓸 수 없어요:");
  for (const p of problems) say(`  - ${p}`);
  process.exit(1);
}
const only = flag === "--only" && text ? (label: string) => label.includes(text) : undefined;
const check = validateProfileAgainstReference(profile, only ? { only } : {});
say(`정답 풀이로 ${check.checked}개 시나리오를 풀었어요.`);
if (check.failing.length === 0) {
  say("모두 100점이에요. 이 물리로 벤치마크를 만들 수 있어요.");
} else {
  say(
    `${check.failing.length}개는 이 물리에서 만점이 나오지 않아요 (이 프로필의 벤치마크에서 빠져요):`,
  );
  for (const f of check.failing) say(`  - ${f.label}: ${f.total}점 (${f.short.join(", ")})`);
  process.exit(1);
}
