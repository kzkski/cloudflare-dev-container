# 作品提出の受付 Worker（hdsc2026-submit）

opencode 研修イベントで、参加者が作ったアプリを回収するための Worker です。
参加者が opencode で `/submit` と打つと、Codespace から作品（tar.gz）と `SUBMISSION.md` がここに送られ、R2 に保存されます。

- 受付 URL: `https://hdsc2026-submit.tokyo-odh-002.workers.dev/submit`
- 保存先: R2 バケット `hdsc2026-submissions`

## 仕組み

```
Codespace                                   受付 Worker                       R2
 /submit  ─ .devcontainer/submit.sh ─ POST /submit ─▶  JWT を検証  ─▶  {email}/{時刻}.tar.gz
          Authorization: Bearer <JWT>                  (署名/exp/iss/aud)      {email}/{時刻}.md
```

- 参加者が `opencode auth login` で得た **Cloudflare Access の JWT**（`~/.local/share/opencode/auth.json` の `token`）をそのまま Bearer トークンとして使います。参加者に新しいログインは不要です。
- この Worker には Cloudflare Access を**設定しません**。Worker 自身が JWT を検証します（opencode-for-events 用のトークンを使うため、別の Access アプリをかけると通らなくなります）。
- 検証内容: 署名（`https://data-sendai-platform.cloudflareaccess.com/cdn-cgi/access/certs` の公開鍵）、`exp`、`iss`、`aud`。`email` クレームを提出者の識別に使います。
- 同じ人が何度提出しても上書きされず、時刻ごとに別のファイルとして残ります。

## API

| メソッド・パス | 説明 |
|----------------|------|
| `POST /submit` | 提出。`Authorization: Bearer <JWT>` と multipart/form-data（`archive`: tar.gz、`SUBMISSION.md`、`GITHUB_USER`）が必要 |
| `GET /health` | 疎通確認（`{"ok":true}`） |

成功時の応答: `{"ok":true,"id":"20261117T123456789Z","email":"...","key":"<email>/<時刻>.tar.gz","size":12345,"submittedAt":"..."}`
失敗時の応答: `{"ok":false,"error":"日本語のメッセージ"}`（HTTP 400 / 401 / 413 / 500）

## 設定値（`wrangler.toml`）

| 名前 | 値 | 説明 |
|------|----|------|
| `CF_ACCESS_TEAM_NAME` | `data-sendai-platform` | opencode-for-events と同じ Zero Trust チーム名 |
| `CF_ACCESS_AUD` | （wrangler.toml 参照） | 「opencode-for-events - Authenticated」Access アプリの AUD Tag |
| `MAX_ARCHIVE_BYTES` | `52428800` | アーカイブの上限（50MB） |
| `SUBMISSIONS`（R2 バインディング） | `hdsc2026-submissions` | 保存先バケット |

## 開発・デプロイ

```bash
cd submit-worker
npm install
npm test            # JWT 検証と受付処理のテスト
npm run typecheck   # 型チェック
npm run deploy      # wrangler deploy
```

Wrangler 4.58 は Node 20 でも動くため、版を固定しています（最新版は Node 22 以上が必要）。

## 全員分の作品を一括ダウンロードする

R2 の中身は次の構成です。

```
hdsc2026-submissions/        ← バケット
  taro@example.com/
    20261117T031500123Z.tar.gz   ← 作品
    20261117T031500123Z.md       ← SUBMISSION.md
    20261117T043000456Z.tar.gz   ← 再提出（時刻が新しいほうが最新）
    ...
```

### 方法 1: rclone（推奨）

1. R2 の API トークンを作る: Cloudflare ダッシュボード → **R2** → **API** → **Manage API tokens** → **Create API token**。権限は **Object Read only**、対象バケットは `hdsc2026-submissions`。表示された **Access Key ID** と **Secret Access Key** を控える（再表示されない）。
2. [rclone](https://rclone.org/install/) をインストールし、`rclone config` で設定する（または `~/.config/rclone/rclone.conf` に直接書く）。

   ```ini
   [r2]
   type = s3
   provider = Cloudflare
   access_key_id = <Access Key ID>
   secret_access_key = <Secret Access Key>
   endpoint = https://<アカウントID>.r2.cloudflarestorage.com
   acl = private
   no_check_bucket = true
   ```

3. 全員分をダウンロードする。

   ```bash
   rclone copy r2:hdsc2026-submissions ./submissions --progress
   ```

4. すべての tar.gz をそれぞれのフォルダに展開する。

   ```bash
   cd submissions
   for f in */*.tar.gz; do
     d="${f%.tar.gz}"
     mkdir -p "$d"
     tar -xzf "$f" -C "$d"
   done
   ```

5. 参加者ごとに最新の提出だけ確認したい場合:

   ```bash
   for u in */; do ls -1 "$u"*.tar.gz | sort | tail -n 1; done
   ```

### 方法 2: wrangler で 1 件ずつ取得

Wrangler 4.58 にはバケット内の一覧コマンドがないため、キーが分かっている個別のファイルだけ取れます（キーは提出時の応答の `key`、または Cloudflare ダッシュボードの R2 画面で確認できます）。

```bash
npx wrangler r2 object get "hdsc2026-submissions/taro@example.com/20261117T031500123Z.tar.gz" \
  --remote --file ./taro.tar.gz
```

## トラブルシュート

| 症状 | 原因・対処 |
|------|------------|
| 401「トークンの有効期限が切れています」 | Access のセッション期間（現在 24 時間）を過ぎている。参加者が `opencode auth login https://opencode-for-events.tokyo-odh-002.workers.dev` をやり直す |
| 401「トークンの対象アプリケーションが正しくありません」 | `CF_ACCESS_AUD` が Access アプリの AUD Tag と一致していない。`wrangler.toml` を確認して再デプロイ |
| 413 | アーカイブが 50MB を超えている。参加者に大きなファイルを除外してもらう |
| 500「保存中にエラー」 | R2 への書き込みエラー。`npx wrangler tail hdsc2026-submit` でログを確認する |

## イベント終了後

作品を回収し終えたら、Worker と（不要なら）バケットを削除してください。

```bash
npx wrangler delete hdsc2026-submit
```
