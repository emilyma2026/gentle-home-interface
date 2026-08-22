(function (window) {
  "use strict";

  var recorder = null;
  var stream = null;
  var stopPromise = null;
  var resolveStop = null;
  var rejectStop = null;
  var activeRecognition = null;
  var activeAudio = null;
  var activeAudioUrl = null;

  function makeError(message, code) {
    var error = new Error(message);
    error.code = code || "voice_error";
    return error;
  }

  function recognitionConstructor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function locale(lang) {
    return lang === "en" || lang === "en-US" ? "en-US" : "zh-CN";
  }

  function apiLanguage(lang) {
    return locale(lang).indexOf("en") === 0 ? "en" : "zh";
  }

  function mimeType() {
    var types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
    ];
    for (var i = 0; i < types.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return "audio/webm";
  }

  function extension(type) {
    type = type || "audio/webm";
    if (type.indexOf("mp4") >= 0 || type.indexOf("m4a") >= 0) return "mp4";
    if (type.indexOf("mpeg") >= 0 || type.indexOf("mp3") >= 0) return "mp3";
    if (type.indexOf("ogg") >= 0) return "ogg";
    if (type.indexOf("wav") >= 0) return "wav";
    return "webm";
  }

  function stopTracks() {
    if (!stream) return;
    stream.getTracks().forEach(function (track) { track.stop(); });
    stream = null;
  }

  async function startRecording(options) {
    options = options || {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      throw makeError("当前浏览器不支持麦克风录音", "unsupported");
    }
    if (recorder && recorder.state !== "inactive") {
      throw makeError("已有录音正在进行", "already_recording");
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    var currentStream = stream;
    var selectedMime = mimeType();
    try {
      recorder = new MediaRecorder(currentStream, { mimeType: selectedMime });
    } catch (_error) {
      recorder = new MediaRecorder(currentStream);
    }

    var chunks = [];
    stopPromise = new Promise(function (resolve, reject) {
      resolveStop = resolve;
      rejectStop = reject;
    });
    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = function () {
      if (rejectStop) rejectStop(makeError("录音失败，请重试", "recording_failed"));
    };
    recorder.onstop = function () {
      var blob = new Blob(chunks, { type: recorder.mimeType || selectedMime });
      stopTracks();
      if (resolveStop) resolveStop(blob);
      resolveStop = null;
      rejectStop = null;
      stopPromise = null;
      recorder = null;
    };
    recorder.start(100);
    if (options.onStatus) options.onStatus("recording");

    setTimeout(function () {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    }, options.maxDurationMs || 30000);
  }

  function stopRecording() {
    if (!recorder || recorder.state === "inactive") {
      return Promise.reject(makeError("当前没有正在进行的录音", "not_recording"));
    }
    var result = stopPromise;
    recorder.stop();
    return result;
  }

  function serviceUrl(kind) {
    var config = window.SUPABASE_CONFIG;
    if (config && config.url) {
      return config.url.replace(/\/$/, "") + "/functions/v1/voice-" + kind;
    }
    return "/api/ai/" + kind;
  }

  async function authHeaders() {
    var config = window.SUPABASE_CONFIG || {};
    var token = config.publishableKey || "";
    if (window.SupabaseClient && window.SupabaseClient.auth) {
      try {
        var sessionResult = await window.SupabaseClient.auth.getSession();
        token = sessionResult.data && sessionResult.data.session
          ? sessionResult.data.session.access_token
          : token;
      } catch (_error) { /* publishable key remains the best-effort fallback */ }
    }
    var headers = {};
    if (config.publishableKey) headers.apikey = config.publishableKey;
    if (token) headers.Authorization = "Bearer " + token;
    return headers;
  }

  async function transcribe(blob, lang) {
    if (!blob || !blob.size) throw makeError("没有录到声音，请重试", "empty_recording");
    var formData = new FormData();
    formData.append("audio", blob, "recording." + extension(blob.type));
    formData.append("language", apiLanguage(lang));
    var headers = await authHeaders();
    var response = await fetch(serviceUrl("stt"), { method: "POST", headers: headers, body: formData });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw makeError(payload.error || "语音识别服务暂时不可用", "stt_failed");
    var text = payload.text || payload.transcript || "";
    if (!String(text).trim()) throw makeError("没有识别到清晰的语音", "empty_transcript");
    return String(text).trim();
  }

  function startRecognition(options) {
    var Recognition = recognitionConstructor();
    if (!Recognition) return null;
    var recognition = new Recognition();
    var finalText = "";
    var settled = false;
    var resolveResult;
    var rejectResult;
    var result = new Promise(function (resolve, reject) {
      resolveResult = resolve;
      rejectResult = reject;
    });

    function finish() {
      if (settled) return;
      settled = true;
      activeRecognition = null;
      if (finalText.trim()) resolveResult(finalText.trim());
      else rejectResult(makeError("没有识别到清晰的语音", "empty_transcript"));
    }

    recognition.lang = locale(options.lang);
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = function () { if (options.onStatus) options.onStatus("listening"); };
    recognition.onresult = function (event) {
      var interim = "";
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += text;
        else interim += text;
      }
      if (options.onInterim) options.onInterim((finalText + interim).trim());
    };
    recognition.onerror = function (event) {
      if (settled) return;
      settled = true;
      activeRecognition = null;
      rejectResult(makeError("语音识别失败：" + (event.error || "未知错误"), event.error || "recognition_failed"));
    };
    recognition.onend = finish;
    try {
      recognition.start();
      activeRecognition = recognition;
    } catch (_error) {
      rejectResult(makeError("无法开始语音识别，请重试", "recognition_start_failed"));
    }
    return {
      mode: "recognition",
      result: result,
      stop: function () {
        if (activeRecognition === recognition) {
          try { recognition.stop(); } catch (_error) { finish(); }
        }
        return result;
      },
    };
  }

  async function startRecordedInput(options) {
    await startRecording(options);
    var settled = false;
    var resolveResult;
    var rejectResult;
    var result = new Promise(function (resolve, reject) {
      resolveResult = resolve;
      rejectResult = reject;
    });
    return {
      mode: "recording",
      result: result,
      stop: async function () {
        if (settled) return result;
        settled = true;
        try {
          if (options.onStatus) options.onStatus("transcribing");
          var text = await transcribe(await stopRecording(), options.lang);
          resolveResult(text);
        } catch (error) {
          rejectResult(error);
        }
        return result;
      },
    };
  }

  async function startInput(options) {
    options = options || {};
    if (options.forceRecording) return startRecordedInput(options);
    return startRecognition(options) || startRecordedInput(options);
  }

  function stopSpeaking() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (activeAudio) { activeAudio.pause(); activeAudio.src = ""; activeAudio = null; }
    if (activeAudioUrl) { URL.revokeObjectURL(activeAudioUrl); activeAudioUrl = null; }
  }

  function browserSpeak(text, lang) {
    return new Promise(function (resolve, reject) {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        reject(makeError("当前浏览器不支持语音播报", "tts_unsupported"));
        return;
      }
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = locale(lang);
      utterance.rate = utterance.lang === "zh-CN" ? 0.78 : 0.82;
      utterance.volume = 1;
      var voices = window.speechSynthesis.getVoices();
      var voice = voices.find(function (item) {
        return item.lang && item.lang.toLowerCase().indexOf(utterance.lang.slice(0, 2).toLowerCase()) === 0;
      });
      if (voice) utterance.voice = voice;
      utterance.onend = resolve;
      utterance.onerror = function () { reject(makeError("语音播报失败", "tts_failed")); };
      window.speechSynthesis.speak(utterance);
    });
  }

  async function speak(text, options) {
    options = options || {};
    text = String(text || "").trim();
    if (!text) return;
    stopSpeaking();
    try {
      var headers = await authHeaders();
      headers["Content-Type"] = "application/json";
      var response = await fetch(serviceUrl("tts"), {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ text: text, language: apiLanguage(options.lang) }),
      });
      if (!response.ok) throw makeError("远程语音服务不可用", "tts_failed");
      var blob = await response.blob();
      if (!blob.size) throw makeError("远程语音为空", "tts_empty");
      activeAudioUrl = URL.createObjectURL(blob);
      activeAudio = new Audio(activeAudioUrl);
      activeAudio.onended = function () { stopSpeaking(); };
      await activeAudio.play();
    } catch (_error) {
      stopSpeaking();
      await browserSpeak(text, options.lang).catch(function () {});
    }
  }

  window.Voice = {
    startRecording: startRecording,
    stopRecording: stopRecording,
    transcribe: transcribe,
    startInput: startInput,
    speak: speak,
    stopSpeaking: stopSpeaking,
    supportsRecognition: !!recognitionConstructor(),
    supportsRecording: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder),
  };
})(window);
