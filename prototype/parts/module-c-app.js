/*  MediKiosk Module C — browser app (React + htm, same inlined libs as A/B).
    Phases: welcome (case picker) → merge (streams joining into one canon)
    → readback (patient, bilingual) → handoff (physician: SOAP + alerts +
    OPConsultRecord + attest). */
(function () {
"use strict";
var React = window.React;
var ReactDOM = window.ReactDOM;
var html = window.htm.bind(React.createElement);
var MC = window.MC;
var e = React.createElement;

function bi(state, obj) {
  if (!obj) return { primary: "", secondary: "" };
  var primary, secondary;
  if (state.lang === "hi") { primary = obj.hi || obj.en; secondary = obj.en; }
  else { primary = obj.en; secondary = obj.hi || obj.en; }
  return { primary: primary, secondary: secondary === primary ? "" : secondary };
}

function initialState() {
  return {
    lang: "en",
    phase: "welcome",
    caseId: null,
    session: null,
    bundle: null,
    resolved: {},
    token: "C" + String(Date.now()).slice(-6)
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "SET_LANG": return Object.assign({}, state, { lang: action.lang });
    case "PICK_CASE":
      return Object.assign({}, state, {
        caseId: action.caseId, phase: "merge",
        session: MC.runCase(action.caseId)
      });
    case "TO_READBACK": return Object.assign({}, state, { phase: "readback" });
    case "ATTEST":
      return Object.assign({}, state, {
        phase: "handoff",
        bundle: MC.physicianAttest(state.session.bundle, "Practitioner/DEMO")
      });
    case "RESTART": return Object.assign(initialState(), { lang: state.lang });
    default: return state;
  }
}

/* ---------- chrome ---------- */

function DemoBar(props) {
  var state = props.state, dispatch = props.dispatch;
  var t = { en: "Module C demo — summary generation", hi: "मॉड्यूल C डेमो — सारांश निर्माण" };
  return html`<div className="demoBar">
    <div className="demoTag">DEMO · ${t.en} · ${t.hi}<//>
    <div className="demoLang">
      <button className=${state.lang === "en" ? "on" : ""} onClick=${function () { dispatch({ type: "SET_LANG", lang: "en" }); }}>English<//>
      <button className=${state.lang === "hi" ? "on" : ""} onClick=${function () { dispatch({ type: "SET_LANG", lang: "hi" }); }}>हिन्दी<//>
      <button className="demoReset" onClick=${function () { dispatch({ type: "RESTART" }); }}>↺ restart<//>
    <//>
  <//>`;
}

function Header(props) {
  var state = props.state;
  var t = { en: "MediKiosk — one summary, ready before the doctor",
            hi: "मेडीकियोस्क — डॉक्टर से पहले, एक तैयार सारांश" };
  return html`<header className="head">
    <div className="brand"><span className="cross">✚<//><span>MediKiosk<//><span className="mod">Module C<//><//>
    <div className="hTitle">${bi(state, t).primary}<//>
    ${bi(state, t).secondary ? html`<div className="hSub">${bi(state, t).secondary}<//>` : null}
  <//>`;
}

function Card(props) {
  return html`<div className=${"card" + (props.className ? " " + props.className : "")}>${props.children}<//>`;
}

function Pill(props) {
  return html`<span className=${"hoPill" + (props.tone ? " " + props.tone : "")}>${props.children}<//>`;
}

/* ---------- phase: welcome (case picker) ---------- */

function Welcome(props) {
  var state = props.state, dispatch = props.dispatch;
  var t = {
    title: { en: "The interview is done. The papers are scanned.",
             hi: "बातचीत हो चुकी है। काग़ज़ स्कैन हो चुके हैं।" },
    sub: { en: "Module C joins both into ONE summary for the doctor — deterministic, no AI writes it.",
           hi: "मॉड्यूल C दोनों को डॉक्टर के लिए एक सारांश में जोड़ता है — नियतात्मक, कोई AI इसे नहीं लिखता।" },
    pick: { en: "Choose a demo session", hi: "डेमो सत्र चुनें" }
  };
  return html`<div className="welcome">
    <${Card}>
      <div className="stepTag">STEP 1 · ${t.pick.en} · ${t.pick.hi}<//>
      <h2 style=${{ marginTop: 12 }}>${bi(state, t.title).primary}<//>
      ${bi(state, t.title).secondary ? html`<div className="promptSub">${bi(state, t.title).secondary}<//>` : null}
      <p style=${{ marginTop: 12 }}>${bi(state, t.sub).primary}<//>
      ${bi(state, t.sub).secondary ? html`<p className="promptSub">${bi(state, t.sub).secondary}<//>` : null}
      <div className="btnRow" style=${{ marginTop: 16 }}>
        ${MC.DEMO_CASES.map(function (c) {
          return html`<button key=${c.id} className="btn big" data-case=${c.id}
            style=${{ textAlign: "left" }}
            onClick=${function () { dispatch({ type: "PICK_CASE", caseId: c.id }); }}>
            ${c.label.en}<br/>${c.label.hi}
          <//>`;
        })}
      <//>
      <div className="wNote" style=${{ marginTop: 14 }}>
        Inputs are demo fixtures shaped exactly like the real contracts
        (HistoryBundle v1 from Module A + run_summary from Module B). The merge,
        render and FHIR-emission logic is the real reference implementation
        (module-c/medic) ported to JS. The renderer is deterministic by design —
        no LLM generates any line of the summary (doc/15 §2 + 2026-09-11
        /last30days validation).
      <//>
    <//>
  <//>`;
}

/* ---------- phase: merge ---------- */

function Merge(props) {
  var state = props.state, dispatch = props.dispatch;
  var s = state.session;
  var t = {
    title: { en: "Joining your interview with your papers",
             hi: "आपकी बातचीत और काग़ज़ों को जोड़ा जा रहा है" },
    fromA: { en: "From the interview (Module A)", hi: "बातचीत से (मॉड्यूल A)" },
    fromB: { en: "From your papers (Module B)", hi: "आपके काग़ज़ों से (मॉड्यूल B)" },
    meds: { en: "Medicines — one list, both sources", hi: "दवाएँ — एक सूची, दोनों स्रोत" },
    labs: { en: "Lab results", hi: "लैब रिपोर्ट" },
    alerts: { en: "For the doctor to check first", hi: "डॉक्टर पहले यह देखें" },
    cont: { en: "Looks right — continue", hi: "ठीक है — आगे बढ़ें" }
  };
  return html`<div className="welcome"><${Card}>
    <div className="stepTag">STEP 2 · ${t.title.en} · ${t.title.hi}<//>
    <h2 style=${{ marginTop: 12 }}>${bi(state, t.title).primary}<//>
    ${bi(state, t.title).secondary ? html`<div className="promptSub">${bi(state, t.title).secondary}<//>` : null}
    <div style=${{ marginTop: 10 }} data-queue=${s.queue}>
      <${Pill} tone=${s.queue === "PRIORITY TRIAGE" ? "pri" : "ok"}>QUEUED: ${s.queue}<//>
      <${Pill}>interview ${s.history.sessionId}<//>
      ${s.documents.sessionId ? html`<${Pill}>papers ${s.documents.sessionId}<//>` : null}
    <//>

    <div className="hoSec" style=${{ marginTop: 14 }}>
      <h4>${bi(state, t.fromA).primary}<//>
      <div className="hoBody">
        <div className="hoRow"><span className="hK">${s.history.complaint.term}<//>
          <span className="hV">${s.history.capturedSlots().length} detail fields captured<//>
          <span className="hSrc">session ${s.history.sessionId}<//><//>
        <div className="hoRow"><span className="hK">red flags<//>
          <span className="hV">${s.history.redFlags.length ? s.history.redFlags.map(function (r) { return r.rule; }).join(", ") : "none"}<//>
          <span className="hSrc">Module A safety layer<//><//>
      <//>
    <//>

    ${s.meds.length + s.labs.length + s.dx.length > 0 ? html`<div className="hoSec">
      <h4>${bi(state, t.fromB).primary}<//>
      <div className="hoBody">
        <div className="hoRow"><span className="hK">documents read<//>
          <span className="hV">${s.documents.meds.length} med lines · ${s.documents.labs.length} lab values · ${s.documents.dx.length} diagnoses<//>
          <span className="hSrc">session ${s.documents.sessionId || "—"}<//><//>
      <//>
    <//>` : html`<div className="hoSec">
      <h4>${bi(state, t.fromB).primary}<//>
      <div className="hoBody"><div className="hoRow"><span className="hV">no papers brought — summary built from the interview alone<//><span className="hSrc">—<//><//><//>
    <//>`}

    <div className="hoSec">
      <h4>${bi(state, t.meds).primary} (${s.meds.length})<//>
      <div className="hoBody">
        ${s.meds.map(function (m) {
          return html`<div key=${m.fid} className="hoRow" data-med=${m.fid}>
            <span className="hK">${MC.medLabel(m)}<//>
            <span className="hV">${m.sources.join(" + ")}${m.verify ? " · ⚠ verify" : ""}${m.reason ? " · " + m.reason : ""}<//>
            <span className="hSrc">${m.fid}<//>
          <//>`;
        })}
      <//>
    <//>

    ${s.labs.length ? html`<div className="hoSec">
      <h4>${bi(state, t.labs).primary} (${s.labs.length})<//>
      <div className="hoBody">
        ${s.labs.map(function (l) {
          return html`<div key=${l.fid} className="hoRow" data-lab=${l.fid}>
            <span className="hK">${l.label()}<//>
            <span className="hV">${l.abnormal ? "⚠ " + l.abnormal.toUpperCase() + " (" + l.rangeNote + ")" : "within range (" + l.rangeNote + ")"}<//>
            <span className="hSrc">${l.fid}<//>
          <//>`;
        })}
      <//>
      <div className="wNote" style=${{ marginTop: 6 }}>
        Reference ranges are demo placeholders pending clinician validation
        (same honesty posture as Module B's engine thresholds).
      <//>
    <//>` : null}

    <div className="hoSec">
      <h4>${bi(state, t.alerts).primary} (${s.alerts.length})<//>
      <div className="hoBody">
        ${s.alerts.map(function (a, i) {
          return html`<div key=${a.fid + ":" + i} className="hoRow" data-alert=${a.severity}>
            <span className="hK">[${a.severity}] ${a.text}<//>
            <span className="hV">${a.detail}<//>
            <span className="hSrc">${a.fid}<//>
          <//>`;
        })}
      <//>
    <//>

    <div className="btnRow">
      <button className="btn big" data-goto="readback" onClick=${function () { dispatch({ type: "TO_READBACK" }); }}>
        ${bi(state, t.cont).primary}<br/>${bi(state, t.cont).secondary}
      <//>
    <//>
  <//><//>`;
}

/* ---------- phase: readback (patient) ---------- */

function Readback(props) {
  var state = props.state, dispatch = props.dispatch;
  var s = state.session;
  var view = state.lang === "hi" ? s.readbackHi : s.readbackEn;
  var other = state.lang === "hi" ? s.readbackEn : s.readbackHi;
  var t = {
    title: { en: "Please check your summary", hi: "अपना सारांश जाँचें" },
    sub: { en: "Tell the kiosk helper if anything is wrong. The doctor will see exactly this.",
           hi: "कुछ गलत हो तो कियोस्क हेल्पर को बताएँ। डॉक्टर को यही दिखेगा।" },
    cont: { en: "Yes, this is correct", hi: "हाँ, यह सही है" }
  };
  return html`<div className="welcome"><${Card}>
    <div className="stepTag">STEP 3 · ${t.title.en} · ${t.title.hi}<//>
    <h2 style=${{ marginTop: 12 }}>${bi(state, t.title).primary}<//>
    ${bi(state, t.title).secondary ? html`<div className="promptSub">${bi(state, t.title).secondary}<//>` : null}
    <div className="hoSec" style=${{ marginTop: 14 }}>
      <div className="hoBody">
        ${view.lines.map(function (l, i) {
          return html`<div key=${i} className="hoRow" data-rb=${i}>
            <span className="hK">${l.text}<//>
            <span className="hSrc">${l.src.join(", ") || "—"}<//>
          <//>`;
        })}
      <//>
      <div className="wNote" style=${{ marginTop: 8 }}>
        Shown in ${state.lang === "hi" ? "हिन्दी" : "English"} — the same fields render in
        ${state.lang === "hi" ? "English" : "हिन्दी"} too (store once, render many; the other
        language has ${other.lines.length} of the same ${view.lines.length} lines).
        Bilingual labels are a deterministic dictionary — no cloud translation
        (Bhashini stays blocked-risk, doc/09; IndicTrans2 is the product lane).
      <//>
    <//>
    <div className="btnRow">
      <button className="btn big" data-goto="handoff" onClick=${function () { dispatch({ type: "ATTEST" }); }}>
        ${bi(state, t.cont).primary}<br/>${bi(state, t.cont).secondary}
      <//>
    <//>
  <//><//>`;
}

/* ---------- phase: handoff (physician) ---------- */

function Handoff(props) {
  var state = props.state, dispatch = props.dispatch;
  var s = state.session, bundle = state.bundle;
  var soap = s.soap;
  var comp = bundle.entry[0].resource;
  var counts = {};
  bundle.entry.forEach(function (en) {
    counts[en.resource.resourceType] = (counts[en.resource.resourceType] || 0) + 1;
  });
  return html`<div className="hoWrap">
    <div className="hoSheet">
      <div className="hoHead">
        <div className="hoT">Physician handoff — pre-consultation summary (demo view)<//>
        <div className="hoMeta">
          <span className="hoPill">session ${state.token} (Module D, simulated)<//>
          <span className="hoPill">interview ${s.history.sessionId} + docs ${s.documents.sessionId || "none"}<//>
          <span className=${"hoPill" + (s.queue === "PRIORITY TRIAGE" ? " pri" : " ok")}>QUEUED: ${s.queue}<//>
          <span className="hoPill ok">captured on-device · offline<//>
        <//>
      <//>
      ${s.alerts.length ? html`<div className="hoBanner">
        ${s.alerts.length} item(s) to check first — ${s.alerts.filter(function (a) { return a.severity === "red-flag"; }).length} red-flag,
        ${s.alerts.filter(function (a) { return a.severity === "verify"; }).length} verify,
        ${s.alerts.filter(function (a) { return a.severity === "abnormal"; }).length} abnormal. Severity-ordered below; nothing was silently resolved.
      <//>` : html`<div className="hoBanner" style=${{ background: "var(--ok-bg)", borderColor: "#BCE3C9", color: "var(--ok)" }}>
        No red flags, no verify items — routine summary.
      <//>`}
      <div className="hoBody">
        <div className="hoSec">
          <h4>One-page SOAP summary (deterministic — every line carries its source)<//>
          ${["S", "O"].map(function (key) {
            return html`<div key=${key} style=${{ marginTop: 8 }}>
              <div style=${{ fontWeight: 700 }}>${key === "S" ? "S — Subjective" : "O — Objective"}<//>
              ${soap[key].map(function (l, i) {
                return html`<div key=${key + i} className="hoRow">
                  <span className="hK">${l.text}<//>
                  <span className="hSrc">${l.src.join(", ") || "—"}<//>
                <//>`;
              })}
            <//>`;
          })}
          <div style=${{ marginTop: 8 }}>
            <div style=${{ fontWeight: 700, color: "var(--muted)" }}>A — Assessment · P — Plan<//>
            ${soap.A.concat(soap.P).map(function (l, i) {
              return html`<div key={"ap" + i} className="hoRow">
                <span className="hK" style=${{ color: "var(--muted)" }}>${l.text}<//>
                <span className="hSrc">physician-only, never generated<//>
              <//>`;
            })}
          <//>
          ${soap.gaps.length ? html`<div className="wNote" style=${{ marginTop: 8 }}>
            Not captured today: ${soap.gaps.map(function (g) { return g.text; }).join(" · ")}
          <//>` : null}
        <//>
        <div className="hoSec">
          <h4>Alerts (${s.alerts.length}) — severity-ordered<//>
          <div className="hoBody">
            ${s.alerts.map(function (a, i) {
              return html`<div key={i} className="hoRow">
                <span className="hK">[${a.severity}] ${a.text}<//>
                <span className="hV">${a.detail}<//>
                <span className="hSrc">${a.fid}<//>
              <//>`;
            })}
          <//>
        <//>
        <div className="hoSec">
          <h4>FHIR OPConsultRecord — NRCeS ABDM profile<//>
          <div className="hoBody">
            ${Object.keys(counts).map(function (rt) {
              return html`<div key={rt} className="hoRow"><span className="hK">${rt}<//><span className="hV">${counts[rt]}<//><span className="hSrc">FHIR R4<//><//>`;
            })}
            <div className="hoRow"><span className="hK">Composition.type<//><span className="hV">371530004 Clinical consultation report<//><span className="hSrc">SNOMED<//><//>
            <div className="hoRow"><span className="hK">Composition.status<//><span className="hV">${comp.status}<//><span className="hSrc">preliminary → final after attest<//><//>
            <div className="hoRow"><span className="hK">Composition.attester<//><span className="hV">${comp.attester.length ? comp.attester[0].mode + " ✓" : "—"}<//><span className="hSrc">NRCeS attester slot<//><//>
            <div className="hoRow"><span className="hK">sections<//><span className="hV">${comp.section.map(function (x) { return x.title; }).join(" · ")}<//><span className="hSrc">coded slices<//><//>
            <div className="hoRow"><span className="hK">raw scans<//><span className="hV">${s.documents.persistRaw ? "kept (consented)" : "transient (DPDP default)"}<//><span className="hSrc">Module B decision<//><//>
          <//>
          <div className="wNote" style=${{ marginTop: 8 }}>
            Attested by Dr. (demo) — the physician confirmed the flagged values; the
            Composition carries the attestation. Structural FHIR validation passes in the
            reference implementation; full NRCeS profile validation is the M3 milestone
            via HAPI. Physician-at-consult sections (examination, investigation advice,
            procedure, follow-up, referral) are deliberately NOT pre-generated.
          <//>
        <//>
      <//>
      <div className="btnRow">
        <button className="btn ghost" onClick=${function () { dispatch({ type: "RESTART" }); }}>↺ restart demo<//>
      <//>
    <//>
  <//>`;
}

/* ---------- app ---------- */

function App() {
  var _React$useReducer = React.useReducer(reducer, undefined, initialState);
  var state = _React$useReducer[0], dispatch = _React$useReducer[1];
  var body = null;
  if (state.phase === "welcome") body = html`<${Welcome} state=${state} dispatch=${dispatch} />`;
  else if (state.phase === "merge") body = html`<${Merge} state=${state} dispatch=${dispatch} />`;
  else if (state.phase === "readback") body = html`<${Readback} state=${state} dispatch=${dispatch} />`;
  else if (state.phase === "handoff") body = html`<${Handoff} state=${state} dispatch=${dispatch} />`;
  return html`<div>
    <${DemoBar} state=${state} dispatch=${dispatch} />
    <${Header} state=${state} />
    ${body}
    <div className="stageFoot">
      MediKiosk SIH 26047 demo · Module C: merge + deterministic render + OPConsultRecord (ABDM)
      · store once, render many (SOAP / read-back / FHIR) · no LLM writes the summary · this page runs offline
    <//>
  <//>`;
}

var rootEl = document.getElementById("root");
ReactDOM.createRoot(rootEl).render(e(App));
})();
