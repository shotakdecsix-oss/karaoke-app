# 🎤 カラオケAIオススメ

好きな曲・アーティスト、当日のセッション状況(周りで歌われた曲・自分が歌った曲)、その日の気分・曲調から、Claude AI がカラオケ曲を5曲オススメしてくれるWebアプリ。

- フロントエンド: `index.html`(単一ファイル、スマホ優先)
- サーバ: `server.js`(Node.js 標準モジュールのみ、npm install 不要)
- プロフィール(生まれ年・好きな曲)は端末の localStorage に保存され、次回も引き継がれます
- 当日セッションは朝6時に自動リセット(深夜0時をまたいでも維持)

## ローカルで起動

Node.js 18 以上が必要です。

```powershell
# Windows (PowerShell)
$env:ANTHROPIC_API_KEY = "sk-ant-..."
node server.js
```

```bash
# Mac / Linux
ANTHROPIC_API_KEY="sk-ant-..." node server.js
```

→ http://localhost:8080 を開く。
スマホから試す場合は、同じWi-Fiに接続して `http://<PCのIPアドレス>:8080` にアクセス。

## Render にデプロイ

1. このフォルダを GitHub リポジトリに push
2. Render ダッシュボード → **New → Blueprint** → リポジトリを選択(`render.yaml` を自動検出)
3. デプロイ後、サービスの **Environment** タブで `ANTHROPIC_API_KEY` にAPIキーを設定

APIキーはサーバ側の環境変数のみで保持され、フロントエンドには一切出ません。

## APIキーの取得

https://console.anthropic.com/ → API Keys から発行。
