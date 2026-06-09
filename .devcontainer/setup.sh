#!/usr/bin/env bash
set -euo pipefail

TOTAL_STEPS=6
CURRENT_STEP=0

log() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  echo ""
  echo "[$CURRENT_STEP/$TOTAL_STEPS] ==> $1"
  echo "[$CURRENT_STEP/$TOTAL_STEPS] ==> $2"
}

detail() {
  echo "    $1"
  echo "    $2"
}

try() {
  detail "Running: $*" "実行中: $*"
  "$@" || {
    echo "WARN: failed -> $*"
    echo "警告: 失敗しました -> $*"
  }
}

CKAN_MCP_BASE_URL="${CKAN_MCP_BASE_URL:-https://ckan-mcp-worker.kzkski.workers.dev}"
CKAN_MCP_REMOTE_URL="${CKAN_MCP_BASE_URL%/}/mcp"

echo "Starting devcontainer setup ($(date -u '+%Y-%m-%d %H:%M:%S UTC'))..."
echo "devcontainer セットアップを開始します ($(date -u '+%Y-%m-%d %H:%M:%S UTC'))..."

log "Installing OpenCode..." "OpenCode をインストール中..."

resolve_latest() {
  local auth=()
  [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  curl -fsSL "${auth[@]}" https://api.github.com/repos/anomalyco/opencode/releases/latest \
    | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p'
}

detail \
  "Resolving latest OpenCode version from GitHub API..." \
  "GitHub API から OpenCode の最新バージョンを取得中..."
ver=""
for i in 1 2 3; do
  ver="$(resolve_latest || true)"
  [ -n "$ver" ] && break
  echo "WARN: version resolve failed (attempt $i); retrying..."
  echo "警告: バージョン取得に失敗しました（試行 $i）、再試行します..."
  sleep $((i*5))
done

if [ -n "$ver" ]; then
  detail "Resolved version: $ver" "取得したバージョン: $ver"
  detail "Running installer..." "インストーラを実行中..."
  curl -fsSL https://opencode.ai/install | bash -s -- --version "$ver"
else
  echo "WARN: could not resolve latest; falling back to pinned ${OPENCODE_VERSION:-1.16.2}"
  echo "警告: 最新版を取得できませんでした。固定バージョン ${OPENCODE_VERSION:-1.16.2} にフォールバックします"
  detail \
    "Running installer with pinned version ${OPENCODE_VERSION:-1.16.2}..." \
    "固定バージョン ${OPENCODE_VERSION:-1.16.2} でインストーラを実行中..."
  curl -fsSL https://opencode.ai/install | bash -s -- --version "${OPENCODE_VERSION:-1.16.2}"
fi
detail "OpenCode install finished." "OpenCode のインストールが完了しました。"

log "Installing OpenCode skills..." "OpenCode スキルをインストール中..."
# グローバルインストール先: ~/.agents/skills/<name>/SKILL.md（OpenCode が読み込む）
detail "Adding cloudflare/skills..." "cloudflare/skills を追加中..."
try npx --yes skills add cloudflare/skills -a opencode -g -y
detail "Adding yusukebe/hono-skill..." "yusukebe/hono-skill を追加中..."
try npx --yes skills add yusukebe/hono-skill -a opencode -g -y

log "Installing Wrangler (global)..." "Wrangler をグローバルインストール中..."
detail "Running npm install -g wrangler..." "npm install -g wrangler を実行中..."
npm install -g wrangler
detail "Wrangler install finished." "Wrangler のインストールが完了しました。"

log "Installing cloudflared..." "cloudflared をインストール中..."
CLOUDFLARED_DEB="/tmp/cloudflared-linux-amd64.deb"
detail "Downloading cloudflared-linux-amd64.deb..." "cloudflared-linux-amd64.deb をダウンロード中..."
try wget --progress=dot:giga "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb" -O "${CLOUDFLARED_DEB}"
detail "Installing .deb package..." ".deb パッケージをインストール中..."
try sudo dpkg -i "${CLOUDFLARED_DEB}"
rm -f "${CLOUDFLARED_DEB}"
detail "cloudflared install finished." "cloudflared のインストールが完了しました。"

log "Generating OpenCode config..." "OpenCode 設定を生成中..."
detail \
  "Writing ${HOME}/.config/opencode/opencode.json ..." \
  "${HOME}/.config/opencode/opencode.json を書き込み中..."
mkdir -p "${HOME}/.config/opencode"
rm -f "${HOME}/.config/opencode/config.json"
cat > "${HOME}/.config/opencode/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "opencode": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenCode API",
      "options": {
        "baseURL": "${OPENCODE_BASE_URL:-}",
        "apiKey": "{env:OPENCODE_API_KEY}"
      },
      "models": {
        "default": {
          "name": "Default Model"
        }
      }
    }
  },
  "mcp": {
    "ckan-open-data": {
      "type": "remote",
      "url": "${CKAN_MCP_REMOTE_URL}",
      "enabled": true,
      "timeout": 120000
    }
  }
}
EOF
detail "OpenCode config written." "OpenCode 設定の書き込みが完了しました。"

echo ""
echo "================================================================"
echo " Setup complete!"
echo " セットアップ完了！"
echo "================================================================"
echo ""
echo "Tools installed:"
echo "インストール済みツール:"
echo "  - OpenCode:  $(command -v opencode 2>/dev/null || echo "${HOME}/.opencode/bin/opencode")"
echo "  - Wrangler:  $(command -v wrangler 2>/dev/null || echo 'installed')"
echo "  - cloudflared: $(cloudflared --version 2>/dev/null || echo 'installed')"
echo "  - ckan-open-data MCP (remote /mcp): ${CKAN_MCP_REMOTE_URL}"
echo ""
echo ">>> Close this terminal, then open a new terminal <<<"
echo ">>> このターミナルを閉じて、新しいターミナルを開いてください <<<"
echo "    PATH and shell configuration apply only in new terminal sessions."
echo "    PATH とシェル設定は、新しいターミナルセッションでのみ反映されます。"
echo ""
echo "Next steps (in the new terminal):"
echo "次のステップ（新しいターミナルで実行）:"
echo "  1. Set OPENCODE_BASE_URL in devcontainer.json (or Codespaces secrets)"
echo "     devcontainer.json（または Codespaces シークレット）に OPENCODE_BASE_URL を設定"
echo "  2. Set OPENCODE_API_KEY in repository Codespaces secrets (if not done yet)"
echo "     リポジトリの Codespaces シークレットに OPENCODE_API_KEY を設定（未設定の場合）"
echo "  3. Run: wrangler login --no-browser"
echo "     実行: wrangler login --no-browser"
echo "  4. Run: opencode (MCP ckan-open-data should appear in the MCP list)"
echo "     実行: opencode（MCP 一覧に ckan-open-data が表示されることを確認）"
