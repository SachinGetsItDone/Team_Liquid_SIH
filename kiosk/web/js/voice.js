// Browser voice client: microphone capture (PCM WAV) + speech playback.
//
// The capture side records the microphone with MediaRecorder, decodes it to
// 16 kHz mono PCM WAV in the browser, and posts it to the kiosk API where the
// real Module A faster-whisper ASR runs. Stop is driven by a timer + an
// AnalyserNode (never solely by audio callbacks), so recording always ends.
// The playback side uses the kiosk server's Module A OS TTS and falls back to
// the browser's own speech synthesis if the server voice is unavailable.

const TARGET_RATE = 16000;

export function micSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    && (window.AudioContext || window.webkitAudioContext)
    && window.MediaRecorder);
}

function downsample(buffer, inRate, outRate) {
  if (outRate === inRate) return buffer;
  const ratio = inRate / outRate;
  const outLen = Math.round(buffer.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, buffer.length - 1);
    const frac = idx - lo;
    out[i] = buffer[lo] * (1 - frac) + buffer[hi] * frac;
  }
  return out;
}

function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);   // byte rate
  view.setUint16(32, 2, true);          // block align
  view.setUint16(34, 16, true);         // bits
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function toBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function pickMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

// Records one utterance. Resolves { b64, seconds } when the caller stops, or
// when trailing silence / the max duration is reached. Rejects with a clear
// message if the mic is unavailable or denied.
export function createRecorder({
  maxSeconds = 15, silenceMs = 1200, startTimeoutMs = 7000,
  threshold = 0.012, onLevel = null,
} = {}) {
  let stream, ctx, source, analyser, mr;
  const chunks = [];
  let stopped = false, sawVoice = false, lastVoiceAt = 0, startedAt = 0;
  let pollTimer = null, maxTimer = null, startTimer = null;
  let resolveFn, rejectFn;

  const teardown = () => {
    clearInterval(pollTimer); clearTimeout(maxTimer); clearTimeout(startTimer);
    try { source && source.disconnect(); } catch { /* noop */ }
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { ctx && ctx.close(); } catch { /* noop */ }
  };

  const finish = () => {                       // request stop; onstop finalizes
    if (stopped) return;
    stopped = true;
    try { if (mr && mr.state !== "inactive") mr.stop(); else finalize(); }
    catch { finalize(); }
  };

  const finalize = async () => {
    const mime = (mr && mr.mimeType) || pickMime() || "audio/webm";
    let samples = null;
    try {
      const blob = new Blob(chunks, { type: mime });
      const ab = await blob.arrayBuffer();
      const decoded = await decodeToBuffer(ab, mime);   // decode BEFORE closing ctx
      samples = downsample(decoded.getChannelData(0), decoded.sampleRate, TARGET_RATE);
    } catch (e) {
      teardown();
      rejectFn && rejectFn(new Error("could not decode recorded audio"));
      return;
    }
    teardown();
    resolveFn && resolveFn({
      b64: toBase64(encodeWav(samples, TARGET_RATE)),
      seconds: samples.length / TARGET_RATE,
    });
  };

  const decodeToBuffer = (arrayBuffer, mime) => {
    const actx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const data = arrayBuffer.slice(0);
    if (actx.decodeAudioData.length >= 2) {
      return new Promise((res, rej) => actx.decodeAudioData(data, res, rej));
    }
    return actx.decodeAudioData(data);
  };

  const start = () => new Promise((resolve, reject) => {
    resolveFn = resolve; rejectFn = reject;
    if (!micSupported()) { reject(new Error("microphone not supported in this browser")); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
      stream = s;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      source = ctx.createMediaStreamSource(s);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      mr = new MediaRecorder(s, pickMime() ? { mimeType: pickMime() } : undefined);
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => { finalize(); };
      mr.start(250);

      startedAt = performance.now();
      lastVoiceAt = startedAt;

      // Timer-driven detection: never depends on audio callbacks firing.
      pollTimer = setInterval(() => {
        if (stopped) return;
        const now = performance.now();
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        if (onLevel) onLevel(rms);
        if (rms >= threshold) { sawVoice = true; lastVoiceAt = now; }
        const since = (now - lastVoiceAt);
        if (sawVoice && since >= silenceMs) finish();
        else if (!sawVoice && now - startedAt >= startTimeoutMs) finish();
      }, 100);
      maxTimer = setTimeout(finish, maxSeconds * 1000);
    }).catch((e) => {
      teardown();
      reject(e);
    });
  });

  const stop = () => finish();

  return { start, stop };
}

// ---------------------------------------------------------------- playback

let currentAudio = null;

function playUrl(url) {
  return new Promise((resolve) => {
    if (currentAudio) { try { currentAudio.pause(); } catch { /* noop */ } currentAudio = null; }
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}

let cachedVoiceList = null;
function pickBrowserVoice(lang) {
  if (!window.speechSynthesis) return null;
  if (!cachedVoiceList) cachedVoiceList = window.speechSynthesis.getVoices() || [];
  const want = lang === "en" ? "en" : "hi";
  return cachedVoiceList.find((v) => (v.lang || "").toLowerCase().startsWith(want)) || null;
}

// Prefer the kiosk server's Module A TTS; fall back to browser synthesis.
export async function speakText(text, lang = "hi", { useServer = true } = {}) {
  if (!text) return;
  if (useServer) {
    try {
      const res = await fetch("/api/speech/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      if (res.ok) {
        const blob = await res.blob();
        await playUrl(URL.createObjectURL(blob));
        return "server";
      }
    } catch { /* fall through to browser voice */ }
  }
  if (window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "en" ? "en-IN" : "hi-IN";
    const v = pickBrowserVoice(lang);
    if (v) u.voice = v;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return "browser";
  }
  return null;
}

export function stopSpeaking() {
  if (currentAudio) { try { currentAudio.pause(); } catch { /* noop */ } currentAudio = null; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}
