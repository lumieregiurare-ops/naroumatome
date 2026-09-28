"""OGP画像（1200x630）とファビコンを作る。

作品の絵は使わない（権利者の画像を置かないため）。原稿用紙のマス目とロゴの文字だけで作る。
文字は Windows の游明朝（Demibold）。無い環境ではフォントのパスを書き換えて使う。

使い方: python scripts/make-og.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FONT = "C:/Windows/Fonts/yumindb.ttf"
FONT_SANS = "C:/Windows/Fonts/YuGothM.ttc"

PAPER = (246, 244, 238)
INK = (29, 35, 43)
INK2 = (74, 82, 92)
GREEN = (30, 91, 71)
GRID = (221, 216, 204)
WHITE = (255, 255, 255)
AMBER = (184, 116, 31)

S = 2  # 2 倍で描いて縮める（線をなめらかにするため）


def og():
    W, H = 1200 * S, 630 * S
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)

    # 右側に原稿用紙のマス目（縦書きの 20 字 × 行）
    cell = 44 * S
    gap = 12 * S
    x0 = 780 * S
    for col in range(8):
        x = x0 + col * (cell + gap)
        for row in range(13):
            y = 24 * S + row * cell
            d.rectangle([x, y, x + cell, y + cell], outline=GRID, width=S)

    # 左上の帯
    d.rectangle([0, 0, W, 10 * S], fill=GREEN)

    # ロゴの四角と「な」
    f_mark = ImageFont.truetype(FONT, 118 * S)
    bx, by, bs = 90 * S, 96 * S, 170 * S
    d.rounded_rectangle([bx, by, bx + bs, by + bs], radius=18 * S, fill=GREEN)
    tw = d.textlength("な", font=f_mark)
    d.text((bx + (bs - tw) / 2, by + bs / 2), "な", font=f_mark, fill=WHITE, anchor="lm")

    # サイト名
    f_title = ImageFont.truetype(FONT, 112 * S)
    tx, ty = 90 * S, 400 * S
    d.text((tx, ty), "なろう系", font=f_title, fill=INK, anchor="ls")
    w1 = d.textlength("なろう系", font=f_title)
    d.text((tx + w1, ty), "まとめ", font=f_title, fill=GREEN, anchor="ls")

    f_sub = ImageFont.truetype(FONT_SANS, 34 * S)
    d.text((tx, 490 * S), "なろう発の作品のアニメ化・コミカライズ・書籍化ニュース", font=f_sub, fill=INK2, anchor="ls")
    d.text((tx, 540 * S), "小説家になろうのランキングと、作品ごとのコメント欄", font=f_sub, fill=INK2, anchor="ls")

    d.line([tx, 572 * S, tx + 120 * S, 572 * S], fill=AMBER, width=5 * S)

    im = im.resize((1200, 630), Image.LANCZOS)
    out = SITE / "assets" / "og.png"
    im.save(out, optimize=True)
    print("wrote", out)


def icon(size):
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.18), fill=GREEN)
    f = ImageFont.truetype(FONT, int(s * 0.74))
    d.text((s / 2, s / 2 + s * 0.02), "な", font=f, fill=WHITE, anchor="mm")
    return im.resize((size, size), Image.LANCZOS)


def icons():
    icon(180).convert("RGB").save(SITE / "apple-touch-icon.png", optimize=True)
    icon(32).save(SITE / "favicon-32.png", optimize=True)
    big = icon(256)
    big.save(SITE / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    (SITE / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="12" fill="#1e5b47"/>'
        '<text x="32" y="34" font-family="\'Shippori Mincho B1\',\'Yu Mincho\',\'Hiragino Mincho ProN\',serif" font-weight="700" font-size="46" fill="#fff" text-anchor="middle" dominant-baseline="central">な</text>'
        "</svg>\n",
        encoding="utf-8",
    )
    print("wrote icons")


if __name__ == "__main__":
    og()
    icons()
