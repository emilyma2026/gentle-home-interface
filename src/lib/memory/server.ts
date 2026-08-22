import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { embed, generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import {
  DUE_HINTS,
  FACT_CATEGORIES,
  type ExtractionSource,
  type FamilyFact,
  type FamilyTodo,
  type MatchedFact,
} from "./types";

const EXTRACT_MODEL = "gpt-5-mini";
const EMBED_MODEL = "text-embedding-3-small";

// 手机号 / 身份证号 / 银行卡号 / 密码类关键词——抽取结果里出现即丢弃，双重保险（system prompt 已经约束过一次）
const SENSITIVE_RE =
  /(\d{11})|(\d{17}[\dXx])|(\d{16,19})|身份证|银行卡|信用卡|密码|password|passport|护照号/;

const EXTRACTION_SYSTEM_PROMPT = `你是阿尔茨海默症老人记忆助手的抽取模块。输入可能来自家人写的笔记，也可能来自老人和 AI 聊天时说的话。
把输入拆成两类，分别放进 facts 和 todos：

facts（记忆）：稳定、值得长期记住、能在老人以后提问或表现出困惑时用来回应的信息。包括：
  - person / preference / routine / event / other：人物关系、喜好、日常习惯、重要事件、其他稳定信息
  - response_script（应答脚本）：老人会反复问的问题或反复出现的困惑情境，家人已经想好固定的回应方式。
    必须同时包含"触发情境"和"具体回应话术"两部分，写成一句话，例如："老人问门锁了没时，告诉她'已经检查过，很安全'"。
    判断标准：如果这条内容的形式是"老人问/说 X 时，回应/告诉她 Y"，就是 response_script，不是 routine 或 todo。

todos（待办）：家人需要去做的具体动作，一次性、有明确时间性——比如买药、预约体检、打电话给谁。
  不包括：老人自己的习惯（放 routine）、重复出现的应答话术（放 response_script）、没有具体截止时间的日常照护提醒（这类如果原文没给出明确时间，也归到 todos 用 due_hint=unspecified，但优先检查是否其实是 response_script）。

规则：
- 每条都必须是输入里明确写到的内容，禁止编造或推测没有依据的信息
- facts 每条一句话说完，具体、可核实，不超过 80 字（response_script 允许稍长以容纳完整话术）；category 从 person / preference / routine / event / response_script / other 中选一个
- todos 每条一句话说完，不超过 60 字；due_hint 从 today（今天）/ tomorrow（明天）/ this_week（这周）/ unspecified（没提到时间）中选一个
- confidence 反映你对这条内容抽取准确性的把握，0 到 1 之间
- 绝对不要输出：手机号、身份证号、银行卡号、密码、详细医疗诊断、法律纠纷等敏感信息
- 没有可抽取的内容就对应返回空数组，不要为了凑数量编造`;

const QA_SYSTEM_PROMPT = `你在帮一位阿尔茨海默症老人回答问题。
只能使用用户消息里列出的"已确认的事实"作答，不能编造、不能使用你自己的知识补充。
如果某条事实是 response_script（格式类似"老人问 X 时，回应 Y"）且和老人的问题匹配，优先照着里面写好的话术回答，不要改写措辞——这是家人特意准备好的稳定回应，用词的一致性对老人很重要。
其他情况回答要简短、温和、口语化，一到两句话。
如果这些事实不足以回答老人的问题，明确说"这个我还不确定，我会问问家人"，不要猜测或编造答案。`;

const extractionSchema = z.object({
  facts: z
    .array(
      z.object({
        text: z.string().min(1).max(180),
        category: z.enum(FACT_CATEGORIES),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(10),
  todos: z
    .array(
      z.object({
        text: z.string().min(1).max(120),
        due_hint: z.enum(DUE_HINTS),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(10),
});

function supabaseAsUser(accessToken: string) {
  const url = process.env["VITE_SUPABASE_URL"];
  const anonKey = process.env["VITE_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) throw new Error("Missing Supabase server env vars");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
}

function textHashOf(text: string): string {
  return createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

export const extractMemory = createServerFn({ method: "POST" })
  .validator(
    (data: { familyId: string; noteText: string; accessToken: string; origin: ExtractionSource }) =>
      data,
  )
  .handler(async ({ data }): Promise<{ facts: FamilyFact[]; todos: FamilyTodo[] }> => {
    const noteText = data.noteText.trim().slice(0, 2000);
    if (!noteText) return { facts: [], todos: [] };

    const { output } = await generateText({
      model: openai(EXTRACT_MODEL),
      output: Output.object({ schema: extractionSchema }),
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: noteText,
    });

    const safeFacts = output.facts.filter((f) => !SENSITIVE_RE.test(f.text));
    const safeTodos = output.todos.filter((t) => !SENSITIVE_RE.test(t.text));
    if (safeFacts.length === 0 && safeTodos.length === 0) return { facts: [], todos: [] };

    const db = supabaseAsUser(data.accessToken);
    const { data: userRes, error: userError } = await db.auth.getUser();
    if (userError || !userRes?.user) throw new Error("AUTH_REQUIRED");

    let insertedFacts: FamilyFact[] = [];
    if (safeFacts.length > 0) {
      const factRows = safeFacts.map((f) => ({
        family_id: data.familyId,
        category: f.category,
        text: f.text,
        confidence: f.confidence,
        status: "pending" as const,
        source: "extracted" as const,
        source_note: noteText.slice(0, 300),
        origin: data.origin,
        created_by: userRes.user.id,
      }));
      const { data: inserted, error } = await db.from("family_facts").insert(factRows).select();
      if (error) throw error;
      insertedFacts = (inserted ?? []) as FamilyFact[];
    }

    let insertedTodos: FamilyTodo[] = [];
    if (safeTodos.length > 0) {
      const todoRows = safeTodos.map((t) => ({
        family_id: data.familyId,
        text: t.text,
        due_hint: t.due_hint,
        status: "pending" as const,
        source: "extracted" as const,
        source_note: noteText.slice(0, 300),
        origin: data.origin,
        created_by: userRes.user.id,
      }));
      const { data: inserted, error } = await db.from("family_todos").insert(todoRows).select();
      if (error) throw error;
      insertedTodos = (inserted ?? []) as FamilyTodo[];
    }

    return { facts: insertedFacts, todos: insertedTodos };
  });

export const confirmFact = createServerFn({ method: "POST" })
  .validator((data: { factId: string; finalText: string; accessToken: string }) => data)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const finalText = data.finalText.trim().slice(0, 500);
    if (!finalText) throw new Error("EMPTY_TEXT");
    if (SENSITIVE_RE.test(finalText)) throw new Error("SENSITIVE_TEXT_BLOCKED");

    const db = supabaseAsUser(data.accessToken);
    const { data: userRes, error: userError } = await db.auth.getUser();
    if (userError || !userRes?.user) throw new Error("AUTH_REQUIRED");

    const { error: updateError } = await db
      .from("family_facts")
      .update({
        text: finalText,
        status: "active",
        reviewed_by: userRes.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.factId);
    if (updateError) throw updateError;

    const { embedding } = await embed({
      model: openai.embeddingModel(EMBED_MODEL),
      value: finalText,
    });
    const { error: rpcError } = await db.rpc("upsert_family_fact_embedding", {
      target_fact_id: data.factId,
      fact_text_hash: textHashOf(finalText),
      fact_embedding: embedding,
    });
    if (rpcError) throw rpcError;

    return { ok: true };
  });

export const rejectFact = createServerFn({ method: "POST" })
  .validator((data: { factId: string; accessToken: string }) => data)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const db = supabaseAsUser(data.accessToken);
    const { data: userRes, error: userError } = await db.auth.getUser();
    if (userError || !userRes?.user) throw new Error("AUTH_REQUIRED");

    const { error } = await db
      .from("family_facts")
      .update({
        status: "rejected",
        reviewed_by: userRes.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.factId);
    if (error) throw error;
    return { ok: true };
  });

export const searchFacts = createServerFn({ method: "POST" })
  .validator((data: { familyId: string; queryText: string; accessToken: string }) => data)
  .handler(async ({ data }): Promise<{ matches: MatchedFact[]; answer: string }> => {
    const queryText = data.queryText.trim().slice(0, 300);
    if (!queryText) return { matches: [], answer: "" };

    const db = supabaseAsUser(data.accessToken);
    const { embedding } = await embed({
      model: openai.embeddingModel(EMBED_MODEL),
      value: queryText,
    });

    const { data: matches, error } = await db.rpc("match_family_facts", {
      target_family_id: data.familyId,
      query_embedding: embedding,
      match_count: 8,
      match_threshold: 0.3,
    });
    if (error) throw error;

    const matchedFacts = (matches ?? []) as MatchedFact[];
    let answer = "记忆里还没有这方面的信息，我会提醒家人补充。";
    if (matchedFacts.length > 0) {
      const { text } = await generateText({
        model: openai(EXTRACT_MODEL),
        system: QA_SYSTEM_PROMPT,
        prompt: `已确认的事实：\n${matchedFacts.map((m) => `- ${m.text}`).join("\n")}\n\n老人的问题：${queryText}`,
      });
      answer = text;
    }
    return { matches: matchedFacts, answer };
  });
