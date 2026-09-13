/**
 * Daytona 沙盒适配层。产品里所有"跑不可信代码 / 跑 AI agent"的活都放进隔离沙盒。
 * DAYTONA_API_KEY 只存在于服务端。没有 key 时相关端点返回 skipped，其余功能不受影响。
 *
 * 环境变量：
 *   DAYTONA_API_KEY   必填，来自 app.daytona.io/dashboard/keys
 *   DAYTONA_API_URL   可选，默认 https://app.daytona.io/api
 *   DAYTONA_TARGET    可选，us 或 eu，默认 us
 *   DAYTONA_SANDBOX   可选，固定复用的沙盒 name 或 UUID（如 Remember_Us）。
 *                     设置后：复用同一个沙盒，停了就拉起来，跑完不删。
 *                     不设置：每次新建一个沙盒，跑完即删。
 */

import { serverEnv } from "./ai-provider.mjs";

const DEFAULT_CODE = 'print("Remember Us sandbox OK")';
const START_TIMEOUT_S = 90;

export class MissingDaytonaKeyError extends Error {
  constructor() {
    super("DAYTONA_API_KEY not configured");
    this.code = "NO_DAYTONA_KEY";
  }
}

/** 新建 Daytona 客户端。缺 key 抛 MissingDaytonaKeyError。 */
export async function getDaytonaClient(env) {
  const apiKey = env.DAYTONA_API_KEY;
  if (!apiKey) throw new MissingDaytonaKeyError();
  const { Daytona } = await import("@daytona/sdk");
  return new Daytona({
    apiKey,
    apiUrl: env.DAYTONA_API_URL || undefined,
    target: env.DAYTONA_TARGET || "us",
  });
}

/** 拿一个可直接跑代码的沙盒：设了 DAYTONA_SANDBOX 就复用（停了拉起来），否则新建。 */
export async function acquireSandbox(daytona, env) {
  const ref = (env.DAYTONA_SANDBOX || "").trim();
  if (ref) {
    const sandbox = await daytona.get(ref);
    if (sandbox.state !== "started") await daytona.start(sandbox, START_TIMEOUT_S);
    return { sandbox, reuse: true };
  }
  return { sandbox: await daytona.create({ language: "python" }), reuse: false };
}

/** 一次性沙盒跑完删掉；复用的沙盒留给它自己的 auto-stop。 */
export async function releaseSandbox(sandbox, reuse) {
  if (!sandbox || reuse) return;
  try {
    await sandbox.delete();
  } catch {
    // 删除失败不影响结果返回，沙盒会自动回收
  }
}

/** 在沙盒里跑一段 Python，返回执行结果。 */
export async function runInSandbox(code, env = process.env) {
  const daytona = await getDaytonaClient(env);
  const { sandbox, reuse } = await acquireSandbox(daytona, env);
  try {
    const run = await sandbox.process.codeRun(code || DEFAULT_CODE);
    return {
      mode: reuse ? "reuse" : "ephemeral",
      sandboxId: sandbox.id,
      exitCode: run.exitCode,
      result: run.result,
    };
  } finally {
    await releaseSandbox(sandbox, reuse);
  }
}

function readJsonBody(req, limit = 200_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        reject(new Error("BODY_TOO_LARGE"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("BAD_JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** POST /api/daytona —— 直接在沙盒里跑一段 Python（自检 / demo 用）。 */
export function daytonaHandler(env) {
  const resolved = env || serverEnv();
  return async function handle(req, res) {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
    }
    try {
      const body = await readJsonBody(req);
      const code =
        typeof body.code === "string" && body.code.trim() ? body.code.slice(0, 12000) : "";
      const out = await runInSandbox(code, resolved);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, ...out }));
    } catch (error) {
      if (error?.code === "NO_DAYTONA_KEY") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({ ok: false, skipped: true, reason: "DAYTONA_API_KEY 未配置" }),
        );
      }
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: "SANDBOX_FAILED",
          detail: String(error?.message || error).slice(0, 300),
        }),
      );
    }
  };
}
