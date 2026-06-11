# Cloudflare Workers + Hono + OpenCode Dev Container

## 概要

このリポジトリは、**Cloudflare Workers + Hono + OpenCode** の開発環境を **GitHub Codespaces** 上に構築するテンプレートです。

`.devcontainer` の設定により、Codespace 起動時に必要な CLI ツールが自動インストールされ、すぐに開発を始められます。

## 含まれるツール

| ツール | 用途 |
|--------|------|
| **OpenCode** | AI コーディングアシスタント（ターミナル） |
| **OpenCode Skills** | Cloudflare / Hono / FIWARE Orion 向けスキル 3 種（セットアップ時に自動導入。詳細は下記） |
| **ckan-open-data MCP** | 日本の CKAN オープンデータ（仙台市 / G空間 / BODIK）— 本番 Worker の **リモート MCP**（`POST /mcp`） |
| **Wrangler** | Cloudflare Workers の開発・デプロイ CLI |
| **cloudflared** | Cloudflare Tunnel（ローカル公開・接続） |
| **Hono** | 軽量 Web フレームワーク（プロジェクト作成時に導入） |

加えて、VS Code 拡張 **Cloudflare Workers Bindings** がプリインストールされます。

## 起動手順

基本的には、GitHub 上で Codespace を作成するだけで開発を始められます。リポジトリのフォークや API キーの登録は**必須ではありません**。

### 事前準備（任意）

必要な場合のみ、Codespace 作成の前に行ってください。

| 項目 | いつ必要か |
|------|------------|
| **リポジトリのカスタマイズ** | `.devcontainer` の設定を変更したい、自分用に管理したい場合。フォーク・クローン・テンプレート利用など、用途に合わせて準備する |
| **`OPENCODE_API_KEY` の登録** | OpenCode の有料 API を別途契約している場合のみ。リポジトリの **Settings** → **Secrets and variables** → **Codespaces** に同名のシークレットを追加する（手順は [環境変数・シークレット](#環境変数シークレット) を参照） |
| **`OPENCODE_BASE_URL` の設定** | 上記と同様、外部の OpenCode 互換 API を使う場合のみ。`.devcontainer/devcontainer.json` の `containerEnv` にベース URL を記入する |

### Codespace の作成（ここから開始）

1. GitHub 上で **Code** → **Codespaces** → **Create codespace on main** を選択する
2. コンテナのビルドが進む（作成ログで進捗を確認できます）
3. ビルドが完了すると Codespaces の画面が開き、ポート **8787**（Wrangler Dev Server）の転送が設定される
4. 続いて `.devcontainer/setup.sh` が自動実行され、OpenCode・Skills・Wrangler などがインストールされる。**初回は 3〜5 分程度**かかることがあります。完了するまで気長にお待ちください
5. セットアップ完了後、**新しいターミナルを開いて**から `opencode` や `wrangler` を使い始める（PATH の反映に新しいセッションが必要）

## 使い方

### OpenCode

```bash
# 対話セッションを開始
opencode

# 認証状態の確認
opencode auth list
```

設定ファイルは `~/.config/opencode/opencode.json` に生成されます。`OPENCODE_BASE_URL` と `OPENCODE_API_KEY` が devcontainer の環境変数から反映されます。

**ckan-open-data MCP** はセットアップ時に `type: "remote"` で登録されます（本番 Worker の Streamable HTTP エンドポイント `https://ckan-mcp-worker.kzkski.workers.dev/mcp`）。Cursor 向けの stdio ブリッジは不要です。`opencode` 起動後、MCP 一覧で `ckan-open-data` が有効か確認してください。

利用例（エージェントへの指示）:

```
ckan-open-data の search_datasets で portal=sendai、keyword=人口、limit=5 として検索し、結果を要約してください。
```

対応ツール: `search_datasets` / `get_dataset` / `search_records` / `list_organizations`（詳細は [ckan-mcp-worker MCP ガイド](https://github.com/kzkski/ckan-mcp-worker/blob/main/docs/MCP_CLIENT_SETUP.md)）。

#### OpenCode Skills

`setup.sh` 実行時に 3 つのスキルパッケージがグローバルインストール（`-g`）されます。配置先は OpenCode の agent-compatible パスです。

```
~/.agents/skills/<skill-name>/SKILL.md
```

例: `~/.agents/skills/wrangler/SKILL.md`

スキルは会話の内容に応じてエージェントが自動的に読み込みます。自然言語で依頼するだけで、各スキルが持つ最新のベストプラクティスや API 知識が反映されます。

##### [cloudflare/skills](https://github.com/cloudflare/skills) — Cloudflare プラットフォーム全般

Cloudflare 公式の Agent Skills コレクションです。Workers・Pages・ストレージ（KV / D1 / R2）・AI（Workers AI / Vectorize / Agents SDK）・ネットワーク（Tunnel / Spectrum）・セキュリティ（WAF / DDoS）・IaC（Terraform / Pulumi）など、Cloudflare Developer Platform 全体をカバーします。

セットアップ時に複数のスキルがまとめてインストールされます。主なものは次のとおりです。

| スキル | 用途 |
|--------|------|
| `cloudflare` | プラットフォーム全体の包括的なガイド |
| `wrangler` | Workers のデプロイ・開発、KV / R2 / D1 / Vectorize / Queues / Workflows の管理 |
| `agents-sdk` | ステートフル AI エージェント（状態管理・スケジューリング・RPC・MCP・メール・ストリーミングチャット） |
| `durable-objects` | ステートフルな協調処理（チャットルーム・マルチプレイヤーゲーム・予約システム）、SQLite・alarms・WebSockets |
| `sandbox-sdk` | AI コード実行・コードインタプリタ・CI/CD・対話型開発環境向けのサンドボックス |
| `web-perf` | Core Web Vitals（FCP / LCP / TBT / CLS）の監査、レンダリングブロック・ネットワークチェーンの分析 |
| `building-mcp-server-on-cloudflare` | Cloudflare 上でのリモート MCP サーバー構築（ツール・OAuth・デプロイ） |
| `building-ai-agent-on-cloudflare` | ステート・WebSockets・ツール連携を持つ AI エージェントの構築 |

利用例:

```
Durable Objects でチャットルームを作りたい。SQLite ストレージと WebSocket を使った構成を教えて。
```

```
wrangler.jsonc に D1 と KV のバインディングを追加する手順を教えて。
```

##### [yusukebe/hono-skill](https://github.com/yusukebe/hono-skill) — Hono Web フレームワーク

[Hono](https://hono.dev/) アプリケーション開発向けのスキルです。ルーティング・コンテキスト・ミドルウェア・JSX・バリデーション・RPC・ストリーミング・ヘルパーなど、Hono API のリファレンス知識をエージェントにインラインで提供します。

[Hono CLI](https://github.com/honojs/cli)（`hono request`）を使ったリクエストテストの手順も含まれます。プロジェクト作成時に `npm install -D @hono/cli` で CLI を導入すると、エージェントがエンドポイントの動作確認まで支援できます。

利用例:

```
Hono で Bearer トークン認証のミドルウェアを書いて。
```

```
このルートに対して hono request で GET リクエストを送って動作を確認して。
```

##### [kzkski/moc-skill](https://github.com/kzkski/moc-skill) — FIWARE Orion (NGSIv2) 読み取り専用クエリ

[FIWARE Orion Context Broker](https://fiware-orion.readthedocs.io/)（NGSIv2）から、認証不要の **GET のみ** でエンティティ情報を取得するためのスキルです。スマートシティ基盤（Make Our City など）に登録されたセンサーデータや都市 OS のコンテキスト情報を、エージェント経由で問い合わせられます。

- **読み取り専用**: Entity の Read のみ（書き込み・Subscription・Registration は非対応）
- **ホワイトリスト方式**: `endpoints.json` に登録された基盤だけアクセス可能
- **安全な問い合わせ**: エージェントは `scripts/orion.sh` 経由でのみ Orion に接続

セットアップ時に依存パッケージ `jq` もインストールされます。Orion 基盤を使う場合は、インストール後にエンドポイントを登録してください。

```bash
# 編集先（グローバルインストール時）
~/.agents/skills/moc-skill/endpoints.json
```

```json
{
  "endpoints": {
    "sendai": {
      "base_url": "https://orion.sendai.makeour.city",
      "Fiware-Service": "sendai",
      "Fiware-ServicePath": "/prod",
      "note": "仙台市都市OS基盤"
    }
  }
}
```

利用例:

```
登録されている Orion 基盤を一覧して。
```

```
横須賀市のFiwareに登録されているエンティティを取得して要約して。
```

```
佐賀市のFiwareに登録されている情報のtypeごとの件数を教えて。
```

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
| `CKAN_MCP_BASE_URL` | `devcontainer.json` の `containerEnv` | Worker のベース URL（MCP は `{BASE}/mcp` に接続。デフォルト: 本番 kzkski） |

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
| MCP が一覧に出ない | `~/.config/opencode/opencode.json` の `url` が **`/mcp` で終わっているか**確認。ターミナルを開き直して `opencode` を再起動 |
| 接続できない | Worker がデプロイ済みか。`curl -sI "${CKAN_MCP_BASE_URL}/mcp"` で応答を確認 |
| `/sse` を指定している | 旧トランスポート。URL を **`/mcp`** に変更する |
| HTTP 429 | レート制限（60 req / 60 秒）。しばらく待ってから再試行 |
