"""Remember Us — 记忆抽取 agent，在 Daytona 沙盒里运行。

家人写的一段笔记进来，两步处理后返回结构化 facts / todos：
  1. extractor：LLM 结构化抽取（person/preference/routine/event/response_script/other + todos）
  2. grounding critic：第二遍 LLM 逐条核对"是不是笔记里明确写到的"，没依据的丢掉

沙盒把不可信的 LLM 输出和外部调用关在隔离环境里。只用 Python 标准库。
Node 侧（server/memory-agent.mjs）把 note / openaiKey / system prompt 以 base64
填进下面两个占位符再送进沙盒执行。
"""

import base64
import json
import re
import sys
import urllib.error
import urllib.request

PAYLOAD_B64 = "__PAYLOAD_B64__"
EXTRACT_SYSTEM = base64.b64decode("__EXTRACT_SYSTEM_B64__").decode()

EXTRACT_MODEL = "gpt-4o-mini"
CRITIC_MODEL = "gpt-4o-mini"

FACT_CATEGORIES = ["person", "preference", "routine", "event", "response_script", "other"]
DUE_HINTS = ["today", "tomorrow", "this_week", "unspecified"]

# 手机号 / 身份证 / 银行卡 / 密码类关键词 —— 命中即丢弃
SENSITIVE_RE = re.compile(
    r"(\d{11})|(\d{17}[\dXx])|(\d{16,19})|身份证|银行卡|信用卡|密码|password|passport|护照号"
)

CRITIC_SYSTEM = (
    "你是核查员。给你一段原始笔记和若干条从中抽取的声明。"
    "逐条判断这条声明是否被原始笔记明确支持（不能靠推测、不能靠常识补全）。"
    '只输出 JSON：{"unsupported": [下标数组]}，下标从 0 开始，指向不被支持、应当丢弃的声明。'
)


def openai_chat(key, model, system, user, want_json=True):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.1,
    }
    if want_json:
        body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    return data["choices"][0]["message"]["content"]


def clamp_conf(v):
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return 0.5


def run(note, key):
    steps = []

    raw = openai_chat(key, EXTRACT_MODEL, EXTRACT_SYSTEM, note)
    parsed = json.loads(raw)
    facts = [
        {
            "text": str(f.get("text", "")).strip()[:180],
            "category": f["category"] if f.get("category") in FACT_CATEGORIES else "other",
            "confidence": clamp_conf(f.get("confidence")),
        }
        for f in parsed.get("facts", [])
        if str(f.get("text", "")).strip()
    ][:10]
    todos = [
        {
            "text": str(t.get("text", "")).strip()[:120],
            "due_hint": t["due_hint"] if t.get("due_hint") in DUE_HINTS else "unspecified",
            "confidence": clamp_conf(t.get("confidence")),
        }
        for t in parsed.get("todos", [])
        if str(t.get("text", "")).strip()
    ][:10]
    steps.append({"name": "extract", "model": EXTRACT_MODEL, "facts": len(facts), "todos": len(todos)})

    dropped = []

    # grounding critic：把 facts + todos 拉平成一个列表逐条核查
    claims = [f["text"] for f in facts] + [t["text"] for t in todos]
    if claims:
        listing = "\n".join(f"[{i}] {c}" for i, c in enumerate(claims))
        critic_raw = openai_chat(
            key,
            CRITIC_MODEL,
            CRITIC_SYSTEM,
            f"原始笔记：\n{note}\n\n抽取的声明：\n{listing}",
        )
        unsupported = set()
        try:
            for i in json.loads(critic_raw).get("unsupported", []):
                if isinstance(i, int) and 0 <= i < len(claims):
                    unsupported.add(i)
        except (json.JSONDecodeError, TypeError):
            pass

        if unsupported:
            fact_count = len(facts)
            kept_facts = []
            for i, f in enumerate(facts):
                if i in unsupported:
                    dropped.append({"text": f["text"], "reason": "ungrounded"})
                else:
                    kept_facts.append(f)
            kept_todos = []
            for j, t in enumerate(todos):
                if (fact_count + j) in unsupported:
                    dropped.append({"text": t["text"], "reason": "ungrounded"})
                else:
                    kept_todos.append(t)
            facts, todos = kept_facts, kept_todos
        steps.append({"name": "ground_check", "model": CRITIC_MODEL, "dropped": len(dropped)})

    # 敏感信息二次过滤
    before = len(facts) + len(todos)
    facts = [f for f in facts if not SENSITIVE_RE.search(f["text"])]
    todos = [t for t in todos if not SENSITIVE_RE.search(t["text"])]
    blocked = before - len(facts) - len(todos)
    if blocked:
        steps.append({"name": "sensitive_filter", "blocked": blocked})

    return {"facts": facts, "todos": todos, "dropped": dropped, "steps": steps}


def main():
    payload = json.loads(base64.b64decode(PAYLOAD_B64).decode())
    note = str(payload.get("note", "")).strip()[:2000]
    key = payload.get("openaiKey", "")
    if not note:
        print(json.dumps({"facts": [], "todos": [], "dropped": [], "steps": []}))
        return
    if not key:
        print(json.dumps({"error": "NO_OPENAI_KEY"}))
        sys.exit(1)
    try:
        print(json.dumps(run(note, key), ensure_ascii=False))
    except urllib.error.HTTPError as exc:
        print(json.dumps({"error": "OPENAI_HTTP", "status": exc.code}))
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001 - 沙盒里跑，兜住一切并回报
        print(json.dumps({"error": "AGENT_FAILED", "detail": str(exc)[:300]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
