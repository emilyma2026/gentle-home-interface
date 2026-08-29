const DEFAULTS = {
  gemini: "gemini-3.6-flash",
  openai: "gpt-4o-mini",
};

const MAX_BODY_LENGTH = 200_000;

function envValue(env, names) {
  for (const name of names) {
    const value = env && env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function pickProvider(env = {}) {
  const gemini = envValue(env, ["GEMINI_API_KEY", "VITE_GEMINI_API_KEY", "GOOGLE_API_KEY"]);
  if (gemini) {
    return {
      name: "gemini",
      key: gemini,
      model: envValue(env, ["AI_MODEL"]) || DEFAULTS.gemini,
    };
  }
  const openai = envValue(env, ["OPENAI_API_KEY"]);
  if (openai) {
    return {
      name: "openai",
      key: openai,
      model: envValue(env, ["AI_MODEL"]) || DEFAULTS.openai,
    };
  }
  return null;
}

async function callGemini(provider, { system, user, json }, fetchImpl) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(provider.model) +
    ":generateContent";
  const body = {
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: json
      ? { responseMimeType: "application/json", temperature: 0.2 }
      : { temperature: 0.4 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": provider.key },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("gemini " + response.status + " " + (await response.text()).slice(0, 300));
  }
  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim();
}

async function callOpenAI(provider, { system, user, json }, fetchImpl) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + provider.key,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: json ? 0.2 : 0.4,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error("openai " + response.status + " " + (await response.text()).slice(0, 300));
  }
  const data = await response.json();
  return (data?.choices?.[0]?.message?.content || "").trim();
}

export async function runAI({ system, user, json }, env = {}, fetchImpl = fetch) {
  const provider = pickProvider(env);
  if (!provider) {
    const error = new Error("NO_AI_KEY");
    error.code = "NO_AI_KEY";
    throw error;
  }
  const text =
    provider.name === "gemini"
      ? await callGemini(provider, { system, user, json }, fetchImpl)
      : await callOpenAI(provider, { system, user, json }, fetchImpl);
  return { provider: provider.name, model: provider.model, text };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function authConfig(env) {
  const url = envValue(env, ["SUPABASE_URL", "VITE_SUPABASE_URL"]).replace(/\/$/, "");
  const publishableKey = envValue(env, [
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
  ]);
  return url && publishableKey ? { url, publishableKey } : null;
}

async function hasValidSupabaseSession(token, env, fetchImpl) {
  const config = authConfig(env);
  if (!config) return { configured: false, valid: false };
  const response = await fetchImpl(config.url + "/auth/v1/user", {
    method: "GET",
    headers: {
      apikey: config.publishableKey,
      authorization: "Bearer " + token,
    },
  });
  return { configured: true, valid: response.ok };
}

export async function handleAIRequest(request, env = {}, fetchImpl = fetch) {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" }, { allow: "POST" });
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return jsonResponse(403, { error: "ORIGIN_NOT_ALLOWED" });
      }
    } catch {
      return jsonResponse(403, { error: "ORIGIN_NOT_ALLOWED" });
    }
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_LENGTH) return jsonResponse(413, { error: "REQUEST_TOO_LARGE" });
    body = JSON.parse(raw || "{}");
  } catch {
    return jsonResponse(400, { error: "INVALID_JSON" });
  }
  if (typeof body.user !== "string" || !body.user.trim()) {
    return jsonResponse(400, { error: "EMPTY_PROMPT" });
  }

  const authorization = request.headers.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse(401, { error: "AUTH_REQUIRED" });

  try {
    const auth = await hasValidSupabaseSession(tokenMatch[1], env, fetchImpl);
    if (!auth.configured) return jsonResponse(503, { error: "AI_AUTH_NOT_CONFIGURED" });
    if (!auth.valid) return jsonResponse(401, { error: "INVALID_SESSION" });

    const output = await runAI(
      {
        system: typeof body.system === "string" ? body.system.slice(0, 4_000) : "",
        user: body.user.trim().slice(0, 12_000),
        json: Boolean(body.json),
      },
      env,
      fetchImpl,
    );
    return jsonResponse(200, output);
  } catch (error) {
    if (error?.code !== "NO_AI_KEY") console.error("[AI API]", error);
    return jsonResponse(error?.code === "NO_AI_KEY" ? 503 : 502, {
      error: error?.code || "AI_FAILED",
    });
  }
}
