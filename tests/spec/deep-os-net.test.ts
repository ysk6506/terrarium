/**
 * The network commands of the deep operating-system fake (REQ-098, ADR-0117 decision 4): ping, dig, nslookup and curl
 * answer from the same state as the services and print what the real tools print in good order and in failure.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("ping reports replies for a reachable host and unreachable for the rest [REQ-098]", () => {
  test("a known host answers every probe, and the count is capped and defaults to four", () => {
    const { sh } = lab();
    const out = sh("ping -c 3 licd").split("\n");
    expect(out[0]).toBe("PING licd (10.0.0.11) 56(84) bytes of data.");
    expect(out[1]).toMatch(
      /^64 bytes from licd \(10\.0\.0\.11\): icmp_seq=1 ttl=63 time=0\.\d+ ms$/,
    );
    expect(out).toContain("3 packets transmitted, 3 received, 0% packet loss, time 2002ms");
    expect(
      sh("ping licd")
        .split("\n")
        .filter((l) => l.startsWith("64 bytes")),
    ).toHaveLength(4);
    expect(
      sh("ping -c 99 licd")
        .split("\n")
        .filter((l) => l.startsWith("64 bytes")),
    ).toHaveLength(10);
  });

  test("an address nobody holds is unreachable, with the errors counted and the exit code 1", () => {
    const { run } = lab();
    const r = run("srv-a2", "ping -c 2 10.99.99.99");
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("From 10.0.0.11 icmp_seq=2 Destination Host Unreachable");
    expect(r.stdout).toContain(
      "2 packets transmitted, 0 received, +2 errors, 100% packet loss, time 2000ms",
    );
  });

  test("an unknown name and a missing target are refused with exit code 2", () => {
    const { run } = lab();
    expect(run("srv-a2", "ping -c 1 nope.example")).toMatchObject({
      exitCode: 2,
      stderr: expect.stringContaining("ping: nope.example: Name or service not known"),
    });
    expect(run("srv-a2", "ping")).toMatchObject({
      exitCode: 2,
      stderr: expect.stringContaining("Destination address required"),
    });
  });
});

describe("dig and nslookup print the answer or the NXDOMAIN of the resolver [REQ-098]", () => {
  test("a name the resolver holds is answered with its address, in full and in short form", () => {
    const { sh } = lab();
    const full = sh("dig licd.dc.local A");
    expect(full).toContain("status: NOERROR");
    expect(full).toContain("licd.dc.local.\t300\tIN\tA\t10.0.0.11");
    expect(full).toContain("SERVER: 10.20.0.53#53(10.20.0.53)");
    expect(sh("dig +short srv-a2.dc.local")).toBe("10.0.0.11");
  });

  test("a name it does not hold is NXDOMAIN, empty in short form", () => {
    const { sh } = lab();
    expect(sh("dig nope.dc.local")).toContain("status: NXDOMAIN");
    expect(sh("dig +short nope.dc.local")).toBe("");
    expect(sh("dig @10.20.0.53 nope.dc.local")).toContain(
      "; <<>> DiG 9.16.23-RH <<>> @10.20.0.53 nope.dc.local",
    );
    expect(sh("dig")).toContain("global options: +cmd");
  });

  test("nslookup names the server it asked and says where a name cannot be found", () => {
    const { run, sh } = lab();
    expect(sh("nslookup nope.dc.local")).toContain(
      "Server:\t\t10.20.0.53\nAddress:\t10.20.0.53#53\n\n** server can't find nope.dc.local: NXDOMAIN",
    );
    expect(run("srv-a2", "nslookup nope.dc.local").exitCode).toBe(1);
    expect(sh("nslookup nope.dc.local 10.20.0.54")).toContain("Server:\t\t10.20.0.54");
    expect(run("srv-a2", "nslookup")).toMatchObject({
      exitCode: 2,
      outside: ["nslookup 대화형 모드"],
    });
  });
});

describe("curl asks the health route of a service and prints what it says [REQ-098]", () => {
  test("a healthy service answers its body, its headers on -I, and the status on -w", () => {
    const { sh } = lab();
    expect(sh("curl -s http://licd:8701/healthz")).toBe('{"status":"ok"}');
    expect(sh("curl -k https://licd:8701/healthz")).toBe('{"status":"ok"}');
    expect(sh("curl -I http://licd:8701/healthz").split("\n")[0]).toBe("HTTP/1.1 200 OK");
    expect(sh("curl -s -o /dev/null -w '%{http_code}' http://licd:8701/healthz")).toBe("200");
    expect(sh("curl -w '%{http_code}\\n' -s http://licd:8701/healthz")).toBe(
      '{"status":"ok"}\n200',
    );
  });

  test("a host with nothing listening is refused with curl's own message and exit code 7", () => {
    const { run } = lab();
    expect(run("srv-a2", "curl -sS http://nope:80/")).toMatchObject({
      exitCode: 7,
      stderr: expect.stringContaining(
        "curl: (7) Failed to connect to nope port 80: Connection refused",
      ),
    });
    expect(run("srv-a2", "curl -I http://srv-a2:8701/healthz").exitCode).toBe(7);
    expect(run("srv-a2", "curl").exitCode).toBe(2);
  });

  test("an option the fake does not do is outside it", () => {
    const { run } = lab();
    expect(run("srv-a2", "curl -X POST http://licd:8701/healthz")).toMatchObject({ exitCode: 2 });
    expect(run("srv-a2", "curl -X POST http://licd:8701/healthz").outside).toBeDefined();
  });
});
