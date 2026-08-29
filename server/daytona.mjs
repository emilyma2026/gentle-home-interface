/**
 * Daytona 沙盒适配层。比赛技术要求：AI 相关代码在隔离沙盒里执行。
 * DAYTONA_API_KEY 只存在于服务端。没有 key 时 /api/daytona 返回 skipped，其余功能不受影响。
 *
 * 环境变量：
 *   DAYTONA_API_KEY   必填，来自 app.daytona.io/dashboard/keys
 *   DAYTONA_API_URL   可选，默认 https://app.daytona.io/api
 *   DAYTONA_TARGET    可选，us 或 eu，默认 us
 *   DAYTONA_SANDBOX   可选，固定复用的沙盒 name 或 UUID（如 Remember_Us）。
 *                     设置后：每次请求复用同一个沙盒，停了就拉起来，跑完不删。
 *                     不设置：每次请求新建一个沙盒，跑完即删。
 */

import { serverEnv } from "./ai-provider.mjs";

const DEFAULT_CODE = 'print("Remember Us sandbox OK")';
const START_TIMEOUT_S = 90;

/** 取固定沙盒，没启动就启动，返回可直接跑代码的 sandbox。 */
async function resumeSandbox(daytona, ref) {
  const sandbox = await daytona.get(ref);
  if (sandbox.state !== "started") {
    await daytona.start(sandbox, START_TIMEOUT_S);
  }
  return sandbox;
}

/** 在沙盒里跑一段 Python，返回执行结果。 */
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

  const ref = (env.DAYTONA_SANDBOX || "").trim();
  const reuse = ref.length > 0;
  let sandbox;
  try {
    sandbox = reuse
      ? await resumeSandbox(daytona, ref)
      : await daytona.create({ language: "python" });
    const run = await sandbox.process.codeRun(code || DEFAULT_CODE);
    return {
      mode: reuse ? "reuse" : "ephemeral",
      sandboxId: sandbox.id,
      exitCode: run.exitCode,
      result: run.result,
    };
  } finally {
    // 复用的沙盒不删，交给它自己的 auto-stop；一次性沙盒跑完就删。
    if (sandbox && !reuse) {
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
