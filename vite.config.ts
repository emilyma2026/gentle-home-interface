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

function daytonaProxyPlugin(): Plugin {
  return {
    name: "companion-daytona-proxy",
    apply: "serve",
    async configureServer(server) {
      const { daytonaHandler } = await import("./server/daytona.mjs");
      const handle = daytonaHandler(process.env);
      server.middlewares.use("/api/daytona", (req, res, next) => {
        if (req.method !== "POST") return next();
        handle(req, res);
      });
    },
  };
}

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [mapsConfigPlugin(), prototypeAssetsPlugin(), aiProxyPlugin(), daytonaProxyPlugin()],
  },
});
