/**
 * 从 .env 生成 public/app/supabase-config.js。
 * public/ 不经过 Vite 处理，VITE_ 变量注入不进这个静态文件，所以需要生成。
 * publishable key 受 RLS 保护，可以提交；换 Supabase 项目后请重跑本脚本。
 *
 *   node scripts/gen-supabase-config.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../server/ai-provider.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "public", "app", "supabase-config.js");
const env = { ...loadDotEnv(root), ...process.env };

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";
if (!url || !key) {
  console.error("缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY，未改动现有配置");
  process.exit(1);
}

fs.writeFileSync(
  OUT,
  "window.SUPABASE_CONFIG = Object.freeze({\n" +
    "  url: " + JSON.stringify(url) + ",\n" +
    "  publishableKey: " + JSON.stringify(key) + ",\n" +
    "});\n",
  "utf8",
);
console.log("已写入 public/app/supabase-config.js →", url);
