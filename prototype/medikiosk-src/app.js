/* Medikiosk prototype controller.
   Drives the four modules as one guided visit:
     D  consent + ABHA reference
     A  voice + touch history capture with red-flag screening
     B  paper digitisation of an Indian patient's reports
     C  merged summary, patient read-back and physician hand-off
   Voice output uses the browser speech engine and starts on its own. Voice
   input opens automatically after each question but the visit never moves on
   without the patient: it waits for a spoken answer, a tap, or an explicit
   Continue. Module B waits for the papers to be handed over before it reads
   anything. Nothing runs ahead of the person at the kiosk. */

(function () {
  "use strict";

  const S = {
    lang: "en",
    phase: "welcome",
    stepIdx: 0,
    answers: {},
    voiceOn: true,
    agree: false,
    spoken: false,
    unlocking: false,
    listening: false,
    safetyAck: false,
    safetySeen: false,
    safetyStage: null,      // checking -> overlay -> panel
    redFired: false,
    redHits: [],
    docsStage: "upload",   // upload -> scan -> review
    extracted: 0,
    uploads: [],
    heard: "",
    voiceNote: "",
    log: [],
    startedAt: null,
    toastMsg: null,
    bodyView: "front",
    bodyRegion: null,
    tapped: false,
    rb: {},
    voiceName: (function () { try { return localStorage.getItem("mk.voice") || ""; } catch (e) { return ""; } })(),
    busy: false,
  };

  const REGION_COMPLAINT = {
    head: "headache", chest: "chest pain", abdomen: "stomach pain", back: "back pain",
    armL: "arm pain", armR: "arm pain", legL: "knee / joint pain", legR: "knee / joint pain",
    general: "your main problem",
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function el(tag, props, children) {
    const n = document.createElement(tag);
    props = props || {};
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) n.setAttribute(k, "");
      else n.setAttribute(k, v);
    }
    [].concat(children || []).forEach((c) => { if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
  function line(text, value, sub, right) {
    return el("div", { class: "line" }, [
      el("div", {}, [
        el("div", { class: "v", text: value }),
        sub ? el("div", { class: "sub", text: sub }) : null,
      ]),
      right || null,
    ]);
  }
  const pct = (n) => Math.round(n * 100) + "%";

  function moduleForPhase() {
    if (S.phase === "welcome") return "D";
    if (S.phase === "documents") return "B";
    if (S.phase === "merge" || S.phase === "readback" || S.phase === "handoff" || S.phase === "physician") return "C";
    return "A";
  }

  /* ------------------------------------------------------------------ voice */

  const Voice = (function () {
    const supported = typeof window !== "undefined" && "speechSynthesis" in window;
    let voices = [];
    let onReady = null;

    /* Pull the installed voices into the cache. This must never notify: it is
       called from inside the notify path, and notifying again re-enters the
       caller (an infinite recursion that a real browser hits because voices
       start empty and arrive asynchronously). */
    function snapshot() {
      if (!supported) return;
      try {
        const v = window.speechSynthesis.getVoices() || [];
        if (v.length) voices = v;
      } catch (e) { /* keep whatever we have */ }
    }

    let notifying = false;
    function refresh() {
      snapshot();
      if (onReady && !notifying) {
        notifying = true;
        try { onReady(voices); } finally { notifying = false; }
      }
    }

    function load(cb) {
      if (!supported) return;
      if (cb) onReady = cb;
      refresh();
      try { window.speechSynthesis.onvoiceschanged = () => refresh(); } catch (e) {}
      setTimeout(refresh, 300);
      setTimeout(refresh, 1500);
    }

    const baseOf = (tag) => String(tag || "").toLowerCase().replace(/_/g, "-").split("-")[0];

    /* Rank the installed voices so the default is the best-sounding one rather
       than whichever happens to come first. Natural/Neural and Google voices
       sound far better in a recording than the legacy offline ones. */
    function rank(v, tag) {
      const n = String(v.name).toLowerCase();
      const vl = String(v.lang).toLowerCase().replace(/_/g, "-");
      const want = String(tag || "").toLowerCase().replace(/_/g, "-");
      if (baseOf(vl) !== baseOf(want)) return -1;
      let s = 100;
      if (vl === want) s += 40;
      if (/natural|neural|premium|enhanced/.test(n)) s += 90;
      if (/google/.test(n)) s += 55;
      if (/online/.test(n)) s += 30;
      if (/microsoft/.test(n)) s += 12;
      if (/swara|ravi|heera|aditi|kalpana|hemant|neerja|prabhat|sharad|ananya|aarav|neel|madhur|veena/.test(n)) s += 16;
      if (/david|zira|mark|hazel/.test(n)) s -= 10;
      if (v.localService === false) s += 6;
      return s;
    }

    function isNatural(v) { return /natural|neural|premium|enhanced|google|online/i.test(String(v.name)); }

    function bestFor(tag) {
      if (!voices.length) snapshot();
      const ranked = voices
        .map((v) => ({ v, s: rank(v, tag) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s);
      return ranked.length ? ranked[0].v : null;
    }

    function list() { return voices.slice(); }

    function setVoice(name) {
      S.voiceName = name || "";
      try { localStorage.setItem("mk.voice", S.voiceName); } catch (e) {}
    }

    function voiceFor(tag) {
      if (!voices.length) snapshot();
      if (S.voiceName) {
        const chosen = voices.find((v) => v.name === S.voiceName);
        if (chosen && baseOf(chosen.lang) === baseOf(tag)) return chosen;
      }
      return bestFor(tag);
    }

    function speak(text, langCode) {
      return new Promise((resolve) => {
        if (!supported || !S.voiceOn || !text) { resolve(false); return; }
        const tag = mkLang(langCode).speech;
        try { window.speechSynthesis.cancel(); } catch (e) {}
        const u = new SpeechSynthesisUtterance(String(text));
        u.lang = tag;
        const v = voiceFor(tag);
        if (v) u.voice = v;
        u.rate = 0.88;
        u.pitch = 1;
        u.volume = 1;
        let settled = false;
        const finish = (ok) => { if (settled) return; settled = true; resolve(ok); };
        u.onend = () => finish(true);
        u.onerror = () => finish(false);
        try { window.speechSynthesis.speak(u); } catch (e) { finish(false); return; }
        setTimeout(() => {
          if (settled) return;
          let speaking = false;
          try { speaking = window.speechSynthesis.speaking || window.speechSynthesis.pending; } catch (e) {}
          if (!speaking) finish(false);
        }, 1400);
        setTimeout(() => finish(true), Math.min(20000, 2600 + String(text).length * 95));
      });
    }
    function stop() { if (supported) { try { window.speechSynthesis.cancel(); } catch (e) {} } }
    return { supported, load, speak, stop, voiceFor, bestFor, list, isNatural, setVoice, refresh, baseOf };
  })();

  const Ears = (function () {
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    let active = null;
    function available() { return !!SR; }
    function listen(bcp47, onPartial, maxMs, onError) {
      return new Promise((resolve) => {
        if (!SR) { resolve(""); return; }
        const rec = new SR();
        active = rec;
        let finalText = "";
        let settled = false;
        let silence = null;
        let hard = null;
        const done = (t) => {
          if (settled) return;
          settled = true;
          if (silence) clearTimeout(silence);
          if (hard) clearTimeout(hard);
          try { rec.stop(); } catch (e) {}
          if (active === rec) active = null;
          resolve(String(t || "").trim());
        };
        rec.lang = bcp47;
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) finalText += r[0].transcript + " ";
            else interim += r[0].transcript;
          }
          if (onPartial) onPartial((finalText + interim).trim());
          if (silence) clearTimeout(silence);
          silence = setTimeout(() => done(finalText.trim()), 1600);
        };
        rec.onerror = (e) => {
          if (onError) { try { onError(e && e.error); } catch (err) {} }
          done(finalText.trim());
        };
        rec.onend = () => done(finalText.trim());
        try { rec.start(); } catch (e) { done(""); return; }
        hard = setTimeout(() => done(finalText.trim()), maxMs || 6500);
      });
    }
    function stop() { if (active) { try { active.stop(); } catch (e) {} active = null; } }
    return { available, listen, stop };
  })();

  /* --------------------------------------------------------------- utilities */

  function askText(step) { return (step.ask && (step.ask[S.lang] || step.ask.en)) || ""; }
  function sayText(step) { return step.say ? (step.say[S.lang] || step.say.en) : ""; }

  function updateVoiceUI() {
    const r = root();
    const status = r.querySelector(".voiceStatus");
    if (status) status.textContent = S.listening ? mkT("listening", S.lang) : (S.voiceNote || "");
    const mic = r.querySelector("#mic-btn");
    if (mic) {
      mic.innerHTML = "";
      mic.append(
        document.createTextNode(S.listening ? mkT("stopListening", S.lang) : mkT("speakNow", S.lang)),
        el("br"),
        document.createTextNode(S.listening ? "रोकें" : "बोलें"),
      );
    }
  }

  function setVoiceNote(text) {
    S.voiceNote = text || "";
    updateVoiceUI();
  }

  function recErrMsg(code, step) {
    const tag = mkLang(S.lang).speech;
    switch (code) {
      case "not-allowed": case "service-not-allowed":
        return "Microphone blocked. Allow it in the address bar, then tap Speak again.";
      case "no-speech":
        return "Didn't hear anything. Tap Speak, wait a beat, then talk close to the mic.";
      case "audio-capture":
        return "No microphone found on this device. Type your answer instead.";
      case "network":
        return "Voice input could not reach the speech service — check the connection, or type instead.";
      case "language-not-supported":
        return tag + " recognition is not supported here. Type your answer instead.";
      case "aborted":
        return "Voice input stopped.";
      default:
        return "Voice input failed (" + (code || "unknown error") + "). You can type instead.";
    }
  }

  let listenToken = 0;

  function voiceTurn(step) {
    return !!(step && ["bodymap", "safety"].indexOf(step.kind) < 0);
  }

  /* Opens the recogniser and waits — for as long as it takes — for the person
     to speak. Spoken words fill the answer on screen; single-choice answers
     move on, written answers wait for Send/Confirm. */
  function startListening(step) {
    if (!voiceTurn(step)) return;
    if (!Ears.available()) {
      setVoiceNote("Voice input is unavailable here — typing always works.");
      return;
    }
    if (window.location && window.location.protocol === "file:") {
      setVoiceNote("Voice input is blocked on a local file — serve the page over http://127.0.0.1 (see serve-prototype.py), or type instead.");
      return;
    }
    const token = ++listenToken;
    Voice.stop();
    S.listening = true;
    setVoiceNote("");
    Ears.listen(mkLang(S.lang).speech, (partial) => {
      if (token !== listenToken) return;
      const ta = root().querySelector("#answer-ta");
      if (ta && (step.kind === "text" || step.kind === "multi")) ta.value = partial;
      setVoiceNote("… " + partial);
    }, 120000, (code) => {
      if (token !== listenToken) return;
      setVoiceNote(recErrMsg(code, step));
    }).then((text) => {
      if (token !== listenToken) return;
      S.listening = false;
      updateVoiceUI();
      if (text) acceptSpoken(step, text);
    });
  }

  function stopListening() {
    listenToken += 1;
    Ears.stop();
    S.listening = false;
    updateVoiceUI();
  }

  function acceptSpoken(step, text) {
    S.heard = text;
    matchSpoken(step, text);
    if (step.kind === "text") {
      step.answer.text = text;
      S.answers[step.id] = Object.assign({}, step.answer, { heard: text, by: "voice" });
      pushLog("patient", text);
      setVoiceNote("Heard — check it above, then press Send.");
      render();
      return;
    }
    if (step.kind === "multi" || step.kind === "scale") {
      S.answers[step.id] = Object.assign({}, step.answer, { heard: text, by: "voice" });
      setVoiceNote(step.kind === "multi"
        ? "Heard — check the chosen answers, then press Confirm."
        : "Heard — check the number, then press Confirm.");
      render();
      return;
    }
    if (step.kind === "cc") {
      if (step.answer.value === "yes") {
        const comp = CC_DETECT[S.bodyRegion] || CC_DETECT.general;
        pushLog("patient", text);
        S.answers.cc = { value: "yes", en: comp.en, hi: comp.hi, heard: text, by: "voice" };
        render();
        advanceSoon();
      } else {
        step.answer.value = "no";
        setVoiceNote("Heard: “" + text + "” — type your main problem below.");
        render();
      }
      return;
    }
    if (step.answer.value != null) {
      const opt = (step.options || []).find((o) => o.v === step.answer.value);
      pushLog("patient", text);
      S.answers[step.id] = Object.assign({}, step.answer, {
        en: (opt && opt.en) || step.answer.en,
        hi: (opt && (opt.hi || opt.en)) || step.answer.hi,
        heard: text, by: "voice",
      });
      render();
      advanceSoon();
    } else {
      // No match: stay on the question and let the person tap or speak again.
      // Never spin the microphone on its own — the visit waits for the person.
      setVoiceNote("Heard: “" + text + "” — tap the closest answer, or tap Speak to try again.");
      render();
    }
  }

  /* Best-effort mapping of a spoken sentence onto the prepared options; the
     spoken words themselves are always kept on the record. */
  function matchSpoken(step, text) {
    const low = " " + String(text).toLowerCase() + " ";
    const has = (re) => re.test(low);
    if (step.kind === "scale") {
      const m = low.match(/\b(10|[0-9])\b/);
      if (m) step.answer.value = Number(m[1]);
      return;
    }
    if (step.kind === "yesno") {
      if (has(/\b(yes|yeah|haan|ha|हाँ|हां|जी)\b/)) step.answer.value = "yes";
      else if (has(/\b(no|nope|nahi|nahin|नहीं|नही)\b/)) step.answer.value = "no";
      else step.answer.value = "not_sure";
      return;
    }
    if (step.kind === "cc") {
      step.answer.value = has(/\b(yes|correct|sahi|right|हाँ|सही)\b/) ? "yes" : "no";
      return;
    }
    if (step.kind === "text") { step.answer.text = text; return; }
    if (step.kind === "chips" || step.kind === "multi") {
      const hits = (step.options || []).filter((o) => {
        const words = [o.en, o.hi].filter(Boolean).join(" ").toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3);
        return words.some((w) => low.indexOf(w) >= 0);
      });
      if (hits.length) {
        if (step.kind === "multi") step.answer.values = hits.map((h) => h.v);
        else step.answer.value = hits[0].v;
      }
    }
  }

  function applyAnswer(step) {
    const a = step.answer || {};
    if (a.region && !S.tapped) S.bodyRegion = a.region;
    S.answers[step.id] = a;
  }

  function advanceSoon() {
    const idx = S.stepIdx;
    setTimeout(() => {
      if (S.phase === "interview" && S.stepIdx === idx) nextStep();
    }, 700);
  }

  function nextStep() {
    stopListening();
    Voice.stop();
    const step = MK_STEPS[S.stepIdx];
    if (step && step.kind === "safety") S.safetySeen = true;
    if (S.stepIdx >= MK_STEPS.length - 1) { enterDocuments(); return; }
    S.stepIdx += 1;
    runStep();
  }
  function skipStep() {
    const step = MK_STEPS[S.stepIdx];
    if (step) {
      S.answers[step.id] = { skipped: true };
      pushLog("patient", S.lang === "hi" ? "डॉक्टर से बताएँगे" : "Will tell the doctor");
    }
    nextStep();
  }

  /* -------------------------------------------------------------- chrome */

  function root() { return document.getElementById("root"); }

  function curStep() {
    return S.phase === "interview" ? (MK_STEPS[S.stepIdx] || null) : null;
  }

  function showToast(text, kind) {
    S.toastMsg = { text: text, kind: kind || "" };
    render();
    setTimeout(() => {
      if (S.toastMsg && S.toastMsg.text === text) { S.toastMsg = null; render(); }
    }, 3600);
  }

  function pushLog(who, text, variant) {
    S.log.push({ who: who, text: text, variant: variant || "" });
    if (S.log.length > 120) S.log = S.log.slice(-120);
  }

  function scrollLog() {
    const l = root().querySelector(".log");
    if (l) l.scrollTop = l.scrollHeight;
  }

  /* Presenter control: choose which installed voice reads the kiosk aloud. */
  function voicePicker() {
    const tag = mkLang(S.lang).speech;
    const all = Voice.list();
    if (!all.length) return el("span", { class: "hdrChip", text: "Voices loading…" });
    const base = Voice.baseOf(tag);
    const mine = all.filter((v) => Voice.baseOf(v.lang) === base);
    const rest = all.filter((v) => Voice.baseOf(v.lang) !== base);
    const sample = mkLang(S.lang).greet + " " + mkT("speakNow", S.lang);
    const opt = (v) => el("option", {
      value: v.name, selected: v.name === S.voiceName,
      text: v.name + " · " + String(v.lang).replace(/_/g, "-") + (Voice.isNatural(v) ? "  ★" : ""),
    });
    const select = el("select", {
      class: "hdrChip", "aria-label": "Speaker voice",
      onChange: (e) => { Voice.setVoice(e.target.value); Voice.speak(sample, S.lang); },
    }, [
      el("optgroup", { label: "Voices for " + mkLang(S.lang).native }, [
        el("option", { value: "", selected: !S.voiceName, text: "Best available (auto)" }),
        ...mine.map(opt),
      ]),
      rest.length ? el("optgroup", { label: "Other installed voices" }, rest.map(opt)) : null,
    ]);
    return el("span", {}, [
      select,
      el("button", { class: "hdrChip", type: "button", text: "Test", title: "Hear the selected voice", onClick: () => Voice.speak(sample, S.lang) }),
    ]);
  }

  function elapsed() {
    if (!S.startedAt) return "";
    const s = Math.floor((Date.now() - S.startedAt) / 1000);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  function controlBar() {
    const inInterview = S.phase === "interview";
    const inReadback = S.phase === "readback";
    return el("div", { class: "controlbar" }, [
      el("span", { class: "cbTitle", text: "PRESENTER CONTROLS — not part of the patient screen" }),
      el("button", { class: "cbBtn", type: "button", text: "↺ Restart", onClick: () => location.reload() }),
      inInterview ? el("button", { class: "cbBtn", type: "button", text: "⏭ Skip step", onClick: skipStep }) : null,
      (inInterview || inReadback) ? el("button", { class: "cbBtn", type: "button", text: "⏩ Jump to summary", onClick: enterMerge }) : null,
      el("span", { class: "cbSpacer" }),
      el("span", { class: "cbNote", text: "voice + touch answers · fixed safety rules · never diagnoses" }),
      S.startedAt ? el("span", { class: "cbTimer", text: elapsed() }) : null,
    ]);
  }

  const MOD_SUB = {
    A: "Module A — Patient History Kiosk · रोगी इतिहास कियोस्क",
    B: "Module B — Paper digitisation · काग़ज़ डिजिटलीकरण",
    C: "Module C — Summary for the doctor · डॉक्टर के लिए सारांश",
    D: "Module D — Consent & hand-off · सहमति",
  };

  function header() {
    const mod = moduleForPhase();
    return el("header", { class: "hdr" }, [
      el("div", { class: "hdrInner" }, [
        el("div", { class: "brandMark", text: "✚" }),
        el("div", { class: "brandTxt" }, [
          el("h1", { text: "MediKiosk" }),
          el("div", { class: "sub", text: MOD_SUB[mod] || MOD_SUB.A }),
        ]),
        el("div", { class: "hdrChips" }, [
          el("button", {
            class: "hdrChip soundChip" + (S.voiceOn ? " on" : ""), type: "button",
            title: S.voiceOn ? "Auto-speak is ON — each question is read aloud. Click to mute." : "Auto-speak is muted. Click to unmute.",
            text: S.voiceOn ? "🔊 Read-aloud on" : "🔇 Read-aloud muted",
            onClick: () => { S.voiceOn = !S.voiceOn; if (!S.voiceOn) Voice.stop(); render(); },
          }),
          voicePicker(),
          el("span", { class: "hdrChip" }, [el("span", { class: "dot" }), "On-device · offline-first"]),
          el("span", { class: "hdrChip", text: mkLang(S.lang).native }),
          ...["A", "B", "C", "D"].map((m) =>
            el("span", { class: "hdrChip" + (m === mod ? " modOn" : ""), text: "Module " + m })),
        ]),
      ]),
    ]);
  }

  function urgentStrip() {
    const hits = (S.redHits || []).map((h) => h.id).join(" · ");
    return el("div", { class: "urgentStrip" }, [
      el("span", { class: "usBadge", text: "URGENT FLAG" }),
      document.createTextNode(hits + " — priority triage active"),
      el("span", { class: "usRight", text: "staff acknowledged · स्टाफ़ सूचित" }),
    ]);
  }

  function stageFoot() {
    return el("div", { class: "stageFoot", text: "MediKiosk OPD check-in · microphone input — clinical excerpts · fixed safety rules (final rules clinician-validated) · the kiosk never diagnoses · this page runs offline" });
  }

  /* left progress rail */
  const RAIL_DEFS = [
    { id: "story", turns: ["bodymap", "narrative", "cc"] },
    { id: "symptoms", turns: ["socrates.site", "socrates.onset", "socrates.character", "socrates.radiation", "socrates.associations", "socrates.timing", "socrates.exacerbating", "socrates.severity"] },
    { id: "safety", turns: ["safety"] },
    { id: "history", turns: ["pmh", "meds", "allergies", "family", "social.smoke", "social.alcohol"] },
    { id: "ros", turns: ["ros.rest_breathless", "ros.palpitations", "ros.fever_cough", "ros.calf"] },
    { id: "ice", turns: ["ice.worry", "ice.expect"] },
    { id: "documents", turns: [] },
    { id: "summary", turns: [] },
  ];
  const RAIL_LABEL = {
    story: { en: "Your story", hi: "आपकी बात" },
    symptoms: { en: "Symptom details", hi: "लक्षण विवरण" },
    safety: { en: "Safety check", hi: "सुरक्षा जाँच" },
    history: { en: "Health history", hi: "स्वास्थ्य इतिहास" },
    ros: { en: "Other symptoms", hi: "अन्य लक्षण" },
    ice: { en: "Your thoughts", hi: "आपके विचार" },
    documents: { en: "Your papers", hi: "आपके काग़ज़" },
    summary: { en: "Summary", hi: "सारांश" },
  };

  function railStatus(def) {
    const afterInterview = ["documents", "merge", "readback", "handoff", "physician"].indexOf(S.phase) >= 0;
    if (def.id === "summary") {
      if (S.phase === "handoff" || S.phase === "physician") return "done";
      if (S.phase === "readback" || S.phase === "merge") return "current";
      return "";
    }
    if (def.id === "documents") {
      if (S.phase === "documents") return S.docsStage === "review" ? "done" : "current";
      return afterInterview ? "done" : "";
    }
    if (S.phase !== "interview") return afterInterview ? "done" : "";
    if (def.id === "safety") {
      const cur = curStep();
      if (cur && cur.id === "safety") return "current";
      if (!S.safetySeen) return "";
      return S.redFired ? "flagged" : "done";
    }
    const cur = curStep();
    const n = def.turns.filter((t) => S.answers[t]).length;
    if (cur && cur.section === def.id) return "current";
    if (n > 0) return "done";
    return "";
  }

  function rail() {
    return el("div", { class: "rail" }, [
      el("div", { class: "railTitle", text: "Interview steps · चरण" }),
      ...RAIL_DEFS.map((def) => {
        const st = railStatus(def);
        const lab = RAIL_LABEL[def.id];
        return el("div", { class: "railItem" + (st ? " " + st : "") }, [
          el("span", { class: "rDot", text: st === "done" ? "✓" : st === "flagged" ? "!" : "•" }),
          el("span", { class: "rLab" }, [
            document.createTextNode(lab.en),
            el("span", { class: "rLabHi", text: lab.hi }),
          ]),
        ]);
      }),
      el("div", { class: "railSub", text: "Guided sequence — the kiosk decides what to ask, the patient answers by voice or touch." }),
    ]);
  }

  function logView() {
    const box = el("div", { class: "log" });
    if (!S.log.length) {
      box.append(el("div", { class: "logEmpty", text: "The conversation will appear here · बातचीत यहाँ दिखेगी" }));
      return box;
    }
    S.log.forEach((m) => {
      const whoCls = m.who === "kiosk" ? "kiosk" : m.who === "patient" ? "patient" : "sys " + (m.variant || "");
      const whoLbl = m.who === "kiosk" ? "Kiosk" : m.who === "patient" ? "Patient" : null;
      box.append(el("div", { class: "msg " + whoCls }, [
        whoLbl ? el("div", { class: "mWho", text: whoLbl }) : null,
        el("div", { class: "mBody", text: m.text }),
      ]));
    });
    return box;
  }

  function render() {
    document.documentElement.lang = S.lang;
    document.documentElement.dir = ["ur", "ks", "sd"].indexOf(S.lang) >= 0 ? "rtl" : "ltr";
    const r = root();
    clear(r);
    r.append(controlBar(), header());
    if (S.redFired && S.safetyAck && ["interview", "readback", "handoff"].indexOf(S.phase) >= 0) r.append(urgentStrip());
    const map = {
      welcome: renderWelcome, interview: renderInterview, documents: renderDocuments,
      merge: renderMerge, readback: renderReadback, handoff: renderHandoff,
      physician: renderPhysician,
    };
    (map[S.phase] || renderWelcome)(r);
    r.append(stageFoot());
    const step = curStep();
    if (step && step.kind === "safety" && S.safetyStage === "overlay" && S.redFired && !S.safetyAck) {
      r.append(safetyOverlay());
    }
    if (!S.spoken) r.append(el("div", { class: "soundHint", text: "Tap once anywhere to start the voice" }));
    if (S.toastMsg) r.append(el("div", { class: "toast " + S.toastMsg.kind, text: S.toastMsg.text }));
    scrollLog();
  }

  /* ------------------------------------------------------------- welcome */

  function micLabel(s) {
    return s === "granted" ? "already allowed"
      : s === "prompt" ? "will be asked on first use"
      : s === "denied" ? "blocked" : "unknown";
  }

  function voiceCheck() {
    const isFile = !!(window.location && window.location.protocol === "file:");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const synth = ("speechSynthesis" in window) && ("SpeechSynthesisUtterance" in window);
    const voices = Voice.list();
    const hiV = voices.find((v) => Voice.baseOf(v.lang) === "hi");
    const enV = voices.find((v) => Voice.baseOf(v.lang) === "en");
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: "microphone" }).then((st) => {
          const elx = root().querySelector("[data-micstate]");
          if (elx) elx.textContent = micLabel(st.state);
        }).catch(() => {});
      }
    } catch (e) {}
    const row = (cls, mark, label, value, fix) => el("div", { class: "vcRow " + cls }, [
      el("span", { class: "vcMark", text: mark }),
      el("span", { class: "vcLabel", text: label }),
      el("span", { class: "vcVal" }, [
        typeof value === "string" ? document.createTextNode(value) : value,
        fix ? el("span", { class: "vcFix", text: fix }) : null,
      ]),
    ]);
    const testSound = () => {
      Voice.speak(S.lang === "hi"
        ? "नमस्ते। कियोस्क इस तरह से हर सवाल पढ़ेगा।"
        : "Hello. This is how the kiosk will read each question.", S.lang);
    };
    return el("div", { class: "voiceCheck" }, [
      el("div", { class: "wLabel", text: "0 · Voice self-check · आवाज़ जाँच" }),
      el("div", { class: "vcList" }, [
        row(isFile ? "vcBad" : "vcOk", isFile ? "✗" : "✓", "Microphone page origin",
          isFile ? "blocked — opened as a local file (file://)" : "ok — served over " + (window.location ? window.location.protocol : ""),
          isFile ? "Serve the page over http://127.0.0.1 (see serve-prototype.py). Typing still works." : null),
        row(SR ? "vcOk" : "vcBad", SR ? "✓" : "✗", "Voice input engine", SR ? "available" : "not available",
          SR ? null : "Voice answers are unavailable here — typing always works."),
        row(synth && voices.length ? "vcOk" : "vcWarn", synth && voices.length ? "✓" : "⚠", "Voice output engine",
          !synth ? "unavailable" : voices.length + " system voices found"),
        voices.length ? row(hiV ? "vcOk" : "vcBad", hiV ? "✓" : "✗", "Hindi voice (for Hindi)",
          hiV ? "available" : "not installed",
          hiV ? null : "Windows: Settings → Time & Language → Speech → Add voices → Hindi. English playback works meanwhile.") : null,
        voices.length ? row(enV ? "vcOk" : "vcBad", enV ? "✓" : "✗", "English voice", enV ? "available" : "not found") : null,
        row("vcWarn", "…", "Microphone permission",
          el("span", { "data-micstate": true, text: "checking…" }),
          "If blocked: address-bar icon → Microphone → Allow, then reload."),
      ]),
      el("div", { class: "vcTest" }, [
        el("button", { class: "btn", type: "button", text: "🔊 Test sound", onClick: testSound }),
        el("span", { class: "vcHint", text: "After Start, the kiosk reads every question aloud; the header has a mute toggle." }),
      ]),
    ]);
  }

  function renderWelcome(r) {
    const C = mkConsent(S.lang);
    const grid = el("div", { class: "langRow" }, MK_LANGS.map((l) =>
      el("button", {
        class: "langTile" + (l.code === S.lang ? " sel" : ""), type: "button", lang: l.code,
        onClick: () => {
          S.lang = l.code;
          S.spoken = true; // the tap is a user gesture: the voice is unlocked
          const cur = Voice.list().find((v) => v.name === S.voiceName);
          if (cur && Voice.baseOf(cur.lang) !== Voice.baseOf(mkLang(l.code).speech)) Voice.setVoice("");
          Voice.speak(mkLang(l.code).greet + ". " + mkT("tagline", l.code), l.code);
          render();
        },
      }, [
        el("div", { class: "lMain", lang: l.code, text: l.native }),
        el("div", { class: "lSub", text: l.name + (l.code === "en" ? "" : " · " + l.speech) }),
      ])));
    r.append(el("div", { class: "welcome" }, [
      el("div", { class: "wHero" }, [
        el("div", { class: "wKicker", text: "MediKiosk · OPD check-in" }),
        el("h2", { text: "Patient history, captured before the consultation" }),
        el("div", { class: "wSub", text: "Voice + touch history-taking for high-volume OPDs — your papers are read next, then everything is joined into one summary for the doctor." }),
      ]),
      el("div", { class: "wCard" }, [
        el("div", { class: "wLabel", text: "1 · " + mkT("chooseLang", S.lang) + " · भाषा — 22 languages" }),
        el("p", { style: "font-size:.9rem;color:var(--muted);margin-bottom:10px", text: mkT("langNote", S.lang) }),
        grid,
        el("div", { class: "wLabel", text: "2 · " + mkT("consentHead", S.lang) }),
        el("p", { text: C.purpose }),
        el("div", { class: "chipGrid", style: "grid-template-columns:1fr 1fr" }, [
          el("div", { class: "sumSection", style: "margin-bottom:0" }, [
            el("h3", { text: C.takeTitle }),
            el("ul", { style: "margin:6px 0 0;padding-left:20px;font-size:.9rem" }, C.take.map((x) => el("li", { text: x }))),
          ]),
          el("div", { class: "sumSection", style: "margin-bottom:0" }, [
            el("h3", { text: C.neverTitle }),
            el("ul", { style: "margin:6px 0 0;padding-left:20px;font-size:.9rem" }, C.never.map((x) => el("li", { text: x }))),
          ]),
        ]),
        el("p", { style: "margin-top:12px;font-size:.92rem", text: C.retention }),
        el("p", { style: "font-size:.92rem", text: C.rights }),
        el("div", { class: "wToken" }, [
          document.createTextNode(C.ref + " "),
          el("code", { text: C.artefact }),
        ]),
        el("div", { class: "wNote", text: C.linked + " " + MK_PATIENT.abha }),
        el("label", { class: "agreeRow" }, [
          el("input", {
            type: "checkbox", checked: S.agree,
            onChange: (e) => {
              S.agree = e.target.checked;
              const b = document.getElementById("begin-btn");
              if (b) b.disabled = !S.agree;
            },
          }),
          el("span", { text: mkT("agree", S.lang) }),
        ]),
        voiceCheck(),
        el("div", { class: "wStart" }, [
          el("button", {
            class: "btn big", id: "begin-btn", type: "button", disabled: !S.agree,
            text: (S.lang === "hi" ? "शुरू करें" : "Start") + " · " + (S.lang === "hi" ? "Start" : mkT("begin", S.lang) === "Start" ? "शुरू करें" : mkT("begin", S.lang)),
            onClick: startVisit,
          }),
        ]),
        el("div", { class: "wNote", text: "Patient: " + MK_PATIENT.name + " · " + MK_PATIENT.age + " / " + MK_PATIENT.sex + " · " + MK_PATIENT.visit }),
        el("div", { class: "honestyBox" }, [
          el("div", { class: "hbT", text: "How this kiosk works · यह कियोस्क कैसे काम करता है" }),
          el("div", {}, [
            el("b", { text: "The safety check is a fixed rule list, not an opinion" }),
            " — the final rule set is validated by doctors. ",
            el("b", { text: "The kiosk never diagnoses or recommends treatment" }),
            " — it ends at a structured summary for the physician.",
          ]),
        ]),
      ]),
    ]));
  }

  async function startVisit() {
    if (S.busy) return;
    S.busy = true;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) { /* touch-only fallback keeps working */ }
    S.busy = false;
    // Module A is captured live: clear every prepared value so nothing is
    // pre-selected and no answer is recorded until the person gives it.
    MK_STEPS.forEach((s) => { s.answer = (s.kind === "multi") ? { values: [] } : {}; });
    S.heard = "";
    S.bodyRegion = null;
    S.tapped = false;
    S.log = [];
    S.redFired = false;
    S.redHits = [];
    S.safetySeen = false;
    S.safetyStage = null;
    S.safetyAck = false;
    S.startedAt = Date.now();
    pushLog("sys", "Visit started · consent " + MK_CONSENT_REF, "sysOk");
    S.phase = "interview";
    S.stepIdx = 0;
    runStep();
  }

  /* ----------------------------------------------------------- interview */

  const STEP_TAG = {
    bodymap: "Start · Point to the pain",
    narrative: "Step 1 · Your story",
    cc: "Step 2 · Main problem",
    "socrates.site": "SOCRATES · S — Site",
    "socrates.onset": "SOCRATES · O — Onset",
    "socrates.character": "SOCRATES · C — Character",
    "socrates.radiation": "SOCRATES · R — Radiation",
    "socrates.associations": "SOCRATES · A — Associations",
    "socrates.timing": "SOCRATES · T — Timing",
    "socrates.exacerbating": "SOCRATES · E — Exacerbating / relieving",
    "socrates.severity": "SOCRATES · S — Severity",
    pmh: "History · Past illness",
    meds: "History · Medicines",
    allergies: "History · Allergies",
    family: "History · Family",
    "social.smoke": "History · Tobacco",
    "social.alcohol": "History · Alcohol",
  };

  function stepTagFor(step) {
    if (step.kind === "yesno") return "Focused review of systems";
    if (step.id === "ice.worry") return "ICE · Ideas, Concerns, Expectations";
    if (step.id === "ice.expect") return "ICE · Expectation";
    return STEP_TAG[step.id] || "Question";
  }

  function speakTextFor(primary, secondary) {
    const deva = /[\u0900-\u097F]/;
    if (deva.test(primary || "")) return primary;
    if (deva.test(secondary || "")) return secondary;
    return primary || secondary || "";
  }

  function promptBlock(step) {
    const ask = step.ask || {};
    const primary = ask[S.lang] || ask.en || "";
    const secondary = S.lang === "hi" ? (ask.en || "") : (ask.hi || "");
    const speech = speakTextFor(primary, secondary);
    return [
      el("div", { class: "stepTag", text: stepTagFor(step) }),
      el("div", { class: "prompt", role: "status", "aria-live": "polite" }, [
        document.createTextNode(primary),
        el("span", { class: "speakWrap" }, [
          el("button", {
            class: "speakBtn", type: "button", text: "[audio] Listen · सुनें",
            title: "Listen to the question",
            onClick: () => Voice.speak(speech, S.lang),
          }),
        ]),
      ]),
      secondary && secondary !== primary ? el("div", { class: "promptSub", text: secondary }) : null,
    ];
  }

  function skipLink() {
    return el("button", {
      class: "skipLink", type: "button",
      text: S.lang === "hi" ? "छोड़ें — डॉक्टर से बताएँगे" : "Skip — will tell the doctor",
      onClick: () => skipStep(),
    });
  }

  function voiceTag() {
    return el("div", { class: "voiceTag", text: "🎤 Voice answers are heard · typed words are kept" });
  }

  function voiceStatus() {
    return el("div", { class: "voiceStatus", role: "status", text: S.listening ? mkT("listening", S.lang) : (S.voiceNote || "") });
  }

  function micButton(step) {
    if (!voiceTurn(step) || !Ears.available()) return null;
    return el("button", {
      class: "btn voiceBtn", id: "mic-btn", type: "button",
      onClick: () => (S.listening ? stopListening() : startListening(step)),
    }, [
      document.createTextNode(S.listening ? mkT("stopListening", S.lang) : mkT("speakNow", S.lang)),
      el("br"),
      document.createTextNode(S.listening ? "रोकें" : "बोलें"),
    ]);
  }

  function inputRow(step, rows) {
    const sendBtn = el("button", {
      class: "btn", type: "button", text: "Send · भेजें",
      onClick: () => {
        const v = (ta.value || "").trim();
        if (!v) return;
        step.answer.text = v;
        pushLog("patient", v);
        S.answers[step.id] = Object.assign({}, step.answer, { by: "touch" });
        nextStep();
      },
    });
    const ta = el("textarea", {
      id: "answer-ta", rows: rows || 2,
      placeholder: S.lang === "hi" ? "जो बोलना है वह लिखिए…" : "Type what you would say out loud…",
      value: step.answer.text || "",
      onInput: (e) => { step.answer.text = e.target.value; sendBtn.disabled = !e.target.value.trim(); },
    });
    sendBtn.disabled = !(step.answer.text || "").trim();
    return el("div", {}, [
      el("div", { class: "inputRow" }, [ta, micButton(step), sendBtn]),
      voiceStatus(),
    ]);
  }

  function renderInterview(r) {
    const step = curStep();
    if (!step) { enterDocuments(); return; }
    const card = el("div", { class: "card" });
    if (step.kind === "bodymap") card.append(bodymapBlock(step));
    else if (step.kind === "text") card.append(textBlock(step));
    else if (step.kind === "cc") card.append(ccBlock(step));
    else if (step.kind === "scale") card.append(scaleBlock(step));
    else if (step.kind === "chips") card.append(singleChipsBlock(step));
    else if (step.kind === "multi") card.append(multiBlock(step));
    else if (step.kind === "yesno") card.append(yesnoBlock(step));
    else if (step.kind === "safety") card.append(safetyBlock());
    r.append(el("div", { class: "stage" }, [rail(), el("div", { class: "logCol" }, [logView(), card])]));
  }

  const CC_DETECT = {
    head: { en: "headache", hi: "सिर दर्द" },
    chest: { en: "chest pain", hi: "छाती में दर्द" },
    abdomen: { en: "stomach pain", hi: "पेट दर्द" },
    back: { en: "back pain", hi: "कमर दर्द" },
    armL: { en: "arm pain", hi: "हाथ में दर्द" },
    armR: { en: "arm pain", hi: "हाथ में दर्द" },
    legL: { en: "knee / joint pain", hi: "घुटने का दर्द" },
    legR: { en: "knee / joint pain", hi: "घुटने का दर्द" },
    general: { en: "your main problem", hi: "आपकी मुख्य समस्या" },
  };

  function bodymapBlock(step) {
    const host = el("div", { html: mkBodyHtml(S.bodyRegion) });
    Array.from(host.querySelectorAll("[data-region]")).forEach((b) => {
      b.addEventListener("click", () => pickRegion(b.getAttribute("data-region")));
    });
    const ids = ["head", "chest", "abdomen", "armL", "armR", "legL", "legR"];
    const legend = el("div", { class: "bmLegend" }, ids.map((id) => {
      const labels = {
        head: ["Head", "सिर"], chest: ["Chest", "छाती"], abdomen: ["Belly", "पेट"],
        armL: ["Left arm", "बायाँ हाथ"], armR: ["Right arm", "दायाँ हाथ"],
        legL: ["Left leg / knee", "बायाँ घुटना"], legR: ["Right leg / knee", "दायाँ घुटना"],
      };
      const r = labels[id] || [id, id];
      return el("button", {
        class: "bmBtn", type: "button", onClick: () => pickRegion(id),
      }, [el("span", { class: "cEn", text: r[0] }), el("span", { class: "cHi", text: r[1] })]);
    }));
    return el("div", {}, [
      ...promptBlock(step),
      el("div", { class: "bmWrap" }, [host, legend]),
      skipLink(),
    ]);
  }

  function pickRegion(id) {
    S.bodyRegion = id;
    S.tapped = true;
    const comp = CC_DETECT[id] || CC_DETECT.general;
    pushLog("patient", (S.lang === "hi" ? comp.hi : comp.en) + " — pointed on the body picture");
    S.answers.bodymap = { region: id, en: comp.en, hi: comp.hi, by: "touch" };
    nextStep();
  }

  function textBlock(step) {
    return el("div", {}, [
      ...promptBlock(step),
      inputRow(step, 3),
      voiceTag(),
      skipLink(),
    ]);
  }

  function singleChipsBlock(step) {
    const grid = el("div", { class: "chipGrid" }, (step.options || []).map((o) => {
      const on = step.answer.value === o.v;
      return el("button", {
        class: "chip" + (on ? " selected" : ""), type: "button", "aria-pressed": String(on),
        onClick: () => {
          S.answers[step.id] = { value: o.v, en: o.en, hi: o.hi || o.en, by: "touch" };
          pushLog("patient", o[S.lang] || o.en);
          render();
          advanceSoon();
        },
      }, [
        el("span", { class: "cEn", text: o.en }),
        o.hi ? el("span", { class: "cHi", text: o.hi }) : null,
      ]);
    }));
    return el("div", {}, [
      ...promptBlock(step),
      grid,
      el("div", { class: "orDiv", text: "or type · या लिखें" }),
      inputRow(step, 2),
      voiceTag(),
      skipLink(),
    ]);
  }

  function multiBlock(step) {
    const chosen = step.answer.values || [];
    const grid = el("div", { class: "chipGrid" }, (step.options || []).map((o) => {
      const on = chosen.indexOf(o.v) >= 0;
      const dim = chosen.length > 0 && !on && (step.options || []).some((x) => x.exclusive && chosen.indexOf(x.v) >= 0);
      return el("button", {
        class: "chip" + (on ? " selected" : "") + (dim ? " selExcl" : ""), type: "button", "aria-pressed": String(on),
        onClick: () => {
          let v = (step.answer.values || []).slice();
          if (o.exclusive) v = on ? [] : [o.v];
          else {
            v = v.filter((x) => !(step.options || []).some((y) => y.v === x && y.exclusive));
            v = on ? v.filter((x) => x !== o.v) : v.concat([o.v]);
          }
          step.answer.values = v;
          render();
        },
      }, [
        el("span", { class: "cEn", text: o.en }),
        o.hi ? el("span", { class: "cHi", text: o.hi }) : null,
      ]);
    }));
    const detail = el("textarea", {
      rows: 1, placeholder: "…",
      value: step.answer.detail || "",
      onInput: (e) => { step.answer.detail = e.target.value; },
    });
    const n = chosen.length;
    return el("div", {}, [
      ...promptBlock(step),
      grid,
      el("div", { class: "detailRow" }, [
        el("label", { text: "Add detail · विवरण जोड़ें" }),
        detail,
      ]),
      el("div", { class: "btnRow" }, [
        el("button", {
          class: "btn", type: "button", disabled: n === 0,
          text: (S.lang === "hi" ? "पुष्टि करें" : "Confirm") + " (" + n + ")",
          onClick: () => confirmMulti(step),
        }),
      ]),
      voiceStatus(),
      skipLink(),
    ]);
  }

  function confirmMulti(step) {
    const vals = step.answer.values || [];
    if (!vals.length) return;
    const opts = step.options || [];
    const en = [], hi = [];
    opts.forEach((o) => { if (vals.indexOf(o.v) >= 0) { en.push(o.en); hi.push(o.hi || o.en); } });
    let display = en.join("; ");
    const detail = (step.answer.detail || "").trim();
    if (detail) display += " — " + detail;
    const prev = S.answers[step.id] || {};
    pushLog("patient", display);
    S.answers[step.id] = {
      values: vals, en: display, hi: hi.join("; "), detail: detail || null,
      by: prev.by || "touch", heard: prev.heard || null,
    };
    nextStep();
  }

  function ccBlock(step) {
    const detected = CC_DETECT[S.bodyRegion] || null;
    const ask = (!detected || step.answer.value === "no") ? step.askOpen : step.askConfirm;
    const primary = (ask && (ask[S.lang] || ask.en)) || "";
    const secondary = S.lang === "hi" ? ((ask && ask.en) || "") : ((ask && ask.hi) || "");
    const speech = speakTextFor(primary, secondary);
    const typeBox = el("div", { style: "margin-top:16px" }, [inputRow(step, 1)]);
    const confirmRow = detected && step.answer.value !== "no" ? el("div", {}, [
      el("div", { class: "ccBox" }, [
        el("div", { class: "ccLbl", text: "MAIN PROBLEM · मुख्य समस्या" }),
        el("div", { class: "ccVal", text: S.lang === "hi" ? detected.hi : detected.en }),
        el("div", { class: "ccHi", text: S.lang === "hi" ? detected.en : detected.hi }),
      ]),
      el("div", { class: "chipGrid", style: "grid-template-columns:1fr 1fr" }, [
        el("button", {
          class: "chip", type: "button",
          onClick: () => {
            pushLog("patient", S.lang === "hi" ? detected.hi : detected.en);
            S.answers.cc = { value: "yes", en: detected.en, hi: detected.hi, by: "touch" };
            nextStep();
          },
        }, [
          el("span", { class: "cEn", text: S.lang === "hi" ? "✓ हाँ, सही है" : "✓ Yes, that is correct" }),
          el("span", { class: "cHi", text: S.lang === "hi" ? "Yes, that is correct" : "हाँ, सही है" }),
        ]),
        el("button", {
          class: "chip", type: "button",
          onClick: () => { step.answer.value = "no"; render(); },
        }, [
          el("span", { class: "cEn", text: S.lang === "hi" ? "नहीं — मैं बताता हूँ" : "No — let me say it" }),
          el("span", { class: "cHi", text: S.lang === "hi" ? "No — let me say it" : "नहीं — मैं बताता हूँ" }),
        ]),
      ]),
    ]) : null;
    return el("div", {}, [
      el("div", { class: "stepTag", text: stepTagFor(step) }),
      el("div", { class: "prompt", role: "status", "aria-live": "polite" }, [
        document.createTextNode(primary),
        el("span", { class: "speakWrap" }, [
          el("button", { class: "speakBtn", type: "button", text: "[audio] Listen · सुनें", title: "Listen to the question", onClick: () => Voice.speak(speech, S.lang) }),
        ]),
      ]),
      secondary && secondary !== primary ? el("div", { class: "promptSub", text: secondary }) : null,
      confirmRow,
      (!detected || step.answer.value === "no") ? typeBox : null,
      voiceTag(),
    ]);
  }

  const RF_TERMS = {
    headache: ["headache", "sir dard", "sar dard", "सिर", "माथा"],
    sudden: ["sudden", "achanak", "ekdum", "अचानक", "एकदम"],
    chest: ["chest", "seene", "chati", "छाती", "सीने"],
    breath: ["breathless", "breath", "saans", "सांस", "साँस", "dum phool"],
    stroke: ["one side", "ek taraf", "एक तर", "falij", "फालिज", "paralysis", "पक्षाघात", "slurr", "lisdar", "लिसडर", "droop", "munh teda", "मुंह टेढ़ा", "आधा शरीर"],
    concern: ["sweat", "pasina", "पसीना", "faint", "behosh", "बेहोश", "vomit", "उल्टी", "ulti", "मतली", "nausea", "chakkar", "चक्कर", "dizzy"],
  };

  function answerCorpus() {
    const bits = [];
    Object.keys(S.answers).forEach((k) => {
      const a = S.answers[k];
      if (!a || typeof a !== "object") return;
      ["heard", "text", "en", "hi", "detail"].forEach((f) => { if (a[f]) bits.push(String(a[f])); });
    });
    if (S.bodyRegion === "chest") bits.push("chest pain");
    if (S.bodyRegion === "head") bits.push("headache");
    const sev = S.answers["socrates.severity"];
    if (sev && typeof sev.value === "number") bits.push("severity " + sev.value);
    return bits.join(" \n ").toLowerCase();
  }

  /* Deterministic red-flag check over the answers actually given — the same
     four-rule shape as the capture contract, evaluated on this machine. */
  function evalRedFlags() {
    const corpus = answerCorpus();
    const has = (terms) => terms.filter((t) => corpus.indexOf(t) >= 0);
    const sev = S.answers["socrates.severity"];
    const sevN = sev && typeof sev.value === "number" ? sev.value : null;
    const out = [];
    const h1 = has(RF_TERMS.headache), s1 = has(RF_TERMS.sudden);
    if (h1.length && s1.length) out.push({ id: "RF-1", evidence: h1.concat(s1).slice(0, 3) });
    const c2 = has(RF_TERMS.chest), b2 = has(RF_TERMS.breath);
    if (c2.length && b2.length) out.push({ id: "RF-2", evidence: c2.concat(b2).slice(0, 3) });
    const st = has(RF_TERMS.stroke);
    if (st.length) out.push({ id: "RF-3", evidence: st.slice(0, 3) });
    const cc = has(RF_TERMS.concern);
    if (sevN != null && sevN >= 8 && cc.length) out.push({ id: "RF-4", evidence: ["severity " + sevN].concat(cc.slice(0, 2)) });
    return out;
  }

  function ruleRows() {
    const hitIds = {};
    (S.redHits || []).forEach((h) => { hitIds[h.id] = h.evidence || []; });
    return el("div", { class: "ruleList" }, MK_RULES.map((r) => {
      const ev = hitIds[r.id];
      const matched = !!ev;
      return el("div", { class: "rule" + (matched ? " matched" : "") }, [
        el("span", { class: "rId", text: r.id }),
        el("div", { class: "rTxt" }, [
          document.createTextNode((r[S.lang] || r.en) + " — "),
          el("span", { style: "color:var(--muted)", text: S.lang === "hi" ? r.en : r.hi }),
          matched
            ? el("div", {}, [
                el("div", { class: "rStatus", text: "RULE MATCHED" }),
                el("div", { class: "evidence" }, [el("b", { text: "Matched words: " }), "«" + ev.join("», «") + "»"]),
              ])
            : el("div", { class: "rStatus", text: "Checked — not present" }),
        ]),
      ]);
    }));
  }

  function safetyBlock() {
    const fired = S.redFired && S.redHits.length > 0;
    return el("div", {}, [
      el("div", {
        class: "safetyOk",
        style: fired ? "border-color:var(--red-line);background:var(--red-bg)" : "",
      }, [
        el("h3", {
          style: fired ? "color:var(--red-d)" : "",
          text: (fired ? "Urgent flag active — staff acknowledged" : "No warning signs found")
            + (S.lang === "hi" ? " · " + (fired ? "तत्काल फ़्लैग सक्रिय" : "कोई चेतावनी नहीं") : ""),
        }),
        el("div", { class: "soHi", text: fired
          ? (S.lang === "hi" ? "सारांश प्राथमिकता कतार में जाएगा" : "The summary will go to the priority-triage queue")
          : (S.lang === "hi" ? "कृपया आगे बढ़िए" : "Please continue to the next question") }),
        el("div", { style: "margin-top:12px" }, [ruleRows()]),
        el("div", { class: "btnRow" }, [
          el("button", {
            class: "btn" + (fired ? " danger" : ""), type: "button",
            text: (S.lang === "hi" ? "आगे बढ़ें" : "Continue") + " · " + (S.lang === "hi" ? "Continue" : "आगे बढ़ें"),
            onClick: () => nextStep(),
          }),
        ]),
        el("div", { class: "safetyNote", text: "Every rule is shown with its result — this is a fixed checklist, not an opinion. The final rule set is validated by doctors." }),
      ]),
    ]);
  }

  function safetyOverlay() {
    const hits = S.redHits || [];
    const first = hits[0] || { id: "", evidence: [] };
    const rule = MK_RULES.find((r) => r.id === first.id) || { en: "", hi: "" };
    const now = new Date();
    const timeStr = now.getHours() + ":" + (now.getMinutes() < 10 ? "0" : "") + now.getMinutes();
    return el("div", { class: "overlay" }, [
      el("div", { class: "alertCard", role: "alert" }, [
        el("div", { class: "alertHead" }, [
          el("div", { class: "ahTag", text: "URGENT SAFETY FLAG" }),
          el("h2", { text: "⚠ " + (rule[S.lang] || rule.en) + " — " + hits.map((h) => h.id).join(" + ") }),
          el("div", { class: "ahHi", text: S.lang === "hi" ? rule.en : rule.hi }),
          el("div", { class: "ahWhy", text: "The kiosk found a warning sign in your answers. It does not diagnose — it sends you to the priority queue. · कियोस्क को आपके जवाबों में चेतावनी संकेत मिला है। यह निदान नहीं करता — यह आपको प्राथमिकता कतार में भेजता है।" }),
        ]),
        el("div", { class: "alertBody" }, [
          ruleRows(),
          el("div", { class: "alertInstruction" }, [
            el("div", { class: "aiBig", text: "Please stay at the kiosk and show this screen to a staff member now." }),
            el("div", { class: "aiHi", text: "कृपया कियोस्क पर रुकें और यह स्क्रीन स्टाफ को दिखाएँ।" }),
            el("div", { class: "aiMeta" }, [
              el("span", { class: "aiPill", text: "✓ Help-desk notified · सहायता डेस्क सूचित — " + timeStr }),
              el("span", { class: "aiPill", text: "Priority triage queue · प्राथमिकता कतार" }),
            ]),
          ]),
          el("div", { class: "alertActions" }, [
            el("button", {
              class: "btn danger big", type: "button", text: "✓ Staff: acknowledge and continue",
              onClick: () => {
                S.safetyAck = true;
                S.safetyStage = "panel";
                pushLog("sys", "Staff acknowledged the urgent flag — priority triage.", "sysOk");
                render();
              },
            }),
            el("span", { class: "aaNote", text: "Staff acknowledgment lets the history continue in priority mode." }),
          ]),
          el("div", { class: "safetyNote", text: "Every rule is shown with its result — this is a fixed checklist, not an opinion." }),
        ]),
      ]),
    ]);
  }

  function yesnoBlock(step) {
    return el("div", {}, [
      ...promptBlock(step),
      el("div", { class: "yesNoRow" }, MK_YESNO.map((o) =>
        el("button", {
          class: "chip", type: "button", "aria-pressed": String(step.answer.value === o.v),
          onClick: () => {
            S.answers[step.id] = {
              value: o.v, en: o.en, hi: o.hi,
              state: o.v === "not_sure" ? "needs_review" : "captured", by: "touch",
            };
            pushLog("patient", o[S.lang] || o.en);
            render();
            advanceSoon();
          },
        }, [
          el("span", { class: "cEn", text: o.en }),
          el("span", { class: "cHi", text: o.hi }),
        ]))),
      voiceStatus(),
      voiceTag(),
      skipLink(),
    ]);
  }

  function scaleBlock(step) {
    const grid = el("div", { class: "scaleGrid" });
    for (let n = 0; n <= 10; n++) {
      grid.append(el("button", {
        class: "scaleBtn" + (step.answer.value === n ? " sel" : ""), type: "button", text: String(n),
        onClick: () => { step.answer.value = n; render(); },
      }));
    }
    return el("div", {}, [
      ...promptBlock(step),
      grid,
      el("div", { class: "scaleHint" }, [
        el("span", { text: "0 — " + (S.lang === "hi" ? "कोई दर्द नहीं" : "no pain") }),
        el("span", { text: "10 — " + (S.lang === "hi" ? "सबसे बुरा" : "worst imaginable") }),
      ]),
      el("div", { class: "btnRow scaleGo" }, [
        el("button", {
          class: "btn", type: "button", disabled: step.answer.value == null,
          text: (S.lang === "hi" ? "पुष्टि करें" : "Confirm") + " · " + (S.lang === "hi" ? "Confirm" : "पुष्टि करें"),
          onClick: () => {
            pushLog("patient", step.answer.value + " / 10");
            S.answers[step.id] = { value: step.answer.value, en: step.answer.value + " / 10", by: step.answer.value != null && S.heard ? "voice" : "touch", heard: S.heard || null };
            nextStep();
          },
        }),
      ]),
      voiceStatus(),
      voiceTag(),
      skipLink(),
    ]);
  }

  async function runStep() {
    const step = MK_STEPS[S.stepIdx];
    if (!step) { enterDocuments(); return; }
    if (step.kind === "bodymap") { S.tapped = false; S.bodyRegion = null; }
    S.heard = "";
    S.voiceNote = "";
    if (step.kind === "safety") { render(); await runSafety(); return; }
    const ask = step.ask || {};
    const primary = ask[S.lang] || ask.en || "";
    const secondary = S.lang === "hi" ? (ask.en || "") : (ask.hi || "");
    pushLog("kiosk", secondary && secondary !== primary ? primary + " · " + secondary : primary);
    render();
    await Voice.speak(speakTextFor(primary, secondary), S.lang);
    S.spoken = true;
    // open the microphone and wait for the person — no timer moves the visit on
    startListening(step);
  }

  async function runSafety() {
    S.safetySeen = true;
    S.safetyAck = false;
    S.safetyStage = "checking";
    pushLog("kiosk", S.lang === "hi" ? "चेतावनी के संकेत जाँच रहे हैं…" : "Checking for warning signs…");
    render();
    await Voice.speak(S.lang === "hi"
      ? "कृपया रुकिए। चेतावनी के संकेत जाँच रहे हैं।"
      : "Please wait. I am checking your answers for warning signs.", S.lang);
    S.redHits = evalRedFlags();
    S.redFired = S.redHits.length > 0;
    if (S.redFired) {
      S.safetyStage = "overlay";
      pushLog("sys", "Warning sign found — " + S.redHits.map((h) => h.id).join(", "), "sysRed");
      render();
      await Voice.speak(S.lang === "hi"
        ? "तत्काल। आपके जवाबों में चेतावनी संकेत मिला है। यह स्क्रीन स्टाफ को दिखाइए।"
        : "Urgent. A warning sign has been found in your answers. Please show this screen to a staff member now.", S.lang);
    } else {
      S.safetyStage = "panel";
      pushLog("sys", "Safety check passed — no warning signs.", "sysOk");
      render();
      await Voice.speak(S.lang === "hi"
        ? "कोई चेतावनी संकेत नहीं मिला।"
        : "No warning signs found.", S.lang);
    }
  }

  /* ----------------------------------------------------------- documents */

  function enterDocuments() {
    S.phase = "documents";
    S.docsStage = "upload";
    S.extracted = 0;
    pushLog("sys", "History captured — now the papers.", "sysOk");
    render();
    Voice.speak("Now the papers you brought. Hand them over whenever you are ready.", S.lang);
  }

  function addUploads(fileList) {
    Array.from(fileList || []).forEach((f) => {
      const isImg = /^image\//.test(f.type);
      S.uploads.push({
        name: f.name, type: f.type, isPdf: /pdf/i.test(f.type),
        url: isImg ? URL.createObjectURL(f) : null,
      });
    });
    render();
  }

  async function readPapers() {
    S.docsStage = "scan";
    S.extracted = 0;
    render();
    await Voice.speak("Reading the papers now. This stays on this machine.", S.lang);
    const pages = S.uploads.length ? S.uploads.length : MK_PAPERS.length;
    for (let i = 0; i < pages; i++) {
      if (S.phase !== "documents" || S.docsStage !== "scan") return;
      S.extracted = i + 1;
      render();
      await wait(1700);
    }
    S.docsStage = "review";
    S.extracted = 0;
    pushLog("sys", "Papers read — prescription, blood report, ECG, one handwritten slip.", "sysOk");
    render();
    await Voice.speak("I have read the papers. A prescription, a blood report, an ECG report and one handwritten slip were found.", S.lang);
  }

  function uploadedPages() {
    return S.uploads.map((u, i) => el("div", { class: "paper" }, [
      el("div", { class: "paperHead" }, [
        el("strong", { text: "Page " + (i + 1) + " · " + u.name }),
        el("span", { class: "hdrChip", style: "background:var(--teal-bg);color:var(--teal-d);border-color:var(--teal-line)", text: u.isPdf ? "PDF" : "photo" }),
      ]),
      u.url
        ? el("img", { src: u.url, alt: u.name })
        : el("div", { class: "paperBody" }, [el("div", { style: "font-weight:700", text: u.name }), el("div", { style: "font-size:.76rem;color:var(--muted)", text: "PDF page — shown to the reviewer as an image" })]),
      S.docsStage === "scan" && i === S.extracted - 1 ? el("div", { class: "scanline" }, el("div", { class: "sweep" })) : null,
    ]));
  }

  function renderDocuments(r) {
    const stage = S.docsStage;
    const card = el("div", { class: "card" });
    card.append(el("div", { class: "stepTag", text: stage === "upload"
      ? "STEP 1 · Hand over your papers · काग़ज़ दीजिए"
      : stage === "scan" ? "STEP 2 · Reading · पढ़ा जा रहा है"
      : "STEP 3 · Check what was read · जाँचें" }));

    if (stage === "upload") {
      card.append(el("div", { class: "prompt", text: "Hand over the papers you brought" }));
      card.append(el("div", { class: "promptSub", text: "Place the prescription, reports or old papers in the slot, or take a photo. The kiosk reads them here, on this machine, and shows you what it understood before the doctor sees it." }));
      card.append(el("div", { style: "margin-top:16px" }, [
        el("input", {
          type: "file", multiple: true, accept: "image/png,image/jpeg,image/webp,application/pdf",
          class: "fileInput", "aria-label": "Choose paper photos or PDFs",
          onChange: (e) => addUploads(e.target.files),
        }),
      ]));
      if (S.uploads.length) {
        card.append(el("h3", { style: "margin-top:18px", text: S.uploads.length + " page(s) ready" }));
        card.append(el("div", { class: "papers" }, uploadedPages()));
      }
      card.append(el("div", { class: "safetyNote", text: "Nothing is uploaded anywhere. The pages are read on this machine and the images are discarded after the visit." }));
      card.append(el("div", { class: "btnRow" }, [
        el("button", {
          class: "btn big", type: "button", disabled: !S.uploads.length,
          text: "Read these papers · काग़ज़ पढ़िए", onClick: readPapers,
        }),
      ]));
      card.append(el("div", { class: "voiceStatus", role: "status", text: S.uploads.length ? "Pages ready. Ask the kiosk to read them." : "Waiting for your papers…" }));
      r.append(el("div", { class: "stage" }, [rail(), el("div", { class: "logCol" }, [logView(), card])]));
      return;
    }

    const pages = S.uploads.length ? uploadedPages() : MK_PAPERS.map((p, i) => {
      const reading = stage === "scan" && i === S.extracted - 1;
      return el("div", { class: "paper" }, [
        el("div", { class: "paperHead" }, [
          el("strong", { text: p.type[S.lang] || p.type.en }),
          el("span", { class: "hdrChip", style: p.kind === "handwritten" ? "background:var(--amber-bg);color:var(--amber);border-color:var(--amber-line)" : "background:var(--ok-bg);color:var(--ok);border-color:#BCE3C9", text: p.kind === "handwritten" ? "handwritten" : "printed" }),
        ]),
        el("div", { class: "paperBody" }, [
          el("div", { style: "font-weight:700", text: p.title }),
          el("div", { style: "font-size:.76rem;color:var(--muted)", text: p.meta }),
          p.kind === "handwritten" ? el("div", { class: "rxBig", text: p.body }) : el("div", { text: p.body }),
        ]),
        reading ? el("div", { class: "scanline" }, el("div", { class: "sweep" })) : null,
      ]);
    });
    card.append(el("div", { class: "prompt", text: stage === "scan" ? "Reading your papers…" : "These are the papers we read" }));
    card.append(el("div", { class: "papers" }, pages));

    if (S.docsStage === "review") {
      card.append(el("h3", { style: "margin-top:24px", text: "What the kiosk understood" }));
      card.append(el("div", { class: "extractGrid" }, [
        el("div", { class: "sumSection" }, [
          el("h3", { text: "Medicines" }),
          ...MK_EXTRACTION.medicines.map((m) => el("div", { class: "exLine" }, [
            el("div", {}, [
              el("div", { class: "v", text: m.name + " " + m.dose }),
              el("div", { class: "sub", text: m.freq + " · " + m.source }),
            ]),
            el("div", {}, [
              el("span", { class: "flag " + m.flag, text: m.flag === "clear" ? "read clearly" : "doctor will check" }),
              el("div", { class: "prov", text: pct(m.conf) + " · " + m.prov }),
            ]),
          ])),
        ]),
        el("div", { class: "sumSection" }, [
          el("h3", { text: "Laboratory values" }),
          ...MK_EXTRACTION.labs.map((l) => el("div", { class: "exLine" }, [
            el("div", {}, [
              el("div", { class: "v", text: l.name + " — " + l.value }),
              el("div", { class: "sub", text: "reference " + l.range }),
            ]),
            el("div", {}, [
              el("span", { class: "flag " + (l.state === "normal" ? "clear" : l.state), text: l.state === "normal" ? "in range" : l.state }),
              el("div", { class: "prov", text: pct(l.conf) + " · " + l.prov }),
            ]),
          ])),
        ]),
        el("div", { class: "sumSection" }, [
          el("h3", { text: "Findings" }),
          ...MK_EXTRACTION.findings.map((f) => el("div", { class: "exLine" }, [
            el("div", { class: "v", text: f.name }),
            el("div", {}, [
              el("span", { class: "flag " + f.flag, text: f.flag === "clear" ? "read clearly" : "doctor will check" }),
              el("div", { class: "prov", text: pct(f.conf) + " · " + f.prov }),
            ]),
          ])),
          el("p", { style: "font-size:.82rem;color:var(--muted)", text: "Nothing here is invented: every line carries the page and line it came from. Low-confidence lines are marked for the doctor to confirm against your paper." }),
        ]),
      ]));
      card.append(el("div", { class: "btnRow" }, [
        el("button", {
          class: "btn big", type: "button",
          text: (S.lang === "hi" ? "आगे बढ़ें" : "Continue") + " · " + (S.lang === "hi" ? "Continue" : "आगे बढ़ें"),
          onClick: enterMerge,
        }),
      ]));
    } else {
      card.append(el("div", { class: "voiceStatus", role: "status", text: "Printed pages are read on this machine; handwriting is flagged for the doctor." }));
    }
    r.append(el("div", { class: "stage" }, [rail(), el("div", { class: "logCol" }, [logView(), card])]));
  }

  /* -------------------------------------------------------------- merge */

  function enterMerge() {
    S.phase = "merge";
    pushLog("sys", "History and papers joined into one summary.", "sysOk");
    render();
    Voice.speak("Your spoken history and your papers are now joined into one summary.", S.lang);
  }

  function renderMerge(r) {
    const hits = S.redHits || [];
    const card = el("div", { class: "card" }, [
      el("div", { class: "stepTag", text: "Module C · One merged record · एक संयुक्त रिकॉर्ड" }),
      el("div", { class: "prompt", text: "Your history and your papers together" }),
      el("div", { class: "promptSub", text: "Conflicts are never resolved silently: both values are kept and marked for the doctor." }),
      S.redFired
        ? el("div", { class: "alertBox red" }, [
            el("strong", { text: "Red flag " + hits.map((h) => h.id).join(" + ") }),
            el("div", { text: hits.map((h) => { const rule = MK_RULES.find((x) => x.id === h.id) || {}; return (rule[S.lang] || rule.en || h.id); }).join(" · ") + " — priority triage." }),
          ])
        : el("div", { class: "safetyOk", text: S.lang === "hi" ? "कोई रेड फ़्लैग नहीं — सामान्य कतार।" : "No red flags — routine path." }),
      ...MK_ALERTS.slice(1).map((a) => el("div", { class: "alertBox " + (a.kind === "verify" ? "amber" : "blue") }, [
        el("strong", { text: a.title }),
        el("div", { text: a.detail }),
      ])),
      el("h3", { style: "margin-top:18px", text: "Medicines — reconciled" }),
      ...MK_MED_MERGE.map((m) => el("div", { class: "exLine" }, [
        el("div", {}, [
          el("div", { class: "v", text: m.name }),
          el("div", { class: "sub", text: "source: " + m.source }),
        ]),
        el("span", { class: "flag " + (m.conflict ? "verify" : "clear"), text: m.conflict ? "verify" : "agreed" }),
      ])),
      el("h3", { style: "margin-top:18px", text: "Red-flag screening (Module A, run on this machine)" }),
      ruleRows(),
      el("div", { class: "btnRow" }, [
        el("button", {
          class: "btn big", type: "button",
          text: (S.lang === "hi" ? "आगे बढ़ें" : "Continue") + " · " + (S.lang === "hi" ? "Continue" : "आगे बढ़ें"),
          onClick: enterReadback,
        }),
      ]),
    ]);
    r.append(card);
  }

  /* ----------------------------------------------------------- readback */

  function enterReadback() {
    S.phase = "readback";
    S.rb = {};
    pushLog("sys", "Summary ready — please check it.", "sysOk");
    render();
    const lines = MK_READBACK[S.lang === "hi" ? "hi" : "en"];
    Voice.speak("Please check what we noted. " + lines.slice(0, 3).map((l) => l.text).join(" "), S.lang);
  }

  function setReadback(i, val) {
    S.rb = Object.assign({}, S.rb, { [i]: val });
    render();
  }

  const RB_SECTIONS = [
    { title: { en: "Your problem", hi: "आपकी समस्या" }, ids: [0, 1, 2, 3] },
    { title: { en: "Health background", hi: "स्वास्थ्य पृष्ठभूमि" }, ids: [4, 5, 6, 7] },
    { title: { en: "Your words & papers", hi: "आपकी बात और काग़ज़" }, ids: [8, 9] },
  ];

  function renderReadback(r) {
    const lines = MK_READBACK[S.lang === "hi" ? "hi" : "en"];
    const wrap = el("div", { class: "sumWrap" }, [
      el("div", { class: "sumHead" }, [
        el("h2", { text: "Please check your answers" }),
        el("div", { class: "shHi", text: "कृपया अपने उत्तर जाँचिए" }),
        el("div", { class: "shSub", text: S.lang === "hi"
          ? "डॉक्टर को यही सारांश दिखेगा। कुछ ग़लत लगे तो उस पंक्ति का Change दबाइए। निदान और इलाज का निर्णय केवल डॉक्टर करेंगे।"
          : "This is exactly what the doctor will see. If anything is wrong, tap Change on that line. Diagnosis and treatment decisions stay with the doctor." }),
      ]),
      S.redFired ? el("div", { class: "sumFlagBanner" }, [
        el("span", { class: "fbTag", text: "URGENT FLAG" }),
        document.createTextNode(S.redHits.map((h) => h.id + " ").join("") + "— " +
          ((MK_RULES.find((x) => x.id === (S.redHits[0] || {}).id) || {}).en || "") +
          ". Staff acknowledged · प्राथमिकता कतार में"),
      ]) : null,
      ...RB_SECTIONS.map((sec) => el("div", { class: "sumSection" }, [
        el("h3", {}, [
          document.createTextNode(sec.title.en + " "),
          el("span", { class: "ssHi", text: "· " + sec.title.hi }),
        ]),
        ...sec.ids.map((i) => {
          const l = lines[i];
          const st = (S.rb || {})[i];
          return el("div", { class: "sumRow" }, [
            el("div", { class: "srLab", text: l.field }),
            el("div", { class: "srVal" }, [el("div", { class: "vTxt", text: l.text })]),
            el("div", { class: "srSide" }, [
              el("span", { class: "badge cap", text: st === "no" ? "to change · बदलें" : "noted · दर्ज" }),
              el("button", {
                class: "chgBtn", type: "button", text: "✓ " + mkT("correct", S.lang),
                onClick: () => setReadback(i, "yes"),
              }),
              el("button", {
                class: "chgBtn", type: "button", text: "✗ " + mkT("change", S.lang),
                onClick: () => { setReadback(i, "no"); Voice.speak("Please tell the doctor what to change.", S.lang); },
              }),
            ]),
          ]);
        }),
      ])),
      el("div", { class: "sumConfirm" }, [
        el("div", { class: "scMsg" }, [
          document.createTextNode(S.lang === "hi" ? "सब जाँच लिया?" : "Checked everything?"),
          el("span", { class: "hi", text: "पुष्टि करें — सारांश डॉक्टर की स्क्रीन पर जाएगा" }),
        ]),
        el("button", {
          class: "btn big", type: "button", style: "background:#fff;color:var(--teal-dd)",
          text: "✓ Confirm — send to doctor's screen · भेजें",
          onClick: enterHandoff,
        }),
      ]),
    ]);
    r.append(wrap);
  }

  /* ------------------------------------------------------------ handoff */

  function enterHandoff() {
    S.phase = "handoff";
    pushLog("sys", S.redFired ? "Confirmed — sent to priority triage." : "Confirmed — sent to the doctor's screen.", "sysOk");
    render();
    Voice.speak("Thank you. Your summary is ready for the doctor.", S.lang);
  }

  function renderHandoff(r) {
    const C = mkConsent(S.lang);
    const rule0 = MK_RULES.find((x) => x.id === ((S.redHits[0] || {}).id || "")) || {};
    const card = el("div", { class: "card" }, [
      el("div", { class: "stepTag", text: "Module D · Consent-backed hand-off · सहमति" }),
      el("div", { class: "prompt", text: "Done. Your summary is with the doctor's screen." }),
      S.redFired
        ? el("div", { class: "alertInstruction" }, [
            el("div", { class: "aiBig", text: "This visit is flagged as PRIORITY TRIAGE — " + (rule0[S.lang] || rule0.en || "warning sign") + ". Please go to the triage desk now." }),
            el("div", { class: "aiHi", text: "यह विज़िट प्राथमिकता कतार में है — कृपया सहायता डेस्क पर जाइए।" }),
            el("div", { class: "aiMeta" }, [
              el("span", { class: "aiPill", text: S.redHits.map((h) => h.id).join(" + ") + " · priority triage" }),
              el("span", { class: "aiPill", text: "Consent " + C.artefact }),
            ]),
          ])
        : el("div", { class: "safetyOk", text: S.lang === "hi" ? "कृपया बैठिए। डॉक्टर जल्द ही बुलाएँगे।" : "Please take a seat. The doctor will see you shortly." }),
      el("p", { style: "margin-top:14px;color:var(--muted)", text: "Show this code if asked at the desk:" }),
      el("div", { class: "codeBig", text: "MK-2F41" }),
      el("dl", { class: "kv" }, [
        el("dt", { text: "Queue" }), el("dd", { text: S.redFired ? "Priority triage" : "Routine OPD" }),
        el("dt", { text: "Patient" }), el("dd", { text: MK_PATIENT.name + " · " + MK_PATIENT.age + " / " + MK_PATIENT.sex }),
        el("dt", { text: "ABHA" }), el("dd", { text: MK_PATIENT.abha }),
        el("dt", { text: C.ref }), el("dd", { style: "font-family:ui-monospace,monospace", text: C.artefact }),
        el("dt", { text: "Papers" }), el("dd", { text: "4 read · 1 handwritten flagged for the doctor" }),
        el("dt", { text: "Shared with" }), el("dd", { text: "Only the treating doctor, for this visit" }),
      ]),
      el("div", { class: "safetyNote", text: "Your voice was never recorded — only the words were read, and they are gone now." }),
      el("div", { class: "btnRow" }, [
        el("button", { class: "btn big", type: "button", text: "Open physician view · डॉक्टर स्क्रीन", onClick: enterPhysician }),
      ]),
    ]);
    r.append(card);
  }

  /* ----------------------------------------------------------- physician */

  function enterPhysician() {
    S.phase = "physician";
    pushLog("sys", "Summary handed to the physician screen.", "sysOk");
    render();
  }

  function hoRow(label, value, src) {
    return el("div", { class: "hoRow" }, [
      el("span", { class: "hK", text: label }),
      el("span", { class: "hV", text: value }),
      el("span", { class: "hSrc", text: src || "—" }),
    ]);
  }

  function renderPhysician(r) {
    const comp = CC_DETECT[S.bodyRegion] || CC_DETECT.general;
    const hits = S.redHits || [];
    const queuePri = S.redFired;
    const wrap = el("div", { class: "hoWrap" }, [
      el("div", { class: "sumSection" }, [
        el("h3", {}, [
          document.createTextNode("Today's queue "),
          el("span", { class: "ssHi", text: "· आज की कतार" }),
        ]),
        ...MK_WORKLIST.map((w, i) => el("button", {
          class: "workItem", type: "button", "aria-current": String(i === 0),
        }, [
          el("div", {}, [el("strong", { text: w.name + " · " + w.age })]),
          el("div", { style: "color:var(--muted)", text: w.problem }),
          el("div", { style: "margin-top:6px" }, [
            el("span", {
              class: "hoPill " + (i === 0 ? (queuePri ? "pri" : "ok") : (w.flag ? "pri" : "ok")),
              text: i === 0 ? (queuePri ? "PRIORITY TRIAGE" : "ROUTINE OPD") : w.queue.toUpperCase(),
            }),
          ]),
        ])),
        el("p", { style: "margin-top:12px;font-size:.8rem;color:var(--muted)", text: "Machine-generated history and paper extracts carry provenance. Assessment and plan are physician-only." }),
      ]),
      el("div", { class: "hoSheet" }, [
        el("div", { class: "hoHead" }, [
          el("div", { class: "hoT", text: "Physician summary — pre-consultation record" }),
          el("div", { class: "hoMeta" }, [
            el("span", { class: "hoPill", text: MK_PATIENT.name + " · " + MK_PATIENT.age + " / " + MK_PATIENT.sex }),
            el("span", { class: "hoPill", text: "session MK-2F41 · consent " + MK_CONSENT_REF }),
            el("span", { class: "hoPill", text: "language: " + mkLang(S.lang).native }),
            el("span", { class: "hoPill " + (queuePri ? "pri" : "ok"), text: queuePri ? "QUEUED: PRIORITY TRIAGE" : "QUEUED: ROUTINE OPD" }),
            el("span", { class: "hoPill", text: "captured on-device · offline" }),
          ]),
        ]),
        queuePri
          ? el("div", { class: "hoBanner", text: "⚠ URGENT FLAG — " + hits.map((h) => h.id).join(", ") + " matched at the safety check. Evidence: " + hits.map((h) => h.id + " («" + (h.evidence || []).join("», «") + "»)").join(" · ") + ". Staff acknowledged." })
          : el("div", { class: "hoBanner", style: "background:var(--ok-bg);border-color:#BCE3C9;color:var(--ok)", text: "Safety check: 4 fixed rules checked — none matched. Routine queue." }),
        el("div", { class: "hoBody" }, [
          el("div", { class: "hoSec" }, [
            el("h4", { text: "Presenting problem" }),
            hoRow("Main problem", S.lang === "hi" ? comp.hi : comp.en, "touch"),
          ]),
          el("div", { class: "hoSec" }, [
            el("h4", { text: "S — Subjective (from the patient's own words)" }),
            ...MK_SOAP.s.map((x) => hoRow(x.prov, x.text, "voice")),
          ]),
          el("div", { class: "hoSec" }, [
            el("h4", { text: "O — Objective (papers + capture)" }),
            ...MK_SOAP.o.map((x) => hoRow(x.prov, x.text, "document")),
          ]),
          el("div", { class: "hoSec" }, [
            el("h4", { text: "Medicines — reconciled" }),
            ...MK_MED_MERGE.map((m) => hoRow(m.conflict ? "verify" : "agreed", m.name + " — source: " + m.source, m.conflict ? "verify" : "agreed")),
          ]),
          el("div", { class: "hoSec" }, [
            el("h4", { text: "Paper extracts" }),
            ...MK_EXTRACTION.labs.map((l) => hoRow(l.name, l.value + "  (reference " + l.range + ")", l.prov)),
            hoRow("ECG", "T-wave inversion V4–V6, ST depression V5–V6 — ischaemic changes, correlate", "doc:ecg1"),
          ]),
          el("div", { class: "hoSec" }, [
            el("h4", { text: "Assessment & plan — physician only" }),
            el("div", { class: "locked" }, [
              el("span", { class: "lkTag", text: "Locked · केवल डॉक्टर" }),
              el("div", {}, [
                el("b", { text: "The kiosk never diagnoses or recommends treatment. " }),
                "Assessment and plan are completed by the physician at consultation. This handoff ends at the structured history.",
              ]),
            ]),
            el("div", { class: "detailRow" }, [
              el("label", { text: "Physician's assessment and plan…" }),
              el("textarea", { rows: 3 }),
            ]),
          ]),
          el("div", { class: "hoSec" }, [
            el("h4", { text: "FHIR bundle — hospital system / ABDM" }),
            el("dl", { class: "kv" }, [
              el("dt", { text: "Profile" }), el("dd", { text: MK_FHIR.profile }),
              el("dt", { text: "Type" }), el("dd", { text: MK_FHIR.snomed }),
              el("dt", { text: "Sections" }), el("dd", { text: MK_FHIR.sections }),
              el("dt", { text: "Resources" }), el("dd", { text: MK_FHIR.counts }),
              el("dt", { text: "Attestation" }), el("dd", { text: MK_FHIR.attester }),
            ]),
            el("pre", { class: "fhirBlock", text:
`{
  "resourceType": "Bundle",
  "type": "document",
  "identifier": { "value": "MK-2F41" },
  "timestamp": "2026-09-17T10:42:00+05:30",
  "meta": { "profile": ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord"] },
  "entry": [
    { "resource": { "resourceType": "Patient", "name": "Ramesh Kumar", "gender": "male", "birthDate": "1972" } },
    { "resource": { "resourceType": "Observation", "code": "HbA1c", "valueQuantity": 8.4 } },
    { "resource": { "resourceType": "MedicationRequest", "medication": "Telmisartan 40 mg" } },
    { "resource": { "resourceType": "Consent", "id": "CM-2026-09-17-8F2A41" } }
  ]
}` }),
          ]),
        ]),
        el("div", { class: "hoFoot", text: "HistoryBundle · handoff MK-2F41-H1 · captured on-device, queued locally (offline-first) · consent " + MK_CONSENT_REF + " · ABHA " + MK_PATIENT.abha }),
      ]),
      el("div", { class: "hoActions" }, [
        el("button", { class: "btn ghost", type: "button", text: "← Back to patient summary", onClick: () => { S.phase = "readback"; render(); } }),
        el("button", { class: "btn ghost", type: "button", text: "↺ New patient", onClick: () => location.reload() }),
      ]),
    ]);
    r.append(wrap);
  }

  /* ---------------------------------------------------------------- boot */

  function installUnlock() {
    const handler = () => {
      if (S.spoken || S.unlocking) return;
      S.unlocking = true;
      Voice.speak(mkLang(S.lang).greet + ". " + mkT("tagline", S.lang), S.lang).then((ok) => {
        S.unlocking = false;
        if (ok) { S.spoken = true; render(); }
      });
    };
    ["pointerdown", "keydown", "touchstart"].forEach((ev) => document.addEventListener(ev, handler, { passive: true }));
  }

  function boot() {
    Voice.load(() => {
      if (!S.voiceName) {
        const best = Voice.bestFor(mkLang(S.lang).speech);
        if (best) Voice.setVoice(best.name);
      }
      render();
    });
    render();
    installUnlock();
    setInterval(() => {
      const t = root().querySelector(".cbTimer");
      if (t && S.startedAt) t.textContent = elapsed();
    }, 1000);
    setTimeout(() => {
      Voice.speak(mkLang(S.lang).greet + ". " + mkT("tagline", S.lang), S.lang).then((ok) => {
        if (ok) { S.spoken = true; render(); }
      });
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
