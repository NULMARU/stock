#!/usr/bin/env python3
"""로켓 모양 PWA 아이콘 생성 — 브랜드 컬러(#C2571B) 둥근 배경 + 크림색 로켓."""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BG = (194, 87, 27, 255)        # #C2571B 브랜드 오렌지
CREAM = (250, 247, 242, 255)   # #FAF7F2
DARK = (60, 35, 20, 255)       # 창문·디테일
FLAME = (255, 214, 140, 255)   # 불꽃


def draw_rocket(size: int, maskable: bool) -> Image.Image:
    S = 1024  # 작업 해상도
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 배경: 마스커블은 전체 채움, 일반은 둥근 사각형
    if maskable:
        d.rectangle([0, 0, S, S], fill=BG)
        pad = int(S * 0.16)  # 안전 영역
    else:
        d.rounded_rectangle([0, 0, S, S], radius=int(S * 0.22), fill=BG)
        pad = int(S * 0.10)
    cx = S // 2
    top = pad
    bot = S - pad
    body_w = int(S * 0.22)
    nose_h = int(S * 0.20)
    body_bot = bot - int(S * 0.16)  # 불꽃 공간
    # 로켓 몸통 (둥근 직사각형)
    d.rounded_rectangle([cx - body_w // 2, top + nose_h, cx + body_w // 2, body_bot],
                        radius=body_w // 3, fill=CREAM)
    # 노즈 콘
    d.polygon([(cx - body_w // 2, top + nose_h + 6), (cx, top), (cx + body_w // 2, top + nose_h + 6)],
              fill=CREAM)
    # 창문
    wr = int(body_w * 0.30)
    wy = top + nose_h + int(S * 0.10)
    d.ellipse([cx - wr, wy - wr, cx + wr, wy + wr], fill=BG, outline=DARK, width=max(4, S // 128))
    # 핀 (양옆)
    fin_w = int(body_w * 0.55)
    fin_h = int(S * 0.13)
    d.polygon([(cx - body_w // 2, body_bot - fin_h), (cx - body_w // 2 - fin_w, body_bot),
               (cx - body_w // 2, body_bot)], fill=CREAM)
    d.polygon([(cx + body_w // 2, body_bot - fin_h), (cx + body_w // 2 + fin_w, body_bot),
               (cx + body_w // 2, body_bot)], fill=CREAM)
    # 불꽃
    fx = cx
    ftop = body_bot + 6
    fbot = bot
    d.polygon([(fx - int(body_w * 0.32), ftop), (fx + int(body_w * 0.32), ftop), (fx, fbot)],
              fill=FLAME)
    d.polygon([(fx - int(body_w * 0.16), ftop), (fx + int(body_w * 0.16), ftop),
               (fx, ftop + (fbot - ftop) * 2 // 3)], fill=BG)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size, maskable, name in [
        (192, False, "icon-192.png"),
        (512, False, "icon-512.png"),
        (192, True, "icon-maskable-192.png"),
        (512, True, "icon-maskable-512.png"),
        (180, False, "apple-touch-icon.png"),
        (32, False, "favicon-32.png"),
    ]:
        draw_rocket(size, maskable).save(OUT / name)
        print(f"생성: {name} ({size}px, maskable={maskable})")


if __name__ == "__main__":
    main()
