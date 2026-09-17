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
    docsStage: "upload",   // upload -> scan -> review
    extracted: 0,
    uploads: [],
    heard: "",
    bodyView: "front",
    bodyRegion: null,
    tapped: false,
    rb: {},
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
  function pane() { return document.getElementById("pane"); }
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
    function load() {
      if (!supported) return;
      try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
      if (!voices.length) window.speechSynthesis.onvoiceschanged = () => { voices = window.speechSynthesis.getVoices() || []; };
    }
    function voiceFor(tag) {
      if (!supported) return null;
      if (!voices.length) { try { voices = window.speechSynthesis.getVoices() || []; } catch (e) {} }
      const want = String(tag || "").toLowerCase();
      const base = want.split("-")[0];
      return voices.find((v) => v.lang.toLowerCase() === want)
        || voices.find((v) => v.lang.toLowerCase().replace(/_/g, "-") === want)
        || voices.find((v) => v.lang.toLowerCase().replace(/_/g, "-").indexOf(base + "-") === 0)
        || voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base)
        || null;
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
    return { supported, load, speak, stop, voiceFor };
  })();

  const Ears = (function () {
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    let active = null;
    function available() { return !!SR; }
    function listen(bcp47, onPartial, maxMs) {
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
        rec.onerror = () => done(finalText.trim());
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
    const strip = pane().querySelector(".voice-strip");
    if (!strip) return;
    strip.classList.toggle("live", !!S.listening);
    const label = strip.querySelector(".voice-text");
    if (label) label.textContent = S.listening ? mkT("listening", S.lang) : mkT("speakNow", S.lang);
    const mic = strip.querySelector("#mic-btn");
    if (mic) mic.textContent = S.listening ? mkT("stopListening", S.lang) : mkT("speakNow", S.lang);
  }

  function setTranscript(box, text) {
    const t = box.querySelector(".transcript");
    if (t) t.textContent = text;
  }

  let listenToken = 0;

  function voiceTurn(step) {
    return !!(step && ["bodymap", "safety"].indexOf(step.kind) < 0);
  }

  /* Opens the recogniser and waits — for as long as it takes — for the person
     to speak. A spoken answer is taken as the answer for this question. */
  function startListening(step) {
    if (!voiceTurn(step) || !Ears.available()) { updateVoiceUI(); return; }
    const box = pane();
    const tr = box.querySelector(".transcript");
    const token = ++listenToken;
    Voice.stop();
    S.listening = true;
    updateVoiceUI();
    Ears.listen(mkLang(S.lang).speech, (partial) => {
      if (token !== listenToken || !tr) return;
      tr.textContent = partial + "▌";
    }, 120000).then((text) => {
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
    const box = pane();
    const tr = box.querySelector(".transcript");
    if (tr) tr.textContent = text;
    matchSpoken(step, text);
    S.heard = text;
    S.answers[step.id] = Object.assign({}, step.answer, { heard: text, by: "voice" });
    updateVoiceUI();
    const idx = S.stepIdx;
    setTimeout(() => {
      if (S.phase === "interview" && S.stepIdx === idx) nextStep();
    }, 1100);
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
    if (S.stepIdx >= MK_STEPS.length - 1) { enterDocuments(); return; }
    S.stepIdx += 1;
    runStep();
  }
  function skipStep() {
    const step = MK_STEPS[S.stepIdx];
    if (step) S.answers[step.id] = { skipped: true };
    nextStep();
  }
  function prevStep() {
    stopListening();
    Voice.stop();
    if (S.phase === "interview" && S.stepIdx > 0) { S.stepIdx -= 1; runStep(); }
  }

  /* -------------------------------------------------------------- chrome */

  function renderHeader() {
    const head = document.getElementById("kiosk-header");
    clear(head);
    const active = moduleForPhase();
    const rail = el("div", { class: "header-tools" },
      ["A", "B", "C", "D"].map((m) =>
        el("span", { class: "chip" + (m === active ? " ok" : ""), text: "Module " + m })));
    head.append(
      el("div", { class: "brand" }, [
        el("strong", { text: "MediKiosk" }),
        el("span", { text: mkT("tagline", S.lang) }),
      ]),
      el("div", { class: "header-tools" }, [
        rail,
        el("button", {
          class: "sound-btn", type: "button", "aria-pressed": String(S.voiceOn),
          text: S.voiceOn ? "🔊 Voice on" : "🔇 Voice off",
          onClick: () => { S.voiceOn = !S.voiceOn; if (!S.voiceOn) Voice.stop(); render(); },
        }),
        el("button", { class: "btn btn-sm", type: "button", text: "Restart", onClick: () => location.reload() }),
      ]),
    );
    const hint = document.getElementById("sound-hint");
    if (hint) hint.classList.toggle("hidden", S.spoken);
  }

  function renderProgress() {
    const bar = document.getElementById("progress");
    clear(bar);
    if (S.phase === "welcome" || S.phase === "physician") return;
    const total = MK_STEPS.length + 3;
    let done = 0, label = "";
    if (S.phase === "interview") { done = S.stepIdx; label = (MK_SECTIONS[MK_STEPS[S.stepIdx].section] || {}); label = label[S.lang] || label.en || ""; }
    else if (S.phase === "documents") { done = MK_STEPS.length; label = MK_SECTIONS.documents[S.lang] || MK_SECTIONS.documents.en; }
    else if (S.phase === "merge") { done = MK_STEPS.length + 1; label = "Summary"; }
    else { done = MK_STEPS.length + 2; label = "Check & confirm"; }
    const p = Math.round((done / total) * 100);
    bar.append(
      el("span", { class: "progress-label", text: label }),
      el("div", { class: "progress-track" }, el("div", { class: "progress-fill", style: "width:" + p + "%" })),
      el("span", { class: "progress-label", text: p + "%" }),
    );
  }

  function footer(children) {
    const f = document.getElementById("footer");
    clear(f);
    (children || []).forEach((c) => c && f.append(c));
  }

  function render() {
    document.documentElement.lang = S.lang;
    document.documentElement.dir = ["ur", "ks", "sd"].indexOf(S.lang) >= 0 ? "rtl" : "ltr";
    renderHeader();
    renderProgress();
    clear(pane());
    const map = {
      welcome: renderWelcome, interview: renderInterview, documents: renderDocuments,
      merge: renderMerge, readback: renderReadback, handoff: renderHandoff,
      physician: renderPhysician,
    };
    (map[S.phase] || renderWelcome)();
  }

  /* ------------------------------------------------------------- welcome */

  function renderWelcome() {
    const C = mkConsent(S.lang);
    const grid = el("div", { class: "lang-grid" }, MK_LANGS.map((l) =>
      el("button", {
        class: "btn lang-btn", type: "button", "aria-pressed": String(l.code === S.lang), lang: l.code,
        onClick: () => {
          S.lang = l.code;
          S.spoken = true; // the tap is a user gesture: the voice is unlocked
          Voice.speak(mkLang(l.code).greet + ". " + mkT("tagline", l.code), l.code);
          render();
        },
      }, [
        el("span", { class: "native", lang: l.code, text: l.native }),
        el("span", { class: "eng", text: l.name + (l.code === "en" ? "" : " · " + l.speech) }),
      ])));

    const node = el("section", { class: "card" }, [
      el("span", { class: "tag", text: "MediKiosk · OPD self check-in" }),
      el("h1", { text: mkLang(S.lang).greet }),
      el("p", { class: "ask", text: mkT("tagline", S.lang) }),
      el("h3", { text: mkT("chooseLang", S.lang) + " · 22 languages" }),
      el("p", { class: "muted small", text: mkT("langNote", S.lang) }),
      grid,
      el("div", { class: "card", style: "margin-top:26px;background:var(--surface-2)" }, [
        el("h3", { text: mkT("consentHead", S.lang) }),
        el("p", { text: C.purpose }),
        el("div", { class: "choices two" }, [
          el("div", {}, [
            el("p", { class: "small", style: "font-weight:800;margin-bottom:6px", text: C.takeTitle }),
            el("ul", { class: "small" }, C.take.map((x) => el("li", { text: x }))),
          ]),
          el("div", {}, [
            el("p", { class: "small", style: "font-weight:800;margin-bottom:6px", text: C.neverTitle }),
            el("ul", { class: "small" }, C.never.map((x) => el("li", { text: x }))),
          ]),
        ]),
        el("p", { class: "small" }, C.retention),
        el("p", { class: "small" }, C.rights),
        el("div", { class: "choices two", style: "margin-top:10px" }, [
          el("div", { class: "banner info small" }, [
            el("strong", { text: C.ref + " " }),
            el("span", { class: "mono", text: C.artefact }),
            el("div", { class: "tiny", text: C.abdm }),
          ]),
          el("div", { class: "banner ok small", text: C.linked + " " + MK_PATIENT.abha }),
        ]),
        el("label", { class: "tick", style: "display:flex;gap:14px;align-items:flex-start;margin-top:14px;font-weight:700" }, [
          el("input", {
            type: "checkbox", style: "width:30px;height:30px;margin-top:2px", checked: S.agree,
            onChange: (e) => {
              S.agree = e.target.checked;
              const b = document.getElementById("begin-btn");
              if (b) b.disabled = !S.agree;
            },
          }),
          el("span", { text: mkT("agree", S.lang) }),
        ]),
      ]),
      el("p", { class: "small muted", text: "Patient: " + MK_PATIENT.name + " · " + MK_PATIENT.age + " / " + MK_PATIENT.sex + " · " + MK_PATIENT.visit }),
    ]);
    pane().append(node);

    footer([
      el("span", { class: "small muted", text: "The kiosk reads every question aloud and listens to your answer." }),
      el("button", {
        class: "btn btn-primary btn-lg", id: "begin-btn", type: "button", disabled: !S.agree,
        text: mkT("begin", S.lang), onClick: startVisit,
      }),
    ]);
    document.documentElement.lang = S.lang;
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
    S.phase = "interview";
    S.stepIdx = 0;
    runStep();
  }

  /* ----------------------------------------------------------- interview */

  function renderInterview() {
    const step = MK_STEPS[S.stepIdx];
    const sec = MK_SECTIONS[step.section] || {};
    const card = el("section", { class: "card" });
    card.append(el("span", { class: "tag", text: (sec[S.lang] || sec.en) + " · " + (S.stepIdx + 1) + " / " + MK_STEPS.length }));

    const strip = el("div", { class: "voice-strip" + (S.listening ? " live" : "") }, [
      el("span", { class: "voice-dot" }),
      el("div", { class: "wave" }, [1, 2, 3, 4, 5].map(() => el("i"))),
      el("div", {}, [
        el("div", { class: "voice-text", text: S.listening ? mkT("listening", S.lang) : mkT("speakNow", S.lang) }),
        el("div", { class: "voice-sub", text: "The kiosk reads the question; answer by voice or by touch." }),
      ]),
      el("button", { class: "btn btn-sm", type: "button", text: mkT("hearAgain", S.lang), onClick: () => Voice.speak(askText(step), S.lang) }),
      voiceTurn(step) && Ears.available()
        ? el("button", {
            class: "btn btn-sm" + (S.listening ? " btn-primary" : ""), id: "mic-btn", type: "button",
            text: S.listening ? mkT("stopListening", S.lang) : mkT("speakNow", S.lang),
            onClick: () => (S.listening ? stopListening() : startListening(step)),
          })
        : null,
    ]);
    card.append(strip);

    card.append(el("h2", { class: "ask", text: askText(step) }));

    if (step.kind === "bodymap") card.append(bodymapBlock());
    else if (step.kind === "text") card.append(el("textarea", { class: "textarea", rows: 3, placeholder: mkT("yourAnswer", S.lang), value: (step.answer.text || ""), onInput: (e) => { step.answer.text = e.target.value; } }));
    else if (step.kind === "cc") card.append(el("div", { class: "banner ok", text: "Noted: " + (REGION_COMPLAINT[S.bodyRegion] || "your main problem") }));
    else if (step.kind === "scale") card.append(scaleBlock(step));
    else if (step.kind === "chips" || step.kind === "multi") card.append(chipsBlock(step));
    else if (step.kind === "yesno") card.append(yesnoBlock(step));
    else if (step.kind === "safety") card.append(safetyBlock());

    card.append(el("div", { class: "transcript", text: S.heard || "" }));
    card.append(el("p", { class: "small muted", text: "You can tap an answer instead of speaking. Every question can be skipped." }));
    pane().append(card);

    footer([
      el("button", { class: "btn", type: "button", text: mkT("back", S.lang), disabled: S.stepIdx === 0, onClick: prevStep }),
      el("button", { class: "btn", type: "button", text: mkT("skip", S.lang), onClick: skipStep }),
      el("span", { class: "grow small muted", text: "Answer by voice or tap — the kiosk waits for you." }),
      el("button", {
        class: "btn btn-primary btn-lg", type: "button", text: mkT("next", S.lang),
        disabled: step.kind === "safety" && !S.safetyAck, onClick: nextStep,
      }),
    ]);
  }

  function bodymapBlock() {
    const stage = el("div", { class: "bm-stage", html: mkBodySvg(S.bodyView, S.bodyRegion) });
    stage.addEventListener("click", (e) => {
      const g = e.target.closest(".bm-hot");
      if (!g) return;
      pickRegion(g.getAttribute("data-region"));
    });
    stage.addEventListener("keydown", (e) => {
      const g = e.target.closest(".bm-hot");
      if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pickRegion(g.getAttribute("data-region")); }
    });
    const legend = el("div", { class: "bm-legend" },
      (S.bodyView === "front"
        ? [["head", "Head", "सिर"], ["chest", "Chest", "छाती"], ["abdomen", "Belly", "पेट"], ["armL", "Left arm", "बायाँ हाथ"], ["armR", "Right arm", "दायाँ हाथ"], ["legL", "Left leg / knee", "बायाँ घुटना"], ["legR", "Right leg / knee", "दायाँ घुटना"]]
        : [["head", "Head", "सिर"], ["back", "Back", "पीठ"], ["armL", "Left arm", "बायाँ हाथ"], ["armR", "Right arm", "दायाँ हाथ"], ["legL", "Left leg / knee", "बायाँ घुटना"], ["legR", "Right leg / knee", "दायाँ घुटना"]]
      ).map(([id, en, hi]) =>
        el("button", {
          class: "bm-btn" + (S.bodyRegion === id ? " sel" : ""), type: "button", onClick: () => pickRegion(id),
        }, [el("span", { class: "en", text: en }), el("span", { class: "hi", text: hi })])));

    return el("div", {}, [
      el("p", { class: "muted", text: mkT("tapWhere", S.lang) }),
      el("div", { class: "bm-wrap" }, [
        el("div", { class: "bm-figure-col" }, [
          el("div", { class: "bm-toggle" }, [
            el("button", { class: S.bodyView === "front" ? "sel" : "", type: "button", text: "Front · सामने", onClick: () => { S.bodyView = "front"; render(); } }),
            el("button", { class: S.bodyView === "back" ? "sel" : "", type: "button", text: "Back · पीछे", onClick: () => { S.bodyView = "back"; render(); } }),
          ]),
          stage,
        ]),
        legend,
      ]),
    ]);
  }

  function pickRegion(id) {
    S.bodyRegion = id;
    S.tapped = true;
    const labels = {
      head: "Head", chest: "Chest", abdomen: "Belly", back: "Back",
      armL: "Left arm", armR: "Right arm", legL: "Left leg / knee", legR: "Right leg / knee", general: "Somewhere else",
    };
    setTranscript(pane(), (labels[id] || id) + " — " + (id === "chest" ? "centre of the chest" : "noted"));
    render();
  }

  function chipsBlock(step) {
    const multi = step.kind === "multi";
    const chosen = multi ? (step.answer.values || []) : [step.answer.value];
    return el("div", { class: "choices" }, (step.options || []).map((o) => {
      const on = chosen.indexOf(o.v) >= 0;
      return el("button", {
        class: "btn choice", type: "button", "aria-pressed": String(on),
        onClick: () => {
          if (multi) {
            let v = (step.answer.values || []).slice();
            v = on ? v.filter((x) => x !== o.v) : v.concat([o.v]);
            step.answer.values = v;
            render();
          } else {
            step.answer.value = on ? null : o.v;
            S.answers[step.id] = step.answer;
            render();
            if (!on) advanceSoon();
          }
        },
      }, [el("span", { text: o[S.lang] || o.en })]);
    }));
  }

  function safetyBlock() {
    const fired = MK_RULES.filter((r) => r.fire);
    return el("div", {}, [
      fired.length
        ? el("div", { class: "redflag", text: "Warning sign found. Please show this screen to the staff member at the desk now." })
        : el("div", { class: "banner ok", text: "No warning signs found. Please continue." }),
      el("h3", { style: "margin-top:20px", text: "Every rule is shown with its result — this is a fixed checklist, not an opinion." }),
      el("div", { class: "rules" }, MK_RULES.map((r) =>
        el("div", { class: "rule " + (r.fire ? "fire" : "pass") }, [
          el("span", { class: "mark", text: r.fire ? "!" : "✓" }),
          el("span", { text: r.id + " — " + (r[S.lang] || r.en) }),
          el("span", { class: "why", text: (S.lang === "hi" ? r.termsHi : r.termsEn) }),
        ]))),
      el("button", {
        class: "btn " + (S.safetyAck ? "" : "btn-danger") + " btn-lg", type: "button",
        style: "margin-top:18px", disabled: S.safetyAck,
        text: S.safetyAck ? "Staff acknowledged — priority triage" : "Staff: acknowledge and continue",
        onClick: () => { S.safetyAck = true; nextStep(); },
      }),
    ]);
  }

  function yesnoBlock(step) {
    return el("div", { class: "choices two" }, MK_YESNO.map((o) =>
      el("button", {
        class: "btn choice", type: "button", "aria-pressed": String(step.answer.value === o.v),
        onClick: () => { step.answer.value = o.v; S.answers[step.id] = step.answer; render(); advanceSoon(); },
      }, o[S.lang] || o.en)));
  }

  function scaleBlock(step) {
    const grid = el("div", { class: "scale" });
    for (let n = 0; n <= 10; n++) {
      grid.append(el("button", {
        class: "btn", type: "button", "aria-pressed": String(step.answer.value === n), text: String(n),
        onClick: () => { step.answer.value = n; S.answers[step.id] = step.answer; render(); advanceSoon(); },
      }));
    }
    return el("div", {}, [
      grid,
      el("div", { class: "scale-hint" }, [el("span", { text: "0 — no pain" }), el("span", { text: "10 — worst pain" })]),
    ]);
  }

  async function runStep() {
    const step = MK_STEPS[S.stepIdx];
    if (!step) { enterDocuments(); return; }
    if (step.kind === "bodymap") { S.tapped = false; S.bodyRegion = null; }
    S.heard = "";
    render();
    await Voice.speak(askText(step), S.lang);
    S.spoken = true;
    if (step.kind === "safety") { await runSafety(); return; }
    // open the microphone and wait for the person — no timer moves the visit on
    startListening(step);
  }

  async function runSafety() {
    S.safetyAck = false;
    render();
    await Voice.speak("Please wait. I am checking your answers for warning signs.", S.lang);
    await wait(600);
    render();
    await Voice.speak("Urgent. Chest pain with breathlessness has been found. Please show this screen to a staff member now.", S.lang);
  }

  /* ----------------------------------------------------------- documents */

  function enterDocuments() {
    S.phase = "documents";
    S.docsStage = "upload";
    S.extracted = 0;
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
    render();
    await Voice.speak("I have read the papers. A prescription, a blood report, an ECG report and one handwritten slip were found.", S.lang);
  }

  function uploadedPages() {
    return S.uploads.map((u, i) => el("div", { class: "paper" }, [
      el("div", { class: "paper-head" }, [
        el("strong", { text: "Page " + (i + 1) }),
        el("span", { class: "chip" + (u.isPdf ? "" : " ok"), text: u.isPdf ? "PDF" : "photo" }),
      ]),
      u.url
        ? el("img", { src: u.url, alt: u.name, style: "width:100%;display:block;max-height:340px;object-fit:contain;background:#fff" })
        : el("div", { class: "paper-body" }, [el("div", { style: "font-weight:700", text: u.name }), el("div", { class: "tiny muted", text: "PDF page — shown to the reviewer as an image" })]),
      S.docsStage === "scan" && i === S.extracted - 1 ? el("div", { class: "scanline" }, el("div", { class: "sweep" })) : null,
    ]));
  }

  function renderDocuments() {
    const stage = S.docsStage;
    const card = el("section", { class: "card" });
    card.append(el("span", { class: "tag", text: "Module B · Paper digitisation · " + (stage === "upload" ? "hand-over" : stage === "scan" ? "reading" : "verify") }));

    if (stage === "upload") {
      card.append(el("h2", { class: "ask", text: "Hand over the papers you brought" }));
      card.append(el("p", { class: "muted", text: "Place the prescription, reports or old papers in the slot, or take a photo. The kiosk reads them here, on this machine, and shows you what it understood before the doctor sees it." }));
      card.append(el("input", {
        type: "file", multiple: true, accept: "image/png,image/jpeg,image/webp,application/pdf",
        class: "textinput", "aria-label": "Choose paper photos or PDFs",
        onChange: (e) => addUploads(e.target.files),
      }));
      if (S.uploads.length) {
        card.append(el("h3", { style: "margin-top:18px", text: S.uploads.length + " page(s) ready" }));
        card.append(el("div", { class: "papers" }, uploadedPages()));
      }
      card.append(el("p", { class: "small muted", style: "margin-top:14px", text: "Nothing is uploaded anywhere. The pages are read and the images are discarded after the visit." }));
      pane().append(card);
      footer([
        el("span", { class: "small muted", text: S.uploads.length ? "Pages ready. Ask the kiosk to read them." : "Waiting for your papers…" }),
        el("button", {
          class: "btn btn-primary btn-lg", type: "button", disabled: !S.uploads.length,
          text: "Read these papers", onClick: readPapers,
        }),
      ]);
      return;
    }

    const pages = S.uploads.length ? uploadedPages() : MK_PAPERS.map((p, i) => {
      const reading = stage === "scan" && i === S.extracted - 1;
      return el("div", { class: "paper" }, [
        el("div", { class: "paper-head" }, [
          el("strong", { text: p.type[S.lang] || p.type.en }),
          el("span", { class: "chip" + (p.kind === "handwritten" ? " warn" : " ok") , text: p.kind === "handwritten" ? "handwritten" : "printed" }),
        ]),
        el("div", { class: "paper-body" + (p.kind === "handwritten" ? " paper-rx" : "") }, [
          el("div", { style: "font-weight:700", text: p.title }),
          el("div", { class: "tiny muted", text: p.meta }),
          el("div", { text: p.body }),
        ]),
        reading ? el("div", { class: "scanline" }, el("div", { class: "sweep" })) : null,
      ]);
    });
    card.append(el("h2", { class: "ask", text: stage === "scan" ? "Reading your papers…" : "These are the papers we read" }));
    card.append(el("div", { class: "papers" }, pages));

    if (S.docsStage === "review") {
      card.append(el("h3", { style: "margin-top:24px", text: "What the kiosk understood" }));
      card.append(el("div", { class: "extract-grid" }, [
        el("div", { class: "card" }, [
          el("h3", { text: "Medicines" }),
          ...MK_EXTRACTION.medicines.map((m) => el("div", { class: "line" }, [
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
        el("div", { class: "card" }, [
          el("h3", { text: "Laboratory values" }),
          ...MK_EXTRACTION.labs.map((l) => el("div", { class: "line" }, [
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
        el("div", { class: "card" }, [
          el("h3", { text: "Findings" }),
          ...MK_EXTRACTION.findings.map((f) => el("div", { class: "line" }, [
            el("div", { class: "v", text: f.name }),
            el("div", {}, [
              el("span", { class: "flag " + f.flag, text: f.flag === "clear" ? "read clearly" : "doctor will check" }),
              el("div", { class: "prov", text: pct(f.conf) + " · " + f.prov }),
            ]),
          ])),
          el("p", { class: "small muted", text: "Nothing here is invented: every line carries the page and line it came from. Low-confidence lines are marked for the doctor to confirm against your paper." }),
        ]),
      ]));
    }
    pane().append(card);

    footer(
      stage === "scan"
        ? [el("span", { class: "small muted", text: "Printed pages are read on this machine; handwriting is flagged for the doctor." })]
        : [el("span", { class: "small muted", text: "You can change anything that is wrong." }),
           el("button", { class: "btn btn-primary btn-lg", type: "button", text: mkT("next", S.lang), onClick: enterMerge })]
    );
  }

  /* -------------------------------------------------------------- merge */

  function enterMerge() {
    S.phase = "merge";
    render();
    Voice.speak("Your spoken history and your papers are now joined into one summary.", S.lang);
  }

  function renderMerge() {
    const card = el("section", { class: "card" });
    card.append(el("span", { class: "tag", text: "Module C · One merged record" }));
    card.append(el("h2", { class: "ask", text: "Your history and your papers together" }));

    card.append(el("div", { class: "choices two" }, [
      el("div", { class: "card" }, [
        el("h3", { text: "Alerts" }),
        ...MK_ALERTS.map((a) => el("div", { class: "alert " + a.kind }, [
          el("strong", { text: a.title }),
          el("div", { class: "detail", text: a.kind === "red-flag" ? "" : "" }),
          el("div", { class: "small", text: a.detail }),
        ])),
      ]),
      el("div", { class: "card" }, [
        el("h3", { text: "Medicines — reconciled" }),
        ...MK_MED_MERGE.map((m) => el("div", { class: "line" }, [
          el("div", {}, [
            el("div", { class: "v", text: m.name }),
            el("div", { class: "sub", text: "source: " + m.source }),
          ]),
          el("span", { class: "flag " + (m.conflict ? "verify" : "clear"), text: m.conflict ? "verify" : "agreed" }),
        ])),
        el("p", { class: "small muted", text: "Conflicts are never resolved silently: both values are kept and marked for the doctor." }),
      ]),
    ]));

    card.append(el("div", { class: "card", style: "margin-top:16px" }, [
      el("h3", { text: "Red-flag screening (Module A, run on this machine)" }),
      ...MK_RULES.map((r) => el("div", { class: "rule " + (r.fire ? "fire" : "pass") }, [
        el("span", { class: "mark", text: r.fire ? "!" : "✓" }),
        el("span", { text: r.id + " — " + (r[S.lang] || r.en) }),
        el("span", { class: "why", text: r.termsEn }),
      ])),
    ]));
    pane().append(card);

    footer([
      el("span", { class: "small muted", text: "No diagnosis is made anywhere in this record." }),
      el("button", { class: "btn btn-primary btn-lg", type: "button", text: mkT("next", S.lang), onClick: enterReadback }),
    ]);
  }

  /* ----------------------------------------------------------- readback */

  function enterReadback() {
    S.phase = "readback";
    S.rb = {};
    render();
    const lines = MK_READBACK[S.lang === "hi" ? "hi" : "en"];
    Voice.speak("Please check what we noted. " + lines.slice(0, 3).map((l) => l.text).join(" "), S.lang);
  }

  function setReadback(i, val) {
    S.rb = Object.assign({}, S.rb, { [i]: val });
    render();
  }

  function renderReadback() {
    const card = el("section", { class: "card" });
    card.append(el("span", { class: "tag", text: "Module C · Patient read-back" }));
    card.append(el("h2", { class: "ask", text: "Is this correct? You can change anything that is wrong." }));
    const lines = MK_READBACK[S.lang === "hi" ? "hi" : "en"];
    lines.forEach((l, i) => {
      const st = (S.rb || {})[i];
      card.append(el("div", { class: "rb-line" }, [
        el("div", { class: "txt" }, [el("span", { text: l.text })]),
        el("div", { class: "rb-actions" }, [
          el("button", {
            class: "btn btn-sm", type: "button", text: "✓ " + mkT("correct", S.lang),
            "aria-pressed": String(st === "yes"), onClick: () => setReadback(i, "yes"),
          }),
          el("button", {
            class: "btn btn-sm", type: "button", text: "✗ " + mkT("change", S.lang),
            "aria-pressed": String(st === "no"),
            onClick: () => { setReadback(i, "no"); Voice.speak("Please tell the doctor what to change.", S.lang); },
          }),
        ]),
      ]));
    });
    card.append(el("p", { class: "small muted", text: "Your words are kept exactly as you said them. Nothing is re-phrased." }));
    pane().append(card);

    footer([
      el("span", { class: "small muted", text: "Confirming does not clear a doubt — only the doctor can." }),
      el("button", { class: "btn btn-primary btn-lg", type: "button", text: mkT("confirm", S.lang), onClick: enterHandoff }),
    ]);
  }

  /* ------------------------------------------------------------ handoff */

  function enterHandoff() {
    S.phase = "handoff";
    render();
    Voice.speak("Thank you. Your summary is ready for the doctor.", S.lang);
  }

  function renderHandoff() {
    const card = el("section", { class: "card" });
    card.append(el("span", { class: "tag", text: "Module D · Consent-backed hand-off" }));
    card.append(el("h1", { text: "Done. Your summary is with the doctor's screen." }));
    card.append(el("div", { class: "redflag", text: "This visit is flagged as PRIORITY TRIAGE — chest pain with breathlessness. Please go to the triage desk now." }));
    card.append(el("div", { class: "card", style: "background:var(--surface-2)" }, [
      el("p", { class: "muted", text: "Show this code if asked at the desk:" }),
      el("div", { class: "code", text: "MK-2F41" }),
      el("dl", { class: "kv" }, [
        el("dt", { text: "Queue" }), el("dd", { text: "Priority triage" }),
        el("dt", { text: "Patient" }), el("dd", { text: MK_PATIENT.name + " · " + MK_PATIENT.age + " / " + MK_PATIENT.sex }),
        el("dt", { text: "ABHA" }), el("dd", { text: MK_PATIENT.abha }),
        el("dt", { text: mkConsent(S.lang).ref }), el("dd", { class: "mono", text: MK_CONSENT.artefact }),
        el("dt", { text: "Papers" }), el("dd", { text: "4 read · 1 handwritten flagged for the doctor" }),
        el("dt", { text: "Shared with" }), el("dd", { text: "Only the treating doctor, for this visit" }),
      ]),
      el("p", { class: "small muted", text: "Your voice was never recorded — only the words were read, and they are gone now." }),
    ]));
    pane().append(card);
    footer([
      el("span", { class: "small muted", text: "Opening the physician view…" }),
      el("button", { class: "btn btn-primary btn-lg", type: "button", text: "Open physician view", onClick: enterPhysician }),
    ]);
  }

  /* ----------------------------------------------------------- physician */

  function enterPhysician() {
    S.phase = "physician";
    document.body.classList.add("physician");
    render();
  }

  function renderPhysician() {
    const shell = el("div", { class: "phys-shell" });
    const aside = el("aside", { class: "phys-aside" }, [
      el("h3", { text: "Today's queue" }),
      el("div", { class: "worklist" }, MK_WORKLIST.map((w, i) =>
        el("button", { class: "item", type: "button", "aria-current": String(i === 0) }, [
          el("div", {}, [el("strong", { text: w.name }), el("span", { class: "muted", text: " · " + w.age })]),
          el("div", { class: "muted", text: w.problem }),
          el("div", { style: "margin-top:6px" }, el("span", { class: "chip " + (w.flag ? "red" : "ok"), text: w.queue })),
        ]))),
      el("p", { class: "small muted", style: "margin-top:16px", text: "Machine-generated history and paper extracts carry provenance. Assessment and plan are physician-only." }),
    ]);

    const main = el("main", { class: "phys-main" }, [
      el("h1", { text: MK_PATIENT.name + " · " + MK_PATIENT.age + " / " + MK_PATIENT.sex }),
      el("p", { class: "muted", text: "Chest pain + breathlessness · arrived " + MK_PATIENT.arrived + " · kiosk summary attested" }),
      el("div", { class: "grid", style: "display:grid;gap:12px;margin-bottom:18px" },
        MK_ALERTS.map((a) => el("div", { class: "alert " + a.kind }, [
          el("strong", { text: a.title }), el("div", { class: "small", text: a.detail }),
        ]))),

      el("div", { class: "soap card" }, [
        el("div", { class: "soap-block" }, [
          el("h4", { text: "S — Subjective (from the patient's own words)" }),
          ...MK_SOAP.s.map((x) => el("div", { class: "line" }, [
            el("div", { text: x.text }), el("span", { class: "prov", text: x.prov }),
          ])),
        ]),
        el("div", { class: "soap-block" }, [
          el("h4", { text: "O — Objective (papers + capture)" }),
          ...MK_SOAP.o.map((x) => el("div", { class: "line" }, [
            el("div", { text: x.text }), el("span", { class: "prov", text: x.prov }),
          ])),
        ]),
        el("div", { class: "soap-block ap" }, [
          el("h4", { text: "A / P — Assessment & plan · physician only" }),
          el("p", { class: "muted", text: "Locked. The kiosk never writes a diagnosis or a plan. This space is filled by the physician at the consult." }),
          el("textarea", { class: "textarea", rows: 3, placeholder: "Physician's assessment and plan…" }),
        ]),
      ]),

      el("div", { class: "card", style: "margin-top:18px" }, [
        el("h3", { text: "FHIR bundle (ready for the hospital system / ABDM)" }),
        el("dl", { class: "kv" }, [
          el("dt", { text: "Profile" }), el("dd", { text: MK_FHIR.profile }),
          el("dt", { text: "Type" }), el("dd", { text: MK_FHIR.snomed }),
          el("dt", { text: "Sections" }), el("dd", { text: MK_FHIR.sections }),
          el("dt", { text: "Resources" }), el("dd", { text: MK_FHIR.counts }),
          el("dt", { text: "Attestation" }), el("dd", { text: MK_FHIR.attester }),
        ]),
        el("pre", { class: "fhir", text:
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
    ]);

    shell.append(aside, main);
    pane().append(shell);
    footer([el("span", { class: "small muted", text: "Read-only view for the treating physician." })]);
  }

  /* ---------------------------------------------------------------- boot */

  function installUnlock() {
    const handler = () => {
      if (S.spoken || S.unlocking) return;
      S.unlocking = true;
      Voice.speak(mkLang(S.lang).greet + ". " + mkT("tagline", S.lang), S.lang).then((ok) => {
        S.unlocking = false;
        if (ok) { S.spoken = true; renderHeader(); }
      });
    };
    ["pointerdown", "keydown", "touchstart"].forEach((ev) => document.addEventListener(ev, handler, { passive: true }));
  }

  function boot() {
    Voice.load();
    render();
    installUnlock();
    setTimeout(() => {
      Voice.speak(mkLang(S.lang).greet + ". " + mkT("tagline", S.lang), S.lang).then((ok) => {
        if (ok) { S.spoken = true; renderHeader(); }
      });
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
