SAMURAI WATCH アプリ
海外組の日本人選手に関する試合結果・移籍ニュースと、note.comの記事一覧をまとめて確認できるスマホ向けWebアプリです。GitHub PagesとGitHub Actionsだけで動作し、サーバー費用はかかりません。
仕組み
	•	index.html … スマホ向けの静的サイト本体。data/*.json を読み込んで表示するだけ。
	•	scripts/fetch-news.mjs … Googleニュースのフィードを取得し、data/scores.json / data/transfers.json を作り直すNode.jsスクリプト。
	•	.github/workflows/update-news.yml … 上記スクリプトを 1時間ごと に自動実行し、変更があればリポジトリにコミット・プッシュするGitHub Actionsワークフロー。
	•	data/players.json … 日本代表メンバーのマスタデータ。自動取得ではなく 手動管理。移籍ウィンドウ後などにこのファイルを直接編集してコミットする。
ブラウザから直接ニュースサイトへ通信するのではなく、GitHub Actions側(サーバー)で取得したデータを静的ファイルとして配信するため、CORSやネットワーク制限の影響を受けません。

セットアップ手順
	1.	GitHubで新規リポジトリ(例: samurai-watch-app)を作成する
	2.	このフォルダの中身をそのままpushする
  git init
git add .
git commit -m "init: samurai watch app"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/samurai-watch-app.git
git push -u origin main
3.	GitHubリポジトリの Settings → Pages で、Source を Deploy from a branch、Branch を main / /(root) に設定する
	4.	GitHubリポジトリの Settings → Actions → General で、Workflow permissions を Read and write permissions にする(Actionsが自動コミットするために必要)
	5.	Actions タブから Update News Data を手動実行(Run workflow)して、初回のデータ取得を行う
	6.	数分後、https://<あなたのユーザー名>.github.io/samurai-watch-app/ でアプリが表示される
iPhoneでは、SafariでこのURLを開いて共有ボタン→「ホーム画面に追加」でアプリのように使えます。

カスタマイズ
	•	note.comのユーザー名・検索キーワードを変える:data/config.json を編集してpushするだけ(次回のActions実行から反映されます)
	•	更新頻度を変える:.github/workflows/update-news.yml の cron を編集(現在は毎時0分)
	•	アイコンを追加する:manifest.json の icons に画像を追加すると、ホーム画面のアイコンが見た目良くなります
手元での動作確認
node scripts/fetch-news.mjs   # data/*.json を更新
python3 -m http.server 8000   # ローカルでindex.htmlを確認

試合予定・結果タブのセットアップ(任意)
「試合」タブは football-data.org の無料APIを使って、実際の試合予定・結果を表示します。設定しなくてもアプリの他の機能は問題なく動きますが、このタブだけ「準備中」の表示のままになります。
	1.	football-data.org/client/register で無料アカウントを登録する(メールアドレスだけでOK)
	2.	登録後にメールで送られてくる APIキー をコピーする
	3.	GitHubリポジトリの Settings → Secrets and variables → Actions を開く
	4.	「New repository secret」で、Name に FOOTBALL_DATA_API_KEY、Secret にコピーしたキーを貼り付けて保存する
	5.	Actions タブから Update Fixtures Data を手動実行(Run workflow)する
対応リーグ:プレミアリーグ・ブンデスリーガ・リーグ・アン・セリエA・ラ・リーガ・エールディビジ・EFLチャンピオンシップ(無料枠の範囲)。
対応していないリーグ:ベルギー1部リーグ(谷口彰悟・伊東純也)、デンマークのスーペルリーガ(鈴木淳之介)、スコティッシュ・プレミアシップ(旗手怜央)は、football-data.orgの無料枠に含まれていないため、このタブには表示されません(速報・移籍タブのニュースでは引き続き追えます)。
無料枠は1分間に10リクエストまでの制限があるため、更新頻度は3時間ごとにしています(update-fixtures.ymlのcronで変更可能)。










  
