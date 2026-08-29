import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { handleAIRequest } from "../server/ai-runtime.mjs";

const serverSource = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");

const environment = {
  OPENAI_API_KEY: "server-only-openai-key",
  SUPABASE_URL: "https://family.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public-project-key",
};

function aiRequest(headers = {}) {
  return new Request("https://remember.example/api/ai", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://remember.example",
      authorization: "Bearer user-session-token",
      ...headers,
    },
    body: JSON.stringify({
      system: "Return JSON only.",
      user: "Mom needs to take medicine today.",
      json: true,
    }),
  });
}

test("the Cloudflare server intercepts the production AI route", () => {
  assert.match(serverSource, /pathname === "\/api\/ai"/);
  assert.match(serverSource, /handleAIRequest\(request, runtimeEnvironment\(env\)\)/);
  assert.match(serverSource, /globalThis[\s\S]*__env__/);
});

test("the production AI route requires a Supabase session", async () => {
  let requests = 0;
  const response = await handleAIRequest(
    aiRequest({ authorization: "" }),
    environment,
    async () => {
      requests += 1;
      throw new Error("should not fetch");
    },
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTH_REQUIRED");
  assert.equal(requests, 0);
});

test("the production AI route verifies Supabase before calling OpenAI", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url) === "https://family.supabase.co/auth/v1/user") {
      assert.equal(options.headers.apikey, "public-project-key");
      assert.equal(options.headers.authorization, "Bearer user-session-token");
      return new Response(JSON.stringify({ id: "user-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url) === "https://api.openai.com/v1/chat/completions") {
      assert.equal(options.headers.authorization, "Bearer server-only-openai-key");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gpt-4o-mini");
      assert.deepEqual(body.response_format, { type: "json_object" });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"reply":"Saved","items":[]}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const response = await handleAIRequest(aiRequest(), environment, fetchImpl);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.provider, "openai");
  assert.equal(body.text, '{"reply":"Saved","items":[]}');
  assert.equal(calls.length, 2);
});

test("the production AI route rejects cross-origin browser calls", async () => {
  let requests = 0;
  const response = await handleAIRequest(
    aiRequest({ origin: "https://attacker.example" }),
    environment,
    async () => {
      requests += 1;
      throw new Error("should not fetch");
    },
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "ORIGIN_NOT_ALLOWED");
  assert.equal(requests, 0);
});

test("the production AI route reports a missing Cloudflare model secret", async () => {
  const response = await handleAIRequest(
    aiRequest(),
    {
      SUPABASE_URL: environment.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: environment.SUPABASE_PUBLISHABLE_KEY,
    },
    async (url) => {
      assert.equal(String(url), "https://family.supabase.co/auth/v1/user");
      return new Response("{}", { status: 200 });
    },
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "NO_AI_KEY");
});
