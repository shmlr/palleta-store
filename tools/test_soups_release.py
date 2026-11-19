#!/usr/bin/env python3
"""Verify the approved 9-soup editorial gallery in a staged public menu."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
page = root / "menu" / "soups.html"
if not page.exists():
    print("SKIP: nine-soup gallery has not yet been released in /menu/")
    raise SystemExit(0)

html = page.read_text(encoding="utf-8")
ids = re.findall(r'<article class="recipe" id="([a-z0-9_-]+)">', html)
assert len(ids) == 9 and len(set(ids)) == 9, ids
assert 'assets/palleta-logo.webp' in html
assert 'Happycall' not in html
assert html.count('<details>') == 9
assert html.count('<ul class="ingredients">') == 9
assert html.count('<h3>Как приготовить</h3>') == 9

for soup_id in ids:
    for kind in ("card", "photo"):
        rel = f"assets/soups/{soup_id}-{kind}.jpg"
        assert rel in html, f"Missing image reference {rel}"
        blob = (root / "menu" / rel).read_bytes()
        assert 30000 <= len(blob) <= 1500000, (rel, len(blob))
        assert blob[:3] == bytes.fromhex("ffd8ff"), rel

for entry in ("start.html", "index.html"):
    assert 'href="./soups.html"' in (root / "menu" / entry).read_text(encoding="utf-8")

assert not any((root / "menu").rglob("*.xlsx")), "Private 1C workbooks must not be published"
print("PASS: nine soup pages, images, navigation, independent public catalog")
