#!/usr/bin/env bash
set -euo pipefail

log() { echo "==> $*"; }
try() { "$@" || echo "WARN: failed -> $*"; }

CKAN_MCP_BASE_URL="${CKAN_MCP_BASE_URL:-https://ckan-mcp-worker.kzkski.workers.dev}"
CKAN_MCP_REMOTE_URL="${CKAN_MCP_BASE_URL%/}/mcp"

log "Installing OpenCode..."

resolve_latest() {
  local auth=()
  [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  curl -fsSL "${auth[@]}" https://api.github.com/repos/anomalyco/opencode/releases/latest \
    | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p'
}

ver=""
for i in 1 2 3; do
  ver="$(resolve_latest || true)"
  [ -n "$ver" ] && break
  echo "WARN: version resolve failed (attempt $i); retrying..."
  sleep $((i*5))
done

if [ -n "$ver" ]; then
  curl -fsSL https://opencode.ai/install | bash -s -- --version "$ver"
else
  echo "WARN: could not resolve latest; falling back to pinned ${OPENCODE_VERSION:-1.16.2}"
  curl -fsSL https://opencode.ai/install | bash -s -- --version "${OPENCODE_VERSION:-1.16.2}"
fi

log "Installing OpenCode skills..."
# グローバルインストール先: ~/.agents/skills/<name>/SKILL.md（OpenCode が読み込む）
try npx --yes skills add cloudflare/skills -a opencode -g -y
try npx --yes skills add yusukebe/hono-skill -a opencode -g -y

log "Installing Wrangler (global)..."
npm install -g wrangler

log "Installing cloudflared..."
CLOUDFLARED_DEB="/tmp/cloudflared-linux-amd64.deb"
try wget -q "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb" -O "${CLOUDFLARED_DEB}"
try sudo dpkg -i "${CLOUDFLARED_DEB}"
rm -f "${CLOUDFLARED_DEB}"

log "Generating OpenCode config..."
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

echo ""
echo "Setup complete! Tools installed:"
echo "  - OpenCode:  $(command -v opencode 2>/dev/null || echo "${HOME}/.opencode/bin/opencode")"
echo "  - Wrangler:  $(command -v wrangler 2>/dev/null || echo 'installed')"
echo "  - cloudflared: $(cloudflared --version 2>/dev/null || echo 'installed')"
echo "  - ckan-open-data MCP (remote /mcp): ${CKAN_MCP_REMOTE_URL}"
echo ""
echo "Next steps:"
echo "  1. Set OPENCODE_BASE_URL in devcontainer.json (or Codespaces secrets)"
echo "  2. Set OPENCODE_API_KEY in repository Codespaces secrets (if not done yet)"
echo "  3. Open a new terminal (PATH is applied via .bashrc on login)"
echo "  4. Run: wrangler login --no-browser"
echo "  5. Run: opencode (MCP ckan-open-data should appear in the MCP list)"
