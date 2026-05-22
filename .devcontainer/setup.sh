#!/usr/bin/env bash
set -e

reload_path() {
  # OpenCode installer adds ~/.opencode/bin via .bashrc; apply it in this shell too.
  if [[ -d "${HOME}/.opencode/bin" ]]; then
    export PATH="${HOME}/.opencode/bin:${PATH}"
  fi

  # npm global binaries (e.g. wrangler)
  if command -v npm >/dev/null 2>&1; then
    local npm_global_bin
    npm_global_bin="$(npm prefix -g 2>/dev/null)/bin"
    if [[ -d "${npm_global_bin}" ]]; then
      export PATH="${npm_global_bin}:${PATH}"
    fi
  fi

  if [[ -f "${HOME}/.bashrc" ]]; then
    set +e
    # shellcheck source=/dev/null
    source "${HOME}/.bashrc"
    set -e
  fi
}

persist_path() {
  local npm_prefix=""
  if command -v npm >/dev/null 2>&1; then
    npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  fi

  sudo tee /etc/profile.d/99-devcontainer-path.sh >/dev/null <<EOF
# Added by .devcontainer/setup.sh — available in all login shells
export PATH="\${HOME}/.opencode/bin:\${PATH}"
EOF

  if [[ -n "${npm_prefix}" ]]; then
    sudo tee -a /etc/profile.d/99-devcontainer-path.sh >/dev/null <<EOF
export PATH="${npm_prefix}/bin:\${PATH}"
EOF
  fi
}

echo "==> Installing OpenCode..."
curl -fsSL https://opencode.ai/install | bash
echo "==> Reloading PATH (OpenCode)..."
reload_path

echo "==> Installing Wrangler (global)..."
npm install -g wrangler
echo "==> Reloading PATH (Wrangler)..."
reload_path

echo "==> Installing cloudflared..."
CLOUDFLARED_DEB="/tmp/cloudflared-linux-amd64.deb"
wget -q "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb" -O "${CLOUDFLARED_DEB}"
sudo dpkg -i "${CLOUDFLARED_DEB}"
rm -f "${CLOUDFLARED_DEB}"

echo "==> Generating OpenCode config..."
mkdir -p "${HOME}/.config/opencode"
cat > "${HOME}/.config/opencode/config.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "opencode": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenCode API",
      "options": {
        "baseURL": "${OPENCODE_BASE_URL}",
        "apiKey": "{env:OPENCODE_API_KEY}"
      },
      "models": {
        "default": {
          "name": "Default Model"
        }
      }
    }
  }
}
EOF

echo "==> Persisting PATH for new shells..."
persist_path
reload_path

echo ""
echo "Setup complete! Tools installed:"
echo "  - OpenCode:  $(command -v opencode 2>/dev/null || echo 'see install output above')"
echo "  - Wrangler:  $(wrangler --version 2>/dev/null || echo 'installed')"
echo "  - cloudflared: $(cloudflared --version 2>/dev/null || echo 'installed')"
echo ""
echo "Next steps:"
echo "  1. Set OPENCODE_BASE_URL in devcontainer.json (or Codespaces secrets)"
echo "  2. Set OPENCODE_API_KEY in your local environment before creating the Codespace"
echo "  3. Run: wrangler login --no-browser"
