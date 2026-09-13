/** 记忆抽取：通过服务端 AI 适配层返回结构化 facts / todos。 */

import { runAI } from "./ai-runtime.mjs";
import { serverEnv } from "./ai-provider.mjs";

// 记忆抽取提示词。
export const EXTRACT_SYSTEM = [
  "你是阿尔茨海默症老人记忆助手的抽取模块。输入是家人写的笔记或老人和 AI 的对话。",
  "把输入拆成 facts（稳定、值得长期记住、能在老人困惑时用来回应的信息，",
  "category 从 person/preference/routine/event/response_script/other 选一个；",
  "response_script 必须同时包含触发情境和具体回应话术）",
  "和 todos（家人要做的一次性、有时间性的动作，due_hint 从 today/tomorrow/this_week/unspecified 选）。",
  "每条必须是输入里明确写到的，禁止编造。绝不输出手机号、身份证号、银行卡号、密码、医疗诊断。",
  "没有可抽取内容就返回空数组。",
  '严格输出 JSON：{"facts":[{"text","category","confidence"}],"todos":[{"text","due_hint","confidence"}]}',
].join(" ");

const OUTPUT_RE = /\{[\s\S]*\}\s*$/;
const SENSITIVE_RE =
  /(\d{11})|(\d{17}[\dXx])|(\d{16,19})|身份证|银行卡|信用卡|密码|password|passport|护照号/;
const FACT_CATEGORIES = ["person", "preference", "routine", "event", "response_script", "other"];
const DUE_HINTS = ["today", "tomorrow", "this_week", "unspecified"];

/** 通过服务端 AI 适配层抽取。 */
export async function extractDirect(note, env = process.env, fetchImpl = fetch) {
  const { text } = await runAI({ system: EXTRACT_SYSTEM, user: note, json: true }, env, fetchImpl);
  let parsed;
  try {
    parsed = JSON.parse((text.match(OUTPUT_RE) || [text])[0]);
  } catch {
    parsed = { facts: [], todos: [] };
  }
  const facts = (parsed.facts || [])
    .filter((f) => f && String(f.text || "").trim() && !SENSITIVE_RE.test(f.text))
    .slice(0, 10)
    .map((f) => ({
      text: String(f.text).trim().slice(0, 180),
      category: FACT_CATEGORIES.includes(f.category) ? f.category : "other",
      confidence: Number.isFinite(+f.confidence) ? Math.min(1, Math.max(0, +f.confidence)) : 0.5,
    }));
  const todos = (parsed.todos || [])
    .filter((t) => t && String(t.text || "").trim() && !SENSITIVE_RE.test(t.text))
    .slice(0, 10)
    .map((t) => ({
      text: String(t.text).trim().slice(0, 120),
      due_hint: DUE_HINTS.includes(t.due_hint) ? t.due_hint : "unspecified",
      confidence: Number.isFinite(+t.confidence) ? Math.min(1, Math.max(0, +t.confidence)) : 0.5,
    }));
  return {
    runtime: "direct",
    facts,
    todos,
    dropped: [],
    steps: [{ name: "extract", facts: facts.length, todos: todos.length }],
  };
}

/** POST /api/memory/extract —— body { note }。 */
export function memoryAgentHandler(env) {
  const resolved = env || serverEnv();
  return async function handle(req, res) {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
    }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 100_000) return req.destroy();
      chunks.push(c);
    });
    req.on("end", async () => {
      // Buffer.concat 再一次性 decode —— 多字节字符被切在 chunk 边界也不会坏
      const raw = Buffer.concat(chunks).toString("utf8");
      let note = "";
      try {
        note = String(JSON.parse(raw || "{}").note || "").trim();
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "BAD_JSON" }));
      }
      if (!note) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({ ok: true, runtime: "none", facts: [], todos: [], steps: [] }),
        );
      }
      try {
        const out = await extractDirect(note, resolved);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, ...out }));
      } catch (failure) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: failure?.code || "AGENT_FAILED",
            detail: String(failure?.message || failure).slice(0, 300),
          }),
        );
      }
    });
  };
}

/** Fetch API 版（Cloudflare Worker / src/server.ts 用）。 */
export async function handleMemoryExtract(request, env = {}, fetchImpl = fetch) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }
  let note = "";
  try {
    note = String((await request.json())?.note || "").trim();
  } catch {
    return Response.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }
  if (!note) {
    return Response.json({ ok: true, runtime: "none", facts: [], todos: [], steps: [] });
  }
  try {
    return Response.json({ ok: true, ...(await extractDirect(note, env, fetchImpl)) });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error?.code || "AGENT_FAILED",
        detail: String(error?.message || error).slice(0, 300),
      },
      { status: 502 },
    );
  }
}
