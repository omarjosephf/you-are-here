"""Packs small colour maps of the planets, the Moon and Pluto into
planet-maps.js (stage 4), plus Saturn's ring colour strip (stage 7).

usage: planetmaps.py <solar system scope dir> <usgs pluto jpg> <out planet-maps.js>

Each map is resampled to 128 x 64 (equirectangular, west edge at -180 deg
longitude, north at the top) and stored as a 64-colour palette plus one
index per pixel. The ring strip is 256 RGBA samples from the inner to the
outer edge of the source image.

Sources
  Solar System Scope textures (2k_<name>.jpg), CC BY 4.0:
  https://www.solarsystemscope.com/textures/ (credit: Solar System Scope /
  INOVE). Processed renderings based on NASA data; Uranus and Neptune are
  nearly featureless artistic banding.
  Pluto: USGS Astrogeology, Pluto New Horizons LORRI-MVIC Global Mosaic
  300m (2017), 1024 px preview. Greyscale; west edge at 0 deg longitude, so
  it is shifted half a turn. The south, unlit in 2015, has no data (black in
  the source): it is filled with a dim grey and marked in the alpha byte.
"""
import base64, json, sys, pathlib
import numpy as np
from PIL import Image

sss, pluto_path, out = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
W, H = 128, 64
BODIES = [
    ('mercury', '2k_mercury.jpg'), ('venus', '2k_venus_atmosphere.jpg'), ('moon', '2k_moon.jpg'),
    ('mars', '2k_mars.jpg'), ('jupiter', '2k_jupiter.jpg'), ('saturn', '2k_saturn.jpg'),
    ('uranus', '2k_uranus.jpg'), ('neptune', '2k_neptune.jpg'),
]

def pack(rgb):
    img = Image.fromarray(rgb.astype(np.uint8), 'RGB')
    q = img.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = bytes(q.getpalette()[: 64 * 3])
    idx = np.asarray(q, dtype=np.uint8)
    err = np.abs(np.frombuffer(pal, np.uint8).reshape(-1, 3)[idx].astype(int) - rgb.astype(int)).mean()
    return {'palette': base64.b64encode(pal).decode(), 'data': base64.b64encode(idx.tobytes()).decode()}, float(err)

maps = {}
for name, f in BODIES:
    im = Image.open(sss / f).convert('RGB').resize((W, H), Image.LANCZOS)
    maps[name], err = pack(np.asarray(im))
    print(name, 'palette error', round(err, 2))

# Pluto (greyscale): shift so the west edge is -180 deg; fill the no-data south.
g = np.asarray(Image.open(pluto_path).convert('L').resize((W, H), Image.LANCZOS), dtype=np.float32)
g = np.roll(g, W // 2, axis=1)
nodata = g < 6
fill = np.median(g[~nodata]) * 0.55
g[nodata] = fill
rgb = np.stack([g, g, g], -1)
maps['pluto'], err = pack(rgb)
maps['pluto']['nodataBelowRow'] = int(np.argmax(nodata.mean(1) > 0.9)) if nodata.any() else H
print('pluto palette error', round(err, 2), 'no data from row', maps['pluto']['nodataBelowRow'])

ring = Image.open(sss / '2k_saturn_ring_alpha.png').convert('RGBA')
r = np.asarray(ring, dtype=np.float32).mean(0)  # average across the strip's height
xs = np.linspace(0, r.shape[0] - 1, 256)
strip = np.stack([np.interp(xs, np.arange(r.shape[0]), r[:, c]) for c in range(4)], -1).round().clip(0, 255).astype(np.uint8)
maps['saturnRing'] = base64.b64encode(strip.tobytes()).decode()

header = '''/*  You Are Here: planet-maps.js (made by tools/planetmaps.py)
    ------------------------------------------------------------------
    Small colour maps (128 x 64, equirectangular, west edge at -180 deg,
    north at the top) for the particle planets: a 64-colour palette and one
    index per pixel, base64. saturnRing: 256 RGBA samples, inner to outer.

    Maps of Mercury, Venus (its cloud tops, which is what you would see),
    the Moon, Mars, Jupiter, Saturn, Uranus and Neptune, and Saturn's ring
    strip: Solar System Scope (INOVE), CC BY 4.0,
    https://www.solarsystemscope.com/textures/ . They are processed
    renderings based on NASA data; Uranus and Neptune are nearly featureless
    artistic banding.
    Pluto: USGS Astrogeology, "Pluto New Horizons LORRI-MVIC Global Mosaic
    300m" (2017; Moore et al. 2016, Science). Greyscale; its colour tint in
    the app is a drawing choice. The south was in darkness during the 2015
    flyby and has no data (drawn dim).

    You don't need to edit this file.
*/
'''
js = header + 'window.YOU_ARE_HERE_PLANET_MAPS = ' + json.dumps({'width': W, 'height': H, **maps}, indent=1) + ';\n'
open(out, 'w', encoding='utf-8').write(js)
print(out, len(js) // 1024, 'KB')
