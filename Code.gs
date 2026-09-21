// Code.gs — カード利用メールを読み、Notionの家計簿データベースに1行追加する。
// 1分おきの時間主導トリガーで checkCardEmails() を呼ぶ想定（設定手順は README.md）。

// ---- 日付・金額の下ごしらえ ----

function normalizeDate_(raw) {
  return raw
    .replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/\//g, '-')
    .replace(/(\d{4})-(\d{1,2})-(\d{1,2})/, (_, y, m, d) =>
      `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
}

function extract_(body, dateRe, storeRe, amountRe) {
  const dm = body.match(dateRe), sm = body.match(storeRe), am = body.match(amountRe);
  if (!dm || !sm || !am) return null;
  return {
    date:   normalizeDate_(dm[1]),
    store:  sm[1].trim(),
    amount: parseInt(am[1].replace(/[,，]/g, ''), 10),
  };
}

// ---- カード会社ごとのメール解析 ----
// 外貨決済・取消/返品・カード券種の判定は含まない（README「できないこと」参照）。
// 金額は「円」で終わり符号の無いものだけを読む。外貨や「-1,234円」のような返品はnullになる。
// 対象外の形式はamountRe等が一致せずnullを返し、要確認ラベルへ回る＝黙って消えはしない。

function parseVpass_(body) {
  return extract_(body,
    /◇利用日[^0-9]*(\d{4}[\/年]\d{1,2}[\/月]\d{1,2})/,
    /◇利用先[：:]\s*(.+?)[\r\n]/,
    // 円建てでも「1,234.00JPY」と書かれる通知がある（実メールで確認）。小数が0の時だけ円として読む。
    /◇利用金額[：:]\s*([0-9,]+)(?:\.0+)?\s*(?:円|JPY)/
  );
}

function parseRakuten_(body) {
  return extract_(body,
    /(?:ご利用日時?|利用日)[^0-9]*(\d{4}[\/年]\d{1,2}[\/月]\d{1,2})/,
    /(?:ご利用先|利用先|加盟店|ご利用加盟店)[^：:\n]*[：:]\s*(.+?)[\r\n]/,
    /(?:ご利用金額|利用金額)[^0-9\-−－]*([0-9,]+)\s*円/
  );
}

function parseViewCard_(body) {
  return extract_(body,
    /利用日[^0-9]*(\d{4}[\/年]\d{1,2}[\/月]\d{1,2})/,
    /利用加盟店[^：:]*[：:]\s*(.+?)[\r\n]/,
    /利用金額[^0-9\-−－]*([0-9,]+)\s*円/
  );
}

// viewsnet.jpはJR東日本「ビューカード」の通知ドメイン（JALカードSuica・ルミネカード・JRE CARD等が
// ここから届く。JCB/DC/AMEX発行のJALカードは対象外＝README「できないこと」参照）。
const CARD_SENDERS = [
  { match: /vpass\.ne\.jp/i,        name: '三井住友',     parse: parseVpass_ },
  { match: /rakuten-card\.co\.jp/i, name: '楽天カード',   parse: parseRakuten_ },
  { match: /viewsnet\.jp/i,         name: 'ビューカード', parse: parseViewCard_ },
];

function parseMsg_(msg) {
  const from = msg.getFrom();
  const sender = CARD_SENDERS.find(s => s.match.test(from));
  if (!sender) return null;
  const parsed = sender.parse(msg.getPlainBody());
  if (!parsed) return null;
  parsed.card = sender.name;
  parsed.category = guessCategory_(parsed.store);
  const subject = msg.getSubject();
  parsed.isFinal = /確報/.test(subject);
  parsed.isStatement = /ご利用明細/.test(subject);
  return parsed;
}

// ---- 分類の簡易推定（店名のキーワード一致。最初に当たったものを使う）----

const CATEGORY_RULES = [
  { re: /セブン|ローソン|ファミリーマート|ミニストップ|スターバックス|ドトール|コメダ|タリーズ|吉野家|すき家|松屋|マクドナルド|ケンタッキー|モスバーガー|サブウェイ|食堂|レストラン|カフェ/i, name: '食費' },
  { re: /イオン|西友|ライフ|マルエツ|業務スーパー|オーケー|スーパー/i, name: '食料品' },
  { re: /マツモトキヨシ|ツルハ|ウエルシア|ドラッグ|薬局/i, name: '日用品' },
  { re: /Amazon|アマゾン|楽天市場|ヨドバシ|ヤマダ電機/i, name: 'ネット通販' },
  { re: /Netflix|Spotify|Apple\s*(Music|TV|One)|iCloud|Hulu|DAZN|定額|サブスク/i, name: 'サブスク・娯楽' },
  { re: /病院|クリニック|医院|歯科|調剤/i, name: '医療' },
  // 「ガス」は「ガスト」（飲食チェーン）を誤って光熱費に入れないよう除外する
  { re: /電気|ガス(?!ト)|水道|東京電力|関西電力|東京ガス/i, name: '光熱費' },
  // 「au」は単独だとAUTOBACS等の店名に含まれ誤爆するため、通信サービスと分かる表記のみ拾う
  { re: /モバイル|通信|ドコモ|ソフトバンク|KDDI|au\s*(?:ペイ|PAY|ショップ)/i, name: '通信' },
  { re: /JR|地下鉄|バス|タクシー|Suica|PASMO|ICOCA|航空|ANA|JAL/i, name: '交通' },
];

function guessCategory_(store) {
  const hit = CATEGORY_RULES.find(r => r.re.test(store));
  return hit ? hit.name : 'その他';
}

// ---- Notion書き込み ----

function registerToNotion_(expense) {
  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + NOTION_TOKEN,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        '名前':   { title: [{ text: { content: expense.store } }] },
        '金額':   { number: expense.amount },
        '日付':   { date: { start: expense.date } },
        'カード': { select: { name: expense.card } },
        '分類':   { select: { name: expense.category } },
      },
    }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Notion登録エラー ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
}

function notionFetch_(url, method, body) {
  const res = UrlFetchApp.fetch(url, {
    method: method,
    headers: {
      Authorization: 'Bearer ' + NOTION_TOKEN,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Notionエラー ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

// ビューカードは1回の利用で「速報」（数分後・店名は「国内加盟店」のような総称）と
// 「確報」（約1週間後・本当の店名）の2通が届く。実メールで確認済み。
// 速報で行を作り、確報では同じ日付・金額の総称の行を探して店名を書き換える。
// 分類は「その他」のままの時だけ書き換える（持ち主が手で選び直した分類を上書きしないため）。
// 総称の行が無く同じ日付・金額の行があれば、速報の時点で店名が出ていたとみなし何もしない。
// どちらも無ければ（速報が届かなかった等）確報で新しく行を作る。
const VIEW_GENERIC_STORE = /^国内加盟店$|^海外加盟店$/;

function findSameRows_(expense) {
  const res = notionFetch_('https://api.notion.com/v1/databases/' + NOTION_DATABASE_ID + '/query', 'post', {
    filter: { and: [
      { property: 'カード', select: { equals: expense.card } },
      { property: '日付',   date:   { equals: expense.date } },
      { property: '金額',   number: { equals: expense.amount } },
    ] },
    page_size: 20,
  });
  return res.results.map(r => ({
    id: r.id,
    store: (r.properties['名前'].title[0] || { plain_text: '' }).plain_text,
    category: (r.properties['分類'].select || { name: '' }).name,
  }));
}

// 三井住友の「ご利用明細のお知らせ」は、即時の通知が来なかった利用（iD払い等）を知らせる一方、
// 即時の通知があった利用も載ることがある（返品で両方に届いた例がある）。
// 同じ日付・金額の行が既にあれば記帳しない。
function recordVpassStatement_(expense) {
  if (findSameRows_(expense).length) return;
  registerToNotion_(expense);
}

function recordFinalViewCard_(expense) {
  const rows = findSameRows_(expense);
  // 同じ店名の行があれば記帳済み。これを先に見ないと、同じ日・同じ金額の別の利用の総称の行を書き換えてしまう。
  if (rows.some(r => r.store === expense.store)) return;
  const generic = rows.find(r => VIEW_GENERIC_STORE.test(r.store));
  if (generic) {
    const props = { '名前': { title: [{ text: { content: expense.store } }] } };
    if (!generic.category || generic.category === 'その他') props['分類'] = { select: { name: expense.category } };
    notionFetch_('https://api.notion.com/v1/pages/' + generic.id, 'patch', { properties: props });
    return;
  }
  if (rows.length) return;
  registerToNotion_(expense);
}

// ラベルは初回実行時に自動作成される。手で作る必要はない。
function labelThread_(thread, suffix) {
  const name = MONITOR_LABEL + '/' + suffix;
  const label = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  thread.addLabel(label);
}

// 書き込みの後にこの保存だけが失敗すると、次の回に同じメールを読み直して二重に記帳する。
// 一時的な失敗に備えて数回やり直す。
function saveDoneIds_(props, ids) {
  for (let i = 0; ; i++) {
    try {
      props.setProperty('PROC_IDS', JSON.stringify(ids.slice(-300)));
      return;
    } catch (e) {
      if (i >= 2) throw e;
      Utilities.sleep(1000);
    }
  }
}

// ---- メイン ----

function checkCardEmails() {
  if (NOTION_TOKEN === 'ここに貼る' || NOTION_DATABASE_ID === 'ここに貼る') {
    throw new Error('Config.gs の NOTION_TOKEN / NOTION_DATABASE_ID がまだ未設定です（README手順3参照）');
  }
  // 1分ごとのトリガーは前回の実行が長引くと重なって同じメールを2度処理しうるため、
  // 鍵が取れない回は今回を丸ごと見送る（次の1分でやり直せば十分）。
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  const errors = [];
  try {
    const props = PropertiesService.getScriptProperties();
    const done = new Set(JSON.parse(props.getProperty('PROC_IDS') || '[]'));
    let ids = [...done];

    // 件名で利用通知だけに絞る。絞らないと請求額の案内や広告まで読み、毎回「要確認」の印が付く。
    // 楽天の速報版は店名が無く確定版と二重になるので読まない（確定版は数日後に届く）。
    const queries = [
      // 三井住友の即時の通知と明細は別のスレッドで届く。即時の通知を先に処理しないと明細が先に記帳され二重になる。
      { days: 2,  q: 'from:statement@vpass.ne.jp subject:ご利用のお知らせ -subject:ご利用明細' },
      { days: 2,  q: 'from:statement@vpass.ne.jp subject:ご利用明細のお知らせ' },
      { days: 2,  q: 'from:rakuten-card.co.jp subject:カード利用のお知らせ -subject:速報版' },
      // ビューカードの確報は利用から約1週間後に届くので10日分を読む。
      // 初回は速報と確報が同時に見つかるため、速報を先に処理しないと二重になる。
      { days: 10, q: 'from:viewsnet.jp subject:ご利用情報のお知らせ -subject:確報版' },
      { days: 10, q: 'from:viewsnet.jp subject:ご利用情報のお知らせ subject:確報版' },
    ];
    // 1件でも失敗したらこの回はそこで止める。続けると、失敗した即時の通知・速報版より先に
    // 明細・確報が記帳され、次の回に読み直した即時の通知・速報版で二重になる。
    scan:
    for (const { days, q } of queries) {
      // Gmailの検索はスレッド単位で当たり、同じ件名の古い通知も1つのスレッドに入っている。
      // 期間より古いメールを読むと、処理済みの記録（直近300件）から外れた分を二重に記帳する。
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      for (const thread of GmailApp.search(q + ' newer_than:' + days + 'd', 0, 20)) {
        for (const msg of thread.getMessages()) {
          const id = msg.getId();
          if (done.has(id)) continue;
          if (msg.getDate().getTime() < since) continue;
          try {
            const expense = parseMsg_(msg);
            if (expense && expense.card === 'ビューカード' && expense.isFinal) recordFinalViewCard_(expense);
            else if (expense && expense.card === '三井住友' && expense.isStatement) recordVpassStatement_(expense);
            else if (expense) registerToNotion_(expense);
            // Notion書き込みが成功した直後（または記帳対象でないと分かった直後）に保存する。
            // 末尾でまとめて保存すると、途中の1件が例外で落ちたときに直前まで成功した分が
            // 「未処理」のまま残り、次の1分の実行がNotionへ二重登録してしまう。
            ids.push(id);
            saveDoneIds_(props, ids);
            // ラベル付けはNotion書き込みの成否と別に失敗しうる（Gmail側のAPI制限等）ので、
            // ここで失敗しても上の保存はやり直さない＝二重登録の危険はない。
            try {
              labelThread_(thread, expense ? '記帳済み' : '要確認');
            } catch (labelErr) {
              Logger.log('checkCardEmails: ' + id + ' のラベル付けに失敗: ' + labelErr);
            }
          } catch (e) {
            // この1件は未処理のまま残り、次の回にこの1件から読み直す。
            Logger.log('checkCardEmails: ' + id + ' の処理に失敗: ' + e);
            errors.push(id + ': ' + e);
            break scan;
          }
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
  // 1件でも失敗があれば実行自体を失敗として終える。GASは失敗した時間主導トリガーの実行を
  // オーナーのメールに自動で知らせるため、Config.gsの値が間違っている等の設定ミスが
  // 「実行は毎回成功しているのに家計簿に何も増えない」という気づきにくい形で埋もれるのを防ぐ。
  if (errors.length) {
    throw new Error(errors.length + '件のメールでエラー:\n' + errors.join('\n'));
  }
}
