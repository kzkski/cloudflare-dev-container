// 作品提出の受付ロジック。JWT 検証は差し替え可能にしてある（テスト用）。
import { JwtError, verifyAccessJwt } from "./jwt";

export interface Env {
  SUBMISSIONS: R2Bucket;
  CF_ACCESS_TEAM_NAME: string;
  CF_ACCESS_AUD: string;
  MAX_ARCHIVE_BYTES?: string;
}

export type Verifier = (token: string, env: Env) => Promise<{ email: string }>;

export const defaultVerifier: Verifier = (token, env) =>
  verifyAccessJwt(token, { team: env.CF_ACCESS_TEAM_NAME, aud: env.CF_ACCESS_AUD });

const DEFAULT_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_SUBMISSION_MD_BYTES = 512 * 1024;
// multipart のヘッダ・SUBMISSION.md などの分の余裕
const MULTIPART_OVERHEAD_BYTES = 2 * 1024 * 1024;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function fail(status: number, error: string): Response {
  return json({ ok: false, error }, status);
}

/** R2 のキーに使えるようメールアドレスを正規化する */
export function sanitizeEmail(email: string): string {
  return email
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "_");
}

function cleanText(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

async function readText(value: File | string | null): Promise<string | null> {
  if (value === null) return null;
  return typeof value === "string" ? value : await value.text();
}

export function createHandler(verify: Verifier = defaultVerifier) {
  return async function handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true });
    }
    if (url.pathname !== "/submit") {
      return fail(404, "見つかりません");
    }
    if (request.method !== "POST") {
      return fail(405, "POST で送信してください");
    }

    // ---- 認証 ----
    const authorization = request.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match) {
      return fail(401, "認証トークンがありません。opencode にログインし直してください");
    }
    let email: string;
    try {
      email = (await verify(match[1].trim(), env)).email;
    } catch (e) {
      if (e instanceof JwtError) {
        console.error("JWT 検証失敗:", e.message);
        return fail(401, `認証に失敗しました: ${e.message}。opencode auth login をやり直してください`);
      }
      console.error("JWT 検証中にエラー:", e instanceof Error ? e.message : e);
      return fail(500, "認証の確認中にエラーが発生しました。しばらくしてからやり直してください");
    }

    // ---- 受信 ----
    const maxArchive = Number(env.MAX_ARCHIVE_BYTES) || DEFAULT_MAX_ARCHIVE_BYTES;
    const contentLength = Number(request.headers.get("content-length"));
    if (contentLength && contentLength > maxArchive + MULTIPART_OVERHEAD_BYTES) {
      return fail(413, `ファイルが大きすぎます（上限 ${Math.floor(maxArchive / 1024 / 1024)}MB）`);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, "送信内容を読み取れませんでした（multipart/form-data で送信してください）");
    }

    const archive = form.get("archive");
    if (archive === null || typeof archive === "string") {
      return fail(400, "archive（tar.gz ファイル）がありません");
    }
    if (archive.size === 0) {
      return fail(400, "archive が空です");
    }
    if (archive.size > maxArchive) {
      return fail(413, `ファイルが大きすぎます（上限 ${Math.floor(maxArchive / 1024 / 1024)}MB）`);
    }
    const magic = new Uint8Array(await archive.slice(0, 2).arrayBuffer());
    if (magic[0] !== 0x1f || magic[1] !== 0x8b) {
      return fail(400, "archive が gzip 形式ではありません");
    }

    const submissionMd = await readText(form.get("SUBMISSION.md"));
    if (submissionMd === null || submissionMd.trim() === "") {
      return fail(400, "SUBMISSION.md がありません");
    }
    if (new TextEncoder().encode(submissionMd).length > MAX_SUBMISSION_MD_BYTES) {
      return fail(413, "SUBMISSION.md が大きすぎます（上限 512KB）");
    }
    const githubUser = cleanText((await readText(form.get("GITHUB_USER"))) ?? "", 100);

    // ---- 保存 ----
    const submittedAt = new Date();
    // 例: 20261117T123456789Z（ミリ秒まで含めて重複しにくくする）
    const timestamp = submittedAt.toISOString().replace(/[-:.]/g, "");
    // バケット名自体が「提出物」なので、直下にメールアドレスのフォルダを置く
    const prefix = `${sanitizeEmail(email)}/${timestamp}`;
    const archiveKey = `${prefix}.tar.gz`;
    const mdKey = `${prefix}.md`;
    const customMetadata = {
      email,
      githubUser,
      submittedAt: submittedAt.toISOString(),
    };

    try {
      await env.SUBMISSIONS.put(archiveKey, archive, {
        httpMetadata: { contentType: "application/gzip" },
        customMetadata,
      });
      await env.SUBMISSIONS.put(mdKey, submissionMd, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
        customMetadata,
      });
    } catch (e) {
      console.error("R2 への保存に失敗:", e instanceof Error ? e.message : e);
      return fail(500, "保存中にエラーが発生しました。しばらくしてからもう一度お試しください");
    }

    console.log(`受付: ${email} ${archiveKey} (${archive.size} bytes, github=${githubUser})`);
    return json({
      ok: true,
      id: timestamp,
      email,
      key: archiveKey,
      size: archive.size,
      submittedAt: submittedAt.toISOString(),
    });
  };
}
