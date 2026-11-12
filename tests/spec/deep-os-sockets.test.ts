/**
 * What the fake host says about its network: sockets (ss, netstat, lsof), addresses and routes (ip) (REQ-098, ADR-0117
 * decision 4). The listening sockets are the ones of the processes that run, so stopping the service takes its port away.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const HEAD = "State  Recv-Q Send-Q    Local Address:Port     Peer Address:Port";

describe("ss lists the sockets of the processes that run [REQ-098]", () => {
  test("-ltn lists the listeners, -p names the process, -H drops the header", () => {
    const { sh } = lab();
    expect(sh("ss -lnt")).toBe(
      `${HEAD}\nLISTEN 0      128             0.0.0.0:22             0.0.0.0:*\nLISTEN 0      128          127.0.0.53:53             0.0.0.0:*\nLISTEN 0      128           0.0.0.0:8701             0.0.0.0:*`,
    );
    expect(sh("ss -ltnp").split("\n")[3]).toBe(
      'LISTEN 0      128           0.0.0.0:8701             0.0.0.0:*  users:(("licd",pid=645,fd=3))',
    );
    expect(sh("ss -ltnH").split("\n")).toHaveLength(3);
    expect(sh("ss -4 -ltn")).toBe(sh("ss -ltn"));
  });

  test("-a adds the protocol column and every socket; -u shows the UDP ones; without -l only the connections", () => {
    const { sh } = lab();
    const all = sh("ss -a").split("\n");
    expect(all[0]).toBe(`Netid ${HEAD}`);
    expect(all.some((l) => l.startsWith("udp UNCONN"))).toBe(true);
    expect(sh("ss -u -l")).toContain("udp UNCONN 0      0            127.0.0.1:323");
    expect(
      sh("ss -tn")
        .split("\n")
        .slice(1)
        .every((l) => l.includes("ESTAB")),
    ).toBe(true);
    expect(sh("ss -tan")).toContain(
      "tcp ESTAB  0      0           10.0.0.11:8701     10.20.48.10:58078",
    );
  });

  test("a filter or a summary is outside what the fake can say", () => {
    const { run } = lab();
    expect(run("srv-a2", "ss -s")).toMatchObject({ exitCode: 2, outside: ["ss -s"] });
    expect(run("srv-a2", "ss dst 10.0.0.1").outside).toEqual(["ss 필터 dst 10.0.0.1"]);
    expect(run("srv-a2", "ss -x").outside).toEqual(["ss -x"]);
  });

  test("a stopped service no longer listens, and its connections are gone", () => {
    const { sh } = lab();
    sh("systemctl stop licd");
    expect(sh("ss -ltn")).not.toContain(":8701");
    expect(sh("ss -tan")).not.toContain("ESTAB");
    expect(sh("netstat -tlnp")).not.toContain("licd");
    sh("systemctl start licd");
    expect(sh("ss -ltn")).toContain(":8701");
  });
});

describe("netstat prints the same sockets in its own table [REQ-098]", () => {
  test("-tlnp lists the listeners with PID/Program, -tln without, -an with the UDP ones", () => {
    const { sh } = lab();
    expect(sh("netstat -tlnp").split("\n").slice(0, 3)).toEqual([
      "Active Internet connections (only servers)",
      "Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name",
      "tcp    0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      457/sshd",
    ]);
    expect(sh("netstat -tln").split("\n")[1]).toBe(
      "Proto Recv-Q Send-Q Local Address           Foreign Address         State",
    );
    expect(sh("netstat -an")).toContain("udp    0      0 127.0.0.1:323");
    expect(sh("netstat -tnp")).toContain(
      "10.0.0.11:8701          10.20.48.10:58078       ESTABLISHED 645/licd",
    );
    expect(sh("netstat -ulnp")).toContain(
      "udp    0      0 127.0.0.53:53           0.0.0.0:*                           532/systemd-resolved",
    );
  });

  test("-r prints the routing table of the host's own network; other tables are outside the fake", () => {
    const { sh, run } = lab();
    expect(sh("netstat -rn")).toBe(
      [
        "Kernel IP routing table",
        "Destination     Gateway         Genmask         Flags   MSS Window  irtt Iface",
        "0.0.0.0         10.0.0.1        0.0.0.0         UG        0 0          0 eth0",
        "10.0.0.0        0.0.0.0         255.255.255.0   U         0 0          0 eth0",
      ].join("\n"),
    );
    expect(run("srv-a2", "netstat -s").outside).toEqual(["netstat -s"]);
    expect(run("srv-a2", "netstat -i").outside).toEqual(["netstat -i"]);
  });
});

describe("ip shows the address, the link and the route of the host [REQ-098]", () => {
  test("addr, link and route have the layout of the real tool, with the host's own address", () => {
    const { sh } = lab();
    expect(sh("ip a").split("\n")[5]).toBe(
      "    inet 10.0.0.11/24 brd 10.0.0.255 scope global eth0",
    );
    expect(sh("ip -br a")).toBe(
      "lo               UNKNOWN        127.0.0.1/8\neth0             UP             10.0.0.11/24",
    );
    expect(sh("ip link").split("\n")[0]).toContain("mode DEFAULT group default qlen 1000");
    expect(sh("ip link")).toContain("link/ether 52:54:00:");
    expect(sh("ip route")).toBe(
      "default via 10.0.0.1 dev eth0 proto static metric 100\n10.0.0.0/24 dev eth0 proto kernel scope link src 10.0.0.11 metric 100",
    );
    expect(sh("ip r")).toBe(sh("ip route"));
    expect(sh("ip")).toBe(sh("ip addr show"));
  });

  test("an object the fake does not have is outside it", () => {
    const { run } = lab();
    // ADR-0184: neigh and rule are real ip objects the fake lacks; foo is no object, and ip says so itself
    for (const obj of ["neigh", "rule"])
      expect(run("srv-a2", `ip ${obj}`)).toMatchObject({ exitCode: 2, outside: [`ip ${obj}`] });
    expect(run("srv-a2", "ip foo")).toMatchObject({ exitCode: 1, outside: [] });
  });
});

describe("lsof lists the open files of the processes [REQ-098]", () => {
  test("-i lists the internet sockets, :port narrows to one port, -p one process, a path its owner", () => {
    const { sh, run } = lab();
    expect(sh("lsof -i").split("\n")[0]).toBe(
      "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
    );
    expect(sh("lsof -i :8701").split("\n")).toHaveLength(4);
    expect(sh("lsof -nP -i")).toContain("licd      645 root   3u   IPv4 0t0 0.0.0.0:8701 (LISTEN)");
    expect(sh("lsof -p 645")).toContain("licd      645 appsvc txt  REG  0t0 /opt/app/bin/licd");
    expect(sh("lsof /var/log/licd/licd.log")).toContain(
      "licd      645 appsvc 4w   REG  0t0 /var/log/licd/licd.log",
    );
    expect(run("srv-a2", "lsof -p 99999")).toMatchObject({
      stderr: "lsof: no process ID 99999",
      exitCode: 1,
    });
    expect(run("srv-a2", "lsof /etc/hostname")).toMatchObject({ stdout: "", exitCode: 1 });
    expect(run("srv-a2", "lsof").outside).toEqual(["lsof 인자 없이 (모든 열린 파일)"]);
    expect(run("srv-a2", "lsof -iTCP -sTCP:LISTEN").outside).toEqual(["lsof -s"]);
  });

  test("nothing listens on a port after the service stopped", () => {
    const { sh, run } = lab();
    sh("systemctl stop licd");
    expect(run("srv-a2", "lsof -i :8701")).toMatchObject({ stdout: "", exitCode: 1 });
    expect(run("srv-a2", "lsof -p 645").stderr).toBe("lsof: no process ID 645");
  });
});
