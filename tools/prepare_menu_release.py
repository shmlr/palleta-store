#!/usr/bin/env python3
"""Stage only approved public Palleta Menu files for manual review.

No 1C exports, secrets, .github workflows, CI logs, or unapproved files.
"""
import argparse
import base64
from io import BytesIO
import re
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops

PUBLIC_FILES = (
    "index.html", "start.html", "core.js", "app.js",
    "products.json", "recipes.json", "manifest.webmanifest",
    "sw.js", "favicon.ico",
)
IMAGE_EXTS = {".png", ".webp", ".jpg", ".jpeg", ".svg", ".ico"}

def rounded(src, dest, pixels):
    img = Image.open(src).convert("RGBA").resize((pixels, pixels), Image.Resampling.LANCZOS)
    mask = Image.new("L", (pixels, pixels), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, pixels - 1, pixels - 1), radius=max(2, round(pixels * .11)), fill=255
    )
    img.putalpha(ImageChops.multiply(img.getchannel("A"), mask))
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, optimize=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--target", type=Path, default=Path("menu"))
    ap.add_argument("--release-sha", required=True)
    args = ap.parse_args()
    src, dest = args.source.resolve(), args.target.resolve()
    if not re.fullmatch("[a-f0-9]{40}", args.release_sha):
        raise SystemExit("A full verified source commit SHA is required")
    for item in PUBLIC_FILES:
        if not (src / item).is_file() or (src / item).is_symlink():
            raise SystemExit(f"Missing or unsafe public app file: {item}")
    if not (src / "assets").is_dir():
        raise SystemExit("Source assets folder missing")
    if dest.exists():
        shutil.rmtree(dest)
    (dest / "assets").mkdir(parents=True)
    for item in PUBLIC_FILES:
        shutil.copy2(src / item, dest / item)
    for item in (src / "assets").iterdir():
        if item.is_file() and not item.is_symlink() and item.suffix.lower() in IMAGE_EXTS:
            shutil.copy2(item, dest / "assets" / item.name)
    # A true same-site return link, while preserving the original menu app logic.
    for name in ("index.html", "start.html"):
        page = (dest / name).read_text(encoding="utf-8")
        if "</header>" not in page or "</style>" not in page:
            raise SystemExit(f"Could not locate menu header/styles in {name}")
        page = page.replace("Для большой семейной закупки ·", "Дискаунтер ·")
        page = page.replace(
            "Автоматическая выгрузка УТ 11 ещё не подключена; наличие и цену подтверждает магазин.",
            "Справочные клубные цены проходят проверку по датированным отчётам 1С. Актуальные цены и наличие подтверждает магазин.",
        )
        page = page.replace(
            "</header>",
            '</header><nav class="store-return-nav" aria-label="На главный сайт">'
            '<a class="store-return-link" href="../">← На сайт Паллеты</a></nav>',
            1,
        )
        page = page.replace(
            "</style>",
            ".store-return-nav{padding:0 2px 10px}"
            ".store-return-link{display:inline-block;min-height:44px;"
            "line-height:44px;font-size:14px;font-weight:700;"
            "color:#254A74;text-underline-offset:3px}"
            ".store-return-link:focus-visible{outline:3px solid #DD463C;"
            "outline-offset:3px}</style>",
            1,
        )
        (dest / name).write_text(page, encoding="utf-8")
    # Reject the mistakenly entered 00 00 number anywhere in public data/code.
    for item in dest.rglob("*"):
        if item.is_file() and item.suffix.lower() in {".html", ".js", ".json", ".webmanifest"}:
            txt = item.read_text(encoding="utf-8")
            if "79882040000" in txt or "+7 988 204 00 00" in txt:
                raise SystemExit(f"Wrong customer phone number: {item}")
    # Clip only the corners of the approved original icons, no brand redraw.
    icon = dest / "assets" / "app-icon-512.png"
    if not icon.is_file():
        raise SystemExit("Approved icon missing from menu assets")
    for size in (192, 512):
        rounded(icon, dest / "assets" / f"app-icon-{size}.png", size)
    # This 32px favicon was derived from the owner's palleta-round-original.png.
    # Never synthesize it from the independent application's PWA app icon.
    approved_path = dest.parent / "assets" / "palleta-approved-favicon-32.b64"
    if not approved_path.is_file():
        raise SystemExit("Original approved Palleta favicon source is missing")
    approved_bytes = base64.b64decode(approved_path.read_text().strip(), validate=True)
    approved_icon = Image.open(BytesIO(approved_bytes)).convert("RGBA")
    if approved_icon.size != (32, 32):
        raise SystemExit("Approved favicon must be a 32x32 PNG")
    for output in (dest / "assets" / "palleta-favicon-32.png",
                   dest.parent / "assets" / "palleta-favicon-32.png"):
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(approved_bytes)
    rounded(icon, dest.parent / "assets" / "palleta-icon-192.png", 192)
    original = Image.open(icon).convert("RGBA")
    mask = Image.new("L", original.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, original.width - 1, original.height - 1),
        radius=int(original.width * .11), fill=255,
    )
    original.putalpha(ImageChops.multiply(original.getchannel("A"), mask))
    for dst in (dest / "favicon.ico", dest.parent / "favicon.ico"):
        approved_icon.save(dst, format="ICO", sizes=[(16, 16), (32, 32)])
    # Add favicon references together with the icon in one atomic pull request.
    store_index = dest.parent / "index.html"
    html = store_index.read_text(encoding="utf-8")
    html = html.replace("https://shmlr.github.io/palleta-menu/start.html", "menu/start.html")
    if "assets/palleta-favicon-32.png" not in html:
        anchor = '<link rel="stylesheet"'
        if anchor not in html:
            raise SystemExit("Storefront stylesheet link missing")
        html = html.replace(
            anchor,
            '<link rel="icon" href="assets/palleta-favicon-32.png" '
            'type="image/png" sizes="32x32">'
            '<link rel="apple-touch-icon" href="assets/palleta-icon-192.png" '
            'sizes="192x192">' + anchor, 1,
        )
        store_index.write_text(html, encoding="utf-8")
    store_index.write_text(html, encoding="utf-8")
    (dest / "RELEASE.txt").write_text(
        "Source: shmlr/palleta-menu\nCommit: " + args.release_sha + "\n"
        "Release requires core/UI/Chromium tests and human PR approval.\n",
        encoding="utf-8",
    )
    print("Staged public menu snapshot", args.release_sha)

if __name__ == "__main__":
    main()
