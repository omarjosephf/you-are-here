"""Rebuilds Earth's colours, city lights and height in earth-map.js from
primary sources with stated terms (stage 4), using landcolors.py and
landdetail.py. The land mask (Natural Earth, public domain) is kept.

usage: earthsources.py <earth-map.js> <blue marble jpg> <black marble jpg> <etopo .ascii> <out dir>

  Land colour: NASA Blue Marble Next Generation, July 2004, 5400 x 2700
    (world.200407.3x5400x2700.jpg). Credit: NASA Earth Observatory.
  City lights: NASA Black Marble 2016, 0.1 degree colour image
    (BlackMarble_2016_01deg.jpg). Credit: NASA Earth Observatory.
  Height: NOAA ETOPO 2022 (CC0), the 60 arc-second surface grid sampled
    every 30 cells (half a degree) through NOAA's OPeNDAP server:
    .../ETOPO_2022_v1_60s_N90W180_surface.nc.ascii?z[15:30:10799][15:30:21599]
    Rows run south to north. Height 0 to 5,000 m maps to grey 0 to 248
    (higher is clipped); the sea is 0.

<out dir> receives the intermediate images and previews (keep it out of git).
"""
import base64, re, subprocess, sys, pathlib
import numpy as np
from PIL import Image

mapjs, day, night, etopo, out = sys.argv[1:6]
out = pathlib.Path(out)
out.mkdir(parents=True, exist_ok=True)
here = pathlib.Path(__file__).parent

src = open(mapjs, encoding='utf-8').read()
W = int(re.search(r'width:\s*(\d+)', src).group(1))
H = int(re.search(r'height:\s*(\d+)', src).group(1))
bits = np.frombuffer(base64.b64decode(re.search(r'\n  data:\s*"([^"]+)"', src).group(1)), dtype=np.uint8)
land = np.unpackbits(bits, bitorder='little')[: W * H].reshape(H, W).astype(bool)

# Water mask at the day image's size, from the land mask itself (so every
# land cell averages only the Blue Marble pixels that fall inside it).
dw, dh = Image.open(day).size
water = Image.fromarray(np.where(land, 0, 255).astype(np.uint8)).resize((dw, dh), Image.NEAREST)
water_path = out / 'water-from-land-mask.png'
water.save(water_path)

# Height image from ETOPO 2022.
txt = open(etopo, encoding='utf-8').read()
rows = re.findall(r'^\[(\d+)\],\s*(.+)$', txt.split('z.lat[')[0], flags=re.M)
z = np.array([[float(v) for v in r[1].split(',')] for r in rows], dtype=np.float32)
assert z.shape == (H, W), z.shape
z = z[::-1]  # north up
grey = np.clip(z / 5000.0, 0, 1) * 248
grey[~land] = 0
topo_path = out / 'etopo2022-height.png'
Image.fromarray(grey.astype(np.uint8)).save(topo_path)
print('height: max', float(z.max()), 'm; land cells above 0 m', int((z[land] > 0).sum()))

py = sys.executable
subprocess.run([py, str(here / 'landcolors.py'), mapjs, day, str(water_path), str(out / 'landcolors-preview.png')], check=True)
subprocess.run([py, str(here / 'landdetail.py'), mapjs, night, str(topo_path), str(out / 'landdetail-preview.png')], check=True)
print('done:', mapjs)
