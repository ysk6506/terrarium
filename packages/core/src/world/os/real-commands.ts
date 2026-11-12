/**
 * Commands that exist on real Linux hosts and that the fake shell does not have (ADR-0184). A name that is not here and
 * not in the fake's command table is a name no real host has either, and keeps the plain `command not found`; a name
 * that is here is a gap: the real host would run it.
 *
 * The list is the maintainers' first backlog: every name an agent reaches for goes into the record as
 * `<name>:command`. It is meant to be generous with common commands (coreutils, util-linux, procps, iproute2, net-tools,
 * systemd, bash builtins, the usual admin tools) and is extended when an agent reaches for a real command it lacks.
 * `example` is a command that works on any host of the fake and does something close to what the agent was after.
 */

type Family = readonly [names: string, example: string];

const FAMILIES: readonly Family[] = [
  [
    "tcpdump nc ncat netcat nmap telnet traceroute tracepath mtr ifconfig route arp ethtool nmcli brctl bridge tc iptables ip6tables nft firewall-cmd ufw resolvectl iwconfig iw hping3 socat tshark host whois",
    "ss -tan",
  ],
  ["iostat vmstat sar mpstat iotop htop atop pidstat dstat nmon glances perf", "top -b -n 1"],
  ["vi vim nano emacs less more man info view pico ed ex", "cat /etc/hosts"],
  [
    "python python2 python3 perl ruby node php lua bash sh zsh ksh dash tclsh gawk mawk nawk java go gcc make cc",
    "awk 'BEGIN{print 1+1}'",
  ],
  [
    "tar gzip gunzip zcat bzip2 bunzip2 xz unxz unzip zip 7z rsync scp sftp ssh ssh-keygen ssh-copy-id wget ftp git svn",
    "cat /etc/hosts",
  ],
  [
    "fdisk parted blkid mkfs fsck lvs vgs pvs lvdisplay vgdisplay pvdisplay lsscsi smartctl hdparm sgdisk mdadm dd e2fsck tune2fs xfs_repair xfs_info resize2fs mkswap swapon swapoff umount findmnt losetup cryptsetup",
    "df -h",
  ],
  [
    "lspci lsusb lscpu dmidecode ipmitool nproc sensors lshw lsmod modprobe rmmod insmod sysctl udevadm hwinfo numactl lsmem lsipc ipcs",
    "cat /proc/cpuinfo",
  ],
  ["docker podman helm kubeadm etcdctl ctr nerdctl buildah skopeo minikube kind oc", "ps aux"],
  ["apt apt-get apt-cache dpkg yum dnf rpm zypper snap pip pip3 npm cargo yarn", "uname -a"],
  [
    "useradd userdel usermod groupadd groupdel passwd chpasswd chmod chown chgrp visudo su login w who last lastb users groups getent crontab at batch",
    "id",
  ],
  [
    "diff cmp patch tree file basename dirname realpath seq yes tac rev paste join comm column fmt fold nl od hexdump xxd strings md5sum sha1sum sha224sum sha256sum sha384sum sha512sum cksum base64 base32 sync split csplit expand unexpand tsort shuf numfmt timeout mktemp install shred wipefs locate updatedb whereis expr bc dc factor nohup watch screen tmux tput reset script",
    "sort -u /etc/hosts",
  ],
  [
    "export set unset alias unalias source . time read eval exec type command local declare typeset readonly history ulimit umask wait jobs bg fg trap getopts shift let pushd popd dirs hash help bind builtin caller compgen complete enable fc logout mapfile readarray shopt suspend times disown",
    "echo hello",
  ],
  [
    "service chkconfig loginctl hostnamectl localectl networkctl busctl systemd-analyze systemd-cgls systemd-cgtop machinectl coredumpctl update-alternatives",
    "systemctl list-units --failed",
  ],
  ["ntpq ntpdate ntpstat hwclock chronyd", "chronyc tracking"],
  [
    "mysql mysqldump mysqladmin pg_dump pg_dumpall pg_ctl pg_restore pg_basebackup redis-cli mongo mongosh sqlite3 sqlplus",
    "echo hello",
  ],
  ["shutdown poweroff halt init telinit", "uptime"],
];

const BY_NAME: ReadonlyMap<string, string> = new Map(
  FAMILIES.flatMap(([names, example]) =>
    names
      .split(" ")
      .filter((n) => /^[\w.[-]+$/.test(n))
      .map((n) => [n, example] as const),
  ),
);

/** The example of a real command the fake lacks; undefined for a name no real host has (or one this list does not know). */
export const realCommandExample = (name: string): string | undefined => BY_NAME.get(name);

/** Every name the list holds (the tests check none of them is also in the command table). */
export const realCommandNames = (): string[] => [...BY_NAME.keys()];

/** Every example (the tests run each). */
export const realCommandExamples = (): string[] => [...new Set(BY_NAME.values())];
