#!/usr/bin/env python3
"""Summarise results/<label>/*.json (vitest JSON reports): pass/fail per file and every failure with its first message."""
import json
import re
import os
import sys

label = sys.argv[1] if len(sys.argv) > 1 else "compat"
root = os.path.join(os.path.dirname(__file__), "..", "results", label)
tot = [0, 0, 0]
rows = []
fails = []
for name in sorted(os.listdir(root)):
    if not name.endswith(".json"):
        continue
    d = json.load(open(os.path.join(root, name)))
    t, p, f = d["numTotalTests"], d["numPassedTests"], d["numFailedTests"]
    # a file that failed to load has no tests: count it as one failure
    loaderr = [r for r in d["testResults"] if r["status"] == "failed" and not r["assertionResults"]]
    if loaderr and t == 0:
        f = 1
        t = 1
        fails.append((name, "(file did not load)", loaderr[0].get("message", "")[:300]))
    tot[0] += t
    tot[1] += p
    tot[2] += f
    rows.append((name[:-5], t, p, f))
    for r in d["testResults"]:
        for a in r["assertionResults"]:
            if a["status"] == "failed":
                msg = (a["failureMessages"] or [""])[0].split("\n")
                snippet = ""
                for line in (a["failureMessages"] or [""])[0].split("\n"):
                    m = re.search(r"(/[^ ()]*\.test\.ts):(\d+)", line)
                    if m and "/tests/spec/" in line:
                        path, ln = m.group(1), m.group(2)
                        try:
                            src = open(path).read().split("\n")
                            snippet = " >> " + " / ".join(x.strip() for x in src[max(0, int(ln) - 3):int(ln)])[:300]
                        except Exception:
                            pass
                        break
                fails.append((name[:-5], a["fullName"], " | ".join(m.strip() for m in msg[:3])[:300] + snippet))
print("| file | tests | pass | fail |")
print("|---|---|---|---|")
for r in rows:
    print("| %s | %d | %d | %d |" % r)
print("| **total** | %d | %d | %d |" % tuple(tot))
print()
for f in fails:
    print("FAIL", f[0], "::", f[1])
    print("    ", f[2])
