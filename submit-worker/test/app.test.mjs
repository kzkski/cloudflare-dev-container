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
      store.set(key, { body, options });
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
  assert.match(keys[0], /^submissions\/taro\.yamada@example\.com\/\d{8}T\d{9}Z\.md$/);
  assert.match(keys[1], /^submissions\/taro\.yamada@example\.com\/\d{8}T\d{9}Z\.tar\.gz$/);
  assert.equal(keys[0].replace(/\.md$/, ""), keys[1].replace(/\.tar\.gz$/, ""));
  assert.equal(bucket.store.get(keys[1]).options.customMetadata.githubUser, "taro");
  assert.equal(body.id, keys[1].split("/")[2].replace(".tar.gz", ""));
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
