"""Generate assets/icon.ico: rounded lime square with dark inner square (app logo mark)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parent / "assets"
OUT.mkdir(exist_ok=True)

LIME = (215, 247, 91, 255)
DARK = (14, 15, 18, 255)


def draw_mark(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = max(1, size // 16)
    r_outer = max(2, size * 5 // 16)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=r_outer, fill=LIME)
    inner = size * 5 // 16
    r_inner = max(1, size * 3 // 16)
    d.rounded_rectangle([inner, inner, size - inner, size - inner], radius=r_inner, fill=DARK)
    return img


base = draw_mark(256)
base.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icon written:", OUT / "icon.ico")
