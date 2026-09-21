// Config.gs — 設定はこの3つだけ。値の取得手順は README.md を参照。

// Notion Integration Token（Notionの「連携アプリ」を作ると発行される）
const NOTION_TOKEN = 'ここに貼る';

// 家計簿データベースのID（NotionのDB URLに含まれる32文字の英数字）
const NOTION_DATABASE_ID = 'ここに貼る';

// 処理済み/要確認メールに付けるGmailラベルの名前（存在しなければ自動作成する）
const MONITOR_LABEL = 'Ledger Starter';
