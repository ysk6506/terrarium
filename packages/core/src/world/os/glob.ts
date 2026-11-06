/** Shell globs (`*`, `?`, `[...]`) against the virtual file system. */
import { normalize, type VirtualFs } from "./fs";

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob.charAt(i);
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else if (ch === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end < 0) re += "\\[";
      else {
        re += `[${glob.slice(i + 1, end).replace(/^!/, "^")}]`;
        i = end;
      }
    } else re += ch.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** The paths a glob matches, sorted; the glob itself when nothing matches (as bash does). */
export function expandGlob(fs: VirtualFs, cwd: string, glob: string): string[] {
  const absolute = glob.startsWith("/");
  let paths = [absolute ? "/" : cwd];
  for (const seg of glob.split("/").filter((s) => s !== "")) {
    const next: string[] = [];
    for (const dir of paths) {
      if (!/[*?[]/.test(seg)) {
        next.push(normalize(dir, seg));
        continue;
      }
      const re = globToRegExp(seg);
      for (const name of fs.list(dir) ?? [])
        if (re.test(name) && (seg.startsWith(".") || !name.startsWith(".")))
          next.push(normalize(dir, name));
    }
    paths = next.filter((p) => fs.exists(p) || !/[*?[]/.test(seg));
  }
  const found = paths.filter((p) => fs.exists(p));
  if (found.length === 0) return [glob];
  const rel = (p: string): string => (absolute ? p : p.slice(cwd === "/" ? 1 : cwd.length + 1));
  return found.sort().map(rel);
}
