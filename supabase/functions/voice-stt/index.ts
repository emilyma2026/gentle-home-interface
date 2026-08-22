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
    const input = await request.formData();
    const audio = input.get("audio");
    const language = input.get("language");
    if (!(audio instanceof File)) return json({ error: "No audio file provided" }, 400);
    if (audio.size > 25 * 1024 * 1024) return json({ error: "Audio file too large" }, 400);

    const form = new FormData();
    form.append("model", Deno.env.get("SILICONFLOW_MODEL_ASR") || "FunAudioLLM/SenseVoiceSmall");
    form.append("file", audio, audio.name || "recording.webm");
    if (language === "zh" || language === "en") form.append("language", String(language));

    const response = await fetch("https://api.siliconflow.cn/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: payload.error?.message || payload.message || "STT request failed" }, 502);
    return json({ text: payload.text || "" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
