import { describe, expect, test } from "vitest";
import { COMMANDS } from "../../packages/core/src/world/os/commands";
import { lab } from "./test-support/deep-os-lab";

/** These take any word or ignore flags (echo prints it, env lists, kill reports a pid), or are not installed on the host. */
const TAKES_ANY = new Set([
  "ip",
  "lsblk",
  "echo",
  "env",
  "printenv",
  "kill",
  "pkill",
  "pgrep",
  "pidof",
  "nice",
  "timedatectl",
  "pg_isready",
  "psql",
  "multipath",
  "reboot",
  "tee",
  "printf",
  "touch",
  "test",
  "[",
  "whoami",
  "id",
]);

describe("an option the fake does not have is named and sent outside the simulation [REQ-098]", () => {
  const names = Object.keys(COMMANDS).filter((n) => !TAKES_ANY.has(n));
  test.each(names)("%s refuses -Z and --no-such-option", (name) => {
    for (const option of ["-Z", "--no-such-option"]) {
      const r = lab().run("srv-a2", `${name} ${option}`);
      expect(r.exitCode, `${name} ${option}`).toBe(2);
      expect(r.outside, `${name} ${option}`).toHaveLength(1);
      expect(r.outside[0]).toMatch(new RegExp(`^(${name}|grep) `));
    }
  });
});
