"""Inline every asset into a single self-contained page.

    python inline.py   ->  legs.embed.html + index.html (identical; index.html for one-drop hosting)
"""
import base64, json, os

SRC = "legs.html"
OUT = "legs.embed.html"
ASSETS = "assets"
AX_N = 158

jpg = ["scout_ap", "scout_lat", "mip_base"] + [f"ax_{i:03d}" for i in range(AX_N)]
png = ["logo_full", "logo_mark", "mip_art"] + [f"lb_{i:03d}" for i in range(AX_N)]

d = {}
for n in jpg:
    with open(os.path.join(ASSETS, n + ".jpg"), "rb") as f:
        d[n] = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
for n in png:
    with open(os.path.join(ASSETS, n + ".png"), "rb") as f:
        d[n] = "data:image/png;base64," + base64.b64encode(f.read()).decode()

html = open(SRC, encoding="utf-8").read()
inject = "<script>window.SCG_ASSETS=" + json.dumps(d) + ";</script>\n"
marker = '<script>\n(function(){\n"use strict";'
assert marker in html, "IIFE marker not found - inline.py needs updating"
html = html.replace(marker, inject + marker)
tag = '<script src="room3d.js?v=14"></script>'
assert tag in html, "room3d.js tag not found"
html = html.replace(tag, "<script>\n" + open("room3d.js", encoding="utf-8").read() + "\n</script>")

open(OUT, "w", encoding="utf-8").write(html)
open("index.html", "w", encoding="utf-8").write(html)
print("wrote", OUT, "and index.html", f"{os.path.getsize(OUT)/1024:.0f} KB  ({len(d)} assets)")
