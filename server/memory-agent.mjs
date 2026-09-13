/**
 * 记忆抽取 agent —— 在 Daytona 沙盒里跑 server/sandbox/memory_agent.py。
 *
 * 家人写的笔记进来，沙盒里两步（结构化抽取 → grounding 核查）后返回 facts / todos。
 * LLM 的不可信输出和外部调用都关在隔离沙盒里，Worker / 主进程不直接碰。
 *
 * 走 /api/memory/extract。缺 DAYTONA_API_KEY 时会回落到本地直跑（不进沙盒），保证 demo 不中断。
 */

import { runAI } from "./ai-runtime.mjs";
import { serverEnv } from "./ai-provider.mjs";
import {
  acquireSandbox,
  getDaytonaClient,
  MissingDaytonaKeyError,
  releaseSandbox,
} from "./daytona.mjs";

// 抽取用的 system prompt —— 唯一来源。注入到沙盒 Python，也给 Worker 直跑兜底用。
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
const EXTRACT_SYSTEM_B64 = Buffer.from(EXTRACT_SYSTEM).toString("base64");

// memory_agent.py 只在沙盒/本地路径用到，懒加载 —— Worker 上没有 fs，也用不到它
let agentSrcCache;
async function loadAgentSrc() {
  if (agentSrcCache === undefined) {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    agentSrcCache = readFileSync(
      fileURLToPath(new URL("./sandbox/memory_agent.py", import.meta.url)),
      "utf8",
    );
  }
  return agentSrcCache;
}

async function buildScript(note, openaiKey) {
  const src = await loadAgentSrc();
  const payload = Buffer.from(JSON.stringify({ note, openaiKey })).toString("base64");
  return src
    .replaceAll("__PAYLOAD_B64__", payload)
    .replaceAll("__EXTRACT_SYSTEM_B64__", EXTRACT_SYSTEM_B64);
}

function parseAgentOutput(stdout) {
  const match = String(stdout || "").match(OUTPUT_RE);
  if (!match) throw new Error(`agent produced no JSON: ${String(stdout).slice(0, 200)}`);
  const parsed = JSON.parse(match[0]);
  if (parsed.error) {
    const err = new Error(parsed.detail || parsed.error);
    err.code = parsed.error;
    throw err;
  }
  return {
    facts: Array.isArray(parsed.facts) ? parsed.facts : [],
    todos: Array.isArray(parsed.todos) ? parsed.todos : [],
    dropped: Array.isArray(parsed.dropped) ? parsed.dropped : [],
    steps: Array.isArray(parsed.steps) ? parsed.steps : [],
  };
}

/** 在 Daytona 沙盒里抽取。返回 { runtime:"daytona", sandboxId, previewLink?, facts, todos, dropped, steps } */
export async function extractInSandbox(note, env = process.env) {
  const openaiKey = env.OPENAI_API_KEY || "";
  if (!openaiKey) {
    const err = new Error("OPENAI_API_KEY not configured");
    err.code = "NO_OPENAI_KEY";
    throw err;
  }
  const daytona = await getDaytonaClient(env);
  const { sandbox, reuse } = await acquireSandbox(daytona, env);
  try {
    const run = await sandbox.process.codeRun(await buildScript(note, openaiKey));
    if (run.exitCode !== 0) {
      throw new Error(`agent exit ${run.exitCode}: ${String(run.result).slice(0, 200)}`);
    }
    let previewLink;
    try {
      const link = await sandbox.getPreviewLink(3000);
      previewLink = link?.url;
    } catch {
      // preview link 不是必须的
    }
    return {
      runtime: "daytona",
      sandboxId: sandbox.id,
      reuse,
      previewLink,
      ...parseAgentOutput(run.result),
    };
  } finally {
    await releaseSandbox(sandbox, reuse);
  }
}

const SENSITIVE_RE =
  /(\d{11})|(\d{17}[\dXx])|(\d{16,19})|身份证|银行卡|信用卡|密码|password|passport|护照号/;
const FACT_CATEGORIES = ["person", "preference", "routine", "event", "response_script", "other"];
const DUE_HINTS = ["today", "tomorrow", "this_week", "unspecified"];

/** 不进沙盒，直接用 AI 网关抽取（Cloudflare Worker 上 Daytona SDK 跑不起来时的路径）。 */
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

/** 沙盒不可用时的兜底：写临时文件在本机跑同一个 Python agent（本地才有 python）。 */
async function extractLocally(note, env) {
  const { spawn } = await import("node:child_process");
  const { writeFile, rm, mkdtemp } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const script = await buildScript(note, env.OPENAI_API_KEY || "");
  const dir = await mkdtemp(join(tmpdir(), "mem-agent-"));
  const file = join(dir, "agent.py");
  await writeFile(file, script, "utf8");
  try {
    const stdout = await new Promise((resolve, reject) => {
      const py = spawn(process.platform === "win32" ? "python" : "python3", [file]);
      let out = "";
      let errOut = "";
      py.stdout.on("data", (d) => (out += d));
      py.stderr.on("data", (d) => (errOut += d));
      py.on("error", reject);
      py.on("close", (code) => (code === 0 || out ? resolve(out) : reject(new Error(errOut))));
    });
    return { runtime: "local-fallback", ...parseAgentOutput(stdout) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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
        const out = await extractInSandbox(note, resolved);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, ...out }));
      } catch (sandboxError) {
        let failure = sandboxError;
        if (sandboxError instanceof MissingDaytonaKeyError) {
          try {
            const out = await extractLocally(note, resolved);
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            return res.end(JSON.stringify({ ok: true, ...out }));
          } catch (fallbackError) {
            failure = fallbackError;
          }
        }
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

/**
 * Fetch API 版（Cloudflare Worker / src/server.ts 用）。
 * 先试 Daytona 沙盒；SDK 在 workerd 上跑不起来时回落到 extractDirect。
 */
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
    return Response.json({ ok: true, ...(await extractInSandbox(note, env)) });
  } catch (sandboxError) {
    const fallbackReason = String(
      sandboxError?.code || sandboxError?.message || "sandbox unavailable",
    ).slice(0, 120);
    try {
      return Response.json({
        ok: true,
        sandboxFallback: fallbackReason,
        ...(await extractDirect(note, env, fetchImpl)),
      });
    } catch (directError) {
      return Response.json(
        {
          ok: false,
          error: directError?.code || "AGENT_FAILED",
          detail: String(directError?.message || directError).slice(0, 300),
        },
        { status: 502 },
      );
    }
  }
}
