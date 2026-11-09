"""Packs the project into one self-contained HTML file (no internet needed).

usage: build_single.py <project dir> <three.module.min.js> <fonts dir> <out.html> [--title T]

<fonts dir> is a node_modules/@fontsource folder (cormorant-garamond and jost).
Put <out.html> in dist/, which is ignored by git.
"""
import base64, re, sys, pathlib

proj, three_path, fonts_dir, out = map(pathlib.Path, sys.argv[1:5])
title = None
if '--title' in sys.argv:
    title = sys.argv[sys.argv.index('--title') + 1]

html = (proj / 'index.html').read_text(encoding='utf-8')

def safe(js, name):
    # Inline scripts must not contain these, or the HTML parser ends the script early.
    for bad in ('</script', '<!--', '<script'):
        assert bad not in js.lower(), f'{name} contains {bad}'
    return js

# Fonts: the same families and weights Google Fonts served, embedded.
FONTS = [
    ('Cormorant Garamond', 'italic', 500, 'cormorant-garamond/files/cormorant-garamond-latin-500-italic.woff2'),
    ('Cormorant Garamond', 'italic', 600, 'cormorant-garamond/files/cormorant-garamond-latin-600-italic.woff2'),
    ('Jost', 'normal', 400, 'jost/files/jost-latin-400-normal.woff2'),
    ('Jost', 'normal', 500, 'jost/files/jost-latin-500-normal.woff2'),
]
faces = []
for fam, style, weight, rel in FONTS:
    b64 = base64.b64encode((fonts_dir / rel).read_bytes()).decode()
    faces.append(f"@font-face{{font-family:'{fam}';font-style:{style};font-weight:{weight};font-display:swap;"
                 f"src:url(data:font/woff2;base64,{b64}) format('woff2');}}")
font_css = '\n'.join(faces)

# The page's font loader (a comment and a small script) becomes embedded fonts.
head_links = re.compile(r'  <!-- fonts: .*?-->\n  <script>\n.*?</script>\n', re.S)
assert head_links.search(html), 'font loader not found'
html = head_links.sub(lambda m: '  <style>\n/* Fonts: Cormorant Garamond and Jost (SIL Open Font License) */\n' + font_css + '\n  </style>\n', html, count=1)

css = (proj / 'style.css').read_text(encoding='utf-8')
assert '</style' not in css.lower()
link = '  <link rel="stylesheet" href="style.css">\n'
assert html.count(link) == 1
html = html.replace(link, '  <style>\n' + css + '\n  </style>\n')

three = safe(three_path.read_text(encoding='utf-8'), 'three')
for name in ('config.js', 'galaxy-model.js', 'earth-map.js', 'astronomy.browser.min.js', 'sky.js', 'earth.js', 'planet-maps.js', 'planets.js', 'main.js'):
    tag = f'<script src="{name}"></script>'
    assert html.count(tag) == 1, tag
    code = safe((proj / name).read_text(encoding='utf-8'), name)
    block = f'<script>\n/* ---- {name} ---- */\n{code}\n</script>'
    if name == 'main.js':
        block = ('<script type="text/plain" id="three-module">\n' + three + '\n</script>\n  ' + block)
    html = html.replace(tag, block)

if title:
    html = re.sub(r'<title>[^<]*</title>', f'<title>{title}</title>', html, count=1)

# Everything must now be inside the page: no script or stylesheet files left to fetch.
outside = re.sub(r'<script type="text/plain" id="three-module">.*?</script>', '', html, flags=re.S)
assert not re.search(r'<script\b[^>]*\bsrc=', outside), 'a <script src> was not inlined'
assert not re.search(r'<link\b[^>]*rel="stylesheet"', outside), 'a stylesheet link was not inlined'

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print(out, f'{out.stat().st_size / 1e6:.2f} MB')
