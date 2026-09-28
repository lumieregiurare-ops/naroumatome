# なろう系まとめ

小説家になろう発の作品・異世界ものの、アニメ化・コミカライズ・書籍化などのニュースと、小説家になろうのランキングをまとめるサイトです。chiikawamatome を元にしています。`docs/` がサイトルートで、ロリポップ（FTP）に置いて公開します。公開先は `https://naroumatome.gamelab.website/`。

- ニュースは **見出し・要約の一部・元記事へのリンク・元記事の og:image** のみ（本文は転載しない）
- 作品の情報とランキングは小説家になろうの公式 API の値。あらすじは冒頭 200 字だけ載せる
- 作品ページにコメント欄がある（PHP）

## 使い方

```bash
npm install                 # esbuild / sharp（ビルド用のみ）
node scripts/collect.mjs    # ニュースとなろうのランキングを集めてページを作る
node scripts/build.mjs      # site/ を最小化して docs/ に出力
python scripts/make-og.py   # OGP 画像とファビコンを作り直す（普段は不要）
```

画面を確かめるときは、コメントも動くように XAMPP の PHP で `docs/` を配信します（`http://127.0.0.1:3290/`）。

```bash
C:\xampp\php\php.exe -S 127.0.0.1:3290 -t docs
```

編集するのは `site/` です。**`docs/` の中身は直接編集しないでください**（次のビルドで上書きされます）。

## ページ

| URL | 内容 |
| --- | --- |
| `/` | ニュースが多い作品（7 日間）・話題のニュース（複数媒体が報じたもの。1 件目だけ画像つき）・新着ニュース・なろう日間ランキング・新しいコメント |
| `/works/` `/works/<id>/` | 作品一覧（画像つき・3 列）と作品ページ。画像・なろうの作品情報・PV・あらすじの冒頭・ニュース・コメント欄 |
| `/ranking/` | なろうの日間・週間・月間・四半期ランキング（各 30 位まで） |
| `/novel/<ncode>/` | ランキングに入った作品のページ（`works` に無いもの）。作品情報とコメント欄 |
| `/anime/` `/comic/` `/book/` `/web/` `/game/` `/goods/` | ジャンル別 |
| `/archive/…` `/about/` `/404.html` `/feed.xml` `/sitemap.xml` | 過去のニュース・サイトについて など |

## 作品を足す

`config.json` の `works` に足します。`id` は URL になるので後から変えないこと（コメントがその id に付くため）。`ncode` は API で確かめます。

```
https://api.syosetu.com/novelapi/api/?out=json&title=1&order=hyoka&lim=3&of=t-n-w&word=作品名
```

`keywords` はニュースの見出しにこの語があればその作品のニュースとみなす語（正規表現）。略称も入れておきます。

## 作品の画像と PV

`scripts/lib/workmedia.mjs` が、作品のニュース記事（手元の記事と、Google ニュースで「作品名 アニメ PV」「作品名 PV」を検索した記事）を開いて、記事の og:image と埋め込まれた YouTube 動画を拾います。動画は YouTube の oEmbed で埋め込みできるか確かめ、動画名に作品名と PV・予告などがあり、ぱちんこ・ゲームの動画でないものだけ使います。結果は `data/works-media.json`。収集のたびに 6 作品ずつ、3 日おきに調べ直します。

画像は記事の見出しで選び分けます。キービジュアル・PV・アニメ化の記事の画像を優先し、声優の出演・イベント・料理企画など人物写真になりがちな記事の画像は使いません（`imageScore`）。記事の画像が無い・読み込めないときは、PV のサムネイル（`img.youtube.com`）に切り替えます。それも無いときは作品名だけの札を出します。

自動で合わないものが選ばれたときは、`works` に直接書くとそちらが優先されます。

```json
{ "id": "log-horizon", ..., "pv": "YouTubeの動画ID", "image": "画像のURL" }
```

## 収集のしくみ

Google ニュースの検索フィード（`googleNews.queries`）と、ラノベニュースオンライン・アニメイトタイムズ・アニメ！アニメ！・コミックナタリー・PR TIMES の RSS を読み、`keywords`（と作品の `keywords`）に当たる記事を残します。PR TIMES は `strict: true` で、「なろう」と作品名にしか反応させていません（「異世界」「転生」だと関係ないリリースまで拾うため）。

なろうのランキングと作品の情報は 12 時間に 1 回だけ取りに行きます（`data/narou-state.json`）。作品ごとに `data/novels/<ncode>.json` に残し、ランキングに入った記録（最高順位）もここに貯めます。

## コメント

`site/api/` の PHP で受け付け、サーバーの `api/data/` にファイルで保存します。データベースは使いません。

- NG ワードは `site/api/ngwords.json`。ひらがな・小文字に直して空白と記号を抜いてから比べるので「シ ネ」「ｼﾈ」も止まります。「シネマ」のように誤って当たるものは `allow` に足します。URL・メールアドレス・電話番号も書き込めません
- 同じ人（IP のハッシュ）は 20 秒に 1 回、1 時間に 10 回まで。人には見えない欄に入力がある書き込みは捨てます
- 3 人から通報されると自動で非表示。書いた本人は同じブラウザから削除できます
- IP アドレスはそのまま保存しません（salt を混ぜたハッシュ）

**管理画面** `https://naroumatome.gamelab.website/api/admin.php` を使うには、サーバーの `api/data/admin.php` に次の 1 行だけのファイルをロリポップのファイルマネージャーなどで置いてください（FTP の自動アップロードでは送りません）。

```php
<?php return 'ここにパスワード';
```

コメントのデータはサーバーにしかありません。FTP の自動アップロードは自分で送ったファイルしか消さないので、デプロイで消えることはありませんが、サーバーを引っ越すときは `api/data/` を手で移してください。ローカルで `php -S` を動かしたときにできる `docs/api/data/` のファイルは `.gitignore` で除外しています（コミットするとサーバーのコメントを上書きしてしまうため）。

## 更新の間隔・公開の設定

chiikawamatome と同じです。GitHub Actions の cron は当てにならないので、ロリポップの cron から `repository_dispatch` を叩きます。trend-video-watcher の `tools/trigger-collect.php` の `REPOS` に `lumieregiurare-ops/naroumatome` を足してあります（サーバーのファイルも差し替えてください）。

**Secrets**: `LOLIPOP_FTP_SERVER` / `LOLIPOP_FTP_USER` / `LOLIPOP_FTP_PASSWORD`
**Variables**: `DEPLOY_TARGET` = `lolipop`、`LOLIPOP_SERVER_DIR` = サブドメインの公開ディレクトリ（末尾のスラッシュ必須）

サブドメインを変える場合は `config.json` の `site.url`、`site/index.html` の OGP・canonical、`site/robots.txt` を直してください。アナリティクスの ID（G-0KF1KBQ0KD）は `site/index.html` に書いてあり、ほかのページにもそこから入ります。
