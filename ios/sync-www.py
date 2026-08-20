#!/usr/bin/env python3
"""Copy PWA assets into the iOS app bundle www/ folder.
Prefer root files when they look complete; otherwise keep existing www/ content.
"""
from pathlib import Path
import shutil
import re

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "ios" / "PipeDesk" / "www"

files = [
    "index.html",
    "style.css",
    "main.js",
    "sw.js",
    "manifest.webmanifest",
    "demo-seed.js",
]

def is_complete(path: Path, min_size: int) -> bool:
    return path.exists() and path.stat().st_size >= min_size

# If root main.js/index are truncated, treat existing DEST as source of truth
root_ok = is_complete(ROOT / "main.js", 50000) and is_complete(ROOT / "index.html", 10000)

if not root_ok and DEST.exists() and is_complete(DEST / "main.js", 50000):
    print("root truncated — keeping existing www/ as source of truth")
    # Still ensure folders exist
    for folder in ("data", "icons"):
        src = ROOT / folder
        dst = DEST / folder
        if src.exists() and not dst.exists():
            shutil.copytree(src, dst)
    for p in sorted(DEST.rglob("*")):
        if p.is_file():
            print(" ", p.relative_to(DEST), p.stat().st_size)
    raise SystemExit(0)

if DEST.exists():
    shutil.rmtree(DEST)
DEST.mkdir(parents=True)

for name in files:
    src = ROOT / name
    if not src.exists():
        # fallback to previous www if any
        alt = (ROOT / "ios" / "PipeDesk" / "www.bak" / name) if False else None
        raise SystemExit(f"missing {src}")
    data = src.read_bytes()
    if name == "index.html":
        text = data.decode("utf-8")
        text = re.sub(r"\?v=\d+\.\d+\.\d+", "", text)
        (DEST / name).write_text(text, encoding="utf-8")
    else:
        (DEST / name).write_bytes(data)

for folder in ("data", "icons"):
    shutil.copytree(ROOT / folder, DEST / folder)

print("synced", DEST)
for p in sorted(DEST.rglob("*")):
    if p.is_file():
        print(" ", p.relative_to(DEST), p.stat().st_size)
