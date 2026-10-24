"""Splice tools/script.js (with calibration values from assets/calib.json) into legs.html.
    python tools/splice.py
"""
import json, re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
h = open('legs.html', encoding='utf-8').read()
js = open('tools/script.js', encoding='utf-8').read()
cal = json.load(open('assets/calib.json'))
tg = {k: v for k, v in cal['TARGETS'].items() if int(k) <= 46}      # aorta only (above the bifurcation)
js = re.sub(r'var TARGETS = \{.*?\};', lambda m: 'var TARGETS = ' + json.dumps(tg, separators=(',', ':')) + ';', js, count=1, flags=re.S)
for name in ('Z_TOTAL', 'AX_N', 'IMG_W', 'FOV_MM', 'Z_SEAM'):
    js, n = re.subn(r'(\b%s = )[0-9.]+' % name, lambda m: m.group(1) + str(cal[name]), js, count=1)
    assert n == 1, name
open('tools/script.js', 'w', encoding='utf-8').write(js)
i = h.index('<script>\n(function(){\n"use strict";')
j = h.rindex('</script>') + len('</script>')
open('legs.html', 'w', encoding='utf-8').write(h[:i] + js.rstrip() + h[j:])
print("spliced", len(tg), "aortic targets")
