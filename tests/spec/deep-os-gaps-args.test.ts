/**
 * How the shell reads the options of a command and how the file tree grows (REQ-098, REQ-087): an option the fake does not
 * know is said so in words, a long option may carry its value after `=`, `--` ends the options, a file written in a
 * directory nobody made makes the directory, and the old logs of a full disk can be read.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const DATA = "printf 'b,2\\na,1\\nc,3\\n' > /tmp/d";

describe("the options of a command [REQ-098]", () => {
  test("[REQ-098] a short option takes its value glued on or apart, a count may stand alone", () => {
    const { sh } = lab();
    sh(DATA);
    expect(sh("head -n 1 /tmp/d")).toBe("b,2");
    expect(sh("head -n1 /tmp/d")).toBe("b,2");
    expect(sh("head -1 /tmp/d")).toBe("b,2");
    expect(sh("grep -ne a /tmp/d")).toBe("2:a,1");
    expect(sh("grep -e a -e b /tmp/d")).toBe("b,2\na,1");
    expect(sh("cut -d, -f2 /tmp/d")).toBe("2\n1\n3");
  });

  test("[REQ-098] a long option carries its value after an equals sign or in the next word, where the command knows it", () => {
    const { sh } = lab();
    sh(DATA);
    expect(sh("grep --regexp=c /tmp/d")).toBe("c,3");
    expect(sh("sort --key=2 --field-separator=, /tmp/d")).toBe("a,1\nb,2\nc,3");
    expect(sh("sort -t, -k2 -r /tmp/d")).toBe("c,3\nb,2\na,1");
  });

  test("[REQ-098] a long option the fake does not know is said so, whether or not it carries a value", () => {
    const { sh } = lab();
    sh(DATA);
    expect(sh("head --bogus /tmp/d 2>&1")).toBe("head: --bogus: 이 흉내에서는 안 돼요");
    expect(sh("head --lines=1 /tmp/d 2>&1")).toBe("head: --lines=1: 이 흉내에서는 안 돼요");
    expect(sh("cut --delimiter=, --fields=1 /tmp/d 2>&1")).toBe(
      "cut: --delimiter=,: 이 흉내에서는 안 돼요",
    );
  });

  test("[REQ-098] two dashes end the options: what follows is a file, even when it looks like an option", () => {
    const { sh } = lab();
    sh(DATA);
    expect(sh("head -- -n /tmp/d 2>&1")).toBe("b,2\na,1\nc,3\nhead: -n: No such file or directory");
    expect(sh("grep -- -x /tmp/d")).toBe("");
  });
});

describe("the file tree [REQ-087]", () => {
  test("[REQ-087] a file written in a directory nobody made makes every directory on the way, owned by root", () => {
    const { sh, world } = lab();
    world.apply(
      { type: "host.act", target: "srv-a2", action: "write", arg: "/opt/new/deep/f" },
      "operator",
    );
    expect(sh("ls /opt/new")).toBe("deep");
    expect(sh("ls /opt/new/deep")).toBe("f");
    expect(sh("ls -ld /opt/new /opt/new/deep")).toMatch(
      /^drwxr-xr-x 2 root\s+root\s+4096 .* \/opt\/new\n/,
    );
  });

  test("[REQ-087] the old logs of a full disk have a start that can be read, and removing them gives the disk back", () => {
    const { sh, inject, physics } = lab();
    inject("disk_full", "srv-a2", { fillPct: 99 });
    physics.run(300);
    expect(sh("df / | tail -1")).toContain("100%");
    expect(sh("head -2 /var/log/licd/licd-20251204.log")).toBe(
      "licd archived line 1: request handled\nlicd archived line 2: request handled",
    );
    sh("rm /var/log/licd/licd-2025*.log");
    expect(sh("ls /var/log/licd")).toBe("licd.log");
    expect(sh("df / | tail -1")).toContain("51%");
  });
});
