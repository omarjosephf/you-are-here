# Samples Earth's real land colours into earth-map.js (one palette index per land pixel).
import base64, re, sys
import numpy as np
from PIL import Image

MAPJS, DAY, WATER = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(MAPJS, encoding='utf-8').read()
W = int(re.search(r'width:\s*(\d+)', src).group(1))
H = int(re.search(r'height:\s*(\d+)', src).group(1))
bits = np.frombuffer(base64.b64decode(re.search(r'data:\s*"([^"]+)"', src).group(1)), dtype=np.uint8)
land = np.unpackbits(bits, bitorder='little')[: W * H].reshape(H, W).astype(bool)

day = np.asarray(Image.open(DAY).convert('RGB'), dtype=np.float32)
water = np.asarray(Image.open(WATER).convert('L'), dtype=np.float32) > 128
sh, sw = day.shape[:2]
assert water.shape == (sh, sw)

col = np.zeros((H, W, 3), np.float32)
have = np.zeros((H, W), bool)
for y in range(H):
    y0, y1 = int(y * sh / H), max(int(y * sh / H) + 1, int(np.ceil((y + 1) * sh / H)))
    for x in range(W):
        if not land[y, x]:
            continue
        x0, x1 = int(x * sw / W), max(int(x * sw / W) + 1, int(np.ceil((x + 1) * sw / W)))
        blk = day[y0:y1, x0:x1].reshape(-1, 3)
        ok = ~water[y0:y1, x0:x1].reshape(-1)
        if ok.any():
            col[y, x] = blk[ok].mean(0)
            have[y, x] = True

# Land cells where the image shows water (coastlines differ slightly): borrow
# the colour of the nearest land cell that has one.
missing = land & ~have
rounds = 0
while missing.any() and rounds < 40:
    rounds += 1
    acc = np.zeros_like(col); cnt = np.zeros((H, W), np.float32)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
        sh_have = np.roll(np.roll(have, dy, 0), dx, 1)
        sh_col = np.roll(np.roll(col, dy, 0), dx, 1)
        acc += sh_col * sh_have[..., None]; cnt += sh_have
    fill = missing & (cnt > 0)
    col[fill] = acc[fill] / cnt[fill][:, None]
    have |= fill
    missing = land & ~have
print('filled in', rounds, 'rounds; still missing', int(missing.sum()))
col[missing] = (120, 110, 90)

ys, xs = np.nonzero(land)  # raster order (row by row)
pixels = col[ys, xs].clip(0, 255).astype(np.uint8)
n = len(pixels)
img = Image.fromarray(pixels.reshape(1, n, 3), 'RGB')
q = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
pal = bytes(q.getpalette()[: 256 * 3])
idx = bytes(np.asarray(q, dtype=np.uint8).reshape(-1))
err = np.abs(np.frombuffer(pal, np.uint8).reshape(-1, 3)[np.frombuffer(idx, np.uint8)].astype(int) - pixels.astype(int)).mean()
print('land pixels', n, 'mean palette error', round(float(err), 2))

block = (
    '  // Real land colours, one palette index per land pixel (row by row).\n'
    '  colors: {\n'
    f'    palette: "{base64.b64encode(pal).decode()}",\n'
    f'    data: "{base64.b64encode(idx).decode()}",\n'
    '  },\n'
)
src = re.sub(r'  // Real land colours.*?\n  \},\n', '', src, flags=re.S)
src = re.sub(r'(  data:\s*"[^"]+",?\n)', lambda m: m.group(1) if m.group(1).rstrip().endswith(',') else m.group(1).rstrip('\n') + ',\n', src, count=1)
src = src.replace('\n};', '\n' + block + '};', 1) if 'colors:' not in src else src
open(MAPJS, 'w', encoding='utf-8').write(src)

prev = np.zeros((H, W, 3), np.uint8); prev[:] = (14, 18, 64)
prev[ys, xs] = np.frombuffer(pal, np.uint8).reshape(-1, 3)[np.frombuffer(idx, np.uint8)]
Image.fromarray(prev).save(sys.argv[4] if len(sys.argv) > 4 else 'landcolors-preview.png')
