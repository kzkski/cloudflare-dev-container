#!/usr/bin/env bash
# 作品提出スクリプト
#
# Codespace 作成後に「新しく追加されたファイルのみ」を tar.gz にまとめ、
# opencode-for-events の認証トークン（Cloudflare Access の JWT）を使って受付 Worker に送信する。
# push 済み・commit 済み・未コミットのどれでも、作成後に追加したファイルなら提出対象になる。
#
# 使い方:
#   bash .devcontainer/submit.sh             # 提出する
#   bash .devcontainer/submit.sh --dry-run   # 送信せず、対象ファイルの確認と tar.gz の作成だけ行う
#
# 提出の基準（この時点より後に追加されたファイルが対象）。次の優先順で決める:
#   1. 環境変数 SUBMIT_BASE_REF（テスト用。コミットやブランチを指定する）
#   2. .git/submit-base に記録された、Codespace 作成時点のコミット（setup.sh が作成時に記録）
#   3. origin が kzkski/cloudflare-dev-container を指している場合は origin/main（記録が無い旧 Codespace 向け）
#   4. 上記のどれでもなければ、リポジトリの最初のコミット（テンプレートから作ったリポジトリ向け）
#
# 環境変数（通常は設定不要。テスト用）:
#   SUBMIT_URL          受付 Worker の URL
#   OPENCODE_AUTH_FILE  opencode の認証ファイル（既定: ~/.local/share/opencode/auth.json）
#   SUBMIT_BASE_REF     提出の基準にするコミット・ブランチ（上記 1。既定: 未設定）
set -euo pipefail

SUBMIT_URL="${SUBMIT_URL:-https://hdsc2026-submit.tokyo-odh-002.workers.dev/submit}"
AUTH_FILE="${OPENCODE_AUTH_FILE:-${HOME}/.local/share/opencode/auth.json}"
# auth.json の中でトークンを探すときに優先するキー
AUTH_KEY="https://opencode-for-events.tokyo-odh-002.workers.dev"
BASE_REF=""
BASE_DESC=""
MAX_BYTES=$((50 * 1024 * 1024))
MAX_LIST_LINES=100

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

die() {
  echo "" >&2
  echo "エラー: $*" >&2
  exit 1
}

DRY_RUN=0
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      # 先頭のコメントブロック（2 行目から、コメントでない行の手前まで）をそのまま表示する
      awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) die "不明な引数です: ${arg}" ;;
  esac
done

for cmd in git tar curl node; do
  command -v "${cmd}" > /dev/null 2>&1 || die "${cmd} コマンドが見つかりません"
done

git rev-parse --git-dir > /dev/null 2>&1 || die "${REPO_ROOT} は git リポジトリではありません"

# 提出の基準を決める（この基準より後に追加されたファイルが提出対象）。優先順は冒頭のコメントを参照
resolve_base_ref() {
  local git_dir recorded url root

  # 1. 環境変数 SUBMIT_BASE_REF（テスト用）
  if [ -n "${SUBMIT_BASE_REF:-}" ]; then
    git rev-parse --verify -q "${SUBMIT_BASE_REF}^{commit}" > /dev/null \
      || die "環境変数 SUBMIT_BASE_REF に指定された ${SUBMIT_BASE_REF} が見つかりません"
    BASE_REF="${SUBMIT_BASE_REF}"
    BASE_DESC="環境変数 SUBMIT_BASE_REF（${SUBMIT_BASE_REF}）"
    return 0
  fi

  # 2. Codespace 作成時に setup.sh が記録したコミット
  git_dir="$(git rev-parse --absolute-git-dir 2> /dev/null || true)"
  if [ -n "${git_dir}" ] && [ -s "${git_dir}/submit-base" ]; then
    recorded="$(head -n 1 "${git_dir}/submit-base" | tr -d '[:space:]')"
    if [ -n "${recorded}" ] && git rev-parse --verify -q "${recorded}^{commit}" > /dev/null; then
      BASE_REF="${recorded}"
      BASE_DESC="Codespace 作成時のコミット（$(git rev-parse --short "${recorded}")）"
      return 0
    fi
  fi

  # 3. 記録が無い旧 Codespace（講師リポジトリから直接作ったもの）は origin/main
  url="$(git remote get-url origin 2> /dev/null | tr '[:upper:]' '[:lower:]' || true)"
  if [[ "${url}" == *kzkski/cloudflare-dev-container* ]] \
    && git rev-parse --verify -q "origin/main^{commit}" > /dev/null; then
    BASE_REF="origin/main"
    BASE_DESC="講師リポジトリの origin/main"
    return 0
  fi

  # 4. テンプレートから作ったリポジトリ: 最初のコミット（複数あれば最も古いもの）
  root="$(git rev-list --max-parents=0 HEAD 2> /dev/null | tail -n 1 || true)"
  if [ -n "${root}" ]; then
    BASE_REF="${root}"
    BASE_DESC="リポジトリの最初のコミット（$(git rev-parse --short "${root}")）"
    return 0
  fi

  die "提出の基準となるコミットが見つかりません。.git/submit-base の記録も、origin/main も、最初のコミットもありません。コミットが 1 つ以上ある git リポジトリ（Codespace のワークスペース）で実行してください"
}
resolve_base_ref
echo "提出の基準: ${BASE_DESC}"
echo "  （この基準より後に追加されたファイルが提出対象です）"

[ -f SUBMISSION.md ] || die "SUBMISSION.md がありません（${REPO_ROOT}/SUBMISSION.md）。アプリの説明を書いた SUBMISSION.md を作成してから、もう一度実行してください（opencode の /submit なら自動で作成します）"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT
RAW_LIST="${WORK_DIR}/raw.list"
LIST="${WORK_DIR}/files.list"

# ---------------------------------------------------------------
# 1. 対象ファイルの収集（Codespace 作成後に新しく追加されたものだけ）
# ---------------------------------------------------------------

# 提出しないパス（.gitignore に頼らず、秘密情報や巨大なものは常に除外する）
is_excluded() {
  case "/$1" in
    */node_modules/* | */.git | */.git/* | */.wrangler/* | */.env* | */.dev.vars* | \
      */auth.json | */*.pem | */*.key | */.DS_Store | /submission-*.tar.gz)
      return 0
      ;;
  esac
  return 1
}

# パスを NUL 区切りで出力する。末尾が / のものは入れ子の git リポジトリ
# （npm create cloudflare などが git init したもの）なので、その中身を展開する
emit() {
  local p="$1" f
  if [[ "${p}" == */ ]]; then
    while IFS= read -r -d '' f; do
      emit "${p}${f}"
    done < <(git -C "${p}" ls-files -co --exclude-standard -z)
  else
    printf '%s\0' "${p}"
  fi
}

{
  # コミット済み・ステージ済みの新規ファイル（名前変更は「削除+追加」として扱う）
  git diff --name-only --no-renames --diff-filter=A -z "${BASE_REF}"
  # 未コミットの新規ファイル（.gitignore 対象は除外）
  git ls-files -o --exclude-standard -z
} | while IFS= read -r -d '' p; do
  emit "${p}"
done | sort -zu > "${RAW_LIST}"

: > "${LIST}"
while IFS= read -r -d '' p; do
  is_excluded "${p}" && continue
  { [ -e "${p}" ] || [ -L "${p}" ]; } || continue
  printf '%s\0' "${p}" >> "${LIST}"
done < "${RAW_LIST}"

COUNT="$(tr -cd '\0' < "${LIST}" | wc -c | tr -d ' ')"

echo "================================================================"
echo " 提出するファイル（Codespace 作成後に追加された ${COUNT} 件）"
echo "================================================================"
if [ "${COUNT}" -gt 0 ]; then
  tr '\0' '\n' < "${LIST}" | head -n "${MAX_LIST_LINES}" | sed 's/^/  /'
  if [ "${COUNT}" -gt "${MAX_LIST_LINES}" ]; then
    echo "  ...ほか $((COUNT - MAX_LIST_LINES)) 件"
  fi
  echo ""
fi
# SUBMISSION.md 自身も新規ファイルなので、それ以外が 1 件もなければ「作品のファイルが無い」とみなす
if [ "${COUNT}" -eq 0 ] || { [ "${COUNT}" -eq 1 ] && [ "$(tr -d '\0' < "${LIST}")" = "SUBMISSION.md" ]; }; then
  die "提出できる作品のファイルがありません。Codespace を作成してから新しく作ったファイル（SUBMISSION.md 以外）があるか確認してください"
fi

# ---------------------------------------------------------------
# 2. tar.gz の作成
# ---------------------------------------------------------------
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="/tmp/submission-${TIMESTAMP}.tar.gz"
# 容量の大きいファイルの上位 5 件を表示する（上限超過の原因を探しやすくする）
show_largest_files() {
  echo "" >&2
  echo "容量の大きいファイル（上位 5 件）:" >&2
  xargs -0 wc -c < "${LIST}" 2> /dev/null | grep -v ' total$' | sort -rn | head -n 5 \
    | awk '{ s = $1; $1 = ""; printf "  %8.1f MB  %s\n", s / 1048576, substr($0, 2) }' >&2 || true
}

# tar.gz を作りながらサイズを監視し、上限（50MB）を 1 バイトでも超えた時点で打ち切る
# （巨大なファイルが混ざっていても、最後まで圧縮せずにすぐ止まる）
set +e
COPYFILE_DISABLE=1 tar -czf - --null -T "${LIST}" 2> "${WORK_DIR}/tar.err" | head -c $((MAX_BYTES + 1)) > "${ARCHIVE}"
TAR_STATUS="${PIPESTATUS[0]}"
set -e
SIZE="$(wc -c < "${ARCHIVE}" | tr -d ' ')"

if [ "${SIZE}" -gt "${MAX_BYTES}" ]; then
  rm -f "${ARCHIVE}"
  show_largest_files
  die "提出するファイルの合計が上限（50MB）を超えています。上の大きなファイルを削除するか、.gitignore に追加してからやり直してください（動画・大きなデータ・生成物（dist など）が原因のことが多いです）"
fi
if [ "${TAR_STATUS}" -ne 0 ]; then
  rm -f "${ARCHIVE}"
  [ -s "${WORK_DIR}/tar.err" ] && sed 's/^/  /' "${WORK_DIR}/tar.err" >&2
  die "アーカイブの作成に失敗しました"
fi
echo "アーカイブを作成しました: ${ARCHIVE} ($((SIZE / 1024)) KB)"

if [ "${DRY_RUN}" -eq 1 ]; then
  echo ""
  echo "（--dry-run のため送信しません。アーカイブは ${ARCHIVE} に残してあります）"
  exit 0
fi

# 失敗時の予備手段: エクスプローラーから右クリックでダウンロードできるよう、ワークスペース直下にもコピーする
print_fallback() {
  local copy="${REPO_ROOT}/submission-${TIMESTAMP}.tar.gz"
  cp "${ARCHIVE}" "${copy}" 2> /dev/null || copy=""
  echo "" >&2
  echo "----------------------------------------------------------------" >&2
  echo " 自動提出に失敗しました。次の手順で提出してください" >&2
  echo "----------------------------------------------------------------" >&2
  echo " アーカイブ: ${ARCHIVE}" >&2
  if [ -n "${copy}" ]; then
    echo " ワークスペースにもコピーしました: submission-${TIMESTAMP}.tar.gz" >&2
    echo " → VS Code 左のエクスプローラーでこのファイルを右クリック →「Download...」で保存し、" >&2
  else
    echo " → このファイルをダウンロードし、" >&2
  fi
  echo "   スタッフの案内に従って提出してください。" >&2
}

# ---------------------------------------------------------------
# 3. 認証トークンの取得
# ---------------------------------------------------------------
[ -f "${AUTH_FILE}" ] || {
  print_fallback
  die "opencode の認証情報（${AUTH_FILE}）が見つかりません。opencode auth login ${AUTH_KEY} を実行してからやり直してください"
}

TOKEN="$(AUTH_FILE="${AUTH_FILE}" AUTH_KEY="${AUTH_KEY}" node -e '
  const fs = require("fs");
  const auth = JSON.parse(fs.readFileSync(process.env.AUTH_FILE, "utf8"));
  let entry = auth[process.env.AUTH_KEY];
  if (!entry || !entry.token) {
    entry = Object.values(auth).find((v) => v && typeof v === "object" && v.token);
  }
  if (entry && entry.token) process.stdout.write(String(entry.token));
' 2> /dev/null || true)"

[ -n "${TOKEN}" ] || {
  print_fallback
  die "認証トークンを読み取れませんでした。opencode auth login ${AUTH_KEY} をやり直してください"
}

# トークンがプロセス一覧（ps）に出ないよう、ヘッダはファイル経由で渡す
HEADER_FILE="${WORK_DIR}/header"
umask 077
printf 'Authorization: Bearer %s\n' "${TOKEN}" > "${HEADER_FILE}"
unset TOKEN

# ---------------------------------------------------------------
# 4. 送信
# ---------------------------------------------------------------
echo "送信中: ${SUBMIT_URL}"
RESPONSE="${WORK_DIR}/response"
CURL_EXIT=0
HTTP_CODE="$(curl -sS --max-time 600 -o "${RESPONSE}" -w '%{http_code}' \
  -H "@${HEADER_FILE}" \
  -F "archive=@${ARCHIVE};type=application/gzip" \
  -F "SUBMISSION.md=@SUBMISSION.md;type=text/markdown" \
  --form-string "GITHUB_USER=${GITHUB_USER:-}" \
  "${SUBMIT_URL}")" || CURL_EXIT=$?

json_get() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const v = JSON.parse(s)[process.argv[1]];
        if (v !== undefined) console.log(v);
      } catch {}
    });
  ' "$1" < "${RESPONSE}"
}

if [ "${CURL_EXIT}" -ne 0 ]; then
  print_fallback
  die "サーバーに接続できませんでした（curl 終了コード ${CURL_EXIT}）。ネットワークを確認してください"
fi

if [ "${HTTP_CODE}" = "200" ] && [ "$(json_get ok)" = "true" ]; then
  echo ""
  echo "================================================================"
  echo " 提出が完了しました！"
  echo "   受付ID : $(json_get id)"
  echo "   提出者 : $(json_get email)"
  echo "   サイズ : $(json_get size) bytes"
  echo "================================================================"
  rm -f "${ARCHIVE}"
  exit 0
fi

# 失敗: サーバーからのメッセージをそのまま表示する
SERVER_MESSAGE="$(json_get error)"
[ -n "${SERVER_MESSAGE}" ] || SERVER_MESSAGE="$(head -c 500 "${RESPONSE}")"
echo "" >&2
echo "サーバーからの応答 (HTTP ${HTTP_CODE}): ${SERVER_MESSAGE}" >&2
if [ "${HTTP_CODE}" = "401" ]; then
  echo "→ 認証の有効期限が切れている可能性があります。次を実行してログインし直し、もう一度 /submit してください:" >&2
  echo "    opencode auth login ${AUTH_KEY}" >&2
fi
print_fallback
exit 1
