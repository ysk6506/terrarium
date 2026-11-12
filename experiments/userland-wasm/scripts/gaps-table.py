#!/usr/bin/env python3
"""Merge results/gaps-{old,wasm,wasm-awkts}.json into the gap coverage table and the counts."""
import json
import os

R = os.path.join(os.path.dirname(__file__), "..", "results")
load = lambda n: {i["id"]: i for i in json.load(open(os.path.join(R, f"gaps-{n}.json")))}
old, new, newts = load("old"), load("wasm"), load("wasm-awkts")


def ok(item):
    f, r = item["fake"], item["real"]
    if any(g for g in f["gaps"]) or "terrarium:" in f["stderr"]:
        return False
    if item.get("loose"):
        return f["code"] == 0
    return f["code"] == (r["code"] or 0) and f["stdout"] == r["stdout"]


rows = []
counts = {}
for id_, it in new.items():
    o, n, nt = ok(old[id_]), ok(it), ok(newts[id_])
    owner = it["owner"]
    if owner == "world":
        status = "해당 없음 (세계를 읽는 명령)"
        key = "na"
    elif n and not o:
        status = "셸이 닫음" if owner == "shell" else ("goawk가 닫음" if owner == "awk" else "셸이 닫음(효과)")
        key = "shell" if owner != "awk" else "awk"
    elif n and o:
        status = "원래 됐음"
        key = "was-ok"
    else:
        status = "아직 열림 (바꾸지 않은 도구)" if owner == "util" else ("아직 열림 (goawk에 없음)" if owner == "awk" else "아직 열림 (셸)")
        key = "open-util" if owner == "util" else "open-awk" if owner == "awk" else "open-shell"
    counts[key] = counts.get(key, 0) + 1
    rows.append((id_, it["src"], owner, "예" if o else "아니오", "예" if n else "아니오", "예" if nt else "아니오", status))

print("| 항목 | 출처 | 담당 | 옛 셸이 맞음 | 새 셸이 맞음 | (awk는 옛 것) | 판정 |")
print("|---|---|---|---|---|---|---|")
for r in rows:
    print("| " + " | ".join(r) + " |")
print()
print(counts, "total", sum(counts.values()))
print()
for id_, it in new.items():
    if not ok(it) and it["owner"] != "world":
        print("NOT OK:", id_, "| fake:", json.dumps(it["fake"], ensure_ascii=False)[:260], "| real:", json.dumps(it["real"], ensure_ascii=False)[:160])
