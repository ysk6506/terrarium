/**
 * `ping`, `curl`, `dig` and `nslookup` of the deep operating-system fake when the network or the host they ask is not
 * well (REQ-098, ADR-0117 decision 4; the name service is REQ-087's DNS fault): what each prints and which exit code it
 * ends with, in the words of the real tool.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("ping and names [REQ-098]", () => {
  test("[REQ-098] ping with no -c sends four packets, and -c is capped at ten", () => {
    const { sh } = lab();
    expect(sh("ping srv-b1")).toContain("4 packets transmitted, 4 received, 0% packet loss");
    expect(sh("ping -c 50 srv-b1")).toContain("10 packets transmitted, 10 received");
  });

  test("[REQ-098] nslookup of a name that exists names the server, the host and its address", () => {
    const { run } = lab();
    const r = run("srv-a2", "nslookup srv-a2");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(
      "Server:\t\t10.20.0.53\nAddress:\t10.20.0.53#53\n\nName:\tsrv-a2.dc.local\nAddress: 10.0.0.11\n",
    );
  });

  test("[REQ-098] a resolver that does not answer is a timeout: dig exits 9, nslookup exits 1", () => {
    const { run } = lab();
    const dig = run("srv-a2", "dig @8.8.8.8 srv-a2");
    expect(dig.exitCode).toBe(9);
    expect(dig.stdout).toContain(";; connection timed out; no servers could be reached");
    expect(dig.stdout).toContain("DiG 9.16.23-RH <<>> @8.8.8.8 srv-a2");
    expect(run("srv-a2", "dig @8.8.8.8 +short srv-a2")).toMatchObject({
      exitCode: 9,
      stdout: ";; connection timed out; no servers could be reached",
    });
    const lookup = run("srv-a2", "nslookup srv-a2 8.8.8.8");
    expect(lookup.exitCode).toBe(1);
    expect(lookup.stdout).toContain(";; connection timed out; no servers could be reached");
  });

  test("[REQ-087] when the host's own DNS fails every lookup it makes times out", () => {
    const { run, inject, physics } = lab();
    inject("dns_failure", "srv-a2");
    physics.run(120);
    expect(run("srv-a2", "dig srv-a2")).toMatchObject({ exitCode: 9 });
    expect(run("srv-a2", "dig +short srv-a2").stdout).toBe(
      ";; connection timed out; no servers could be reached",
    );
    expect(run("srv-a2", "nslookup srv-a2")).toMatchObject({ exitCode: 1 });
    expect(run("srv-a2", "ping srv-a2")).toMatchObject({
      exitCode: 2,
      stderr: "ping: srv-a2: Name or service not known",
    });
    expect(run("srv-a2", "curl http://nowhere.example/")).toMatchObject({
      exitCode: 6,
      stderr: "curl: (6) Could not resolve host: nowhere.example",
    });
  });
});

describe("curl [REQ-098]", () => {
  test("[REQ-098] a URL with no path asks for /, a path-less localhost reaches the first service on the host", () => {
    const { run } = lab();
    expect(run("srv-a2", "curl -s http://localhost")).toMatchObject({
      exitCode: 0,
      stdout: '{"status":"ok"}',
    });
    expect(run("srv-a2", "curl -s http://localhost:8080/x?y=1#z").exitCode).toBe(7);
    expect(run("srv-b1", "curl -s localhost").exitCode).toBe(7);
  });

  test("[REQ-087] a service whose process keeps crashing refuses the connection, with exit 7", () => {
    const { run, inject, physics } = lab();
    inject("process_crashloop", "srv-a2", { intervalS: 30 });
    physics.run(300);
    expect(run("srv-b1", "curl http://svc-license/")).toMatchObject({
      exitCode: 7,
      stderr: "curl: (7) Failed to connect to svc-license port 80: Connection refused",
    });
    expect(run("srv-b1", "curl -s http://svc-license/")).toMatchObject({ exitCode: 7, stderr: "" });
    expect(run("srv-b1", "curl -sS http://svc-license/").stderr).toContain("(7) Failed to connect");
  });

  test("[REQ-087] a host that is down does not answer at all: exit 28 after five seconds, quietly with -s", () => {
    const { run, inject, physics } = lab();
    inject("kernel_panic", "srv-a2", { downSeconds: 1800 });
    physics.run(60);
    expect(run("srv-b1", "curl http://svc-license/")).toMatchObject({
      exitCode: 28,
      stderr: "curl: (28) Connection timed out after 5001 milliseconds",
    });
    expect(run("srv-b1", "curl -s http://svc-license/")).toMatchObject({
      exitCode: 28,
      stderr: "",
    });
    expect(run("srv-b1", "ping -c 2 srv-a2")).toMatchObject({ exitCode: 1 });
  });
});
