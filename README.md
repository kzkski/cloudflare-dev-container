# Cloudflare Workers + Hono + OpenCode Dev Container

## 概要

このリポジトリは、**Cloudflare Workers + Hono + OpenCode** の開発環境を **GitHub Codespaces** 上に構築するテンプレートです。

`.devcontainer` の設定により、Codespace 起動時に必要な CLI ツールが自動インストールされ、すぐに開発を始められます。

## 含まれるツール

| ツール | 用途 |
|--------|------|
| **OpenCode** | AI コーディングアシスタント（ターミナル） |
| **OpenCode Skills** | `cloudflare/skills`・`yusukebe/hono-skill`（セットアップ時に自動導入） |
| **ckan-open-data MCP** | 日本の CKAN オープンデータ（仙台市 / G空間 / BODIK）— 本番 Worker の **リモート SSE**（`/sse`） |
| **Wrangler** | Cloudflare Workers の開発・デプロイ CLI |
| **cloudflared** | Cloudflare Tunnel（ローカル公開・接続） |
| **Hono** | 軽量 Web フレームワーク（プロジェクト作成時に導入） |

加えて、VS Code 拡張 **Cloudflare Workers Bindings** がプリインストールされます。

## 起動手順

1. このリポジトリを GitHub にプッシュする（またはテンプレートとして利用する）
2. リポジトリの **Settings** → **Secrets and variables** → **Codespaces** で、シークレット `OPENCODE_API_KEY` を追加する
3. GitHub 上で **Code** → **Codespaces** → **Create codespace on main** を選択
4. コンテナのビルドと `setup.sh` の実行が完了するまで待つ（初回は数分かかることがあります）
5. ポート **8787**（Wrangler Dev Server）が自動転送される

必要に応じて、`.devcontainer/devcontainer.json` の `OPENCODE_BASE_URL` に API のベース URL を設定してください。

## 使い方

### OpenCode

```bash
# 対話セッションを開始
opencode

# 認証状態の確認
opencode auth list
```

設定ファイルは `~/.config/opencode/opencode.json` に生成されます。`OPENCODE_BASE_URL` と `OPENCODE_API_KEY` が devcontainer の環境変数から反映されます。

**ckan-open-data MCP** はセットアップ時に `type: "remote"` で登録されます（本番 Worker の SSE エンドポイント `https://ckan-mcp-worker.kzkski.workers.dev/sse`）。OpenCode のリモート MCP は **SSE のみ**対応のため、stdio ブリッジや `POST /mcp` は使いません。`opencode` 起動後、MCP 一覧で `ckan-open-data` が有効か確認してください。

利用例（エージェントへの指示）:

```
ckan-open-data の search_datasets で portal=sendai、keyword=人口、limit=5 として検索し、結果を要約してください。
```

対応ツール: `search_datasets` / `get_dataset` / `search_records` / `list_organizations`（詳細は [ckan-mcp-worker MCP ガイド](https://github.com/kzkski/ckan-mcp-worker/blob/main/docs/MCP_CLIENT_SETUP.md)）。

Cloudflare / Hono 向けの Skills は `setup.sh` 実行時にグローバルインストール（`-g`）され、次の形式で配置されます（OpenCode の agent-compatible パス）。

```
~/.agents/skills/<skill-name>/SKILL.md
```

例: `~/.agents/skills/wrangler/SKILL.md`

- [cloudflare/skills](https://github.com/cloudflare/skills)
- [yusukebe/hono-skill](https://github.com/yusukebe/hono-skill)

### Wrangler（ローカル開発）

```bash
# プロジェクトディレクトリで開発サーバー起動（デフォルトポート 8787）
wrangler dev

# デプロイ
wrangler deploy
```

### cloudflared（Quick Tunnel）

```bash
# Wrangler が 8787 で動いている状態で、一時的な公開 URL を発行
cloudflared tunnel --url http://localhost:8787
```

表示された `*.trycloudflare.com` の URL で、外部からデモにアクセスできます。

## Hono プロジェクトの作り方

新規 Workers プロジェクトは Cloudflare の公式スキャフォールドで作成します。

```bash
npm create cloudflare@latest my-app
```

プロンプトでは次のような選択が一般的です。

- **Template**: `Worker + Durable Objects` または `Hello World` など用途に合わせて選択
- **Framework**: **Hono** を選択すると Hono ベースの構成になります

作成後:

```bash
cd my-app
npm install
wrangler dev
```

## デモ公開方法（Quick Tunnel）

1. ターミナル 1 で `wrangler dev` を起動する
2. ターミナル 2 で `cloudflared tunnel --url http://localhost:8787` を実行する
3. 出力された公開 URL を共有する

Quick Tunnel は一時的な URL です。本番運用には [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) の恒常的な設定を検討してください。

## 注意事項

### Wrangler ログイン（Codespaces）

ブラウザが開けない環境のため、**必ず** `--no-browser` オプションを使ってください。

```bash
wrangler login --no-browser
```

表示される URL をローカル PC のブラウザで開き、表示された認証コードをターミナルに貼り付けます。

### 環境変数・シークレット

| 変数 | 設定場所 | 説明 |
|------|----------|------|
| `OPENCODE_API_KEY` | リポジトリの **Codespaces シークレット** | OpenCode API キー（`devcontainer.json` の `secrets` と同名） |
| `OPENCODE_BASE_URL` | `devcontainer.json` の `containerEnv` | OpenCode 互換 API のベース URL（後から設定可） |
| `CKAN_MCP_BASE_URL` | `devcontainer.json` の `containerEnv` | Worker のベース URL（MCP は `{BASE}/sse` に接続。デフォルト: 本番 kzkski） |

#### `OPENCODE_API_KEY` の登録手順

1. GitHub リポジトリで **Settings** → **Secrets and variables** → **Codespaces** を開く
2. **New repository secret** をクリック
3. Name に `OPENCODE_API_KEY`、Value に API キーを入力して保存
4. Codespace を作成または Rebuild する

`devcontainer.json` の `remoteEnv` が `${localEnv:OPENCODE_API_KEY}` 経由でコンテナへ渡します。キーをリポジトリにコミットしないでください。

### 初回セットアップ

`postCreateCommand` により `.devcontainer/setup.sh` が自動実行されます。失敗した場合は Codespace 内で手動実行できます。

```bash
.devcontainer/setup.sh
```

`setup.sh` 完了後は **新しいターミナルを開いて** から `opencode` や `wrangler` を使ってください（OpenCode インストーラが `.bashrc` に追加した PATH はログイン時に読み込まれます）。

### ckan-open-data MCP のトラブルシュート

| 症状 | 対処 |
|------|------|
| MCP が一覧に出ない | `~/.config/opencode/opencode.json` の `url` が **`/sse` で終わっているか**確認。ターミナルを開き直して `opencode` を再起動 |
| 接続できない | `/mcp` ではなく **`/sse`** か確認。Worker がデプロイ済みか（`curl -sI "${CKAN_MCP_BASE_URL}/sse"`） |
| REST は動くが MCP だけ失敗 | OpenCode は Streamable HTTP（`POST /mcp`）非対応。設定を `type: "remote"` + `/sse` にする |
| HTTP 429 | レート制限（60 req / 60 秒）。しばらく待ってから再試行 |
