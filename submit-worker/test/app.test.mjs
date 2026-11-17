// 受付 Worker のテスト（Node 組み込みテストランナー）。`npm test` で実行する。
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import { createHandler, sanitizeEmail } from "../.test-build/app.js";
import { verifyAccessJwt, JwtError } from "../.test-build/jwt.js";

const TEAM = "test-team";
const AUD = "test-aud";

// ---- テスト用の署名鍵・JWT ----
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const keyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const jwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: "k1" };
const fetchJwks = async () => ({ keys: [jwk] });

async function makeJwt(claims = {}, { kid = "k1", signKey = keyPair.privateKey } = {}) {
  const header = b64u(JSON.stringify({ alg: "RS256", kid }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(
    JSON.stringify({
      email: "Taro.Yamada@example.com",
      iss: `https://${TEAM}.cloudflareaccess.com`,
      aud: [AUD],
      exp: now + 3600,
      ...claims,
    }),
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64u(sig)}`;
}
const verify = (token, extra = {}) =>
  verifyAccessJwt(token, { team: TEAM, aud: AUD, fetchJwks, cache: { keys: new Map(), fetchedAt: 0 }, ...extra });

// ---- JWT 検証 ----
test("正しい JWT は通り、email が取れる", async () => {
  const payload = await verify(await makeJwt());
  assert.equal(payload.email, "Taro.Yamada@example.com");
});

test("aud が文字列でも通る", async () => {
  await verify(await makeJwt({ aud: AUD }));
});

test("期限切れ・iss/aud 違い・署名違い・email なしは拒否する", async () => {
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(verify(await makeJwt({ exp: now - 3600 })), JwtError);
  await assert.rejects(verify(await makeJwt({ iss: "https://evil.cloudflareaccess.com" })), JwtError);
  await assert.rejects(verify(await makeJwt({ aud: ["other"] })), JwtError);
  await assert.rejects(verify(await makeJwt({ email: undefined })), JwtError);
  const other = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  await assert.rejects(verify(await makeJwt({}, { signKey: other.privateKey })), JwtError);
  await assert.rejects(verify(await makeJwt({}, { kid: "unknown" })), JwtError);
  await assert.rejects(verify("a.b"), JwtError);
});

// ---- /submit ----
function fakeBucket() {
  const store = new Map();
  return {
    store,
    async put(key, value, options) {
      const body = typeof value === "string" ? value : Buffer.from(await value.arrayBuffer());
      store.set(key, { body, options, uploaded: new Date("2026-11-17T03:00:00Z") });
    },
    // R2 の list/get の簡易版（ページング対応）
    async list({ limit = 1000, cursor } = {}) {
      const keys = [...store.keys()].sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return {
        objects: slice.map((key) => ({
          key,
          size: Buffer.byteLength(store.get(key).body),
          uploaded: store.get(key).uploaded,
          customMetadata: store.get(key).options?.customMetadata,
        })),
        truncated,
        cursor: truncated ? String(start + limit) : undefined,
      };
    },
    async get(key) {
      const item = store.get(key);
      if (!item) return null;
      const bytes = typeof item.body === "string" ? Buffer.from(item.body) : item.body;
      return {
        body: new Blob([bytes]).stream(),
        size: bytes.length,
        httpEtag: '"test-etag"',
        httpMetadata: item.options?.httpMetadata,
      };
    },
  };
}

const handler = createHandler((token) => verify(token));
const archiveBytes = gzipSync(Buffer.from("dummy tar"));

async function post({ token, fields, env, headers = {} } = {}) {
  const form = new FormData();
  const f = fields ?? {
    archive: new File([archiveBytes], "submission.tar.gz", { type: "application/gzip" }),
    "SUBMISSION.md": new File(["# テストアプリ\n"], "SUBMISSION.md"),
    GITHUB_USER: "taro",
  };
  for (const [k, v] of Object.entries(f)) form.append(k, v);
  const bucket = fakeBucket();
  const request = new Request("https://example.test/submit", {
    method: "POST",
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token ?? (await makeJwt())}` }), ...headers },
    body: form,
  });
  const res = await handler(request, {
    SUBMISSIONS: bucket,
    CF_ACCESS_TEAM_NAME: TEAM,
    CF_ACCESS_AUD: AUD,
    ...env,
  });
  return { res, bucket, body: await res.json() };
}

test("正常に提出すると R2 に tar.gz と .md が保存される", async () => {
  const { res, bucket, body } = await post();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  const keys = [...bucket.store.keys()].sort();
  assert.equal(keys.length, 2);
  assert.match(keys[0], /^taro\.yamada@example\.com\/\d{8}T\d{9}Z\.md$/);
  assert.match(keys[1], /^taro\.yamada@example\.com\/\d{8}T\d{9}Z\.tar\.gz$/);
  assert.equal(keys[0].replace(/\.md$/, ""), keys[1].replace(/\.tar\.gz$/, ""));
  assert.equal(bucket.store.get(keys[1]).options.customMetadata.githubUser, "taro");
  assert.equal(body.id, keys[1].split("/")[1].replace(".tar.gz", ""));
});

test("トークンなし・不正トークンは 401", async () => {
  assert.equal((await post({ token: null })).res.status, 401);
  assert.equal((await post({ token: "invalid" })).res.status, 401);
});

test("archive なし・gzip でない・空は 400", async () => {
  const md = new File(["x"], "SUBMISSION.md");
  assert.equal((await post({ fields: { "SUBMISSION.md": md } })).res.status, 400);
  assert.equal((await post({ fields: { archive: new File(["plain text"], "a.tar.gz"), "SUBMISSION.md": md } })).res.status, 400);
  assert.equal((await post({ fields: { archive: new File([], "a.tar.gz"), "SUBMISSION.md": md } })).res.status, 400);
});

test("SUBMISSION.md なしは 400", async () => {
  const { res } = await post({ fields: { archive: new File([archiveBytes], "a.tar.gz") } });
  assert.equal(res.status, 400);
});

test("上限超過は 413", async () => {
  const { res } = await post({ env: { MAX_ARCHIVE_BYTES: "5" } });
  assert.equal(res.status, 413);
});

test("/submit 以外・GET は拒否する", async () => {
  const env = { SUBMISSIONS: fakeBucket(), CF_ACCESS_TEAM_NAME: TEAM, CF_ACCESS_AUD: AUD };
  assert.equal((await handler(new Request("https://example.test/other"), env)).status, 404);
  assert.equal((await handler(new Request("https://example.test/submit"), env)).status, 405);
  assert.equal((await handler(new Request("https://example.test/health"), env)).status, 200);
});

test("メールアドレスは R2 キーに使える文字へ正規化される", () => {
  assert.equal(sanitizeEmail("A.B+c@Example.com"), "a.b+c@example.com");
  const evil = sanitizeEmail("../../x/y@e.com");
  assert.ok(!evil.includes("/") && !evil.startsWith("."), evil);
  assert.ok(!sanitizeEmail("a/b\\c@e.com").includes("/"));
});

// ---- 管理用 API（/admin/list, /admin/object） ----
async function adminCall(path, { email = "Organizer@Example.com", adminEmails = "organizer@example.com", bucket, noToken = false, method = "GET" } = {}) {
  const b = bucket ?? fakeBucket();
  const headers = noToken ? {} : { authorization: `Bearer ${await makeJwt({ email })}` };
  const env = { SUBMISSIONS: b, CF_ACCESS_TEAM_NAME: TEAM, CF_ACCESS_AUD: AUD };
  // adminEmails が null のときは ADMIN_EMAILS 自体を設定しない（未設定の状態）
  if (adminEmails !== null) env.ADMIN_EMAILS = adminEmails;
  const res = await handler(new Request(`https://example.test${path}`, { method, headers }), env);
  return { res, bucket: b };
}

async function seed(bucket, n = 3) {
  for (let i = 0; i < n; i++) {
    await bucket.put(`user${i}@example.com/2026111${i}T000000000Z.tar.gz`, `archive-${i}`, {
      customMetadata: { githubUser: `gh${i}` },
      httpMetadata: { contentType: "application/gzip" },
    });
  }
}

test("管理 API: トークンなしは 401", async () => {
  assert.equal((await adminCall("/admin/list", { noToken: true })).res.status, 401);
  assert.equal((await adminCall("/admin/object?key=x", { noToken: true })).res.status, 401);
});

test("管理 API: 主催者以外は 403（大文字小文字は区別しない）", async () => {
  const other = await adminCall("/admin/list", { email: "participant@example.com" });
  assert.equal(other.res.status, 403);
  // 主催者でも、メールアドレスの大文字小文字が違うだけなら許可される
  assert.equal((await adminCall("/admin/list", { email: "ORGANIZER@EXAMPLE.COM" })).res.status, 200);
});

test("管理 API: ADMIN_EMAILS が未設定なら誰も使えない", async () => {
  assert.equal((await adminCall("/admin/list", { adminEmails: "" })).res.status, 403);
  assert.equal((await adminCall("/admin/list", { adminEmails: null })).res.status, 403);
});

test("管理 API: 複数の主催者をカンマ区切りで指定できる", async () => {
  const r = await adminCall("/admin/list", { email: "b@example.com", adminEmails: "a@example.com, b@example.com" });
  assert.equal(r.res.status, 200);
});

test("管理 API: GET 以外は 405", async () => {
  assert.equal((await adminCall("/admin/list", { method: "POST" })).res.status, 405);
});

test("管理 API: 一覧にキー・サイズ・GitHub ユーザーが出る", async () => {
  const bucket = fakeBucket();
  await seed(bucket);
  const { res } = await adminCall("/admin/list", { bucket });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.objects.length, 3);
  assert.equal(body.objects[0].key, "user0@example.com/20261110T000000000Z.tar.gz");
  assert.equal(body.objects[0].size, "archive-0".length);
  assert.equal(body.objects[0].githubUser, "gh0");
  assert.equal(body.truncated, false);
});

test("管理 API: ファイルの中身をそのまま取得できる", async () => {
  const bucket = fakeBucket();
  await seed(bucket);
  const { res } = await adminCall("/admin/object?key=" + encodeURIComponent("user1@example.com/20261111T000000000Z.tar.gz"), { bucket });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/gzip");
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "archive-1");
});

test("管理 API: 存在しない key は 404、key なしは 400", async () => {
  assert.equal((await adminCall("/admin/object?key=nothing")).res.status, 404);
  assert.equal((await adminCall("/admin/object")).res.status, 400);
});

test("提出 API は管理者でなくても使える（管理者限定にしていない）", async () => {
  const { res } = await post({ token: await makeJwt({ email: "participant@example.com" }) });
  assert.equal(res.status, 200);
});
