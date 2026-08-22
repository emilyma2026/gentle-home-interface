/**
 * 从 .env 读取 Google Maps key，生成 public/app/maps-config.js。
 * 生成的文件已在 .gitignore 里，key 不会进仓库。
 * 部署时改为在托管平台的环境变量里注入，跑一次这个脚本即可。
 *
 *   node scripts/gen-maps-config.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "public", "app", "maps-config.js");

function readEnvKey() {
  if (process.env.VITE_GOOGLE_MAPS_API_KEY) return process.env.VITE_GOOGLE_MAPS_API_KEY.trim();
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*VITE_GOOGLE_MAPS_API_KEY\s*=\s*(.*)$/);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

const key = readEnvKey();
const body =
  "/* 自动生成，请勿提交。运行 node scripts/gen-maps-config.mjs 重新生成。 */\n" +
  "window.MAPS_CONFIG = Object.freeze({ key: " + JSON.stringify(key) + " });\n";

fs.writeFileSync(OUT, body, "utf8");
console.log(
  key
    ? "已写入 public/app/maps-config.js（key 长度 " + key.length + "）"
    : "未找到 VITE_GOOGLE_MAPS_API_KEY，已写入空 key，地图会降级为示意图",
);
