// カラオケ曲AIオススメアプリ - サーバ
// Node.js 標準モジュールのみで動作(npm install 不要 / Node 18+)
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const HOST = "0.0.0.0";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

const INDEX_PATH = path.join(__dirname, "index.html");

// ---- Claude API 呼び出し ----
async function getRecommendations({ favorites, mood, moodTags, aroundToday, sungToday, birthYear, blacklist, exclude }) {
  const systemPrompt = `あなたは日本のカラオケに詳しい選曲アドバイザーです。
ユーザーの好みと気分に合わせて、カラオケで歌うのに適した曲を5曲オススメしてください。

ルール:
- 実在する曲のみ。日本のカラオケ(DAM/JOYSOUND)に入っていそうな曲を優先
- 「今日すでに自分が歌った曲」「今日その場で歌われた曲」「除外リスト」の曲は選ばない
- 「ブラックリスト」の曲は絶対に提案しない(ユーザーが歌わない・知らないと明示した曲)
- 「今日その場で歌われた曲」は場の雰囲気(年代・ジャンル・盛り上がり度)の手がかりとして活用し、その場に合う選曲をする
- 「好きな曲・アーティスト」の扱い(重要): 挙げられたアーティストの曲をそのまま出すのではなく、リスト全体から曲調やノリの共通性(テンポ、エネルギー、キー感、雰囲気、メロディの傾向)を読み取り、それに似た曲調・ノリの曲を優先して提案する
- 同じアーティストの曲ばかりにしない。「好きな曲・アーティスト」に挙がったアーティスト本人の曲は5曲中多くても1曲までとし、残りは別のアーティストから似た雰囲気の曲を選ぶ
- 当日の気分・希望する曲調も考慮する
- ユーザーの生まれ年から世代を推定し、青春時代(中高生〜20代前半)に流行した曲も適度に織り交ぜる
- 各曲に、なぜこのユーザーにオススメか短い理由を付ける
- キーの高さ(例: 高め/普通/低め)と難易度(易しい/普通/難しい)の目安も付ける

出力は必ず次のJSON形式のみ(説明文やコードブロック記号は不要):
{"recommendations":[{"title":"曲名","artist":"アーティスト名","reason":"オススメ理由","key":"キーの目安","difficulty":"難易度"}]}`;

  const userPrompt = [
    birthYear ? `プロフィール: ${birthYear}年生まれ` : "",
    `好きな曲・アーティスト(曲調・ノリの参考。同じアーティストばかり選ばないこと): ${favorites && favorites.length ? favorites.join("、") : "(未登録)"}`,
    aroundToday && aroundToday.length ? `今日その場(周り)で歌われた曲: ${aroundToday.join("、")}` : "",
    sungToday && sungToday.length ? `今日すでに自分が歌った曲: ${sungToday.join("、")}` : "",
    `今日の気分: ${mood || "(特になし)"}`,
    moodTags && moodTags.length ? `希望する曲調: ${moodTags.join("、")}` : "",
    blacklist && blacklist.length ? `ブラックリスト(絶対に提案しない): ${blacklist.join("、")}` : "",
    exclude && exclude.length ? `除外リスト(直前に提案済みなので選ばない): ${exclude.join("、")}` : "",
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API エラー (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  // JSON部分を頑健に抽出
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AIの応答からJSONを抽出できませんでした");
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.recommendations)) {
    throw new Error("AIの応答形式が不正です");
  }
  return parsed.recommendations;
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

  // 静的配信(index.html のみ)
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return fs.readFile(INDEX_PATH, (err, data) => {
      if (err) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        return res.end("index.html を読み込めません");
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(data);
    });
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, HOST, () => {
  console.log(`カラオケAIオススメ: http://localhost:${PORT} (LAN: http://<このPCのIP>:${PORT})`);
  if (!API_KEY) console.warn("警告: ANTHROPIC_API_KEY が未設定です。/api/recommend は動作しません。");
});
