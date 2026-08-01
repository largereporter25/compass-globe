"""Synthesises a test clip with legible signage so the pipeline can be exercised
end to end without shipping someone else's footage. Not part of the app."""
import subprocess, os, random
from PIL import Image, ImageDraw, ImageFont

OUT = "/tmp/frames"
os.makedirs(OUT, exist_ok=True)
W, H = 1280, 720

LATIN = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"
DEVA = "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf"
GUJ = "/usr/share/fonts/truetype/noto/NotoSansGujarati-Regular.ttf"

def f(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.truetype(LATIN, size)

SCENES = [
    ((28, 40, 52), [("ASHRAM ROAD", LATIN, 74), ("Ahmedabad Municipal Corporation", LATIN, 40)]),
    ((52, 44, 30), [("GJ 01 KA 4321", LATIN, 92)]),
    ((30, 48, 38), [("+91 79 2630 1234", LATIN, 62), ("www.amc.gov.in", LATIN, 46)]),
    ((46, 32, 34), [("Rs 250 / kg", LATIN, 66), ("SARDAR PATEL MARKET", LATIN, 44)]),
    ((34, 36, 50), [("अहमदाबाद", DEVA, 84), ("मार्ग", DEVA, 52)]),
    ((40, 46, 34), [("અમદાવાદ", GUJ, 84)]),
]

idx = 0
random.seed(7)
for bg, lines in SCENES:
    for _ in range(24):  # 24 frames per scene at 12fps = 2s
        img = Image.new("RGB", (W, H), bg)
        d = ImageDraw.Draw(img)
        for i in range(0, H, 9):
            d.line([(0, i), (W, i)], fill=tuple(min(255, c + 5) for c in bg))
        d.rectangle([120, 190, W - 120, H - 190], fill=(238, 236, 230))
        y = 250
        for text, font_path, size in lines:
            font = f(font_path, size)
            bbox = d.textbbox((0, 0), text, font=font)
            d.text(((W - (bbox[2] - bbox[0])) / 2, y), text, font=font, fill=(24, 24, 26))
            y += size + 34
        img.save(f"{OUT}/f{idx:04d}.png")
        idx += 1

subprocess.run([
    "ffmpeg", "-y", "-framerate", "12", "-i", f"{OUT}/f%04d.png",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24",
    "/home/user/workspace/compass-globe/test-clip.mp4",
], check=True, capture_output=True)
print("wrote test-clip.mp4", idx, "frames")
