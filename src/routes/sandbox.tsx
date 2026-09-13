import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sandbox")({
  component: SandboxDemo,
  head: () => ({
    meta: [{ title: "Memory Agent · Daytona sandbox" }],
  }),
});

const SAMPLE_NOTE = `妈妈每天早上七点吃降压药，饭后。
她最疼的孙女是朵朵，在上海读大学。
她经常反复问"门锁了没有"，这时候要跟她说"已经检查过了，门锁好了，很安全"。
周三下午三点陪她去社区医院复查血压。
她年轻时在纺织厂当过组长。`;

type Fact = { text: string; category: string; confidence: number };
type Todo = { text: string; due_hint: string; confidence: number };
type Step = Record<string, unknown>;
type Result = {
  ok: boolean;
  runtime?: string;
  sandboxId?: string;
  reuse?: boolean;
  previewLink?: string;
  sandboxFallback?: string;
  facts?: Fact[];
  todos?: Todo[];
  dropped?: Array<{ text: string; reason: string }>;
  steps?: Step[];
  error?: string;
  detail?: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  person: "人物",
  preference: "喜好",
  routine: "日常",
  event: "事件",
  response_script: "应答脚本",
  other: "其他",
};

const RUNTIME_LABEL: Record<string, string> = {
  daytona: "Daytona 沙盒",
  direct: "AI 网关直跑（沙盒不可用）",
  "local-fallback": "本机 Python（无 Daytona key）",
  none: "空输入",
};

function SandboxDemo() {
  const [note, setNote] = useState(SAMPLE_NOTE);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/memory/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = (await res.json()) as Result;
      if (!data.ok) {
        setError(`${data.error ?? "FAILED"}: ${data.detail ?? ""}`);
        return;
      }
      setResult(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-[#faf6f0] px-5 py-10 text-[#3a2c22]">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b4794a]">Remember Us</p>
      <h1 className="mt-1 text-2xl font-extrabold">记忆抽取 Agent — Daytona 沙盒</h1>
      <p className="mt-2 text-sm leading-relaxed text-[#7c5c43]">
        家人写的照护笔记 → 在 Daytona 隔离沙盒里跑两步（结构化抽取 → grounding 逐条核查）→ 返回
        分类好的 facts / todos。不可信的 LLM 输出和外部调用都关在沙盒里。
      </p>

      <textarea
        className="mt-5 h-44 w-full resize-y rounded-2xl border border-[#e6d9c9] bg-white p-4 text-sm leading-relaxed outline-none focus:border-[#b4794a]"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="粘贴一段家人写的笔记…"
      />

      <button
        onClick={run}
        disabled={busy || !note.trim()}
        className="mt-4 w-full rounded-full bg-[#b4794a] py-3.5 text-center text-[15px] font-bold text-white transition disabled:opacity-40"
      >
        {busy ? "沙盒运行中…" : "在 Daytona 沙盒里抽取"}
      </button>

      {error && (
        <div className="mt-4 rounded-xl bg-[#fae7e6] p-3 text-sm text-[#c4585c]">{error}</div>
      )}

      {result && (
        <section className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[#eef1de] px-3 py-1 font-bold text-[#5f6e32]">
              {RUNTIME_LABEL[result.runtime ?? ""] ?? result.runtime}
            </span>
            {result.sandboxId && (
              <span className="rounded-full bg-[#f4e9db] px-3 py-1 font-mono text-[#8a5a33]">
                sandbox {result.sandboxId.slice(0, 8)}
                {result.reuse ? " · 复用" : ""}
              </span>
            )}
            {result.previewLink && (
              <a
                href={result.previewLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-[#f4e9db] px-3 py-1 font-bold text-[#8a5a33] underline"
              >
                打开沙盒
              </a>
            )}
            {result.sandboxFallback && (
              <span className="rounded-full bg-[#fbf0da] px-3 py-1 text-[#c08a2e]">
                沙盒回落：{result.sandboxFallback}
              </span>
            )}
          </div>

          {result.steps && result.steps.length > 0 && (
            <div className="rounded-2xl border border-[#e6d9c9] bg-white p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#9a8574]">
                Pipeline
              </p>
              <ol className="space-y-1 text-sm">
                {result.steps.map((s, i) => (
                  <li key={i} className="font-mono text-[13px] text-[#5c483a]">
                    {i + 1}. {JSON.stringify(s)}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#e6d9c9] bg-white p-4">
              <p className="mb-2 text-sm font-extrabold">
                Facts <span className="text-[#9a8574]">({result.facts?.length ?? 0})</span>
              </p>
              <ul className="space-y-2 text-sm">
                {(result.facts ?? []).map((f, i) => (
                  <li key={i}>
                    <span className="mr-1.5 rounded bg-[#eef1de] px-1.5 py-0.5 text-[11px] font-bold text-[#5f6e32]">
                      {CATEGORY_LABEL[f.category] ?? f.category}
                    </span>
                    {f.text}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-[#e6d9c9] bg-white p-4">
              <p className="mb-2 text-sm font-extrabold">
                Todos <span className="text-[#9a8574]">({result.todos?.length ?? 0})</span>
              </p>
              <ul className="space-y-2 text-sm">
                {(result.todos ?? []).map((t, i) => (
                  <li key={i}>
                    <span className="mr-1.5 rounded bg-[#fbf0da] px-1.5 py-0.5 text-[11px] font-bold text-[#c08a2e]">
                      {t.due_hint}
                    </span>
                    {t.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {result.dropped && result.dropped.length > 0 && (
            <div className="rounded-2xl border border-[#f0d9d9] bg-[#fbf2f2] p-4">
              <p className="mb-2 text-sm font-extrabold text-[#c4585c]">
                grounding 核查丢弃 ({result.dropped.length})
              </p>
              <ul className="space-y-1 text-sm text-[#8b6b52]">
                {result.dropped.map((d, i) => (
                  <li key={i}>
                    <s>{d.text}</s> — {d.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
