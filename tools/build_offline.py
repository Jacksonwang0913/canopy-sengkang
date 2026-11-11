"""Build a self-contained Canopy HTML file from the GitHub Pages source."""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
from pathlib import Path


def data_url(path: Path, mime: str | None = None) -> str:
    mime = mime or mimetypes.guess_type(path)[0]
    return "data:" + mime + ";base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def bundle(root: Path) -> str:
    page = read_text(root / "index.html")
    css = read_text(root / "styles.css")
    for font in ("geist.woff2", "geist-mono.woff2"):
        css = css.replace("assets/" + font, data_url(root / "assets" / font, "font/woff2"))
    page = page.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")

    paths = ["data/records.js", "data/basemap.js", "core.js", "map.js", "app.js"]
    records = json.loads(read_text(root / paths[0]).removeprefix("window.CANOPY_RECORDS = ").strip().removesuffix(";"))
    for row in records:
        for kind in ("original", "mask", "overlay"):
            key = kind + "_image"
            row[key] = data_url(root / row[key])
    payload = json.dumps(records, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    scripts = ['<script data-role="records">window.CANOPY_PORTABLE = true; window.CANOPY_RECORDS = ' + payload + ';</script>']
    for path in paths:
        page = page.replace(f'<script defer src="{path}"></script>\n', "", 1)
        if path != paths[0]:
            code = read_text(root / path)
            if "</script" in code.lower():
                raise ValueError(f"Script needs escaping before embedding: {path}")
            scripts.append('<script data-role="code">\n' + code + '\n</script>')
    return page.replace("</body>", "\n".join(scripts) + "\n</body>", 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    options = parser.parse_args()
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(bundle(Path(__file__).resolve().parents[1]), encoding="utf-8")
