// Config.gs — 必須の設定は上の3つ。DISCORD_WEBHOOK_URLは任意。値の取得手順は README.md を参照。

// Notion Integration Token（Notionの「連携アプリ」を作ると発行される）
const NOTION_TOKEN = 'ここに貼る';

// 家計簿データベースのID（NotionのDB URLに含まれる32文字の英数字）
const NOTION_DATABASE_ID = 'ここに貼る';

// 処理済み/要確認メールに付けるGmailラベルの名前（存在しなければ自動作成する）
const MONITOR_LABEL = 'Ledger Starter';

// Discord Webhook URL（任意。空のままなら通知しません。設定手順はREADME手順6）
const DISCORD_WEBHOOK_URL = '';

// 以下2つは手順7（任意・上級者向け）専用。Discordのボタンで分類を訂正したい場合だけ、
// 両方に値を入れます。片方だけ入れても手順6の通知のまま動きます（README手順7参照）。

// Discord Botのトークン（Discord Developer Portalの「Bot」タブで発行）
const DISCORD_BOT_TOKEN = '';

// 通知を送るDiscordチャンネルのID
const DISCORD_CHANNEL_ID = '';
