#!/usr/bin/env python3
"""Krea 3D asset pipeline.

Reads data/krea_catalog.json (source of truth) and, for every model:
  1. GLB: uses the entry's `published` file under public/ if it exists, else
     optimises ../../Refs/krea3d/<id>_raw.glb into public/props/krea/<id>.glb
     with gltf-transform (webp textures, 2048 px, light simplify, draco).
  2. Thumbnails: public/props/krea/thumbs/<id>.webp (from <id>_preview.png)
     and <id>_ref.webp (from <id>_ref.png), fit to 384x384, WebP q82.
  3. Writes public/props/krea/manifest.json (models in catalog order).
  4. Prints a summary table.

Idempotent: outputs that are newer than their sources are left alone.
Run: refs/.venv/Scripts/python.exe -I tools/krea_assets.py
"""
import datetime
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
PUBLIC = REPO / "public"
CATALOG = REPO / "data" / "krea_catalog.json"
REFS = (REPO / ".." / ".." / "Refs" / "krea3d").resolve()
OUT_DIR = PUBLIC / "props" / "krea"
THUMB_DIR = OUT_DIR / "thumbs"
MANIFEST = OUT_DIR / "manifest.json"

THUMB_SIZE = (384, 384)
WEBP_QUALITY = 82
OPTIMIZE_ARGS = ("--texture-compress webp --texture-size 2048 "
                 "--simplify-error 0.001 --compress draco")


def warn(msg):
    print(f"WARNING: {msg}", file=sys.stderr)


def up_to_date(dst: Path, src: Path) -> bool:
    return dst.exists() and dst.stat().st_size > 0 and dst.stat().st_mtime >= src.stat().st_mtime


def rel(p: Path) -> str:
    return p.relative_to(PUBLIC).as_posix()


def build_glb(model):
    """Return (path or None, action string)."""
    mid = model["id"]
    published = model.get("published")
    if published:
        pub = PUBLIC / published
        if pub.is_file():
            return pub, "published"
        warn(f"{mid}: published file {published} not found, falling back to raw")

    raw = REFS / f"{mid}_raw.glb"
    out = OUT_DIR / f"{mid}.glb"
    if not raw.is_file():
        if out.is_file():
            warn(f"{mid}: raw missing, keeping existing {rel(out)}")
            return out, "kept (no raw)"
        warn(f"{mid}: raw GLB missing ({raw}); left out of manifest")
        return None, "MISSING raw"
    if up_to_date(out, raw):
        return out, "glb up to date"

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f"{mid}.tmp.glb")
    if tmp.exists():
        tmp.unlink()
    cmd = f'npx --yes @gltf-transform/cli optimize "{raw}" "{tmp}" {OPTIMIZE_ARGS}'
    print(f"[{mid}] optimising {raw.name} ...", flush=True)
    res = subprocess.run(cmd, shell=True, cwd=str(REPO),
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0 or not tmp.is_file() or tmp.stat().st_size == 0:
        warn(f"{mid}: gltf-transform failed (exit {res.returncode}):\n{res.stdout[-2000:]}")
        if tmp.exists():
            tmp.unlink()
        if out.is_file():
            return out, "optimise FAILED (kept old)"
        return None, "optimise FAILED"
    os.replace(tmp, out)
    return out, "optimised"


def build_thumb(src: Path, dst: Path):
    """Return (exists, action) for one thumbnail."""
    if not src.is_file():
        return False, "missing"
    if up_to_date(dst, src):
        return True, "ok"
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
        im.thumbnail(THUMB_SIZE, Image.LANCZOS)
        tmp = dst.with_name(dst.stem + ".tmp.webp")
        im.save(tmp, "WEBP", quality=WEBP_QUALITY, method=6)
    os.replace(tmp, dst)
    return True, "made"


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    models = catalog.get("models", [])
    if not REFS.is_dir():
        warn(f"Refs folder not found: {REFS}")

    entries, rows, failures = [], [], 0
    for m in models:
        mid = m["id"]
        glb, glb_action = build_glb(m)

        thumb_dst = THUMB_DIR / f"{mid}.webp"
        ref_dst = THUMB_DIR / f"{mid}_ref.webp"
        try:
            has_thumb, t_act = build_thumb(REFS / f"{mid}_preview.png", thumb_dst)
        except Exception as e:  # corrupt image etc.
            warn(f"{mid}: preview thumbnail failed: {e}")
            has_thumb, t_act = thumb_dst.is_file(), "FAILED"
        try:
            has_ref, r_act = build_thumb(REFS / f"{mid}_ref.png", ref_dst)
        except Exception as e:
            warn(f"{mid}: ref thumbnail failed: {e}")
            has_ref, r_act = ref_dst.is_file(), "FAILED"

        actions = [glb_action]
        if t_act not in ("ok",):
            actions.append(f"thumb {t_act}")
        if r_act not in ("ok",):
            actions.append(f"ref {r_act}")
        if glb is None or "FAILED" in " ".join(actions):
            failures += 1

        kb = glb.stat().st_size / 1024 if glb else 0
        rows.append((mid, f"{kb:,.0f}" if glb else "-",
                     "yes" if has_thumb else "no", "yes" if has_ref else "no",
                     ", ".join(actions)))

        if glb is None:
            continue
        entries.append({
            "id": mid,
            "name": m.get("name", mid),
            "category": m.get("category"),
            "description": m.get("description"),
            "file": rel(glb),
            "thumb": rel(thumb_dst) if has_thumb else None,
            "ref": rel(ref_dst) if has_ref else None,
            "bytes": glb.stat().st_size,
            "made": m.get("made"),
            "placement": m.get("placement"),
        })

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "models": entries,
    }
    tmp = MANIFEST.with_name("manifest.tmp.json")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, MANIFEST)

    headers = ("id", "GLB KB", "thumb", "ref", "action")
    widths = [max(len(str(r[i])) for r in rows + [headers]) for i in range(5)]
    fmt = "  ".join(f"{{:{'>' if i == 1 else '<'}{w}}}" for i, w in enumerate(widths))
    print(fmt.format(*headers))
    print(fmt.format(*("-" * w for w in widths)))
    for r in rows:
        print(fmt.format(*r))
    print(f"\n{len(entries)}/{len(models)} models in {rel(MANIFEST)}"
          + (f"; {failures} with problems" if failures else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
