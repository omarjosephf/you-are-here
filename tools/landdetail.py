# Adds per-land-pixel detail to earth-map.js: city lights at night (high 4 bits)
# and elevation (low 4 bits), one byte per land pixel, row by row.
import base64, re, sys
import numpy as np
from PIL import Image

MAPJS, NIGHT, TOPO, PREVIEW = sys.argv[1:5]
src = open(MAPJS, encoding='utf-8').read()
W = int(re.search(r'width:\s*(\d+)', src).group(1))
H = int(re.search(r'height:\s*(\d+)', src).group(1))
bits = np.frombuffer(base64.b64decode(re.search(r'\n  data:\s*"([^"]+)"', src).group(1)), dtype=np.uint8)
land = np.unpackbits(bits, bitorder='little')[: W * H].reshape(H, W).astype(bool)

def cells(img):
    """Mean of each W x H cell of a bigger equirectangular image."""
    a = np.asarray(img, dtype=np.float32)
    sh, sw = a.shape[:2]
    out = np.zeros((H, W) + a.shape[2:], np.float32)
    for y in range(H):
        y0, y1 = int(y * sh / H), max(int(y * sh / H) + 1, int(np.ceil((y + 1) * sh / H)))
        row = a[y0:y1]
        for x in range(W):
            x0, x1 = int(x * sw / W), max(int(x * sw / W) + 1, int(np.ceil((x + 1) * sw / W)))
            out[y, x] = row[:, x0:x1].reshape(-1, *a.shape[2:]).mean(0)
    return out

# City lights: the red in the night image (the lights are yellow-white; the moonlit
# land, sea and ice around them are blue, with little red).
night = np.asarray(Image.open(NIGHT).convert('RGB'), dtype=np.float32)
warm = np.clip(night[..., 0] - 0.5 * night[..., 2] - 4, 0, None)
lights = cells(warm)
ref = np.percentile(lights[land & (lights > 0.5)], 99.5)
lights = np.clip(lights / ref, 0, 1) ** 0.6
lq = np.round(lights * 15).astype(np.uint8)

topo = cells(Image.open(TOPO).convert('L'))
eq = np.round(np.clip(topo / 248.0, 0, 1) * 15).astype(np.uint8)

ys, xs = np.nonzero(land)
packed = (lq[ys, xs] << 4) | eq[ys, xs]
print('land pixels', len(packed), 'lit', int((lq[ys, xs] > 0).sum()), 'elev>0', int((eq[ys, xs] > 0).sum()))

block = (
    '  // City lights (high 4 bits) and height (low 4 bits), one byte per land pixel.\n'
    f'  detail: "{base64.b64encode(packed.astype(np.uint8).tobytes()).decode()}",\n'
)
src = re.sub(r'  // City lights \(high 4 bits\).*?\n  detail: "[^"]*",\n', '', src, flags=re.S)
src = src.rstrip()
assert src.endswith('};')
src = src[:-2].rstrip() + '\n' + block + '};\n'
open(MAPJS, 'w', encoding='utf-8').write(src)

pv = np.zeros((H * 2, W, 3), np.uint8)
pv[:H][land] = (40, 40, 60)
pv[:H, :, 0] = np.maximum(pv[:H, :, 0], lq * 17)
pv[:H, :, 1] = np.maximum(pv[:H, :, 1], (lq * 17 * 0.75).astype(np.uint8))
pv[H:][..., 0] = pv[H:][..., 1] = pv[H:][..., 2] = np.where(land, eq * 17, 0)
Image.fromarray(pv).save(PREVIEW)
