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

const DEFAULTS = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
};

export function pickProvider(env = process.env) {
  const gemini = env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (gemini) return { name: "gemini", key: gemini, model: env.AI_MODEL || DEFAULTS.gemini };
  const openai = env.OPENAI_API_KEY;
  if (openai) return { name: "openai", key: openai, model: env.AI_MODEL || DEFAULTS.openai };
  return null;
}

async function callGemini(provider, { system, user, json }) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(provider.model) +
    ":generateContent";
  const body = {
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: json ? { responseMimeType: "application/json", temperature: 0.2 } : { temperature: 0.4 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": provider.key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("gemini " + res.status + " " + (await res.text()).slice(0, 300));
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

async function callOpenAI(provider, { system, user, json }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + provider.key },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: json ? 0.2 : 0.4,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error("openai " + res.status + " " + (await res.text()).slice(0, 300));
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || "").trim();
}

/** 统一入口。返回纯文本；json 为 true 时模型被要求输出 JSON 字符串。 */
export async function runAI({ system, user, json }, env = process.env) {
  const provider = pickProvider(env);
  if (!provider) {
    const err = new Error("NO_AI_KEY");
    err.code = "NO_AI_KEY";
    throw err;
  }
  const text =
    provider.name === "gemini"
      ? await callGemini(provider, { system, user, json })
      : await callOpenAI(provider, { system, user, json });
  return { provider: provider.name, model: provider.model, text };
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
