/**
 * Daytona 沙盒适配层。比赛技术要求：AI 相关代码在隔离沙盒里执行。
 * DAYTONA_API_KEY 只存在于服务端。没有 key 时 /api/daytona 返回 skipped，其余功能不受影响。
 *
 * 环境变量：
 *   DAYTONA_API_KEY   必填，来自 app.daytona.io/dashboard/keys
 *   DAYTONA_API_URL   可选，默认 https://app.daytona.io/api
 *   DAYTONA_TARGET    可选，us 或 eu，默认 us
 */

import { serverEnv } from "./ai-provider.mjs";

const DEFAULT_CODE = 'print("Remember Us sandbox OK")';

/** 建沙盒 -> 跑一段 Python -> 删沙盒，返回执行结果。 */
export async function runInSandbox(code, env = process.env) {
  const apiKey = env.DAYTONA_API_KEY;
  if (!apiKey) {
    const err = new Error("NO_DAYTONA_KEY");
    err.code = "NO_DAYTONA_KEY";
    throw err;
  }
  const { Daytona } = await import("@daytona/sdk");
  const daytona = new Daytona({
    apiKey,
    apiUrl: env.DAYTONA_API_URL || undefined,
    target: env.DAYTONA_TARGET || "us",
  });
  let sandbox;
  try {
    sandbox = await daytona.create({ language: "python" });
    const run = await sandbox.process.codeRun(code || DEFAULT_CODE);
    return { sandboxId: sandbox.id, exitCode: run.exitCode, result: run.result };
  } finally {
    if (sandbox) {
      try {
        await sandbox.delete();
      } catch {
        // 删除失败不影响结果返回，沙盒会自动回收
      }
    }
  }
}

/** 挂到任意 Node HTTP 服务上的 /api/daytona 处理器。 */
export function daytonaHandler(env) {
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
    });
  };
}
