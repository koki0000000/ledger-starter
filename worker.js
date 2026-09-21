// Discordの署名検証・GASへの中継・GASからのDiscord投稿代行だけを行うCloudflare Worker。
// Cloudflareダッシュボードのコードエディタにそのまま貼り付けて使う設計で、wranglerやnpmは要らない
// （手順7参照）。ここに家計簿固有の処理（分類の判定・Notionの読み書き等）は一切書かない。GAS側の
// doPost（Code.gs）がすべて行い、interaction の経路では、このWorkerはJSONを右から左へ渡すだけにする。

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // GAS → Worker → Discord Bot API（Code.gsのnotifyDiscordInteractive_が呼ぶ）。
    // GASのUrlFetchAppから直接Discordへ投稿すると403 code 40333で拒否される
    // （Discord側のエッジがGASの発信元を塞ぐ恒常的な挙動。実機で確認した）。
    // WorkerのURLは`(名前).(アカウント名).workers.dev`の形で人には推測しにくいが、
    // 総当たりされない保証ではないため、X-Secretで誰からの呼び出しかを確認する。
    // エラー文言はDiscordが返す401（Botトークン誤り）と区別できるようにする
    // （GAS側のログを見て買った人が自分で切り分けられるように。SETUP.mdの「失敗したときの見分け方」参照）。
    if (request.method === 'POST' && url.pathname === '/notify') {
      if (request.headers.get('X-Secret') !== env.NOTIFY_SECRET) {
        return new Response('NOTIFY_SECRET mismatch', { status: 401 });
      }
      const channelId = request.headers.get('X-Channel-Id');
      const body = await request.text();
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body,
        });
        const text = await res.text();
        return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (request.method !== 'POST') return new Response('OK');

    const sig = request.headers.get('X-Signature-Ed25519');
    const ts  = request.headers.get('X-Signature-Timestamp');
    const raw = await request.text();
    if (!sig || !ts || !(await verify(env.DISCORD_PUBLIC_KEY, sig, ts, raw))) {
      return new Response('Invalid signature', { status: 401 });
    }

    const body = JSON.parse(raw);

    // Discordの疎通確認（Interactions Endpoint URLを登録・保存するたびに届く）。
    if (body.type === 1) return json({ type: 1 });

    // ここから先は3秒以内に応答する必要があるが、GAS側の処理（Notion更新）はコールドスタートを
    // 含めると3秒を超えうる。先に type 6（DEFERRED_UPDATE_MESSAGE）でDiscordに応答だけ返し、
    // GASへの中継と元メッセージの書き換えはその後ろで行う。
    ctx.waitUntil(forwardToGasAndPatch(body, env));
    return json({ type: 6 });
  },
};

// GASの応答（元メッセージの書き換え内容）をそのままDiscordへのPATCH本文として使う。
// 元メッセージの編集はinteraction tokenそのものが認証を兼ねるため、Botトークンは要らない
// （Discord公式ドキュメント: Edit Webhook Messageは認証ヘッダー不要と明記）。
async function forwardToGasAndPatch(body, env) {
  let result;
  try {
    const resp = await fetch(env.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    try {
      const parsed = JSON.parse(text);
      result = (parsed && parsed.ok === false) ? errorPayload(parsed.error) : parsed;
    } catch (e) {
      result = errorPayload('GASから読めない応答が返りました: ' + text.slice(0, 200));
    }
  } catch (e) {
    result = errorPayload('GASに届きませんでした: ' + e.message);
  }

  await fetch(
    `https://discord.com/api/v10/webhooks/${body.application_id}/${body.token}/messages/@original`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) }
  );
}

function errorPayload(detail) {
  return { content: `分類の更新に失敗しました（${String(detail).slice(0, 200)}）。もう一度選び直すか、Notionの表を直接直してください。` };
}

async function verify(publicKeyHex, signature, timestamp, body) {
  const key = await crypto.subtle.importKey('raw', fromHex(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, fromHex(signature), new TextEncoder().encode(timestamp + body));
}

function fromHex(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return b;
}

function json(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
