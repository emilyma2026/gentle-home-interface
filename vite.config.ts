// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

// 本地开发时把 /api/ai 交给服务端处理，AI 的 key 只留在服务端，不进浏览器。
// 生产环境请在托管平台上提供同样路径的接口，或用同一个 server/ai-provider.mjs。
function aiProxyPlugin(): Plugin {
  return {
    name: "companion-ai-proxy",
    apply: "serve",
    async configureServer(server) {
      const { aiHandler } = await import("./server/ai-provider.mjs");
      const handle = aiHandler(process.env);
      server.middlewares.use("/api/ai", (req, res, next) => {
        if (req.method !== "POST") return next();
        handle(req, res);
      });
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [aiProxyPlugin()],
  },
});
