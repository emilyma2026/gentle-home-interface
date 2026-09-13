import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { EXTRACT_SYSTEM, extractDirect, handleMemoryExtract } from "../server/memory-agent.mjs";

const agentSrc = readFileSync(new URL("../server/sandbox/memory_agent.py", import.meta.url), "utf8");

function openaiStub(payload) {
  return async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
}

const env = { OPENAI_API_KEY: "sk-test" };

test("EXTRACT_SYSTEM is the single source of the extraction prompt", () => {
  assert.match(EXTRACT_SYSTEM, /facts/);
  assert.match(EXTRACT_SYSTEM, /due_hint/);
  // the python agent injects it rather than carrying its own copy
  assert.doesNotMatch(agentSrc, /你是阿尔茨海默症老人记忆助手的抽取模块/);
  assert.match(agentSrc, /__EXTRACT_SYSTEM_B64__/);
  assert.match(agentSrc, /__PAYLOAD_B64__/);
});

test("extractDirect normalizes categories, clamps confidence, filters sensitive", async () => {
  const out = await extractDirect(
    "妈妈每天早上吃药。她的手机号是 13800001111。",
    env,
    openaiStub({
      facts: [
        { text: "妈妈每天早上吃药", category: "routine", confidence: 1.5 },
        { text: "妈妈的手机号是 13800001111", category: "person", confidence: 0.9 },
        { text: "一条没写分类的事实", confidence: 0.4 },
      ],
      todos: [{ text: "周三陪她复查", due_hint: "weird", confidence: 0.8 }],
    }),
  );

  assert.equal(out.runtime, "direct");
  assert.equal(out.facts.length, 2); // 手机号那条被 SENSITIVE_RE 挡掉
  assert.equal(out.facts[0].confidence, 1); // 1.5 -> clamp 到 1
  assert.equal(out.facts[1].category, "other"); // 缺分类 -> other
  assert.equal(out.todos[0].due_hint, "unspecified"); // 非法 due_hint -> unspecified
});

test("handleMemoryExtract falls back to direct when the sandbox is unavailable", async () => {
  const req = new Request("http://x/api/memory/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note: "她最喜欢的孙女是朵朵。" }),
  });
  // 没有 DAYTONA_API_KEY -> extractInSandbox 抛 MissingDaytonaKeyError -> 走 extractDirect
  const res = await handleMemoryExtract(
    req,
    env,
    openaiStub({ facts: [{ text: "她最喜欢的孙女是朵朵", category: "person", confidence: 0.9 }], todos: [] }),
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.runtime, "direct");
  assert.ok(body.sandboxFallback, "should record why the sandbox was skipped");
  assert.equal(body.facts[0].category, "person");
});

test("handleMemoryExtract rejects non-POST and bad JSON", async () => {
  const get = await handleMemoryExtract(new Request("http://x/api/memory/extract"), env);
  assert.equal(get.status, 405);

  const bad = await handleMemoryExtract(
    new Request("http://x/api/memory/extract", { method: "POST", body: "not json" }),
    env,
  );
  assert.equal(bad.status, 400);
});

test("empty note short-circuits without calling the model", async () => {
  let called = false;
  const res = await handleMemoryExtract(
    new Request("http://x/api/memory/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "   " }),
    }),
    env,
    async () => {
      called = true;
      return new Response("{}");
    },
  );
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.runtime, "none");
  assert.equal(called, false);
});
