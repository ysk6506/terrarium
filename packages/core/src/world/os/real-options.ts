/**
 * What the real tools accept (ADR-0184). When the fake meets a flag it does not implement, the first question is
 * whether the real tool has that flag: if it does, the fake is missing something (a gap, with a hint); if not, the real
 * tool would refuse too and the fake says what the real one says, with no hint.
 *
 * The tables list every option the tool documents (GNU coreutils 9 `--help`, procps-ng, util-linux, iproute2, curl,
 * systemd man pages), not just the ones the fake has. A new real flag the table lacks reads as a genuine error; the fix
 * is to add it here. `example` is a command that works on the fake and is run by a test.
 */
import type { FlagSpec, Parsed } from "./args";
import { emulationGap, type R } from "./types";

/** How the real tool words a refused option. */
type Style =
  | "gnu"
  | "grep"
  | "sed"
  | "procps"
  | "ps"
  | "top"
  | "curl"
  | "lsof"
  | "hostname"
  | "awk";

interface Real {
  /** Short options, one letter each. */
  readonly short: string;
  /** Long options, space separated, without the dashes. */
  readonly long: string;
  /** A command that works in any world; none when no command is right everywhere (`ping` needs a host that exists). */
  readonly example?: string;
  readonly style?: Style;
  /** The exit status of a refused option (1 unless the tool says otherwise). */
  readonly code?: number;
}

const CURL_LONG =
  "anyauth append basic cacert capath cert ciphers compressed config connect-timeout continue-at cookie cookie-jar create-dirs crlf data data-ascii data-binary data-raw data-urlencode digest dump-header fail fail-early fail-with-body form get globoff head header help http1.0 http1.1 http2 include insecure interface ipv4 ipv6 json keepalive-time key limit-rate list-only location location-trusted manual max-filesize max-redirs max-time netrc no-buffer no-keepalive noproxy output output-dir parallel post301 post302 post303 proxy proxy-user proto range raw referer remote-header-name remote-name remote-time request resolve retry retry-all-errors retry-delay retry-max-time show-error silent speed-limit speed-time ssl ssl-reqd stderr tcp-nodelay time-cond tls-max tlsv1 trace trace-ascii unix-socket upload-file url user user-agent verbose version write-out";

const REAL: Readonly<Record<string, Real>> = {
  ls: {
    short: "1ABCDFGHILNQRSTUXZabcdfghiklmnopqrstuvwx",
    long: "all almost-all author block-size classify color context dereference dereference-command-line dereference-command-line-symlink-to-dir directory dired escape file-type format full-time group-directories-first help hide hide-control-chars human-readable hyperlink ignore ignore-backups indicator-style inode kibibytes literal no-group numeric-uid-gid quote-name quoting-style recursive reverse show-control-chars si size sort tabsize time time-style version width zero",
    example: "ls -la /etc",
    code: 2,
  },
  du: {
    short: "0BDHLPSXabcdhklmstx",
    long: "all apparent-size block-size bytes count-links dereference dereference-args exclude exclude-from files0-from help human-readable inodes max-depth no-dereference null one-file-system separate-dirs si summarize threshold time time-style total version",
    example: "du -sh /var/log",
  },
  stat: {
    short: "Lcft",
    long: "cached dereference file-system format help printf terse version",
    example: "stat /etc/hosts",
  },
  rm: {
    short: "IRdfirv",
    long: "dir force help interactive no-preserve-root one-file-system preserve-root recursive verbose version",
    example: "rm -f /tmp/terrarium-demo",
  },
  truncate: {
    short: "cors",
    long: "help io-blocks no-create reference size version",
    example: "touch /tmp/terrarium-trunc && truncate -s 0 /tmp/terrarium-trunc",
  },
  grep: {
    short: "0123456789ABCDEFGHILPRTUVZabcdefhilmnoqrsvwxyz",
    long: "after-context basic-regexp before-context binary binary-files byte-offset color colour context count dereference-recursive devices directories exclude exclude-dir exclude-from extended-regexp file files-with-matches files-without-match fixed-strings group-separator help ignore-case include initial-tab invert-match label line-buffered line-number line-regexp max-count no-filename no-group-separator no-ignore-case no-messages null null-data only-matching perl-regexp quiet recursive regexp silent text version with-filename word-regexp",
    example: "grep -n root /etc/passwd",
    style: "grep",
    code: 2,
  },
  free: {
    short: "Vbcghklmstvw",
    long: "bytes committed count gibi giga help human kibi kilo line lohi mebi mega pebi peta seconds si tebi tera total version wide",
    example: "free -m",
    style: "procps",
  },
  df: {
    short: "BHPTahikltvx",
    long: "all block-size exclude-type help human-readable inodes local no-sync output portability print-type si sync total type version",
    example: "df -h",
  },
  uptime: {
    short: "Vhps",
    long: "help pretty since version",
    example: "uptime -p",
    style: "procps",
  },
  date: {
    short: "IRdfrsu",
    long: "date debug file help iso-8601 reference resolution rfc-3339 rfc-email set universal utc version",
    example: "date -u",
  },
  hostname: {
    short: "AFIVabdfhisy",
    long: "alias all-fqdns all-ip-addresses boot domain file fqdn help ip-address long nis short version yp",
    example: "hostname -s",
    style: "hostname",
    code: 255,
  },
  uname: {
    short: "aimnoprsv",
    long: "all hardware-platform help kernel-name kernel-release kernel-version machine nodename operating-system processor version",
    example: "uname -r",
  },
  mount: {
    short: "BFLMNORTUVacfhilmnortvw",
    long: "all bind fake fork fstab help internal-only label make-private make-rprivate make-rshared make-rslave make-runbindable make-shared make-slave make-unbindable mkdir move namespace no-canonicalize no-mtab onlyonce options options-mode options-source options-source-force rbind read-only read-write rw show-labels source target target-prefix test-opts types uuid verbose version",
    example: "mount",
  },
  logrotate: {
    short: "dfmsvl?",
    long: "debug force help log mail state usage verbose version",
    example: "logrotate -d /etc/logrotate.conf",
    style: "gnu",
  },
  sort: {
    short: "CMRSTVbcdfghikmnorstuz",
    long: "batch-size buffer-size check compress-program debug dictionary-order field-separator files0-from general-numeric-sort help human-numeric-sort ignore-case ignore-leading-blanks ignore-nonprinting key merge month-sort numeric-sort output parallel random-sort random-source reverse sort stable temporary-directory unique version version-sort zero-terminated",
    example: "sort -u /etc/hosts",
    code: 2,
  },
  ps: {
    short: "AaCcdeFfGgHhjLlMmNnOoPpqRrSsTtUuVvwXxyZ",
    long: "Group User cols columns context cumulative deselect forest format group headers help info lines no-headers pid ppid quick-pid rows sid signames sort tty user version width",
    example: "ps aux",
    style: "ps",
  },
  top: {
    short: "1EHOSUVbcdehinopsuw",
    long: "accum-time-toggle batch-mode cmdline-toggle delay filter-any-user filter-only-euser help idle-toggle iterations list-fields pid scale-summary-mem scale-task-mem secure-mode single-cpu-toggle sort-override threads-show version width",
    example: "top -b -n 1",
    style: "top",
  },
  mkdir: {
    short: "Zmpv",
    long: "context help mode parents verbose version",
    example: "mkdir -p /tmp/terrarium-demo",
  },
  ln: {
    short: "FLPSTbdfinrstv",
    long: "backup directory force help interactive logical no-dereference no-target-directory physical relative suffix symbolic target-directory verbose version",
    example: "ln -s /etc/hosts /tmp/terrarium-link",
  },
  readlink: {
    short: "efmnqsvz",
    long: "canonicalize canonicalize-existing canonicalize-missing help no-newline quiet silent verbose version zero",
    example: "readlink -f /etc/hosts",
  },
  cat: {
    short: "AETbenstuv",
    long: "help number number-nonblank show-all show-ends show-nonprinting show-tabs squeeze-blank version",
    example: "cat -n /etc/hosts",
  },
  head: {
    short: "0123456789cnqvz",
    long: "bytes help lines quiet silent verbose version zero-terminated",
    example: "head -n 5 /etc/passwd",
  },
  tail: {
    short: "0123456789Fcfnqsvz",
    long: "bytes follow help lines max-unchanged-stats pid quiet retry silent sleep-interval verbose version zero-terminated",
    example: "tail -n 20 /var/log/messages",
  },
  wc: {
    short: "Lclmw",
    long: "bytes chars files0-from help lines max-line-length total version words",
    example: "wc -l /etc/passwd",
  },
  tr: {
    short: "Ccdst",
    long: "complement delete help squeeze-repeats truncate-set1 version",
    example: "echo abc | tr a-z A-Z",
  },
  cut: {
    short: "Mbcdfnsz",
    long: "bytes characters complement delimiter fields help only-delimited output-delimiter version zero-terminated",
    example: "cut -d: -f1 /etc/passwd",
  },
  uniq: {
    short: "Dcdfisuwz",
    long: "all-repeated check-chars count group help ignore-case repeated skip-chars skip-fields unique version zero-terminated",
    example: "sort /etc/hosts | uniq -c",
  },
  xargs: {
    short: "0EILPadeilnoprstx",
    long: "arg-file delimiter eof exit help interactive max-args max-chars max-lines max-procs no-run-if-empty null open-tty process-slot-var replace show-limits verbose version",
    example: "echo a b | xargs echo",
  },
  awk: {
    short: "FfvbcCdDeEghilLMnNoOpPrsStVW",
    long: "assign characters-as-bytes copyright csv debug dump-variables exec field-separator file gen-pot help include lint lint-old load no-optimize non-decimal-data optimize posix pretty-print profile re-interval sandbox source traditional use-lc-numeric version",
    example: "awk 'NR==2{print $1}' /etc/hosts",
    style: "awk",
    code: 2,
  },
  sed: {
    short: "Eefilnrsuz",
    long: "debug expression file follow-symlinks help in-place line-length null-data posix quiet regexp-extended sandbox separate silent unbuffered version",
    example: "sed -n 1p /etc/hosts",
    style: "sed",
  },
  systemctl: {
    short: "tpalhqHMnosrfi",
    long: "after all before boot-loader-menu check-inhibitors dry-run fail failed force full global help host ignore-inhibitors job-mode kill-whom lines machine marked no-ask-password no-block no-legend no-pager no-reload no-wall now output plain preset-mode property quiet recursive reverse runtime show-types signal state system timestamp type user value version with-dependencies",
    example: "systemctl list-units --failed",
  },
  journalctl: {
    short: "DFMNSUabcefghklmnopqrtux",
    long: "after-cursor all boot case-sensitive catalog cursor cursor-file directory disk-usage dmesg facility field fields file flush follow grep header help identifier image interval lines list-boots list-catalog machine merge namespace no-full no-hostname no-pager no-tail output output-fields pager-end priority quiet reverse root rotate setup-keys show-cursor since sync system truncate-newline unit until update-catalog user user-unit utc vacuum-files vacuum-size vacuum-time verify verify-key version",
    example: "journalctl -n 5",
  },
  dmesg: {
    short: "CDEFHJLPSTVWcdefhklnprstuwx",
    long: "buffer-size clear color console-level console-off console-on ctime decode facility file follow follow-new force-prefix help human json kernel level noescape nopager notime raw read-clear reltime show-delta since syslog time-format until userspace version",
    example: "dmesg",
  },
  lsof: {
    short: "?abhKlnNoOPRtUvVXcdDeEfFgGiLmMprsSTuwxZ",
    long: "help version",
    example: "lsof -i -P -n",
    style: "lsof",
  },
  curl: {
    short: "012346ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz",
    long: CURL_LONG,
    style: "curl",
    code: 2,
  },
  ping: {
    short: "46aAbBcdDfhiIlLmMnNOpqQrRsStTUvVwW",
    long: "help version",
    code: 2,
  },
  ss: {
    short: "0HEFOVZ46abdefhilmnoprstuwxz",
    long: "all bpf contexts dccp family help info listening memory no-header numeric options packet processes raw resolve summary tcp udp unix version vsock",
    example: "ss -tln",
    code: 255,
  },
  netstat: {
    short: "46AcCdeFghiIlLMnNopPrstuvVwWxZa",
    long: "all continuous extend groups help interfaces listening masquerade numeric numeric-hosts numeric-ports numeric-users program route statistics symbolic tcp timers udp unix verbose version wide",
    example: "netstat -tln",
  },
  cp: {
    short: "HLPRSTZabdfilnprstuvxz",
    long: "archive attributes-only backup context copy-contents debug dereference force help hard-link interactive link no-clobber no-dereference no-preserve no-target-directory one-file-system parents preserve recursive reflink remove-destination sparse strip-trailing-slashes suffix symbolic-link target-directory update verbose version",
    example: "cp /etc/hosts /tmp/terrarium-copy",
  },
  mv: {
    short: "STZbfintuv",
    long: "backup context debug force help interactive no-clobber no-target-directory strip-trailing-slashes suffix target-directory update verbose version",
    example: "cp /etc/hosts /tmp/terrarium-copy",
  },
};

const wordsOf = (s: string): string[] => s.split(" ");

/** The long option a typed `--name[=value]` stands for: exact, or the one the real tool accepts as an abbreviation. */
function canonicalLong(real: Real, typed: string): string | undefined {
  const name = typed.slice(2).split("=")[0] ?? "";
  const names = wordsOf(real.long);
  if (name === "") return undefined;
  if (names.includes(name)) return name;
  const hits = names.filter((n) => n.startsWith(name));
  return hits.length === 1 ? hits[0] : undefined;
}

/** The option the real tool documents for a rejected one, as the key the gap is recorded under; undefined when it has none. */
export function realOption(tool: string, bad: string): string | undefined {
  const real = REAL[tool];
  if (!real) return undefined;
  if (bad.startsWith("--")) {
    const long = canonicalLong(real, bad);
    return long === undefined ? undefined : `--${long}`;
  }
  const ch = bad.charAt(1);
  return ch !== "" && real.short.includes(ch) ? `-${ch}` : undefined;
}

/** Whether the tool has a table here (a tool without one cannot tell a gap from a mistake). */
export const hasRealOptions = (tool: string): boolean => tool in REAL;

/** The example of a tool, for the tests and for gaps raised from elsewhere. */
export const exampleOf = (tool: string): string | undefined => REAL[tool]?.example;

/** Every tool that has a table (the tests run each example). */
export const realTools = (): string[] => Object.keys(REAL);

/** The first line of a refused option as the real tool words it. */
function refusal(tool: string, bad: string, style: Style): string[] {
  const long = bad.startsWith("--");
  const first = long
    ? `${tool}: unrecognized option '${bad}'`
    : `${tool}: invalid option -- '${bad.charAt(1)}'`;
  switch (style) {
    case "grep":
      return [
        first,
        "Usage: grep [OPTION]... PATTERNS [FILE]...",
        "Try 'grep --help' for more information.",
      ];
    case "sed":
      return [first, "Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]..."];
    case "procps":
      return [first, "", "Usage:", ` ${tool} [options]`, "", `For more details see ${tool}(1).`];
    case "ps":
      return [
        long ? "error: unknown gnu long option" : "error: garbage option",
        "",
        "Usage:",
        " ps [options]",
        "",
        " Try 'ps --help <simple|list|output|threads|misc|all>'",
        "  or 'ps --help <s|l|o|t|m|a>'",
        " for additional help text.",
        "",
        "For more details see ps(1).",
      ];
    case "top":
      return [
        first,
        "Usage:",
        " top -hv | -bcEeHiOSs1 -d secs -n max -u|U user -p pid(s) -o field -w [cols]",
      ];
    case "curl":
      return [
        `curl: option ${bad.split("=")[0]}: is unknown`,
        "curl: try 'curl --help' or 'curl --manual' for more information",
      ];
    case "lsof":
      return [`lsof: illegal option character: ${bad.charAt(1)}`];
    case "hostname":
      return [first, "Usage: hostname [-b] {hostname|-F file}         set host name (from file)"];
    case "awk":
      return [`awk: not an option: ${bad}`];
    default:
      return [first, `Try '${tool} --help' for more information.`];
  }
}

/** A refused option the real tool would also refuse: its own words, its own exit status, no hint. */
export function genuineOption(tool: string, bad: string): R {
  const real = REAL[tool];
  const lines = refusal(tool, bad, real?.style ?? "gnu");
  return { out: "", err: `${lines.join("\n")}\n`, code: real?.code ?? 1 };
}

/**
 * For a tool that reads its options loosely (`cp`, `mv`): the real tool's refusal of the first option it does not have,
 * or undefined when every option is one the real tool has.
 */
export function refuseUnknown(tool: string, args: readonly string[]): R | undefined {
  const real = REAL[tool];
  if (!real) return undefined;
  for (const a of args) {
    if (a === "--") return undefined;
    if (!a.startsWith("-") || a === "-") continue;
    const unknown = a.startsWith("--")
      ? canonicalLong(real, a) === undefined
      : [...a.slice(1)].some((ch) => !real.short.includes(ch));
    if (unknown) {
      const bad = a.startsWith("--")
        ? a
        : `-${[...a.slice(1)].find((ch) => !real.short.includes(ch))}`;
      return genuineOption(tool, bad);
    }
  }
  return undefined;
}

/** The flags a spec has, compact: `-l -a -h ... --sort`. */
export function flagList(spec: FlagSpec): string {
  const shorts = [...(spec.bool ?? ""), ...(spec.val ?? "")].map((c) => `-${c}`);
  const longs = Object.keys(spec.long ?? {}).map((n) => `--${n}`);
  return [...shorts, ...longs].join(" ") || "(옵션 없음)";
}

/**
 * The answer to the first flag a spec did not know: a gap when the real tool has the flag, the real tool's own
 * refusal when it does not. The tool must have a table above.
 */
export function badFlag(tool: string, p: Parsed, supported?: string): R {
  const bad = p.bad as string;
  const real = REAL[tool];
  const option = realOption(tool, bad);
  if (!real || option === undefined) return genuineOption(tool, bad);
  return emulationGap({
    tool,
    feature: `flag:${option}`,
    what: bad,
    supported: supported ?? flagList(p.spec),
    example: real.example,
  });
}
