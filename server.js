// カラオケ曲AIオススメアプリ - サーバ
// Node.js 標準モジュールのみで動作(npm install 不要 / Node 18+)
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const HOST = "0.0.0.0";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-haiku-4-5-20251001"; // MODEL が404のとき自動で切替

const INDEX_PATH = path.join(__dirname, "index.html");

// デプロイ(コード更新)日時: server.js と index.html の mtime の新しい方を日本時間で
function getBuildTime() {
  try {
    const times = [INDEX_PATH, __filename].map((f) => fs.statSync(f).mtimeMs);
    return new Date(Math.max(...times)).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    }) + " JST";
  } catch {
    return "不明";
  }
}

// ---- Claude API 呼び出し ----
async function getRecommendations({ favorites, mood, moodTags, aroundToday, sungToday, birthYear, gender, blacklist, exclude }) {
  const systemPrompt = `あなたは日本のカラオケに詳しい選曲アドバイザーです。
ユーザーの好みと気分に合わせて、カラオケで歌うのに適した曲を5曲オススメしてください。

ルール:
- 最重要(検索での裏取り必須): 候補に挙げる曲は、出力前に必ずweb検索ツールで「曲名 アーティスト名」を検索し、その曲が実在し、そのアーティストが実際に歌っている曲であることを検索結果で確認すること。うろ覚えのまま出力するのは厳禁
- 検索しても実在を確認できなかった曲・組み合わせは候補から外す。確認が取れた曲が5曲に満たない場合は、無理に5曲に埋めず、確認できた曲だけを出力してよい(5曲未満でも構わない)
- 自信がない・うろ覚えの曲を出すくらいなら、検索で存在が確認できる有名で確実な定番曲を優先する(創作・でっち上げは厳禁)
- 実在する曲のみ。日本のカラオケ(DAM/JOYSOUND)に入っていそうな曲を優先
- 「今日すでに自分が歌った曲」「今日その場で歌われた曲」「除外リスト」の曲は選ばない
- 「ブラックリスト」の曲は絶対に提案しない(ユーザーが歌わない・知らないと明示した曲)
- 「今日その場で歌われた曲」は場の雰囲気(年代・ジャンル・盛り上がり度)の手がかりとして活用し、その場に合う選曲をする
- 最重要(アーティストの偏り厳守): 「好きな曲・アーティスト」欄に名前が挙がっているアーティスト本人の曲は、どんなに好みに合っていても出力する5曲(または確認できた曲数)のうち最大1曲までしか選んではいけない(0曲でも構わない)。出力する直前に、選んだ曲のうち「好きな曲・アーティスト」欄のアーティストと一致する曲が何曲あるか数え、2曲以上あれば必ず1曲まで減らし、別のアーティストの曲に差し替えてから出力すること
- 「好きな曲・アーティスト」欄は本人の曲をそのまま出すためではなく、曲調・ノリの好み(テンポ、エネルギー、キー感、雰囲気、メロディの傾向)を読み取るための参考情報として使う。そこから連想される別のアーティストの曲を中心に提案すること
- 「性別」の扱い: 基本的にはユーザーと同じ性別のアーティストの曲を中心に選ぶ(歌いやすいキー・声域の目安になるため)。ただし気分・希望する曲調欄から「女性曲を歌いたい」「異性の曲でもOK」等の希望が読み取れる場合は、その希望を優先して異性アーティストの曲も選ぶ
- 当日の気分・希望する曲調も考慮する
- ユーザーの生まれ年から世代を推定し、青春時代(中高生〜20代前半)に流行した曲も適度に織り交ぜる
- 各曲に、なぜこのユーザーにオススメか短い理由を付ける
- キーの高さ(例: 高め/普通/低め)と難易度(易しい/普通/難しい)の目安も付ける

検索・検討の過程を経たあと、最後の出力は必ず次のJSON形式のみ(説明文やコードブロック記号は不要。JSON以外の文章を前後に付けない):
{"recommendations":[{"title":"曲名","artist":"アーティスト名","reason":"オススメ理由","key":"キーの目安","difficulty":"難易度"}]}`;

  const userPrompt = [
    birthYear ? `プロフィール: ${birthYear}年生まれ` : "",
    gender ? `性別: ${gender}(基本は同性アーティスト中心。気分・曲調の希望欄で異性曲の希望があればそちらを優先)` : "",
    `好きな曲・アーティスト(曲調・ノリの参考。同じアーティストばかり選ばないこと): ${favorites && favorites.length ? favorites.join("、") : "(未登録)"}`,
    aroundToday && aroundToday.length ? `今日その場(周り)で歌われた曲: ${aroundToday.join("、")}` : "",
    sungToday && sungToday.length ? `今日すでに自分が歌った曲: ${sungToday.join("、")}` : "",
    `今日の気分: ${mood || "(特になし)"}`,
    moodTags && moodTags.length ? `希望する曲調: ${moodTags.join("、")}` : "",
    blacklist && blacklist.length ? `ブラックリスト(絶対に提案しない): ${blacklist.join("、")}` : "",
    exclude && exclude.length ? `除外リスト(直前に提案済みなので選ばない): ${exclude.join("、")}` : "",
  ].filter(Boolean).join("\n");

  // Web検索ツールで各曲の実在をAI自身に確認させてから出力させる(幻覚対策)。
  // 検索ツールを使う場合、アシスタント応答のプリフィル(強制続き書き)は
  // 検索呼び出しの余地を潰してしまうため使わない。JSON抽出は下の頑健パーサーに任せる
  const callAPI = (model) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        system: systemPrompt,
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 8 },
        ],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

  // 上流エラーボディから error.message を取り出し、サーバログにも残す
  const readApiError = async (res) => {
    const errText = await res.text().catch(() => "");
    console.error(`Claude API エラー (${res.status}):`, errText.slice(0, 1000));
    try {
      return JSON.parse(errText).error.message || errText.slice(0, 200);
    } catch {
      return errText.slice(0, 200);
    }
  };

  // 1回分の「API呼び出し→パース」をまとめた関数。
  // パース失敗はモデルの生成揺らぎによる一過性の不具合であることが多いため、
  // 呼び出し元で複数回リトライできるようにする(致命的な設定系エラーは fatal=true で即終了)
  async function attemptOnce() {
    let usedModel = MODEL;
    let res = await callAPI(usedModel);

    if (res.status === 404 && FALLBACK_MODEL && FALLBACK_MODEL !== usedModel) {
      // モデル名が見つからない → 旧モデルへ自動フォールバック
      const firstMsg = await readApiError(res);
      console.warn(`モデル ${usedModel} が404(${firstMsg})。${FALLBACK_MODEL} で再試行します`);
      usedModel = FALLBACK_MODEL;
      res = await callAPI(usedModel);
    }

    // 一時的なエラー(429=混雑 / 529=過負荷 / 5xx)は少し待って最大2回まで自動再試行
    for (let retry = 0; !res.ok && (res.status === 429 || res.status === 529 || res.status >= 500) && retry < 2; retry++) {
      const waitMs = 1500 * 2 ** retry; // 1.5秒 → 3秒
      console.warn(`一時的なエラー(${res.status})。${waitMs}ms待って再試行します (${retry + 1}/2)`);
      await new Promise((r) => setTimeout(r, waitMs));
      res = await callAPI(usedModel);
    }

    if (!res.ok) {
      const msg = await readApiError(res);
      if (res.status === 401) {
        throw Object.assign(new Error(`APIキーが無効です。サーバの ANTHROPIC_API_KEY を確認してください (${msg})`), { fatal: true });
      }
      if (res.status === 404) {
        throw Object.assign(new Error(`モデル名(${usedModel})が見つかりません: ${msg}`), { fatal: true });
      }
      if (res.status === 429) throw new Error("リクエストが混み合っています。少し待ってからもう一度お試しください");
      if (res.status === 529 || res.status >= 500) throw new Error("AIサーバが混雑しています。少し待ってからもう一度お試しください");
      throw new Error(`Claude API エラー (${res.status}): ${msg}`);
    }

    const data = await res.json();
    // text ブロックのみ連結(web_search のツール呼び出し・検索結果ブロックは除外される)
    const full = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (data.stop_reason === "max_tokens") {
      console.warn("警告: max_tokens で応答が途中切れ(検索を多用した可能性)。修復パースを試みます。");
    }

    try {
      return parseRecommendations(full);
    } catch (e) {
      console.error("パース失敗。生応答:\n---\n" + full + "\n---");
      const snippet = full.replace(/\s+/g, " ").trim().slice(0, 160);
      throw new Error(`AIの応答を解析できませんでした(応答例: ${snippet || "(空)"}${full.length > 160 ? "…" : ""})`);
    }
  }

  // パース失敗・一時的な生成揺らぎは、生成そのものをやり直せば直ることが多いので
  // 「API呼び出し→パース」全体を最大2回まで試みる(致命的エラーは即座に終了)
  const MAX_GEN_ATTEMPTS = 2;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_GEN_ATTEMPTS; attempt++) {
    try {
      return await attemptOnce();
    } catch (e) {
      lastErr = e;
      if (e.fatal || attempt === MAX_GEN_ATTEMPTS) throw e;
      console.warn(`生成をやり直します(${attempt}/${MAX_GEN_ATTEMPTS - 1})。理由: ${e.message}`);
    }
  }
  throw lastErr;
}

// 文字列(引用符)内のブレースを無視しつつ、バランスの取れた {...} を
// すべて(ネストしたものも含めて)抜き出す。曲の理由に "や{}" が含まれていても
// 正規表現ベースより壊れにくい
function extractBraceSpans(text) {
  const spans = [];
  const stack = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") stack.push(i);
    else if (c === "}") {
      const s = stack.pop();
      if (s !== undefined) spans.push(text.slice(s, i + 1));
    }
  }
  return spans;
}

// フェンス・前置き・途中切れがあっても頑健にJSONを取り出す
function parseRecommendations(raw) {
  let t = raw.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  if (start === -1) throw new Error("JSONが見つかりません");
  t = t.slice(start);

  const spans = extractBraceSpans(t);

  // 1) 一番大きい(=トップレベルの)ブロックを { "recommendations": [...] } としてパース
  if (spans.length) {
    const outer = spans.reduce((a, b) => (b.length > a.length ? b : a));
    try {
      const parsed = JSON.parse(outer);
      if (Array.isArray(parsed.recommendations) && parsed.recommendations.length) {
        return parsed.recommendations;
      }
    } catch { /* fallthrough */ }
  }

  // 2) 修復パース: 完結している曲オブジェクトだけを拾う(途中切れ・壊れ対策)
  const recs = spans
    .filter((s) => s.includes('"title"'))
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter((r) => r && r.title);
  if (recs.length) return recs;

  throw new Error("有効な曲データを抽出できませんでした");
}

// ---- HTTPサーバ ----
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error("リクエストが大きすぎます"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // APIプロキシ
  if (url.pathname === "/api/recommend" && req.method === "POST") {
    if (!API_KEY) {
      return sendJSON(res, 500, {
        error: "サーバに ANTHROPIC_API_KEY が設定されていません",
      });
    }
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      const recommendations = await getRecommendations(body);
      return sendJSON(res, 200, { recommendations });
    } catch (e) {
      console.error(e);
      return sendJSON(res, 502, { error: e.message || "オススメの取得に失敗しました" });
    }
  }

  // 静的配信(index.html のみ、ビルド日時を埋め込み)
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return fs.readFile(INDEX_PATH, "utf8", (err, html) => {
      if (err) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        return res.end("index.html を読み込めません");
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html.replace("__BUILD_TIME__", getBuildTime()));
    });
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, HOST, () => {
  console.log(`カラオケAIオススメ: http://localhost:${PORT} (LAN: http://<このPCのIP>:${PORT})`);
  if (!API_KEY) console.warn("警告: ANTHROPIC_API_KEY が未設定です。/api/recommend は動作しません。");
});
