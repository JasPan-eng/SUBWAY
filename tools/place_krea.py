"""Assign OSM footprints around Myrtle Av-Broadway to the Krea building models in data/krea_catalog.json.

Each building model gets the nearest footprints whose oriented size and height suit it, never a footprint the hero
layer already uses (station, platforms, fast food, tenements), never one within 14 m of the J route centreline.
Writes placement {"type": "footprints", "ids": [...]} into the catalog entries listed in RULES and prints a summary.
Re-run after adding a model; assignments are deterministic (nearest first, then by id).
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Footprints the hero layer places models on (from hero.placements() in the explorer, 2026-10-28) + the fast food.
HERO_USED = {250317334, 1050009842, 250325864, 1050009843, 298198839, 1050009844, 250408675, 250408579, 250325862,
             250408585, 250408674, 250408584, 250408591, 250408603, 250408590, 250408673, 298198829, 250408596,
             250408610}
# id: (min length, max length, min width, max width, min height, max height, how many, max distance from origin)
RULES = {
    "walkup_4storey": (12, 30, 6, 11, 11.5, 18, 8, 260),
    "ornate_corner": (12, 26, 8, 14, 9, 15, 3, 220),
    "graffiti_loft": (20, 60, 14, 40, 7, 18, 4, 320),
    "storefront_row": (10, 30, 8, 25, 2.5, 6.5, 6, 260),
    "frame_house": (9, 18, 4.5, 7.5, 6, 10.5, 10, 280),
    "brownstone": (12, 20, 5, 7.5, 10.5, 15, 8, 300),
    "corner_deli": (10, 20, 6, 10, 6, 9.5, 5, 240),
}


def oriented(pts):
    best = None
    for i in range(1, len(pts)):
        dx, dy = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
        a = math.atan2(dy, dx)
        c, s = math.cos(a), math.sin(a)
        us = [x * c + y * s for x, y in pts]
        vs = [-x * s + y * c for x, y in pts]
        L, W = max(us) - min(us), max(vs) - min(vs)
        if L < W:
            L, W = W, L
        area = L * W
        if best is None or area < best[0]:
            best = (area, L, W)
    return best[1], best[2]


def route_distance(x, y, pts):
    best = 1e9
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L)) if L else 0.0
        best = min(best, math.hypot(x - ax - t * dx, y - ay - t * dy))
    return best


def main():
    block = json.load(open(os.path.join(ROOT, "data", "myrtle_block.json"), encoding="utf-8"))
    route = json.load(open(os.path.join(ROOT, "data", "route_j.json"), encoding="utf-8"))
    rpts = [(p["x"], p["y"]) for p in route["points"]]
    catalog_path = os.path.join(ROOT, "data", "krea_catalog.json")
    catalog = json.load(open(catalog_path, encoding="utf-8"))
    taken = set(HERO_USED)
    cands = []
    for b in block["buildings"]:
        if b["id"] in taken or len(b["pts"]) < 4:
            continue
        d = math.hypot(b["x"], b["y"])
        if route_distance(b["x"], b["y"], rpts) < 14:
            continue
        L, W = oriented(b["pts"])
        cands.append({"id": b["id"], "d": d, "L": L, "W": W, "h": b["height"], "src": b["heightSource"]})
    cands.sort(key=lambda c: (c["d"], c["id"]))
    by_id = {m["id"]: m for m in catalog["models"]}
    # Rarer types first so the common ones do not take their footprints.
    for mid in ["graffiti_loft", "ornate_corner", "corner_deli", "storefront_row", "brownstone", "walkup_4storey", "frame_house"]:
        if mid not in by_id:
            continue
        lmin, lmax, wmin, wmax, hmin, hmax, n, rmax = RULES[mid]
        picked = []
        for c in cands:
            if c["id"] in taken or c["d"] > rmax:
                continue
            # Default-height (9 m) footprints carry no height information: accept them on size alone.
            h_ok = c["src"] == "default" or hmin <= c["h"] <= hmax
            if lmin <= c["L"] <= lmax and wmin <= c["W"] <= wmax and h_ok:
                picked.append(c["id"])
                taken.add(c["id"])
                if len(picked) >= n:
                    break
        by_id[mid]["placement"] = {"type": "footprints", "ids": picked} if picked else None
        print(f"{mid:16s} {len(picked):2d} footprints")
    with open(catalog_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()
