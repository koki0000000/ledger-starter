// Config.gs — 必須はNOTION_TOKENとNOTION_DATABASE_IDの2つ。DISCORD_WEBHOOK_URLは任意。値の取得手順は SETUP.md を参照。

// Notion Integration Token（Notionの「連携アプリ」を作ると発行される）
const NOTION_TOKEN = 'ここに貼る';

// 家計簿データベースのID（NotionのDB URLに含まれる32文字の英数字）
const NOTION_DATABASE_ID = 'ここに貼る';

// 処理済み/要確認メールに付けるGmailラベルの名前（存在しなければ自動作成する）
const MONITOR_LABEL = 'Ledger Starter';

// Discord Webhook URL（任意。空のままなら通知しません。設定手順はSETUP.md の手順6）
const DISCORD_WEBHOOK_URL = '';

// 以下3つは手順7（任意・上級者向け）専用。Discordのボタンで分類を訂正したい場合だけ、
// 3つとも値を入れます（1つでも空なら手順6の通知のまま動きます）。Discord Botのトークンは
// ここではなくCloudflare Workerの設定に入れます。GASから直接Discordへ投稿するとDiscord側に
// 拒否されるため、投稿だけはWorkerに任せる構成になっています（SETUP.md の手順7参照）。

// 通知を送るDiscordチャンネルのID
const DISCORD_CHANNEL_ID = '';

// Cloudflare Workerと共有する合言葉（自分で決めて、Worker側にも同じ値を設定する）
const NOTIFY_SECRET = '';

// Cloudflare WorkerのURLの末尾に /notify を足したもの（例: https://xxxx.workers.dev/notify）
const DISCORD_NOTIFY_URL = '';
