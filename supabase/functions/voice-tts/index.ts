const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("SILICONFLOW_API_KEY");
  if (!apiKey) return json({ error: "SILICONFLOW_API_KEY is not configured" }, 503);

  try {
    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 1000) return json({ error: "Text must contain 1-1000 characters" }, 400);

    const model = Deno.env.get("SILICONFLOW_MODEL_TTS") || "FunAudioLLM/CosyVoice2-0.5B";
    let voice = Deno.env.get("SILICONFLOW_TTS_VOICE") || "alex";
    if (!voice.includes(":")) voice = `${model}:${voice}`;
    const response = await fetch("https://api.siliconflow.cn/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text, voice, response_format: "wav", speed: 0.82, stream: false }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return json({ error: payload.error?.message || payload.message || "TTS request failed" }, 502);
    }
    return new Response(await response.arrayBuffer(), {
      headers: { ...corsHeaders, "Content-Type": response.headers.get("Content-Type") || "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
