import { createHandler, type Env } from "./app";

const handle = createHandler();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error("予期せぬエラー:", e instanceof Error ? e.message : e);
      return new Response(JSON.stringify({ ok: false, error: "サーバーでエラーが発生しました" }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
