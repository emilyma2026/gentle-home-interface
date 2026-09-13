(function (global) {
  global.createLiveVoice = function (options) {
    var current = null, status = { status: 'idle' }, rows = [], seen = new Set(), revision = 0;
    function state(value) { status = value; if (options.onState) options.onState(value); }
    function captureOff(c) { if (c.stream) c.stream.getTracks().forEach(function (t) { t.stop(); }); if (c.audio) c.audio.pause(); }
    function cleanup(c) { if (current === c) current = null; captureOff(c); clearTimeout(c.timer); clearTimeout(c.delegateTimer); if (c.channel) c.channel.close(); if (c.peer) c.peer.close(); }
    function send(c, value) { if (c.channel && c.channel.readyState === 'open') { c.channel.send(JSON.stringify(value)); return true; } return false; }
    function append(c, content, id, type) { return send(c, { type: type || 'session.commentary.append', delegation_id: id || null, content: String(content).slice(0, 700) }); }
    function fail(c, error) { if (current !== c) return; cleanup(c); state({ status: 'error', error: error || 'LIVE_UNAVAILABLE' }); }
    async function delegate(c, id) {
      var at = revision;
      var valid = function () { return current === c && !c.stopping && c.delegation === id && revision === at; };
      try {
        var result = options.onDelegate ? await options.onDelegate({ delegationId: id, transcript: rows.slice(-60), isCurrent: valid }) : 'Family lookup is unavailable. Please try again.';
        if (valid() && result) append(c, result, id);
        else if (current === c && !c.stopping && c.delegation === id && at !== revision) c.delegateTimer = setTimeout(function () { delegate(c, id); }, 350);
      } catch (_) { if (valid()) append(c, 'The family lookup or save failed. Tell the user it was not sent and ask them to try again.', id); }
    }
    function event(c, e) {
      if (current !== c) return;
      var v; try { v = JSON.parse(e.data); } catch (_) { return; }
      if (v.event_id && seen.has(v.event_id)) return;
      if (v.event_id) seen.add(v.event_id);
      if (v.type === 'session.started') {
        c.ready = true; clearTimeout(c.timer);
        if (c.stopping) { send(c, { type: 'session.close' }); return; }
        state({ status: 'connected' });
        append(c, 'Greet the user briefly now as an AI companion, then listen patiently. Use ' + (options.getLanguage() === 'en' ? 'English.' : 'Mandarin Chinese.'), null, 'session.instructions.append');
        c.timer = setTimeout(stop, 10 * 60 * 1000);
      } else if (v.type === 'session.closed') { cleanup(c); state({ status: 'idle' }); }
      else if (v.type === 'error' || v.type === 'session.error') fail(c, 'LIVE_UNAVAILABLE');
      else if (!c.stopping && /session\.(input|output)_transcript\.delta/.test(v.type) && typeof v.delta === 'string') {
        var role = v.type.indexOf('input') >= 0 ? 'user' : 'assistant';
        rows.push({ role: role, text: v.delta, start_ms: v.start_ms, end_ms: v.end_ms });
        if (role === 'user') revision++;
        if (options.onTranscript) options.onTranscript(rows.slice());
      } else if (!c.stopping && v.type === 'session.delegation.created' && v.delegation && v.delegation.target === 'client') {
        c.delegation = v.delegation.id; clearTimeout(c.delegateTimer);
        c.delegateTimer = setTimeout(function () { delegate(c, v.delegation.id); }, 350);
      }
    }
    async function start() {
      if (current) return;
      var c = {}; current = c; rows = []; seen = new Set(); revision = 0;
      state({ status: 'connecting' });
      try {
        if (!navigator.mediaDevices || typeof RTCPeerConnection === 'undefined') throw new Error('LIVE_UNSUPPORTED');
        c.audio = new Audio(); c.audio.autoplay = true;
        c.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        if (current !== c) { captureOff(c); return; }
        c.peer = new RTCPeerConnection();
        c.stream.getAudioTracks().forEach(function (track) { c.peer.addTrack(track, c.stream); });
        c.peer.addEventListener('track', function (e) { c.audio.srcObject = e.streams[0] || new MediaStream([e.track]); c.audio.play().catch(function () { if (current === c) state({ status: status.status, audioBlocked: true }); }); });
        c.peer.addEventListener('connectionstatechange', function () { if (c.peer.connectionState === 'failed' || c.peer.connectionState === 'disconnected') fail(c, 'LIVE_DISCONNECTED'); });
        c.channel = c.peer.createDataChannel('oai-events');
        c.channel.addEventListener('message', function (e) { event(c, e); });
        c.channel.addEventListener('close', function () { if (current === c && !c.stopping) fail(c, 'LIVE_DISCONNECTED'); });
        await c.peer.setLocalDescription(await c.peer.createOffer());
        if (c.peer.iceGatheringState !== 'complete') await new Promise(function (resolve, reject) {
          var timer = setTimeout(function () { reject(new Error('LIVE_TIMEOUT')); }, 10000);
          c.peer.addEventListener('icegatheringstatechange', function () { if (c.peer.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); } });
        });
        var token = await options.getToken();
        if (current !== c) return;
        if (!token) throw new Error('AUTH_REQUIRED');
        var response = await fetch('/api/live/session', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ familyId: options.getFamilyId(), lang: options.getLanguage(), sdp: c.peer.localDescription.sdp }), signal: AbortSignal.timeout(35000) });
        var result = await response.json();
        if (current !== c) return;
        if (!response.ok) throw new Error(result.error || 'LIVE_UNAVAILABLE');
        await c.peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
        if (current === c && !c.ready) c.timer = setTimeout(function () { fail(c, 'LIVE_TIMEOUT'); }, 30000);
      } catch (error) { fail(c, error.name === 'NotAllowedError' ? 'LIVE_MIC_DENIED' : error.message); }
    }
    function stop() {
      var c = current; if (!c) return;
      c.stopping = true; captureOff(c); clearTimeout(c.timer); clearTimeout(c.delegateTimer);
      if (c.ready) { send(c, { type: 'session.close' }); state({ status: 'stopping' }); c.timer = setTimeout(function () { if (current === c) { cleanup(c); state({ status: 'idle' }); } }, 3000); }
      else { cleanup(c); state({ status: 'idle' }); }
    }
    return { start: start, stop: stop, state: function () { return status; }, transcript: function () { return rows.slice(); },
      commentary: function (text) { return !!(current && current.ready && !current.stopping && append(current, text, null)); },
      play: async function () { if (current && current.audio) { await current.audio.play(); state({ status: status.status }); } },
      dispose: function () { if (current) { send(current, { type: 'session.close' }); cleanup(current); } state({ status: 'idle' }); }
    };
  };
})(window);
