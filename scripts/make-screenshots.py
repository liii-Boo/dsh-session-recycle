"""把界面截图裁成 README 配图：去窗口边框、去侧栏外的空白。"""

from pathlib import Path

from PIL import Image

OUT = Path(r"C:\Users\li\Documents\deepseek-harness\default-workspace\plugins\dsh-session-recycle\docs")
OUT.mkdir(parents=True, exist_ok=True)

JOBS = [
    # 侧栏入口：整张就很紧凑，只裁掉底部空白
    (
        r"C:\Users\li\.dsh\attachments\v1\objects\1e\1e00ad0bb21c20d07420f98b5a8710b6898b29c0b1221fdb7c8c48753fbbd90a",
        "sidebar.png",
        (0, 0, 453, 460),
        453,
    ),
    # 会话页签面板：裁掉左侧栏与窗口控件
    (
        r"C:\Users\li\.dsh\attachments\v1\objects\de\def7c164614cc199a7f4606fb380047f93b5ce0ff286dad94df2ad95fed17310",
        "panel.png",
        (430, 75, 1905, 560),
        1200,
    ),
]

for src, name, box, target_width in JOBS:
    image = Image.open(src).convert("RGB")
    cropped = image.crop(box)
    if cropped.width != target_width:
        ratio = target_width / cropped.width
        cropped = cropped.resize((target_width, int(cropped.height * ratio)), Image.LANCZOS)
    target = OUT / name
    cropped.save(target, "PNG", optimize=True)
    print(f"{name}: {cropped.width}x{cropped.height}  {target.stat().st_size / 1024:.0f} KB")
