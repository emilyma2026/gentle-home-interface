import fs from "node:fs/promises";
import path from "node:path";

import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

function mapsConfigPlugin(): Plugin {
  return {
    name: "remember-us-maps-config",
    async buildStart() {
      const module = await import("./scripts/gen-maps-config.mjs");
      if (typeof module.default === "function") {
        await module.default();
      }
    },
    async configureServer() {
      const module = await import("./scripts/gen-maps-config.mjs");
      if (typeof module.default === "function") {
        await module.default();
      }
    },
  };
}

function prototypeAssetsPlugin(): Plugin {
  return {
    name: "remember-us-prototype-assets",
    apply: "build",
    async closeBundle() {
      const root = process.cwd();
      const source = path.join(root, "public", "app");
      const targets = [
        path.join(root, ".output", "public", "app"),
        path.join(root, "dist", "app"),
      ];

      await Promise.all(
        targets.map(async (target) => {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.rm(target, { recursive: true, force: true });
          await fs.cp(source, target, { recursive: true });
        }),
      );
    },
  };
}

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

function liveProxyPlugin(): Plugin {
  return {
    name: "companion-live-proxy",
    apply: "serve",
    async configureServer(server) {
      const { handleLiveRequest } = await import("./server/live-runtime.mjs");
      const { serverEnv } = await import("./server/ai-provider.mjs");
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/live/")) return next();
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 65_536) {
              res.writeHead(413, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "REQUEST_TOO_LARGE" }));
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) {
            if (typeof value === "string") headers.set(name, value);
          }
          const request = new Request(new URL(req.url, "http://" + req.headers.host), {
            method: req.method || "GET", headers,
            ...(req.method === "POST" ? { body: Buffer.concat(chunks).toString("utf8") } : {}),
          });
          const result = await handleLiveRequest(request, serverEnv());
          res.writeHead(result.status, Object.fromEntries(result.headers));
          res.end(await result.text());
        } catch {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "LIVE_UNAVAILABLE" }));
        }
      });
    },
  };
}

// 本地开发的记忆抽取接口（生产在 src/server.ts 里路由）
function memoryProxyPlugin(): Plugin {
  return {
    name: "companion-memory-proxy",
    apply: "serve",
    async configureServer(server) {
      const { memoryAgentHandler } = await import("./server/memory-agent.mjs");
      const memory = memoryAgentHandler(process.env);
      server.middlewares.use("/api/memory/extract", (req, res, next) => {
        if (req.method !== "POST") return next();
        memory(req, res);
      });
    },
  };
}

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [mapsConfigPlugin(), prototypeAssetsPlugin(), liveProxyPlugin(), aiProxyPlugin(), memoryProxyPlugin()],
  },
});
