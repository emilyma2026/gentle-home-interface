/**
 * 服务端 AI 适配层。同时支持 Gemini 和 OpenAI，按 .env 里存在哪个 key 自动选，
 * 优先 Gemini。API key 只存在于服务端，不会出现在浏览器里。
 *
 * 环境变量：
 *   GEMINI_API_KEY / VITE_GEMINI_API_KEY   走 Gemini
 *   OPENAI_API_KEY                          走 OpenAI
 *   AI_MODEL                                可选，覆盖默认模型
 */

import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAI } from "./ai-runtime.mjs";

export { pickProvider, runAI } from "./ai-runtime.mjs";

/** 读取项目根目录的 .env，Vite 不会把非 VITE_ 前缀的变量放进 process.env。 */
export function loadDotEnv(base) {
  const root = base || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const file = path.join(root, ".env");
  const out = {};
  if (!fsSync.existsSync(file)) return out;
  for (const line of fsSync.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** 服务端可用的环境：.env 打底，真实环境变量优先。 */
export function serverEnv(base) {
  return { ...loadDotEnv(base), ...process.env };
}

/** 挂到任意 Node HTTP 服务上的 /api/ai 处理器。 */
export function aiHandler(env) {
  const resolved = env || serverEnv();
  return async function handle(req, res) {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
    }
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 200_000) req.destroy();
    });
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw || "{}");
        if (typeof body.user !== "string" || !body.user.trim()) {
          res.writeHead(400, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "EMPTY_PROMPT" }));
        }
        const out = await runAI(
          { system: body.system, user: body.user.slice(0, 12000), json: !!body.json },
          resolved,
        );
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(out));
      } catch (error) {
        const code = error?.code === "NO_AI_KEY" ? 503 : 502;
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error?.code || "AI_FAILED", detail: String(error?.message || error).slice(0, 300) }));
      }
    });
  };
}
