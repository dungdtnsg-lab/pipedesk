#!/usr/bin/env python3
"""Copy PWA assets into the iOS app bundle www/ folder."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "ios" / "PipeDesk" / "www"

if DEST.exists():
    shutil.rmtree(DEST)
DEST.mkdir(parents=True)

files = [
    "index.html",
    "style.css",
    "main.js",
    "sw.js",
    "manifest.webmanifest",
    "demo-seed.js",
]
for name in files:
    src = ROOT / name
    if not src.exists():
        raise SystemExit(f"missing {src}")
    data = src.read_bytes()
    if name == "index.html":
        text = data.decode("utf-8")
        text = __import__("re").sub(r"\?v=\d+\.\d+\.\d+", "", text)
        (DEST / name).write_text(text, encoding="utf-8")
    else:
        (DEST / name).write_bytes(data)

for folder in ("data", "icons"):
    shutil.copytree(ROOT / folder, DEST / folder)

print("synced", DEST)
for p in sorted(DEST.rglob("*")):
    if p.is_file():
        print(" ", p.relative_to(DEST), p.stat().st_size)
