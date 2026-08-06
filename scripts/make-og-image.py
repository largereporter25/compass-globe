from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import math, random

W, H = 1200, 630
OUT = Path(__file__).resolve().parents[1] / 'public' / 'og-image.png'
random.seed(25)
img = Image.new('RGB', (W, H), '#070b14')
p = img.load()
# Midnight-to-blue radial wash.
for y in range(H):
    for x in range(W):
        dx, dy = (x - 830) / W, (y - 290) / H
        glow = max(0, 1 - math.sqrt(dx * dx + dy * dy) * 2.4)
        p[x, y] = (7 + int(4 * glow), 11 + int(15 * glow), 20 + int(29 * glow))

d = ImageDraw.Draw(img)
orange = '#ff5a1f'
bone = '#f4ede0'
muted = '#a7b2c6'
line = '#2b3852'

# Technical longitude/latitude grid and a geometric globe.
cx, cy, r = 912, 319, 225
for rr in (r, r-1):
    d.ellipse((cx-rr, cy-rr, cx+rr, cy+rr), outline='#516078', width=2)
for lat in (-60, -30, 0, 30, 60):
    yy = cy + int(math.sin(math.radians(lat)) * r)
    half = int(math.cos(math.radians(lat)) * r)
    d.line((cx-half, yy, cx+half, yy), fill=line, width=1)
for lon in (-60, -30, 0, 30, 60):
    a = math.radians(lon)
    box = (cx-int(abs(math.cos(a))*r), cy-r, cx+int(abs(math.cos(a))*r), cy+r)
    d.ellipse(box, outline=line, width=1)
# Globe markers and a thin point-to-point path.
points = [(820, 236), (955, 203), (1034, 308), (892, 404), (1075, 417)]
for x, y in points:
    d.ellipse((x-5, y-5, x+5, y+5), fill=orange)
d.line(points[:4], fill=orange, width=2)
# Noisy cartographic blocks.
for _ in range(60):
    x = random.randint(720, 1130); y = random.randint(100, 535)
    if (x-cx)**2 + (y-cy)**2 < r*r:
        s = random.randint(1, 4)
        d.rectangle((x, y, x+s, y+s), fill='#526078')

# Divider and evidence strips.
d.line((62, 82, 632, 82), fill=bone, width=2)
d.line((62, 514, 632, 514), fill=line, width=2)
d.rectangle((62, 110, 73, 120), fill=orange)
d.rectangle((80, 110, 91, 120), outline=orange, width=2)

font_dir = '/usr/share/fonts/truetype/dejavu'
regular = ImageFont.truetype(f'{font_dir}/DejaVuSans.ttf', 24)
small = ImageFont.truetype(f'{font_dir}/DejaVuSans-Bold.ttf', 16)
heading = ImageFont.truetype(f'{font_dir}/DejaVuSans-Bold.ttf', 64)
subhead = ImageFont.truetype(f'{font_dir}/DejaVuSans.ttf', 28)
mono = ImageFont.truetype(f'{font_dir}/DejaVuSansMono.ttf', 16)

d.text((108, 101), 'COMPASS GLOBE', font=small, fill=bone)
d.text((62, 166), 'Trace the clues.', font=heading, fill=bone)
d.text((62, 238), 'Keep the evidence.', font=heading, fill=orange)
d.text((62, 338), 'Open-source geolocation triage for video evidence.', font=subhead, fill=muted)
d.text((62, 378), 'Local keyframes  /  OCR  /  open geodata  /  auditable leads', font=regular, fill=bone)
d.text((62, 545), 'VIDEO EVIDENCE · LOCAL-FIRST · OPEN DATA', font=mono, fill=muted)
d.text((62, 572), 'compass-globe.vercel.app', font=mono, fill=bone)

img.save(OUT, optimize=True)
print(OUT)
