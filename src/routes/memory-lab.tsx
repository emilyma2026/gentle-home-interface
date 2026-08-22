import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase-client";
import { extractMemory, confirmFact, rejectFact, searchFacts } from "@/lib/memory/server";
import type {
  DueHint,
  ExtractionSource,
  FamilyFact,
  FamilyTodo,
  MatchedFact,
} from "@/lib/memory/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/memory-lab")({
  component: MemoryLab,
});

const STATUS_LABEL: Record<FamilyFact["status"], string> = {
  pending: "待确认",
  active: "已生效",
  stale: "已过期",
  rejected: "已拒绝",
};

const CATEGORY_LABEL: Record<FamilyFact["category"], string> = {
  person: "人物",
  preference: "喜好",
  routine: "日常",
  event: "事件",
  response_script: "应答脚本",
  other: "其他",
};

const DUE_HINT_LABEL: Record<DueHint, string> = {
  today: "今天",
  tomorrow: "明天",
  this_week: "这周",
  unspecified: "没说时间",
};

const DUE_HINT_ORDER: DueHint[] = ["today", "tomorrow", "this_week", "unspecified"];

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const anyE = e as Record<string, unknown>;
    return String(anyE["message"] ?? anyE["error"] ?? JSON.stringify(e));
  }
  return String(e);
}

function MemoryLab() {
  const runExtractMemory = useServerFn(extractMemory);
  const runConfirmFact = useServerFn(confirmFact);
  const runRejectFact = useServerFn(rejectFact);
  const runSearchFacts = useServerFn(searchFacts);

  const [userId, setUserId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [bootError, setBootError] = useState<string | null>(null);

  const [origin, setOrigin] = useState<ExtractionSource>("family_note");
  const [noteText, setNoteText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [facts, setFacts] = useState<FamilyFact[]>([]);
  const [todos, setTodos] = useState<FamilyTodo[]>([]);
  const [draftText, setDraftText] = useState<Record<string, string>>({});

  const [queryText, setQueryText] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<MatchedFact[]>([]);
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap() {
    setBootError(null);
    let { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        setBootError("匿名登录失败：" + error.message);
        return;
      }
      sessionData = { session: data.session };
    }
    const token = sessionData.session?.access_token ?? null;
    setAccessToken(token);
    if (!token) return;

    const uid = sessionData.session!.user.id;
    setUserId(uid);
    const { data: membership } = await supabase
      .from("family_members")
      .select("family_id, role")
      .eq("user_id", uid)
      .limit(1)
      .maybeSingle();

    if (membership) {
      setFamilyId(membership.family_id);
      setRole(membership.role);
      loadAll(membership.family_id);
    }
  }

  async function handleCreate() {
    setBootError(null);
    const initialPayload = {
      code: "",
      lang: "zh",
      rev: 0,
      setup: true,
      paired: false,
      elder: null,
      people: [],
      facts: [],
      pending: [],
      timeline: [],
      call: null,
      lastCaller: null,
      thread: [],
      askCounts: {},
      loc: null,
      guide: null,
    };
    const { data, error } = await supabase.rpc("create_family", {
      initial_payload: initialPayload,
      requested_role: "family",
    });
    if (error) {
      setBootError("创建家庭失败：" + error.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      setBootError("创建家庭失败：没有返回数据");
      return;
    }
    setFamilyId(row.family_id);
    setRole("family");
    loadAll(row.family_id);
  }

  async function handleJoin() {
    setBootError(null);
    const { data, error } = await supabase.rpc("join_family", {
      family_code: joinCode.trim(),
      requested_role: "family",
    });
    if (error) {
      setBootError("加入家庭失败：" + error.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      setBootError("家庭码不存在，请检查是否输错");
      return;
    }
    setFamilyId(row.family_id);
    setRole("family");
    loadAll(row.family_id);
  }

  async function loadAll(fid: string) {
    const [factsRes, todosRes] = await Promise.all([
      supabase
        .from("family_facts")
        .select("*")
        .eq("family_id", fid)
        .order("created_at", { ascending: false }),
      supabase
        .from("family_todos")
        .select("*")
        .eq("family_id", fid)
        .order("created_at", { ascending: false }),
    ]);
    setFacts((factsRes.data ?? []) as FamilyFact[]);
    setTodos((todosRes.data ?? []) as FamilyTodo[]);
  }

  async function handleExtract() {
    if (!familyId || !accessToken || !noteText.trim()) return;
    setExtracting(true);
    try {
      await runExtractMemory({ data: { familyId, noteText, accessToken, origin } });
      setNoteText("");
      await loadAll(familyId);
    } catch (e) {
      console.error("extract error", e);
      setBootError("抽取失败：" + describeError(e));
    } finally {
      setExtracting(false);
    }
  }

  async function handleConfirmFact(fact: FamilyFact) {
    if (!accessToken) return;
    const finalText = draftText[fact.id] ?? fact.text;
    try {
      await runConfirmFact({ data: { factId: fact.id, finalText, accessToken } });
      if (familyId) await loadAll(familyId);
    } catch (e) {
      console.error("confirm error", e);
      setBootError("确认失败：" + describeError(e));
    }
  }

  async function handleRejectFact(fact: FamilyFact) {
    if (!accessToken) return;
    await runRejectFact({ data: { factId: fact.id, accessToken } });
    if (familyId) await loadAll(familyId);
  }

  async function updateTodoStatus(todo: FamilyTodo, status: FamilyTodo["status"]) {
    if (!userId) return;
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === "active" || status === "rejected") patch["completed_by"] = null;
    if (status === "done") {
      patch["completed_by"] = userId;
      patch["completed_at"] = new Date().toISOString();
    }
    const { error } = await supabase.from("family_todos").update(patch).eq("id", todo.id);
    if (error) {
      setBootError("更新待办失败：" + error.message);
      return;
    }
    if (familyId) await loadAll(familyId);
  }

  async function handleSearch() {
    if (!familyId || !accessToken || !queryText.trim()) return;
    setSearching(true);
    try {
      const result = await runSearchFacts({ data: { familyId, queryText, accessToken } });
      setMatches(result.matches);
      setAnswer(result.answer);
    } catch (e) {
      console.error("search error", e);
      setBootError("检索失败：" + describeError(e));
    } finally {
      setSearching(false);
    }
  }

  if (!familyId) {
    return (
      <main className="mx-auto max-w-md p-6 space-y-4">
        <h1 className="text-lg font-semibold">记忆系统测试台</h1>
        <p className="text-sm text-muted-foreground">
          新建一个测试家庭，或输入已有的 6 位家庭码加入。
        </p>
        <Button onClick={handleCreate} className="w-full">
          新建测试家庭
        </Button>
        <div className="flex gap-2">
          <Input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="6 位家庭码"
            maxLength={6}
          />
          <Button onClick={handleJoin} disabled={joinCode.trim().length !== 6}>
            加入
          </Button>
        </div>
        {bootError && <p className="text-sm text-destructive">{bootError}</p>}
      </main>
    );
  }

  const pendingFacts = facts.filter((f) => f.status === "pending");
  const reviewedFacts = facts.filter((f) => f.status !== "pending");
  const pendingTodos = todos.filter((t) => t.status === "pending");
  const activeTodos = todos.filter((t) => t.status === "active");
  const doneTodos = todos.filter((t) => t.status === "done");

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-8">
      <div>
        <h1 className="text-lg font-semibold">记忆系统测试台</h1>
        <p className="text-sm text-muted-foreground">
          家庭 {familyId.slice(0, 8)} · 身份 {role}
        </p>
      </div>

      {bootError && <p className="text-sm text-destructive">{bootError}</p>}

      <Card className="p-4 space-y-3">
        <h2 className="font-medium">1. 输入一段记录</h2>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={origin === "family_note"}
              onChange={() => setOrigin("family_note")}
            />
            家人端记录
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={origin === "elder_chat"}
              onChange={() => setOrigin("elder_chat")}
            />
            老人端聊天（测试）
          </label>
        </div>
        <Textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="例如：妈妈最近喜欢每天下午去楼下小花园坐一会儿，最爱吃甜豆沙包，孙子叫朵朵，每周六会来看她。记得明天帮她买降压药。"
          rows={4}
        />
        <Button onClick={handleExtract} disabled={extracting || !noteText.trim()}>
          {extracting ? "抽取中…" : "抽取记忆和待办"}
        </Button>
      </Card>

      {(pendingFacts.length > 0 || pendingTodos.length > 0) && (
        <Card className="p-4 space-y-4">
          <h2 className="font-medium">2. 待确认</h2>

          {pendingFacts.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">记忆事实</p>
              {pendingFacts.map((fact) => (
                <div key={fact.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{CATEGORY_LABEL[fact.category]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      置信度 {(fact.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <Textarea
                    value={draftText[fact.id] ?? fact.text}
                    onChange={(e) =>
                      setDraftText((prev) => ({ ...prev, [fact.id]: e.target.value }))
                    }
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleConfirmFact(fact)}>
                      确认
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleRejectFact(fact)}>
                      忽略
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pendingTodos.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">待办事项</p>
              {pendingTodos.map((todo) => (
                <div key={todo.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{DUE_HINT_LABEL[todo.due_hint]}</Badge>
                  </div>
                  <p className="text-sm">{todo.text}</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateTodoStatus(todo, "active")}>
                      确认
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateTodoStatus(todo, "rejected")}
                    >
                      忽略
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTodos.length > 0 && (
        <Card className="p-4 space-y-3">
          <h2 className="font-medium">待办列表</h2>
          {DUE_HINT_ORDER.map((hint) => {
            const group = activeTodos.filter((t) => t.due_hint === hint);
            if (group.length === 0) return null;
            return (
              <div key={hint} className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{DUE_HINT_LABEL[hint]}</p>
                {group.map((todo) => (
                  <div key={todo.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{todo.text}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateTodoStatus(todo, "done")}
                    >
                      完成
                    </Button>
                  </div>
                ))}
              </div>
            );
          })}
        </Card>
      )}

      {doneTodos.length > 0 && (
        <Card className="p-4 space-y-1.5">
          <h2 className="font-medium">已完成的待办</h2>
          {doneTodos.map((todo) => (
            <p key={todo.id} className="text-sm text-muted-foreground line-through">
              {todo.text}
            </p>
          ))}
        </Card>
      )}

      {reviewedFacts.length > 0 && (
        <Card className="p-4 space-y-2">
          <h2 className="font-medium">已处理的事实</h2>
          {reviewedFacts.map((fact) => (
            <div key={fact.id} className="flex items-center gap-2 text-sm">
              <Badge variant={fact.status === "active" ? "default" : "outline"}>
                {STATUS_LABEL[fact.status]}
              </Badge>
              <span
                className={fact.status === "rejected" ? "text-muted-foreground line-through" : ""}
              >
                {fact.text}
              </span>
            </div>
          ))}
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <h2 className="font-medium">3. 老人端：提问测试</h2>
        <div className="flex gap-2">
          <Input
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="例如：我孙子叫什么名字？"
          />
          <Button onClick={handleSearch} disabled={searching || !queryText.trim()}>
            {searching ? "检索中…" : "提问"}
          </Button>
        </div>
        {answer && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium mb-1">回答</p>
            <p>{answer}</p>
          </div>
        )}
        {matches.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">检索到的事实（按相似度排序）</p>
            {matches.map((m) => (
              <div key={m.id} className="text-xs text-muted-foreground">
                · {m.text}（相似度 {m.similarity.toFixed(2)}
                {m.is_core ? "，核心事实" : ""}）
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
