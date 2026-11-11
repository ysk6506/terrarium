/**
 * The virtual file system of a fake host (ADR-0117 decision 1). There is no stored tree: it is described, node by
 * node, from the host's seed, time and state each time a command asks, and the content of a file is only made
 * when something reads it. `/proc` and `/var/log` come out of the process table and the event list; a fault
 * changes the tree (a big file under /var/log, a certificate that expired, a resolv.conf that points nowhere).
 * The few things an operator can write are kept in the host's state and laid over the tree.
 */

import { buildEtc } from "./fs-etc";
import { buildProc } from "./fs-proc";
import { buildVar } from "./fs-var";
import type { OsHost } from "./host";

export interface FsNode {
  readonly type: "f" | "d" | "l";
  /** Permission bits, e.g. 0o644. */
  readonly mode: number;
  readonly owner: string;
  readonly group: string;
  /** Size in bytes (for a directory, the size of the directory entry itself). */
  readonly size: () => number;
  /** World time of the last change. */
  readonly mtime: number;
  readonly content?: () => string;
  readonly target?: string;
}

export interface FileOptions {
  readonly content?: () => string;
  readonly size?: number | (() => number);
  readonly mode?: number;
  readonly owner?: string;
  readonly group?: string;
  readonly mtime?: number;
}

const DIR_SIZE = 4096;

/** What `os.files` keeps of a path an operator wrote (`text`), made (`dir`) or linked (`link`). */
interface OverlayEntry {
  readonly t: number;
  readonly text: string;
  readonly dir?: true;
  readonly link?: string;
}

/** Collects the nodes of a tree; parent directories appear by themselves. */
export class TreeBuilder {
  readonly nodes = new Map<string, FsNode>();

  constructor(readonly h: OsHost) {}

  dir(path: string, owner = "root", mode = 0o755): void {
    if (path !== "/" && !this.nodes.has(path)) this.dir(parentOf(path));
    if (!this.nodes.has(path))
      this.nodes.set(path, {
        type: "d",
        mode,
        owner,
        group: owner,
        size: () => DIR_SIZE,
        mtime: this.h.bootT,
      });
  }

  file(path: string, o: FileOptions = {}): void {
    this.dir(parentOf(path));
    const content = o.content;
    const size =
      typeof o.size === "number"
        ? () => o.size as number
        : (o.size ?? (() => (content ? content().length : 0)));
    this.nodes.set(path, {
      type: "f",
      mode: o.mode ?? 0o644,
      owner: o.owner ?? "root",
      group: o.group ?? o.owner ?? "root",
      size,
      mtime: o.mtime ?? this.h.bootT,
      ...(content ? { content } : {}),
    });
  }

  /** A file with fixed text. */
  text(path: string, text: string, o: Omit<FileOptions, "content"> = {}): void {
    this.file(path, { ...o, content: () => text, size: o.size ?? text.length });
  }
}

export function parentOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
}

export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** `a/./b/../c` made absolute against `cwd`. */
export function normalize(cwd: string, path: string): string {
  const parts = (path.startsWith("/") ? path : `${cwd}/${path}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return `/${out.join("/")}`;
}

export interface FsStat {
  readonly path: string;
  readonly type: "f" | "d" | "l";
  readonly mode: number;
  readonly owner: string;
  readonly group: string;
  readonly size: number;
  readonly mtime: number;
  readonly target?: string;
}

/** Why a write was refused. */
export type WriteDenied = "ro" | "denied" | "protected";

const WRITE_ROOTS = ["/var", "/tmp", "/home", "/etc", "/srv", "/run", "/mnt", "/dev/shm"];
const REMOVE_ROOTS = ["/var", "/tmp", "/home", "/srv", "/run", "/mnt", "/dev/shm"];
const under = (path: string, roots: readonly string[]): boolean =>
  roots.some((r) => path === r || path.startsWith(`${r}/`));

/** How many links one path may pass through before it is "too many levels of symbolic links". */
const LINK_LIMIT = 16;
/** Where a loop of symbolic links leads ("Too many levels of symbolic links"): nothing is there. */
export const LINK_LOOP = "/<too many levels of symbolic links>";

export class VirtualFs {
  private readonly nodes: Map<string, FsNode>;
  private children: Map<string, string[]> | undefined;
  /** Whether some node is a symbolic link (paths then need resolving): only an operator makes one. */
  private linked = false;

  constructor(
    readonly h: OsHost,
    bins: readonly string[],
  ) {
    const b = new TreeBuilder(h);
    buildProc(b);
    buildEtc(b);
    buildVar(b, bins);
    this.nodes = b.nodes;
    this.overlay();
  }

  /** What an operator wrote, made or removed lies over the described tree. */
  private overlay(): void {
    const { files, removed } = this.h.os;
    for (const [path, f] of Object.entries(files ?? {})) {
      const base = this.nodes.get(path);
      this.nodes.set(path, this.overlayNode(f, base));
      this.linked ||= f.link !== undefined;
      if (!base) this.ensureDir(parentOf(path));
    }
    for (const path of removed ?? []) this.drop(path);
  }

  private overlayNode(f: OverlayEntry, base: FsNode | undefined): FsNode {
    const owner = base?.owner ?? "root";
    const group = base?.group ?? "root";
    if (f.link !== undefined) {
      const target = f.link;
      return {
        type: "l",
        mode: 0o777,
        owner,
        group,
        size: () => target.length,
        mtime: f.t,
        target,
      };
    }
    if (f.dir)
      return {
        type: "d",
        mode: base?.mode ?? 0o755,
        owner,
        group,
        size: () => DIR_SIZE,
        mtime: f.t,
      };
    return {
      type: "f",
      mode: base?.mode ?? 0o644,
      owner,
      group,
      size: () => f.text.length,
      mtime: f.t,
      content: () => f.text,
    };
  }

  private ensureDir(path: string): void {
    if (path === "/" || this.nodes.has(path)) return;
    this.ensureDir(parentOf(path));
    this.nodes.set(path, {
      type: "d",
      mode: 0o755,
      owner: "root",
      group: "root",
      size: () => DIR_SIZE,
      mtime: this.h.bootT,
    });
  }

  private drop(path: string): void {
    this.nodes.delete(path);
    const prefix = `${path}/`;
    for (const key of [...this.nodes.keys()]) if (key.startsWith(prefix)) this.nodes.delete(key);
  }

  /**
   * The path with the symbolic links on the way replaced by what they point to; the last part too when
   * `followLast`. A loop of links (LINK_LIMIT hops without an end) leads to `LINK_LOOP`, a place that is not there.
   */
  resolve(path: string, followLast: boolean): string {
    if (!this.linked) return path;
    let cur = path;
    for (let hops = 0; hops < LINK_LIMIT; hops++) {
      const next = this.hop(cur, followLast);
      if (next === undefined) return cur;
      cur = next;
    }
    return LINK_LOOP;
  }

  /** One link of the path replaced by its target, or undefined when the path has none left. */
  private hop(path: string, followLast: boolean): string | undefined {
    const parts = path.split("/").filter(Boolean);
    let prefix = "";
    for (const [i, part] of parts.entries()) {
      prefix += `/${part}`;
      const n = this.nodes.get(prefix);
      if (n?.type !== "l" || n.target === undefined) continue;
      if (i === parts.length - 1 && !followLast) return undefined;
      const rest = parts.slice(i + 1).join("/");
      const base = normalize(parentOf(prefix), n.target);
      return rest ? `${base === "/" ? "" : base}/${rest}` : base;
    }
    return undefined;
  }

  /** What `lstat` says: the link itself, not what it points to. */
  stat(path: string): FsStat | undefined {
    const at = this.resolve(path, false);
    if (at === "/")
      return {
        path,
        type: "d",
        mode: 0o755,
        owner: "root",
        group: "root",
        size: DIR_SIZE,
        mtime: this.h.bootT,
      };
    const n = this.nodes.get(at);
    if (!n) return undefined;
    return {
      path,
      type: n.type,
      mode: n.mode,
      owner: n.owner,
      group: n.group,
      size: n.size(),
      mtime: n.mtime,
      ...(n.target ? { target: n.target } : {}),
    };
  }

  exists(path: string): boolean {
    const at = this.resolve(path, false);
    return at === "/" || this.nodes.has(at);
  }

  /** Whether the path is a directory, or a link to one. */
  isDir(path: string): boolean {
    const at = this.resolve(path, true);
    return at === "/" || this.nodes.get(at)?.type === "d";
  }

  /** The names in a directory, sorted; undefined when it is not one. */
  list(path: string): string[] | undefined {
    if (!this.isDir(path)) return undefined;
    if (!this.children) {
      const map = new Map<string, string[]>();
      for (const key of this.nodes.keys()) {
        if (key === "/") continue; // the root is nobody's child
        const parent = parentOf(key);
        map.set(parent, [...(map.get(parent) ?? []), baseName(key)]);
      }
      for (const list of map.values()) list.sort();
      this.children = map;
    }
    return this.children.get(this.resolve(path, true)) ?? [];
  }

  /** The text of a file, following links; undefined when it is not a readable file. */
  read(path: string): string | undefined {
    const n = this.nodes.get(this.resolve(path, true));
    return n?.type === "f" ? (n.content ? n.content() : "") : undefined;
  }

  /**
   * `path` and everything under it, directories first, in name order. Links are listed but not entered, and
   * the walk keeps its own stack: the whole tree of a host is far deeper than a call stack allows.
   */
  walk(path: string): string[] {
    const out: string[] = [];
    const todo = [path];
    for (let p = todo.pop(); p !== undefined; p = todo.pop()) {
      out.push(p);
      if (this.nodes.get(p)?.type === "l") continue;
      const names = this.list(p) ?? [];
      for (let i = names.length - 1; i >= 0; i--)
        todo.push(p === "/" ? `/${names[i]}` : `${p}/${names[i]}`);
    }
    return out;
  }

  /** Bytes under a path, the way `du -b` adds them up. */
  usage(path: string): number {
    let sum = 0;
    for (const p of this.walk(path)) sum += this.stat(p)?.size ?? 0;
    return sum;
  }

  /** Why a path cannot be written (`>`, `tee`, `truncate`), if it cannot. */
  denyWrite(path: string): WriteDenied | undefined {
    if (path === "/dev/null") return undefined;
    if (!under(path, WRITE_ROOTS)) return "denied";
    return this.h.os.fs === "ro" && !under(path, ["/tmp", "/run", "/dev/shm"]) ? "ro" : undefined;
  }

  /** Why a path cannot be removed (`rm`), if it cannot. */
  denyRemove(path: string): WriteDenied | undefined {
    if (!under(path, REMOVE_ROOTS)) return "protected";
    return this.h.os.fs === "ro" && !under(path, ["/tmp", "/run", "/dev/shm"]) ? "ro" : undefined;
  }
}
