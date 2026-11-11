/** The commands the fake shell has (ADR-0117 decision 4). A name that is not here is `command not found`. */
import { awk } from "./awk";
import { multipath, pgIsReady, psql } from "./cmd-db";
import { find } from "./cmd-find";
import { cp, du, env, ls, rm, stat, touch, truncate } from "./cmd-fs";
import { grep } from "./cmd-grep";
import { ln, mkdir, readlink } from "./cmd-link";
import { dmesg, journalctl } from "./cmd-log";
import { curl, dig, nslookup, ping } from "./cmd-net";
import { kill, nice, pgrep, pidof, pkill, ps, top } from "./cmd-proc";
import { ip, lsof, netstat, ss } from "./cmd-sock";
import { sort } from "./cmd-sort";
import {
  date,
  df,
  free,
  hostname,
  id,
  logrotate,
  lsblk,
  mount,
  reboot,
  uname,
  uptime,
  whoami,
} from "./cmd-sys";
import { cat, cut, echo, head, printf, tail, tee, testCmd, tr, uniq, wc, xargs } from "./cmd-text";
import { chronyc, openssl, timedatectl } from "./cmd-time";
import { sed } from "./sed";
import type { Handler } from "./types";
import { systemctl } from "./units";

export const COMMANDS: Readonly<Record<string, Handler>> = {
  cat,
  ls,
  du,
  df,
  free,
  top,
  ps,
  ss,
  netstat,
  ip,
  ping,
  curl,
  dig,
  nslookup,
  date,
  uptime,
  hostname,
  mount,
  lsblk,
  lsof,
  stat,
  tail,
  head,
  grep,
  egrep: grep,
  fgrep: grep,
  awk,
  sed,
  sort,
  uniq,
  wc,
  cut,
  tr,
  xargs,
  find,
  echo,
  env,
  printenv: env,
  kill,
  pkill,
  pgrep,
  pidof,
  nice,
  chronyc,
  timedatectl,
  pg_isready: pgIsReady,
  psql,
  multipath,
  systemctl,
  journalctl,
  dmesg,
  openssl,
  logrotate,
  rm,
  truncate,
  reboot,
  tee,
  printf,
  touch,
  cp,
  mv: cp,
  mkdir,
  ln,
  readlink,
  test: testCmd,
  "[": testCmd,
  whoami,
  id,
  uname,
};
