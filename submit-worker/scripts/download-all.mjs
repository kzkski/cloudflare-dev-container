#!/usr/bin/env node
// 主催者用: 提出された作品を全員分まとめてダウンロードする。
//
//   node scripts/download-all.mjs                  # ./submissions に全員分を保存
//   node scripts/download-all.mjs --extract        # さらに tar.gz を展開する
//   node scripts/download-all.mjs --out ./work     # 保存先を変える
//
// 認証: opencode-for-events の Cloudflare Access の JWT を使う（R2 のトークンは不要）。
//   1. 環境変数 O4E_TOKEN
//   2. opencode の認証ファイル（~/.local/share/opencode/auth.json）
//   3. cloudflared（未ログインならブラウザが開く）。事前に `brew install cloudflared`
// 主催者のメールアドレスが Worker の ADMIN_EMAILS に登録されている必要がある。
//
// 何度実行してもよい。すでに同じサイズで保存済みのファイルはスキップする（差分だけ取得）。
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";

const APP_URL = "https://opencode-for-events.tokyo-odh-002.workers.dev";
const DEFAULT_BASE = "https://hdsc2026-submit.tokyo-odh-002.workers.dev";

const { values: opts } = parseArgs({
  options: {
    out: { type: "string", default: "./submissions" },
    extract: { type: "boolean", default: false },
    url: { type: "string", default: process.env.SUBMIT_BASE_URL ?? DEFAULT_BASE },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (opts.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

const base = opts.url.replace(/\/$/, "");
const outDir = resolve(opts.out);

function die(message) {
  console.error(`\nエラー: ${message}`);
  process.exit(1);
}

// ---------------- 認証トークンの取得 ----------------
function tokenFromAuthFile() {
  const file = process.env.OPENCODE_AUTH_FILE ?? join(homedir(), ".local/share/opencode/auth.json");
  if (!existsSync(file)) return null;
  try {
    const auth = JSON.parse(readFileSync(file, "utf8"));
    const entry = auth[APP_URL]?.token ? auth[APP_URL] : Object.values(auth).find((v) => v && typeof v === "object" && v.token);
    return entry?.token ?? null;
  } catch {
    return null;
  }
}

// `cloudflared access login` を実行する。ブラウザで開く URL などの案内は表示するが、
// 取得したトークン（JWT）は画面やスクロールバックに残さないよう、その行だけ隠す
function runCloudflaredLogin() {
  return new Promise((done) => {
    const child = spawn("cloudflared", ["access", "login", APP_URL], { stdio: ["inherit", "pipe", "pipe"] });
    const forward = (stream, write) =>
      createInterface({ input: stream }).on("line", (line) => {
        const text = line.trim();
        if (text.startsWith("eyJ") || text.includes("Successfully fetched your token")) return;
        write(line);
      });
    forward(child.stdout, (line) => console.log(line));
    forward(child.stderr, (line) => console.error(line));
    child.on("error", () => done());
    child.on("close", () => done());
  });
}

async function tokenFromCloudflared() {
  const run = (args) => spawnSync("cloudflared", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const probe = run(["--version"]);
  if (probe.error) return { error: "cloudflared が見つかりません。`brew install cloudflared` でインストールしてください" };

  let result = run(["access", "token", `-app=${APP_URL}`]);
  if (result.status !== 0 || !result.stdout.trim().startsWith("eyJ")) {
    console.log("Cloudflare Access にログインします。ブラウザが開くので、ログインしてください...");
    await runCloudflaredLogin();
    result = run(["access", "token", `-app=${APP_URL}`]);
  }
  const token = result.stdout.trim();
  return token.startsWith("eyJ") ? { token } : { error: "cloudflared でトークンを取得できませんでした" };
}

async function getToken() {
  if (process.env.O4E_TOKEN) return process.env.O4E_TOKEN.trim();
  const fromFile = tokenFromAuthFile();
  if (fromFile) return fromFile;
  const viaCloudflared = await tokenFromCloudflared();
  if (viaCloudflared.token) return viaCloudflared.token;
  die(viaCloudflared.error);
}

const token = await getToken();

// ---------------- API 呼び出し ----------------
async function api(path) {
  let res;
  try {
    res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch (e) {
    die(`サーバーに接続できませんでした（${e.message}）。ネットワークを確認してください`);
  }
  if (res.status === 401) {
    die("認証に失敗しました（ログインの期限切れの可能性があります）。`cloudflared access login " + APP_URL + "` をやり直してください");
  }
  if (res.status === 403) {
    die("主催者として登録されていません。Worker の ADMIN_EMAILS に、ログインに使ったメールアドレスを追加してください");
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = (await res.json()).error ?? message;
    } catch {}
    die(`サーバーからのエラー: ${message}`);
  }
  return res;
}

async function listAll() {
  const objects = [];
  let cursor;
  do {
    const res = await api(`/admin/list${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    const body = await res.json();
    objects.push(...body.objects);
    cursor = body.truncated ? body.cursor : undefined;
  } while (cursor);
  return objects;
}

// R2 のキーを、保存先の外に出られない安全なパスに変換する
function safeLocalPath(key) {
  const parts = key.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  const target = resolve(outDir, ...parts);
  return target.startsWith(outDir + sep) ? target : null;
}

async function download(object) {
  const target = safeLocalPath(object.key);
  if (!target) {
    console.warn(`  スキップ（不正なキー）: ${object.key}`);
    return "skipped";
  }
  if (existsSync(target) && statSync(target).size === object.size) return "exists";

  const res = await api(`/admin/object?key=${encodeURIComponent(object.key)}`);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    die(`ダウンロードに失敗しました: ${object.key}（${e.message}）`);
  }
  return "downloaded";
}

// ---------------- 実行 ----------------
console.log(`提出一覧を取得中: ${base}`);
const objects = await listAll();
if (objects.length === 0) {
  console.log("まだ提出がありません。");
  process.exit(0);
}

let downloaded = 0;
let existing = 0;
for (const object of objects) {
  const state = await download(object);
  if (state === "downloaded") {
    downloaded++;
    console.log(`  ダウンロード: ${object.key}`);
  } else if (state === "exists") {
    existing++;
  }
}

// 参加者ごとの最新の提出（時刻が新しいもの）をまとめる
const latest = new Map();
for (const { key, githubUser } of objects) {
  const [email, file] = key.split("/");
  if (!file?.endsWith(".tar.gz")) continue;
  if (!latest.has(email) || file > latest.get(email).file) latest.set(email, { file, githubUser });
}

// 展開（tar.gz → 同名のフォルダ）。提出物は信頼できない入力なので、展開しても中のコードを実行しないこと
let extracted = 0;
if (opts.extract) {
  for (const object of objects) {
    if (!object.key.endsWith(".tar.gz")) continue;
    const archive = safeLocalPath(object.key);
    if (!archive) continue;
    const dest = archive.slice(0, -".tar.gz".length);
    if (existsSync(dest)) continue;
    mkdirSync(dest, { recursive: true });
    const r = spawnSync("tar", ["-xzf", archive, "-C", dest], { encoding: "utf8" });
    if (r.status === 0) extracted++;
    else console.warn(`  展開に失敗: ${object.key}\n${r.stderr}`);
  }
}

console.log("");
console.log("================================================================");
console.log(` 完了: ${objects.length} ファイル（新規 ${downloaded} / 取得済み ${existing}）`);
console.log(` 参加者: ${latest.size} 人`);
if (opts.extract) console.log(` 展開: ${extracted} 件`);
console.log(` 保存先: ${outDir}`);
console.log("================================================================");
for (const [email, { file, githubUser }] of [...latest].sort()) {
  console.log(`  ${email}  最新: ${file.replace(".tar.gz", "")}${githubUser ? `  (GitHub: ${githubUser})` : ""}`);
}
