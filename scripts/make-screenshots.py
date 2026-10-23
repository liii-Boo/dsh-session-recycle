"""把「彻底删除」确认对话框截图裁成 README 配图（避开右上角窗口控件）。"""

from pathlib import Path

from PIL import Image

OUT = Path(r"C:\Users\li\Documents\deepseek-harness\default-workspace\plugins\dsh-session-recycle\docs")
OUT.mkdir(parents=True, exist_ok=True)

SRC = r"C:\Users\li\.dsh\attachments\v1\objects\ca\ca6121f0c32d1eb347d4b3b76f55e04fe7c95187cfcb0453c358808271c01ef8"

image = Image.open(SRC).convert("RGB")
# 原图 1921x1234：左侧栏到 x≈420，顶部窗口控件到 y≈75
cropped = image.crop((430, 80, 1880, 800))
ratio = 1200 / cropped.width
cropped = cropped.resize((1200, int(cropped.height * ratio)), Image.LANCZOS)
target = OUT / "dialog.png"
cropped.save(target, "PNG", optimize=True)
print(f"dialog.png: {cropped.width}x{cropped.height}  {target.stat().st_size / 1024:.0f} KB")

stale = OUT / "panel.png"
if stale.exists():
    stale.unlink()
    print("已删除旧的 panel.png（那是改样式之前的界面）")
stale2 = OUT / "confirm.png"
if stale2.exists():
    stale2.unlink()
    print("已删除 confirm.png（被 dialog.png 取代）")
