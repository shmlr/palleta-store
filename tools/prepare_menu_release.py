#!/usr/bin/env python3
"""Stage only approved public Palleta Menu files for manual review.

No 1C exports, secrets, .github workflows, CI logs, or unapproved files.
"""
import argparse
import io
import cairosvg
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

def original_icon(vector_path, size):
    """Render exact paths from approved .ai; modify only the outer white canvas."""
    svg = vector_path.read_bytes()
    scale = 4 if size < 128 else 2
    canvas = size * scale
    padding = round(canvas * 0.10)
    art = Image.open(io.BytesIO(cairosvg.svg2png(
        bytestring=svg, output_width=canvas - 2 * padding
    ))).convert("RGBA")
    img = Image.new("RGBA", (canvas, canvas), "#ffffff")
    img.alpha_composite(art, (padding, (canvas - art.height) // 2))
    mask = Image.new("L", img.size)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, canvas - 1, canvas - 1), radius=round(canvas * 0.105), fill=255
    )
    img.putalpha(ImageChops.multiply(img.getchannel("A"), mask))
    return img.resize((size, size), Image.Resampling.LANCZOS)

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
            "Пилот v1.5 · меню на 3/7 дней и продукты дома.",
            "Меню на 3 или 7 дней · порции по каждому приёму пищи.",
        )
        page = page.replace(
            "app.js?v=pantry-20261014-v1",
            f"app.js?v=attendance-{args.release_sha[:12]}",
        )
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
            "outline-offset:3px}"
            "/* palleta: approved gentle rounding */:root{--radius-sm:10px;--radius-md:14px;--radius-lg:16px}.panel,.home-hero{border-radius:var(--radius-lg)}.choice,.btn,.wa-link,.home-stats>div,.cross-brand,.product select{border-radius:var(--radius-sm)}.note,.pill,.light-btn{border-radius:var(--radius-sm)}</style>",
            1,
        )
        (dest / name).write_text(page, encoding="utf-8")
    # Reject the mistakenly entered 00 00 number anywhere in public data/code.
    for item in dest.rglob("*"):
        if item.is_file() and item.suffix.lower() in {".html", ".js", ".json", ".webmanifest"}:
            txt = item.read_text(encoding="utf-8")
            if "79882040000" in txt or "+7 988 204 00 00" in txt:
                raise SystemExit(f"Wrong customer phone number: {item}")
    # Symbol is the percentage sign on a pallet, extracted from the brandbook AI.
    # The artwork's path geometry is immutable; only the outer white square is rounded.
    source_vector = dest.parent / "assets" / "palleta-original-symbol.svg"
    if not source_vector.is_file():
        raise SystemExit("Approved brandbook vector SVG missing")
    (dest / "assets" / "palleta-original-symbol.svg").write_bytes(
        source_vector.read_bytes()
    )
    for size in (192, 512):
        original_icon(source_vector, size).save(
            dest / "assets" / f"app-icon-{size}.png", optimize=True
        )
    for output, size in (
        (dest / "assets" / "palleta-favicon-32.png", 32),
        (dest.parent / "assets" / "palleta-favicon-32.png", 32),
        (dest.parent / "assets" / "palleta-icon-192.png", 192),
    ):
        original_icon(source_vector, size).save(output, optimize=True)
    ico = original_icon(source_vector, 256)
    for output in (dest / "favicon.ico", dest.parent / "favicon.ico"):
        ico.save(output, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    # Refresh web app icons on installed phones and evict legacy PWA caches.
    manifest = dest / "manifest.webmanifest"
    manifest.write_text(
        manifest.read_text(encoding="utf-8").replace("20261014-final", "20261019-vector-brand"),
        encoding="utf-8",
    )
    worker = dest / "sw.js"
    worker_text = worker.read_text(encoding="utf-8")
    worker_text = worker_text.replace(
        "palleta-offline-v1-20261014-pantry-3day",
        "palleta-offline-release-" + args.release_sha[:12],
    )
    if (dest / "assets" / "local-point-logo.webp").is_file():
        worker_text = worker_text.replace(
            "'./assets/palleta-logo.webp'",
            "'./assets/palleta-logo.webp','./assets/local-point-logo.webp'",
        )
    worker.write_text(worker_text, encoding="utf-8")
    for name in ("index.html", "start.html"):
        page_file = dest / name
        page_file.write_text(
            page_file.read_text(encoding="utf-8").replace(
                "20261014-final", "20261019-vector-brand"
            ), encoding="utf-8",
        )
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
