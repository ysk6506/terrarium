/**
 * `mkdir`, `ln -s` and `readlink` of the fake shell (REQ-098). A directory or a symbolic link made here is a
 * `host.act` (`mkdir`, `symlink`) like every other write, so a replay and a fast-forward give the same tree.
 * Hard links are not simulated: a tree that is described, not stored, has no inodes to share.
 */
import { has, hasAny, parseArgs } from "./args";
import { shown } from "./cmd-fs";
import { baseName, LINK_LOOP, normalize, parentOf } from "./fs";
import { act, type Cmd, fail, ok, type R, unsupported } from "./types";

const REFUSED = {
  ro: "Read-only file system",
  denied: "Permission denied",
  protected: "Permission denied",
};

/** Why `path` cannot be made: the message after `cannot create …: `, or undefined when it can. */
function blocker(c: Cmd, path: string): string | undefined {
  const denied = c.fs.denyWrite(path);
  if (denied) return REFUSED[denied];
  if (!c.fs.exists(parentOf(path))) return "No such file or directory";
  return c.fs.isDir(parentOf(path)) ? undefined : "Not a directory";
}

/** The directories `mkdir -p` has to make for `path`, outermost first (none when it is there). */
function missingDirs(c: Cmd, path: string): string[] {
  const out: string[] = [];
  for (let p = path; p !== "/" && !c.fs.exists(p); p = parentOf(p)) out.unshift(p);
  return out;
}

function makeDir(
  c: Cmd,
  name: string,
  opts: { parents: boolean; verbose: boolean },
  say: string[],
): string | undefined {
  const path = shown(c, name);
  const refuse = (why: string): string => `mkdir: cannot create directory '${name}': ${why}`;
  if (c.fs.exists(path))
    return opts.parents && c.fs.isDir(path) ? undefined : refuse("File exists");
  const dirs = opts.parents ? missingDirs(c, path) : [path];
  // the outermost one decides: what is made after it stands inside it
  const why = blocker(c, dirs[0] as string);
  if (why) return refuse(why);
  for (const dir of dirs) {
    act(c, "mkdir", dir);
    if (opts.verbose) say.push(`mkdir: created directory '${dir === path ? name : dir}'`);
  }
  return undefined;
}

export function mkdir(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "pv", val: "m", long: { parents: "bool", verbose: "bool" } });
  if (p.bad) return unsupported("mkdir", p.bad);
  if (has(p, "m")) return unsupported("mkdir", "-m (권한은 정하지 않아요)");
  if (p.rest.length === 0)
    return fail("mkdir: missing operand\nTry 'mkdir --help' for more information.", 1);
  const parents = hasAny(p, "p", "--parents");
  const verbose = hasAny(p, "v", "--verbose");
  const say: string[] = [];
  const errs = p.rest
    .map((name) => makeDir(c, name, { parents, verbose }, say))
    .filter((e): e is string => e !== undefined);
  return {
    out: say.length ? `${say.join("\n")}\n` : "",
    err: errs.length ? `${errs.join("\n")}\n` : "",
    code: errs.length ? 1 : 0,
  };
}

/** Where `ln -s TARGET NAME` puts the link: inside NAME when that is a directory. */
function linkPlace(c: Cmd, target: string, name: string): { path: string; label: string } {
  const into = c.fs.isDir(shown(c, name));
  const label = into ? `${name.replace(/\/$/, "")}/${baseName(target)}` : name;
  return { path: shown(c, label), label };
}

export function ln(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "sfnvT",
    long: { symbolic: "bool", force: "bool", verbose: "bool" },
  });
  if (p.bad) return unsupported("ln", p.bad);
  if (!hasAny(p, "s", "--symbolic"))
    return unsupported("ln", "하드 링크는 못 만들어요 (-s만 돼요)");
  const [target, name = baseName(p.rest[0] ?? "")] = p.rest;
  if (target === undefined || p.rest.length > 2)
    return fail(target === undefined ? "ln: missing file operand" : "ln: extra operand", 1);
  const { path, label } = linkPlace(c, target, name);
  const why = linkBlocker(c, path, hasAny(p, "f", "--force"));
  if (why) return fail(`ln: failed to create symbolic link '${label}': ${why}`, 1);
  act(c, "symlink", path, target);
  return ok(hasAny(p, "v", "--verbose") ? `'${label}' -> '${target}'\n` : "");
}

/** Why `ln -s` cannot put a link at `path`, or undefined when it can. */
function linkBlocker(c: Cmd, path: string, force: boolean): string | undefined {
  if (c.fs.exists(path) && !force) return "File exists";
  if (c.fs.isDir(path) && !c.fs.stat(path)?.target) return "File exists";
  return blocker(c, path);
}

type Canon = "none" | "f" | "e" | "m";

/** Which of `readlink`'s modes the options ask for: the link itself, or the final place with all, all but the last, or none of the parts there. */
function canonMode(p: ReturnType<typeof parseArgs>): Canon {
  if (hasAny(p, "e", "--canonicalize-existing")) return "e";
  if (hasAny(p, "m", "--canonicalize-missing")) return "m";
  return hasAny(p, "f", "--canonicalize") ? "f" : "none";
}

/** The answer of `readlink` for one path, or undefined when it has none (the exit code is then 1). */
function readOne(c: Cmd, mode: Canon, path: string): string | undefined {
  if (mode === "none") {
    const st = c.fs.stat(path);
    return st?.type === "l" ? st.target : undefined;
  }
  const where = normalize("/", c.fs.resolve(path, true));
  if (where === LINK_LOOP) return undefined;
  if (mode === "m") return where;
  const need = mode === "e" ? where : parentOf(where);
  return c.fs.exists(need) ? where : undefined;
}

export function readlink(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "femnqsv",
    long: {
      canonicalize: "bool",
      "canonicalize-existing": "bool",
      "canonicalize-missing": "bool",
      "no-newline": "bool",
    },
  });
  if (p.bad) return unsupported("readlink", p.bad);
  if (p.rest.length === 0) return fail("readlink: missing operand", 1);
  const end = hasAny(p, "n", "--no-newline") ? "" : "\n";
  const answers = p.rest.map((name) => readOne(c, canonMode(p), shown(c, name)));
  return {
    out: answers.map((a) => (a === undefined ? "" : `${a}${end}`)).join(""),
    code: answers.includes(undefined) ? 1 : 0,
  };
}
