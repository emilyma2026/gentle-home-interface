import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../server/ai-provider.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "public", "app", "maps-config.js");

export function readEnvKey() {
  const env = { ...loadDotEnv(root), ...process.env };
  return (env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
}

export default function generateMapsConfig() {
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
}

generateMapsConfig();
