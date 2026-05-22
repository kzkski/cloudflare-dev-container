# Cloudflare Workers + Hono + OpenCode Dev Container

## 概要

このリポジトリは、**Cloudflare Workers + Hono + OpenCode** の開発環境を **GitHub Codespaces** 上に構築するテンプレートです。

`.devcontainer` の設定により、Codespace 起動時に必要な CLI ツールが自動インストールされ、すぐに開発を始められます。

## 含まれるツール

| ツール | 用途 |
|--------|------|
| **OpenCode** | AI コーディングアシスタント（ターミナル） |
| **Wrangler** | Cloudflare Workers の開発・デプロイ CLI |
| **cloudflared** | Cloudflare Tunnel（ローカル公開・接続） |
| **Hono** | 軽量 Web フレームワーク（プロジェクト作成時に導入） |

加えて、VS Code 拡張 **Cloudflare Workers Bindings** がプリインストールされます。

## 起動手順

1. このリポジトリを GitHub にプッシュする（またはテンプレートとして利用する）
2. ローカル環境に `OPENCODE_API_KEY` を設定しておく（Codespaces 作成時に devcontainer へ注入されます）
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

設定ファイルは `~/.config/opencode/config.json` に生成されます。`OPENCODE_BASE_URL` と `OPENCODE_API_KEY` が devcontainer の環境変数から反映されます。

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

### 環境変数

| 変数 | 設定場所 | 説明 |
|------|----------|------|
| `OPENCODE_API_KEY` | ローカル環境（`localEnv` で注入） | OpenCode API キー |
| `OPENCODE_BASE_URL` | `devcontainer.json` の `containerEnv` | OpenCode 互換 API のベース URL（後から設定可） |

`OPENCODE_API_KEY` はリポジトリにコミットしないでください。GitHub Codespaces の場合は、User secrets や devcontainer の `remoteEnv` など、安全な方法で渡すことを推奨します。

### 初回セットアップ

`postCreateCommand` により `.devcontainer/setup.sh` が自動実行されます。失敗した場合は Codespace 内で手動実行できます。

```bash
.devcontainer/setup.sh
```
