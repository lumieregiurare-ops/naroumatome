"""ファビコンを作る（og() は以前の OGP 画像を作っていたもの）。

OGP 画像（site/assets/og.png）はいまは手で作った画像を 1200x630 に縮めて置いている。
このスクリプトは既定ではファビコンだけを書き出す。og() を呼ぶと手で作った OGP 画像を上書きするので注意。

作品の絵は使わない（権利者の画像を置かないため）。サイト名の文字だけで作る。
文字は Windows の游ゴシック（Bold）。無い環境ではフォントのパスを書き換えて使う。

使い方: python scripts/make-og.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FONT = "C:/Windows/Fonts/YuGothB.ttc"

INK = (34, 34, 34)
INK2 = (90, 90, 90)
BLUE = (44, 111, 187)
ORANGE = (232, 89, 12)
WHITE = (255, 255, 255)

S = 2  # 2 倍で描いて縮める（線をなめらかにするため）


def og():
    W, H = 1200 * S, 630 * S
    im = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 14 * S], fill=ORANGE)
    d.rectangle([0, 470 * S, W, H], fill=BLUE)

    f_title = ImageFont.truetype(FONT, 150 * S)
    tx, ty = 80 * S, 330 * S
    d.text((tx, ty), "なろう系", font=f_title, fill=INK, anchor="ls")
    w1 = d.textlength("なろう系", font=f_title)
    d.text((tx + w1, ty), "まとめ", font=f_title, fill=BLUE, anchor="ls")

    f_sub = ImageFont.truetype(FONT, 34 * S)
    d.text((tx, 400 * S), "なろう発作品のアニメ化・コミカライズ・書籍化ニュース", font=f_sub, fill=INK2, anchor="ls")
    f_url = ImageFont.truetype(FONT, 34 * S)
    d.text((tx, 560 * S), "naroumatome.gamelab.website", font=f_url, fill=WHITE, anchor="ls")

    im = im.resize((1200, 630), Image.LANCZOS)
    out = SITE / "assets" / "og.png"
    im.save(out, optimize=True)
    print("wrote", out)


def icon(size):
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.18), fill=BLUE)
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
        '<rect width="64" height="64" rx="12" fill="#2c6fbb"/>'
        '<text x="32" y="34" font-family="sans-serif" font-weight="700" font-size="46" fill="#fff" text-anchor="middle" dominant-baseline="central">な</text>'
        "</svg>\n",
        encoding="utf-8",
    )
    print("wrote icons")


if __name__ == "__main__":
    icons()
