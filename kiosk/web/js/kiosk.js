// Patient-facing kiosk application.
//
// Drives the production capture flow and the real backend: consent + session
// creation, the config-driven interview, server-evaluated red flags,
// document upload (real Module B), history finalisation, summary generation
// (real Module C), bilingual read-back, and handoff. The UI contains no
// clinical content: every question, option and label is rendered from the
// schema served by the API.

import { api, el, clear, t, toast, createStore, fmtTime } from "./core.js";
import { createRecorder, micSupported, speakText, stopSpeaking } from "./voice.js";

const S = createStore({
  phase: "welcome",
  config: null,
  schema: null,
  speech: null,
  autoSpeak: false,
  listening: false,
  spokenStep: null,
  lang: "en",
  respondent: { role: "patient", relation: null },
  visitType: "new",
  session: null,
  answers: {},
  steps: [],
  idx: 0,
  complaintId: "general",
  redFlags: [],
  safetyAck: false,
  readback: null,
  summary: null,
  documents: null,
  busy: false,
});

// ------------------------------------------------------------------ utilities

const NONE_VALUES = ["none_assoc", "none_pmh", "no_meds", "no_allergy",
  "no_family", "never", "no_alc"];

function pane() { return document.getElementById("pane"); }

function currentStep() {
  const s = S.get();
  return s.steps[s.idx] || null;
}

function complaintFor(id) {
  const schema = S.get().schema;
  const all = [...schema.complaints, schema.general_complaint];
  return all.find((c) => c.id === id) || schema.general_complaint;
}

function rosSetFor(id) {
  const schema = S.get().schema;
  const set = complaintFor(id).rosSet || "general";
  return schema.ros_sets[set] || schema.ros_sets.general;
}

function buildSteps() {
  const s = S.get();
  const steps = [];
  for (const sec of s.schema.sections) {
    if (sec.id === "readback") continue; // read-back is a phase, not a question
    if (sec.turns === "ROS_DYNAMIC") {
      for (const item of rosSetFor(s.complaintId)) {
        steps.push({ section: sec.id, turnId: item.id, ros: item });
      }
    } else {
      for (const tid of sec.turns) {
        const turn = s.schema.turns[tid];
        if (turn) steps.push({ section: sec.id, turnId: tid, turn });
      }
    }
  }
  return steps;
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const s = S.get();
    if (!s.session) return;
    try {
      await api.put(`/api/sessions/${s.session.session_id}/answers`,
        { answers: s.answers });
    } catch (e) { /* autosave is best-effort; final POST validates */ }
  }, 600);
}

function setAnswer(turnId, patch) {
  const answers = { ...S.get().answers };
  const prev = answers[turnId];
  const base = (prev && typeof prev === "object" && !Array.isArray(prev)) ? prev : {};
  answers[turnId] = { ...base, ...patch, ts: Date.now() };
  S.set({ answers });
  scheduleSave();
}

// ROS answers are stored as a bare string; the builder reads them directly.
function setRawAnswer(turnId, value) {
  const answers = { ...S.get().answers };
  answers[turnId] = value;
  S.set({ answers });
  scheduleSave();
}

function answerOf(turnId) {
  const a = S.get().answers[turnId];
  return (a && typeof a === "object" && !Array.isArray(a)) ? a : {};
}

// -------------------------------------------------------------------- boot

async function boot() {
  try {
    const [config, schema] = await Promise.all([
      api.get("/api/config"), api.get("/api/interview"),
    ]);
    document.title = t(config.brand.name, config.default_language) + " — Kiosk";
    const speech = config.speech || null;
    const autoSpeak = !!(speech && speech.tts && speech.tts.available
      && speech.auto_speak_default !== false);
    S.set({ config, schema, speech, autoSpeak,
            lang: config.default_language,
            visitType: config.visit_types[0].code });
    render();
  } catch (e) {
    pane().append(el("div", { class: "banner err", text: "Cannot reach the kiosk service: " + e.message }));
  }
}

// ------------------------------------------------------------------ chrome

function renderHeader() {
  const s = S.get();
  const header = document.getElementById("kiosk-header");
  clear(header);
  header.append(
    el("div", { class: "brand" }, [
      el("strong", { text: t(s.config.brand.name, s.lang) }),
      el("span", { class: "small muted", text: t(s.config.brand.tagline, s.lang) }),
    ]),
    el("div", { class: "header-tools" }, [
      s.speech && s.speech.tts && s.speech.tts.available
        ? el("button", {
            class: "btn btn-sm", type: "button",
            "aria-pressed": String(s.autoSpeak),
            text: s.autoSpeak ? "Voice: on" : "Voice: off",
            title: "Read questions aloud",
            onClick: () => { stopSpeaking(); S.set({ autoSpeak: !s.autoSpeak }); render(); },
          })
        : null,
      el("div", { class: "langswitch", role: "group", "aria-label": "Language" },
        s.config.languages.map((l) =>
          el("button", {
            type: "button", "aria-pressed": String(l.code === s.lang),
            lang: l.code, text: l.native,
            onClick: () => { S.set({ lang: l.code }); render(); },
          }))),
      el("a", { class: "btn btn-sm", href: "/physician", text: "Physician view" }),
    ]),
  );
}

// ------------------------------------------------------------------ voice IO

let activeRecorder = null;

function speechAvailable(kind) {
  const s = S.get().speech;
  return !!(s && s[kind] && s[kind].available);
}

function ttsLang() { return S.get().lang === "en" ? "en" : "hi"; }

function turnAcceptsText(turn) {
  if (!turn) return false;
  // any answerable turn accepts speech; the transcript is stored as text and
  // the server builder maps it (history_builder reads answers[*].text)
  return !["safety", "documents", "readback"].includes(turn.kind);
}

function voiceBar(turn, askText, step) {
  const s = S.get();
  const parts = [];
  if (speechAvailable("tts")) {
    parts.push(el("button", {
      class: "btn btn-sm", type: "button", text: "Hear question",
      onClick: () => speakText(askText, ttsLang()),
    }));
  }
  const canMic = speechAvailable("asr") && micSupported() && turnAcceptsText(turn)
    && !["safety", "documents"].includes(step.turnId);
  if (canMic) {
    parts.push(el("button", {
      class: "btn btn-sm" + (s.listening ? " btn-primary" : ""), type: "button",
      text: s.listening ? "Listening… (tap to stop)" : "Speak answer",
      onClick: () => (s.listening ? stopListening() : startListening(step.turnId)),
    }));
  }
  if (!parts.length) return null;
  return el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 16px" }, parts);
}

function startListening(turnId) {
  const s = S.get();
  if (s.listening || !s.session) return;
  stopSpeaking();          // never let the spoken prompt leak into the mic
  activeRecorder = createRecorder();
  S.set({ listening: true });
  render();
  activeRecorder.start().then(async ({ b64 }) => {
    if (!b64) return;
    const res = await api.post(`/api/sessions/${s.session.session_id}/asr`, { audio_b64: b64 });
    if (res.text) {
      applyVoiceAnswer(turnId, res.text, res.conf);
      toast("Heard: " + res.text);
    } else {
      toast("Could not hear that clearly — please try again or type.");
    }
  }).catch((e) => {
    const denied = /denied|notallowed|permission/i.test(e.message || "");
    toast(denied ? "Microphone permission was blocked — allow it or type your answer."
                 : "Microphone unavailable: " + (e.message || "unknown error"), "err");
  }).finally(() => { activeRecorder = null; S.set({ listening: false }); render(); });
}

// Voice answers land as free text; for scale/yes-no turns also set the value
// the server builder reads, so a spoken answer is not silently ignored.
function applyVoiceAnswer(turnId, text, conf) {
  const s = S.get();
  const step = (s.steps || []).find((x) => x.turnId === turnId);
  const turn = (step && (step.turn || s.schema.turns[turnId])) || {};
  const clean = String(text).trim().toLowerCase();
  const patch = { text: String(text).trim(), voice: true, conf: conf ?? null };
  if (turn.kind === "scale") {
    const m = clean.match(/\d+(?:\.\d+)?/);
    if (m) patch.value = Math.max(0, Math.min(10, Number(m[0])));
  } else if (turn.kind === "yesno") {
    if (/\b(yes|haan|ha|हाँ|हां)\b/.test(clean)) patch.value = "yes";
    else if (/\b(no|nahi|nahin|नहीं|नही)\b/.test(clean)) patch.value = "no";
  }
  setAnswer(turnId, patch);
}

function stopListening() { if (activeRecorder) activeRecorder.stop(); }

function renderProgress() {
  const s = S.get();
  const bar = document.getElementById("progress");
  clear(bar);
  if (!["interview", "documents", "readback"].includes(s.phase)) return;
  const total = s.steps.length || 1;
  const pct = s.phase === "interview"
    ? Math.round(((s.idx) / total) * 100)
    : 100;
  const sec = s.phase === "interview" && s.steps[s.idx]
    ? s.steps[s.idx].section : s.phase;
  bar.append(
    el("span", { class: "small muted", text: `${sec}  ` }),
    el("div", { class: "bar" }, el("div", { class: "fill", style: `width:${pct}%` })),
    el("span", { class: "small muted", text: s.phase === "interview"
      ? `${Math.min(s.idx + 1, total)} / ${total}` : "100%" }),
  );
}

function setFooter(children) {
  const footer = document.getElementById("kiosk-footer");
  clear(footer);
  children.forEach((c) => c && footer.append(c));
}

// --------------------------------------------------------------- welcome

function renderWelcome() {
  const s = S.get();
  const c = s.config;
  pane().append(
    el("section", { class: "card turn-card" }, [
      el("div", { class: "section-tag", text: "Welcome" }),
      el("h1", { text: t(c.brand.tagline, s.lang) }),

      el("h3", { text: "Language" }),
      el("div", { class: "choices cols-2" }, c.languages.map((l) =>
        el("button", {
          class: "btn choice", type: "button", lang: l.code,
          "aria-pressed": String(l.code === s.lang),
          onClick: () => { S.set({ lang: l.code }); render(); },
        }, [el("span", {}, [el("strong", { text: l.native }), el("span", { class: "muted small", text: "  " + l.label })])]))),

      el("h3", { text: "Who is answering?" }),
      el("div", { class: "choices cols-2" }, c.respondent_roles.map((r) =>
        el("button", {
          class: "btn choice", type: "button",
          "aria-pressed": String(r.code === s.respondent.role),
          onClick: () => {
            const respondent = { ...s.respondent, role: r.code };
            if (r.code === "patient") respondent.relation = null;
            S.set({ respondent }); render();
          },
        }, t(r.label, s.lang)))),

      s.respondent.role === "proxy"
        ? el("div", {}, [
            el("h3", { text: "Relation to patient" }),
            el("div", { class: "choices" }, c.proxy_relations.map((r) =>
              el("button", {
                class: "btn choice", type: "button",
                "aria-pressed": String(r.code === s.respondent.relation),
                onClick: () => { S.set({ respondent: { ...s.respondent, relation: r.code } }); render(); },
              }, t(r.label, s.lang)))),
          ])
        : null,

      el("h3", { text: "Visit type" }),
      el("div", { class: "choices cols-2" }, c.visit_types.map((v) =>
        el("button", {
          class: "btn choice", type: "button",
          "aria-pressed": String(v.code === s.visitType),
          onClick: () => { S.set({ visitType: v.code }); render(); },
        }, t(v.label, s.lang)))),

      speechStatus(),
      renderNotice(c.disclosures.consent_notice),
    ]),
  );

  setFooter([
    el("span", { class: "small muted", text: "Your answers help the doctor prepare before you go in." }),
    el("button", {
      class: "btn btn-primary btn-lg", type: "button",
      disabled: s.busy, text: "Start",
      onClick: startSession,
    }),
  ]);
}

function speechStatus() {
  const s = S.get();
  if (!s.speech) return null;
  const asr = s.speech.asr || {};
  const tts = s.speech.tts || {};
  const bits = [
    asr.available ? "Voice answers available" : "Voice answers unavailable — please type",
    tts.available ? "Questions can be read aloud" : "Questions are shown as text",
  ];
  return el("p", { class: "small muted", text: bits.join(" · ") });
}

function renderNotice(notice) {
  const acked = !!S.get().noticeAck;
  return el("div", { class: "card", style: "margin-top:18px;background:var(--surface-2)" }, [
    el("h3", { text: "Before we begin — your consent" }),
    el("p", { text: notice.purpose }),
    el("p", { class: "small muted", text: "We collect:" }),
    el("ul", { class: "small" }, (notice.data_collected || []).map((d) => el("li", { text: d }))),
    el("p", { class: "small muted", text: "We do not collect:" }),
    el("ul", { class: "small" }, (notice.not_collected || []).map((d) => el("li", { text: d }))),
    el("p", { class: "small", text: notice.retention }),
    el("p", { class: "small", text: notice.rights }),
    el("label", { class: "tick" }, [
      el("input", {
        type: "checkbox", id: "notice-ack",
        checked: Boolean(acked),
        onChange: (e) => S.set({ noticeAck: e.target.checked }),
      }),
      el("span", { text: "I have read and understood the notice above." }),
    ]),
  ]);
}

async function startSession() {
  const s = S.get();
  if (!s.noticeAck) { toast("Please tick the consent box to continue.", "err"); return; }
  if (s.respondent.role === "proxy" && !s.respondent.relation) {
    toast("Please choose your relation to the patient.", "err"); return;
  }
  S.set({ busy: true });
  try {
    const session = await api.post("/api/sessions", {
      language: s.lang,
      respondent: s.respondent,
      visit: { type: s.visitType, prior_date: null },
      notice_acknowledged: true,
    });
    S.set({ session, phase: "interview", idx: 0, answers: {}, busy: false });
    S.set({ steps: buildSteps() });
    render();
    focusPane();
  } catch (e) {
    S.set({ busy: false });
    toast(e.message, "err");
  }
}

// -------------------------------------------------------------- interview

function renderInterview() {
  const s = S.get();
  const step = currentStep();
  if (!step) { finishInterview(); return; }
  const isDocs = step.turnId === "documents";
  let turn = s.schema.turns[step.turnId];
  if (!turn && step.ros) turn = { id: step.turnId, kind: "yesno" };
  const card = el("section", { class: "card turn-card" });
  const secLabel = s.schema.sections.find((x) => x.id === step.section);
  card.append(el("div", { class: "section-tag", text: t(secLabel?.label, s.lang) || step.section }));

  const askText = step.turnId === "safety" ? null
    : isDocs ? "Do you have any old prescriptions, reports or papers? You can add photos now."
    : step.ros ? t(step.ros, s.lang)
    : turn?.ask ? t(turn.ask, s.lang)
    : turn?.askConfirm ? t(turn.askConfirm, s.lang)
    : t(secLabel?.label, s.lang);

  const bar = voiceBar(turn, askText || "", step);
  if (bar) card.append(bar);

  const renderers = {
    bodymap: renderBodyMap, text: renderText, cc: renderCC, chips: renderChips,
    multi: renderChips, scale: renderScale, safety: renderSafety,
    yesno: renderYesNo, documents: renderDocuments,
  };
  const renderer = isDocs ? renderDocuments : (renderers[turn?.kind] || renderUnsupported);
  renderer(card, step, turn);
  pane().append(card);

  // read the question aloud once per step (low-literacy affordance)
  if (askText && s.autoSpeak && speechAvailable("tts") && s.spokenStep !== step.turnId) {
    S.set({ spokenStep: step.turnId });
    speakText(askText, ttsLang());
  }

  // footer nav
  const back = el("button", {
    class: "btn", type: "button", text: "Back",
    disabled: s.idx === 0, onClick: () => { S.set({ idx: s.idx - 1 }); render(); focusPane(); },
  });
  const next = el("button", {
    class: "btn btn-primary btn-lg", type: "button",
    id: "next-btn", text: s.idx === s.steps.length - 1 ? "Finish" : "Next",
    onClick: () => nextStep(),
  });
  setFooter([back, el("span", { class: "small muted", text: "You can skip any question — the doctor will follow up." }), next]);
}

function focusPane() {
  const heading = pane().querySelector("h2, .ask");
  if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus(); }
}

function nextStep() {
  const s = S.get();
  const step = currentStep();
  if (step && step.turnId === "safety" && s.redFlags.length > 0 && !s.safetyAck) {
    toast("Please let the staff member acknowledge the urgent flag.", "err");
    return;
  }
  if (step && step.turnId === "documents") { /* handled by its own action */ }
  if (s.idx >= s.steps.length - 1) { finishInterview(); return; }
  S.set({ idx: s.idx + 1 });
  render();
  focusPane();
}

function renderUnsupported(card, step) {
  card.append(el("div", { class: "banner warn", text: "Unsupported step: " + step.turnId }));
}

function askHtml(turn, lang) { return t(turn.ask, lang); }

// -- Body map: tappable front/back figure (zero-literacy starter) ----------
// Ported from the demo prototype. A tap solves BOTH the region slot and the
// complaint, and persists complaint_id so the server derives the right
// complaint + ROS set (history_builder reads answers.complaint_id).

let bodyView = "front";

function bodyRegion(id) {
  const schema = S.get().schema || {};
  return (schema.body_regions || []).find((r) => r.id === id) || null;
}

function pickBodyRegion(id) {
  const s = S.get();
  const r = bodyRegion(id) || { id, complaint: "general", label: { en: id } };
  setAnswer("bodymap", { value: r.id });
  setAnswer("complaint_id", { value: r.complaint });
  S.set({ complaintId: r.complaint, steps: buildSteps() });
  if (!String(answerOf("narrative").text || "").trim()) {
    const label = t(r.label, s.lang) || r.id;
    setAnswer("narrative", { text: `Pointed to the ${String(label).toLowerCase()} on the body picture` });
  }
  render();
}

function _svg(tag, attrs = {}) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function bodyFigure(selectedId) {
  const svg = _svg("svg", {
    viewBox: "0 0 220 348", class: "bmSvg", role: "img",
    "aria-label": "Body picture — tap where it hurts",
  });
  const region = (id, shapes) => {
    const g = _svg("g", {
      class: "bmRegion" + (selectedId === id ? " sel" : ""),
      "data-region": id, tabindex: "0", role: "button",
    });
    const r = bodyRegion(id);
    const title = _svg("title", {});
    title.textContent = r ? t(r.label, S.get().lang) : id;
    g.appendChild(title);
    shapes.forEach((sh) => g.appendChild(sh));
    const pick = () => pickBodyRegion(id);
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
    });
    return g;
  };
  svg.appendChild(region("head", [_svg("circle", { cx: 110, cy: 32, r: 24 })]));
  svg.appendChild(_svg("rect", { class: "bmPlain", x: 100, y: 54, width: 20, height: 16, rx: 4 }));
  if (bodyView === "front") {
    svg.appendChild(region("chest", [_svg("rect", { x: 76, y: 70, width: 68, height: 78, rx: 12 })]));
    svg.appendChild(region("abdomen", [_svg("rect", { x: 76, y: 148, width: 68, height: 62, rx: 12 })]));
  } else {
    svg.appendChild(region("back", [_svg("rect", { x: 76, y: 70, width: 68, height: 140, rx: 12 })]));
  }
  svg.appendChild(region("armL", [
    _svg("rect", { x: 42, y: 74, width: 24, height: 118, rx: 12 }),
    _svg("circle", { cx: 54, cy: 200, r: 11 })]));
  svg.appendChild(region("armR", [
    _svg("rect", { x: 154, y: 74, width: 24, height: 118, rx: 12 }),
    _svg("circle", { cx: 166, cy: 200, r: 11 })]));
  svg.appendChild(region("legL", [
    _svg("rect", { x: 78, y: 214, width: 28, height: 112, rx: 12 }),
    _svg("circle", { cx: 92, cy: 264, r: 14 })]));
  svg.appendChild(region("legR", [
    _svg("rect", { x: 114, y: 214, width: 28, height: 112, rx: 12 }),
    _svg("circle", { cx: 128, cy: 264, r: 14 })]));
  return svg;
}

function renderBodyMap(card, step, turn) {
  const s = S.get();
  card.append(el("h2", { class: "ask", text: askHtml(turn, s.lang) }));
  card.append(el("p", {
    class: "small muted",
    text: "Tap the part of the body that hurts — or use the words below.",
  }));

  const selected = answerOf("bodymap").value;
  const toggle = el("div", { class: "bmViewToggle", role: "tablist" }, [
    el("button", {
      class: "bmViewBtn" + (bodyView === "front" ? " sel" : ""), type: "button",
      role: "tab", "aria-selected": String(bodyView === "front"),
      text: "Front · सामने", onClick: () => { bodyView = "front"; render(); },
    }),
    el("button", {
      class: "bmViewBtn" + (bodyView === "back" ? " sel" : ""), type: "button",
      role: "tab", "aria-selected": String(bodyView === "back"),
      text: "Back · पीछे", onClick: () => { bodyView = "back"; render(); },
    }),
  ]);
  const figureCol = el("div", { class: "bmFigure" }, [toggle, bodyFigure(selected)]);

  const ids = bodyView === "front"
    ? ["head", "chest", "abdomen", "armL", "armR", "legL", "legR", "general"]
    : ["head", "back", "armL", "armR", "legL", "legR", "general"];
  const legend = el("div", { class: "bmLegend" });
  ids.forEach((id) => {
    const r = bodyRegion(id);
    if (!r) return;
    legend.append(el("button", {
      class: "bmBtn" + (selected === id ? " sel" : ""), type: "button",
      "aria-pressed": String(selected === id), onClick: () => pickBodyRegion(id),
    }, [
      el("span", { class: "cEn", text: t(r.label, "en") }),
      el("span", { class: "cHi", text: t(r.label, "hi") }),
    ]));
  });

  card.append(el("div", { class: "bmWrap" }, [figureCol, legend]));
}

function renderText(card, step, turn) {
  const s = S.get();
  card.append(el("h2", { class: "ask", text: askHtml(turn, s.lang) }));
  const ta = el("textarea", {
    class: "textarea", rows: "5",
    placeholder: "…",
    value: answerOf(step.turnId).text || "",
    onChange: (e) => setAnswer(step.turnId, { text: e.target.value }),
  });
  card.append(ta);
}

function renderCC(card, step, turn) {
  const s = S.get();
  const comp = complaintFor(s.complaintId);
  card.append(el("h2", { class: "ask", text: t(turn.askConfirm, s.lang) }));
  card.append(el("p", { class: "pill pill-ok", text: t(comp, s.lang) || comp.en }));
  card.append(el("div", { class: "choices cols-2" }, [
    el("button", {
      class: "btn choice", type: "button", text: "Yes, that is correct",
      "aria-pressed": String(answerOf("cc").value === "yes"),
      onClick: () => { setAnswer("cc", { value: "yes", text: comp.en }); render(); },
    }),
    el("button", {
      class: "btn choice", type: "button", text: "No — let me say it",
      "aria-pressed": String(answerOf("cc").value === "no"),
      onClick: () => { setAnswer("cc", { value: "no" }); render(); },
    }),
  ]));
  if (answerOf("cc").value === "no") {
    card.append(el("input", {
      class: "textinput", type: "text",
      placeholder: "Type your main problem",
      value: answerOf("cc").text || "",
      onChange: (e) => setAnswer("cc", { text: e.target.value }),
    }));
  }
}

async function resolveOptions(turnId) {
  const s = S.get();
  const res = await api.get(`/api/interview/options/${encodeURIComponent(turnId)}?complaint=${encodeURIComponent(s.complaintId)}`);
  return res.options || [];
}

function renderChips(card, step, turn) {
  const s = S.get();
  const multi = turn.kind === "multi";
  card.append(el("h2", { class: "ask", text: askHtml(turn, s.lang) }));
  const holder = el("div", { class: "choices" });
  card.append(holder);
  resolveOptions(step.turnId).then((options) => {
    clear(holder);
    options.forEach((o) => {
      const ans = answerOf(step.turnId);
      const selected = (ans.values || []).includes(o.v);
      holder.append(el("button", {
        class: "btn choice", type: "button",
        "aria-pressed": String(selected),
        onClick: () => {
          const a = answerOf(step.turnId);
          let values = a.values || [];
          if (multi) {
            if (o.exclusive) values = selected ? [] : [o.v];
            else values = selected ? values.filter((v) => v !== o.v) : [...values.filter((v) => !isExclusive(turn, v)), o.v];
          } else {
            values = selected ? [] : [o.v];
          }
          setAnswer(step.turnId, { values });
          if (turn.freeText || o.focusText) { /* text field rendered below */ }
          render();
        },
      }, t(o, s.lang)));
    });
  }).catch((e) => toast(e.message, "err"));

  const ans = answerOf(step.turnId);
  const needsText = turn.freeText || (ans.values || []).some((v) => isFocusText(turn, v))
    || !!ans.text;
  if (needsText) {
    card.append(el("input", {
      class: "textinput", type: "text",
      placeholder: t(turn.freeText, s.lang) || "Type here",
      value: ans.text || "",
      onChange: (e) => setAnswer(step.turnId, { text: e.target.value }),
    }));
  }
}

function isExclusive(turn, v) {
  const o = (turn.options || []).find((x) => x.v === v);
  return !!(o && o.exclusive);
}
function isFocusText(turn, v) {
  const o = (turn.options || []).find((x) => x.v === v);
  return !!(o && o.focusText);
}

function renderScale(card, step, turn) {
  const s = S.get();
  card.append(el("h2", { class: "ask", text: askHtml(turn, s.lang) }));
  const grid = el("div", { class: "scale" });
  for (let n = turn.min ?? 0; n <= (turn.max ?? 10); n++) {
    grid.append(el("button", {
      class: "btn", type: "button", text: String(n),
      "aria-pressed": String(answerOf(step.turnId).value === n),
      onClick: () => { setAnswer(step.turnId, { value: n }); render(); },
    }));
  }
  card.append(grid);
}

function renderYesNo(card, step, turn, item) {
  const s = S.get();
  const rosItem = item || step.ros;
  card.append(el("div", { class: "section-tag", text: (rosItem?.system || "").toUpperCase() }));
  card.append(el("h2", { class: "ask", text: t(rosItem, s.lang) || t(rosItem, "en") }));
  const holder = el("div", { class: "choices cols-2" });
  s.schema.yes_no_options.forEach((o) => {
    holder.append(el("button", {
      class: "btn choice", type: "button",
      "aria-pressed": String(S.get().answers[step.turnId] === o.v),
      onClick: () => { setRawAnswer(step.turnId, o.v); render(); },
    }, t(o, s.lang)));
  });
  card.append(holder);
}

async function renderSafety(card, step, turn) {
  const s = S.get();
  if (!s.safetyLoaded) {
    card.append(el("h2", { class: "ask", text: "Checking for warning signs…" }));
    try {
      const res = await api.post(`/api/sessions/${s.session.session_id}/safety`, {});
      S.set({ redFlags: res.red_flags || [], safetyLoaded: true,
              safetyAck: (res.red_flags || []).length === 0 });
    } catch (e) {
      clear(card);
      card.append(el("div", { class: "banner err", text: "Safety check failed: " + e.message }));
      return;
    }
    render();
    return;
  }
  if (s.redFlags.length === 0) {
    card.append(el("h2", { class: "ask", text: "No warning signs found." }));
    card.append(el("div", { class: "banner ok", text: "Please continue to the next question." }));
    return;
  }
  card.append(el("h2", { class: "ask", text: "Urgent — please show this to a staff member now." }));
  card.append(el("div", { class: "redflag-banner" }, [
    el("ul", {}, s.redFlags.map((rf) =>
      el("li", { text: t({ en: rf.title, hi: rf.title_hi }, s.lang) + "  (" + rf.rule + ")" }))),
  ]));
  card.append(el("button", {
    class: "btn btn-danger btn-lg", type: "button",
    text: s.safetyAck ? "Staff acknowledged" : "Staff: acknowledge and continue",
    disabled: s.safetyAck,
    onClick: () => { setAnswer("_safety", { ack: true }); S.set({ safetyAck: true }); render(); focusPane(); },
  }));
}

// -------------------------------------------------------------- documents

function renderDocuments(card, step) {
  const s = S.get();
  card.append(el("h2", { class: "ask", text: "Do you have any old prescriptions, reports or papers? You can add photos now." }));
  const input = el("input", {
    type: "file", multiple: true, accept: "image/png,image/jpeg,image/webp",
    id: "doc-input", class: "textinput",
  });
  card.append(input);
  card.append(el("button", {
    class: "btn btn-primary", type: "button", text: "Upload papers",
    onClick: () => uploadDocuments(input.files),
  }));
  if (s.documents) {
    card.append(el("div", { class: "banner ok"}, [
      el("div", { text: `Processed ${s.documents.pages} page(s).` }),
      s.documents.pages_needing_verify
        ? el("div", { text: `${s.documents.pages_needing_verify} page(s) have low-confidence fields the doctor will verify.` })
        : null,
    ]));
  }
}

async function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function uploadDocuments(files) {
  const s = S.get();
  if (!files || files.length === 0) { toast("Choose one or more image files first."); return; }
  S.set({ busy: true });
  try {
    const images = [];
    for (const f of files) {
      images.push({ filename: f.name, content_b64: await fileToB64(f) });
    }
    const res = await api.post(`/api/sessions/${s.session.session_id}/documents`, { images });
    S.set({ documents: res, busy: false });
    toast(`Processed ${res.pages} page(s).`, "info");
    render();
  } catch (e) {
    S.set({ busy: false });
    toast(e.message, "err");
  }
}

// ------------------------------------------------------------- finish/readback

async function finishInterview() {
  const s = S.get();
  S.set({ busy: true });
  try {
    await api.put(`/api/sessions/${s.session.session_id}/answers`, { answers: s.answers });
    await api.post(`/api/sessions/${s.session.session_id}/history`, {});
    const summary = await api.post(`/api/sessions/${s.session.session_id}/summary`, {});
    S.set({ summary, phase: "readback", busy: false });
    render();
  } catch (e) {
    S.set({ busy: false });
    toast("Could not prepare the summary: " + e.message, "err");
  }
}

function readbackFor(lang) {
  const s = S.get();
  const v = s.summary.views;
  return (lang === "en") ? v.readback_en : v.readback_hi;
}

function renderReadback() {
  const s = S.get();
  const card = el("section", { class: "card turn-card" });
  const view = readbackFor(s.lang === "en" ? "en" : "hi");
  card.append(el("div", { class: "section-tag", text: "Please check what we noted" }));
  card.append(el("h2", { class: "ask", text: "Is this correct? You can change anything that is wrong." }));
  const conf = s.answers._readback || {};
  view.lines.forEach((line, i) => {
    const key = String(i);
    card.append(el("div", { class: "readback-line" }, [
      el("div", { class: "txt", text: line.text }),
      el("div", { class: "readback-actions" }, [
        el("button", {
          class: "btn btn-sm", type: "button", text: "✓ Correct",
          "aria-pressed": String(conf[key] === "yes"),
          onClick: () => { setReadback(key, "yes"); },
        }),
        el("button", {
          class: "btn btn-sm", type: "button", text: "✗ Change",
          "aria-pressed": String(conf[key] === "no"),
          onClick: () => { setReadback(key, "no"); },
        }),
      ]),
    ]));
  });
  const speechText = view.lines.map((l) => l.text).join(". ");
  if (speechAvailable("tts")) {
    card.append(el("div", { style: "display:flex;gap:8px;margin:4px 0 14px" }, [
      el("button", { class: "btn btn-sm", type: "button", text: "Hear this",
        onClick: () => speakText(speechText, ttsLang()) }),
    ]));
  }
  if (s.autoSpeak && speechAvailable("tts") && s.spokenStep !== "readback" && speechText) {
    S.set({ spokenStep: "readback" });
    speakText(speechText, ttsLang());
  }
  pane().append(card);
  setFooter([
    el("span", { class: "small muted", text: "Your words are kept exactly as you said them." }),
    el("button", {
      class: "btn btn-primary btn-lg", type: "button", text: "Confirm and finish",
      onClick: () => { S.set({ phase: "handoff" }); render(); },
    }),
  ]);
}

function setReadback(key, val) {
  const answers = { ...S.get().answers };
  answers._readback = { ...(answers._readback || {}), [key]: val };
  S.set({ answers });
  scheduleSave();
  render();
}

// ---------------------------------------------------------------- handoff

function renderHandoff() {
  const s = S.get();
  const isRed = s.redFlags.length > 0;
  pane().append(el("section", { class: "card turn-card" }, [
    el("div", { class: "section-tag", text: "Done — please proceed" }),
    el("h1", { text: "Thank you. Your summary is ready for the doctor." }),
    isRed
      ? el("div", { class: "redflag-banner", text: "Show this code at the help desk now — your case is flagged as priority." })
      : el("div", { class: "banner info", text: "Please take a seat. The doctor will see you shortly." }),
    el("p", { class: "muted", text: "Show this code if asked:" }),
    el("div", { class: "handoff-code", text: s.session.session_id }),
    el("p", { class: "small muted", text: "Your papers and history have been handed to the doctor's screen. Nothing is shared without your consent." }),
  ]));
  setFooter([
    el("span"),
    el("button", { class: "btn btn-lg", type: "button", text: "Start a new patient", onClick: () => location.reload() }),
  ]);
}

// ------------------------------------------------------------------- render

function render() {
  const s = S.get();
  if (!s.config) return;
  renderHeader();
  renderProgress();
  clear(pane());
  const map = {
    welcome: renderWelcome, interview: renderInterview,
    readback: renderReadback, handoff: renderHandoff,
  };
  (map[s.phase] || renderWelcome)();
}

document.addEventListener("DOMContentLoaded", boot);
