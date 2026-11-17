// Cloudflare Access が発行した JWT（RS256）を検証する。
// 検証項目: 署名 / exp / nbf / iss / aud / email の存在

export interface AccessJwtPayload {
  email: string;
  iss: string;
  aud: string | string[];
  exp: number;
  [key: string]: unknown;
}

export interface JwksFetcher {
  (url: string): Promise<{ keys: (JsonWebKey & { kid?: string })[] }>;
}

export interface KeyCache {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

export interface VerifyOptions {
  /** Zero Trust のチーム名（例: data-sendai-platform） */
  team: string;
  /** Access アプリの AUD Tag */
  aud: string;
  /** テスト用: JWKS の取得処理を差し替える */
  fetchJwks?: JwksFetcher;
  /** テスト用: 鍵キャッシュを差し替える */
  cache?: KeyCache;
  /** テスト用: 現在時刻（秒） */
  now?: number;
}

export class JwtError extends Error {}

const CLOCK_SKEW_SEC = 30;
const JWKS_MIN_REFETCH_MS = 60_000;
const JWKS_TIMEOUT_MS = 10_000;

const defaultCache: KeyCache = { keys: new Map(), fetchedAt: 0 };

const defaultFetchJwks: JwksFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`JWKS の取得に失敗しました (HTTP ${res.status})`);
  return (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };
};

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(segment: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
  } catch {
    throw new JwtError("トークンの形式が正しくありません");
  }
}

async function loadKeys(opts: VerifyOptions, cache: KeyCache): Promise<void> {
  const url = `https://${opts.team}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const jwks = await (opts.fetchJwks ?? defaultFetchJwks)(url);
  const next = new Map<string, CryptoKey>();
  for (const jwk of jwks.keys) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    next.set(jwk.kid, key);
  }
  cache.keys = next;
  cache.fetchedAt = Date.now();
}

async function getKey(kid: string, opts: VerifyOptions, cache: KeyCache): Promise<CryptoKey> {
  const cached = cache.keys.get(kid);
  if (cached) return cached;
  // 未知の kid（鍵ローテーション直後など）: 取得から一定時間が過ぎていれば取り直す
  if (Date.now() - cache.fetchedAt > JWKS_MIN_REFETCH_MS) {
    await loadKeys(opts, cache);
  }
  const key = cache.keys.get(kid);
  if (!key) throw new JwtError("トークンの署名鍵が見つかりません");
  return key;
}

export async function verifyAccessJwt(token: string, opts: VerifyOptions): Promise<AccessJwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("トークンの形式が正しくありません");
  const [h, p, s] = parts;

  const header = decodeJson<{ alg?: string; kid?: string }>(h);
  if (header.alg !== "RS256" || !header.kid) {
    throw new JwtError("トークンの署名方式が正しくありません");
  }

  const cache = opts.cache ?? defaultCache;
  const key = await getKey(header.kid, opts, cache);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) throw new JwtError("トークンの署名が正しくありません");

  const payload = decodeJson<Partial<AccessJwtPayload>>(p);
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SEC < now) {
    throw new JwtError("トークンの有効期限が切れています");
  }
  if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SEC > now) {
    throw new JwtError("トークンはまだ有効ではありません");
  }
  if (payload.iss !== `https://${opts.team}.cloudflareaccess.com`) {
    throw new JwtError("トークンの発行元が正しくありません");
  }
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(opts.aud)) {
    throw new JwtError("トークンの対象アプリケーションが正しくありません");
  }
  if (typeof payload.email !== "string" || !payload.email.includes("@")) {
    throw new JwtError("トークンにメールアドレスが含まれていません");
  }
  return payload as AccessJwtPayload;
}
