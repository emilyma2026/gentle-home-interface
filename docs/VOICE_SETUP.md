# Voice setup

The browser voice module lives in `public/app/voice.js`. It talks to two Supabase Edge Functions:

- `voice-stt`: accepts a recorded `audio` multipart field and returns `{ "text": "..." }`.
- `voice-tts`: accepts `{ "text": "..." }` and returns WAV audio.

The SiliconFlow API key is only used by the Edge Functions. Do not put it in `public/app` or commit it to the repository.

## Deploy

From the project root, after linking the Supabase project:

```bash
supabase secrets set SILICONFLOW_API_KEY=your-key
supabase functions deploy voice-stt
supabase functions deploy voice-tts
```

Optional function secrets:

```bash
supabase secrets set SILICONFLOW_MODEL_ASR=FunAudioLLM/SenseVoiceSmall
supabase secrets set SILICONFLOW_MODEL_TTS=FunAudioLLM/CosyVoice2-0.5B
supabase secrets set SILICONFLOW_TTS_VOICE=alex
```

The iframe route must keep `allow="microphone; geolocation"`, otherwise browser microphone permission is blocked.

## Browser behavior

- Profile setup and family questions use browser speech recognition when available.
- Call recording uses `MediaRecorder`, then sends the audio to `voice-stt`.
- TTS tries `voice-tts` first and falls back to `speechSynthesis` when the remote function is unavailable.
