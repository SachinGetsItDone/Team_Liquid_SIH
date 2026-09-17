/*  MediKiosk Module B — browser app (React + htm, same inlined libs as Module A).
    Phases: welcome (DPDP consent) → scan (doc picker) → processing (engine ladder
    + voting) → review (patient) → attest (physician) → handoff (FHIR bundle). */
(function () {
"use strict";
var React = window.React;
var ReactDOM = window.ReactDOM;
var html = window.htm.bind(React.createElement);
var MB = window.MB;
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
    selected: {},
    uploads: [],
    uploadSeq: 0,
    skippedNote: false,
    session: null,
    resolved: {},
    bundle: null,
    token: "B" + String(Date.now()).slice(-6)
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "SET_LANG": return Object.assign({}, state, { lang: action.lang });
    case "CONSENT": return Object.assign({}, state, { phase: "scan" });
    case "DECLINE": return Object.assign({}, state, { phase: "declined" });
    case "TOGGLE_DOC":
      var sel = Object.assign({}, state.selected);
      if (sel[action.id]) delete sel[action.id]; else sel[action.id] = true;
      return Object.assign({}, state, { selected: sel });
    case "ADD_UPLOADS": {
      var items = action.items || [];
      var ups = state.uploads.concat(items.map(function (it, i) {
        var seq = state.uploadSeq + i;
        return {
          uid: "u" + (seq + 1), name: it.maskedName, size: it.size, mime: it.mime,
          thumbUrl: it.thumbUrl, handwritten: false, variant: seq,
          kind: MB.UPLOAD_VARIANTS[seq % MB.UPLOAD_VARIANTS.length].kind
        };
      }));
      return Object.assign({}, state, {
        uploads: ups,
        uploadSeq: state.uploadSeq + items.length,
        skippedNote: (action.skipped || 0) > 0
      });
    }
    case "REMOVE_UPLOAD":
      return Object.assign({}, state, { uploads: state.uploads.filter(function (u) { return u.uid !== action.uid; }) });
    case "MARK_BROKEN":
      return Object.assign({}, state, { uploads: state.uploads.map(function (u) {
        return u.uid === action.uid ? Object.assign({}, u, { broken: true }) : u;
      }) });
    case "MARK_DARK":
      return Object.assign({}, state, { uploads: state.uploads.map(function (u) {
        return u.uid === action.uid ? Object.assign({}, u, { dark: !!action.dark }) : u;
      }) });
    case "TOGGLE_UPLOAD_MODE":
      return Object.assign({}, state, { uploads: state.uploads.map(function (u) {
        return u.uid === action.uid ? Object.assign({}, u, { handwritten: !!action.handwritten }) : u;
      }) });
    case "SCAN": {
      var docIds = MB.DEMO_DOCS.filter(function (d) { return state.selected[d.id]; })
                               .map(function (d) { return d.id; });
      var uploadDocs = state.uploads.filter(function (u) { return !u.broken; }).map(function (u) {
        return MB.makeUploadedDoc({ uid: u.uid, name: u.name, variant: u.variant, handwritten: u.handwritten });
      });
      if (!docIds.length && !uploadDocs.length) return state;
      return Object.assign({}, state, { phase: "processing", session: MB.runSession(docIds.concat(uploadDocs), { sessionId: state.token }) });
    }
    case "TO_REVIEW": return Object.assign({}, state, { phase: "review" });
    case "CORRECT_FIELD":
      return Object.assign({}, state, {
        session: MB.correctField(state.session, action.key, action.kind, action.a, action.b, action.c)
      });
    case "DENY_FIELD":
      return Object.assign({}, state, {
        session: MB.denyField(state.session, action.key, action.denied)
      });
    case "RESOLVE": {
      var res = Object.assign({}, state.resolved);
      res[action.key] = action.value;
      return Object.assign({}, state, { resolved: res });
    }
    case "ATTEST":
      return Object.assign({}, state, { phase: "handoff", bundle: MB.physicianAttest(state.session.bundle, "Practitioner/DEMO") });
    case "RESTART": return Object.assign(initialState(), { lang: state.lang });
    default: return state;
  }
}

/* ---------- chrome (same classes as Module A's presenter bar + kiosk header) ---------- */

function DemoBar(props) {
  var state = props.state, dispatch = props.dispatch;
  return html`<div className="demobar">
    <span className="dbTitle">DEMO CONTROLS — presenter only, not part of the product<//>
    <button className="dbBtn" onClick=${function () { dispatch({ type: "SET_LANG", lang: "en" }); }}>
      English${state.lang === "en" ? " ✓" : ""}
    <//>
    <button className="dbBtn" onClick=${function () { dispatch({ type: "SET_LANG", lang: "hi" }); }}>
      हिन्दी${state.lang === "hi" ? " ✓" : ""}
    <//>
    <button className="dbBtn" onClick=${function () { dispatch({ type: "RESTART" }); }}>↺ Restart<//>
    <span className="dbSpacer"><//>
    <span className="dbNote">Module B · document digitization — upload lane + verify-default OCR pipeline (engine simulated)<//>
  <//>`;
}

function Header(props) {
  var state = props.state;
  return html`<div>
    <header className="hdr">
      <div className="hdrInner">
        <div className="brandMark">✚<//>
        <div className="brandTxt">
          <h1>MediKiosk<//>
          <div className="sub">Module B — Document Digitization Kiosk · दस्तावेज़ डिजिटाइज़ेशन कियोस्क<//>
        <//>
        <div className="hdrChips">
          <span className="hdrChip"><span className="dot"><//> On-device · offline-first<//>
          <span className="hdrChip">${state.lang === "en" ? "English" : "हिन्दी"}<//>
          <span className="hdrChip demoChip">DEMO PROTOTYPE<//>
        <//>
      <//>
    <//>
  <//>`;
}

function Card(props) {
  return html`<div className=${"card" + (props.className ? " " + props.className : "")}>${props.children}<//>`;
}

function Pill(props) {
  return html`<span className=${"hoPill" + (props.tone ? " " + props.tone : "")}>${props.children}<//>`;
}

/* ---------- phase: welcome (DPDP itemized consent) ---------- */

function Welcome(props) {
  var state = props.state, dispatch = props.dispatch;
  var C = MB.CHROME.consent;
  return html`<div className="welcome">
    <${Card}>
      <div className="stepTag">STEP 1 · ${C.title.en} · ${C.title.hi}<//>
      <h2 style=${{ marginTop: 12 }}>${bi(state, C.title).primary}<//>
      ${bi(state, C.title).secondary ? html`<div className="promptSub">${bi(state, C.title).secondary}<//>` : null}
      <p style=${{ marginTop: 14 }}><b>${bi(state, C.purpose).primary}<//><//>
      ${bi(state, C.purpose).secondary ? html`<p className="promptSub">${bi(state, C.purpose).secondary}<//>` : null}
      <div className="hoSec" style=${{ marginTop: 16 }}>
        <h4>${bi(state, C.collected).primary}<//>
        <ul style=${{ margin: "8px 0 0 20px" }}>
          ${C.collectedItems.map(function (it) { return html`<li key=${it.en}>${bi(state, it).primary}<//>`; })}
        <//>
        <h4 style=${{ marginTop: 12 }}>${bi(state, C.notCollected).primary}<//>
        <ul style=${{ margin: "8px 0 0 20px" }}>
          ${C.notCollectedItems.map(function (it) { return html`<li key=${it.en}>${bi(state, it).primary}<//>`; })}
        <//>
      <//>
      <p style=${{ marginTop: 14 }}>${bi(state, C.rights).primary}<//>
      ${bi(state, C.rights).secondary ? html`<p className="promptSub">${bi(state, C.rights).secondary}<//>` : null}
      <p className="promptSub" style=${{ marginTop: 6 }}>${bi(state, C.retention).primary}<//>
      <div className="btnRow">
        <button className="btn big" onClick=${function () { dispatch({ type: "CONSENT" }); }}>
          ${bi(state, C.agree).primary}<br/>${bi(state, C.agree).secondary}
        <//>
        <button className="btn ghost" onClick=${function () { dispatch({ type: "DECLINE" }); }}>
          ${bi(state, C.decline).primary}<br/>${bi(state, C.decline).secondary}
        <//>
      <//>
      <div className="wNote" style=${{ marginTop: 14 }}>
        Notice text mirrors the DPDP 2023 itemized-notice requirement (doc/13 §4). Demo wording — final notice to be legally reviewed.
      <//>
    <//>
  <//>`;
}

function Declined(props) {
  var state = props.state, dispatch = props.dispatch;
  var t = { en: "No problem. Please show your papers directly to the doctor. Your history from the interview is still saved.",
            hi: "कोई बात नहीं। अपने काग़ज़ सीधे डॉक्टर को दिखाइए। आपका इतिहास फिर भी सुरक्षित है।" };
  return html`<div className="welcome"><${Card}>
    <h2>${bi(state, t).primary}<//>
    ${bi(state, t).secondary ? html`<p className="promptSub">${bi(state, t).secondary}<//>` : null}
    <div className="btnRow"><button className="btn ghost" onClick=${function () { dispatch({ type: "RESTART" }); }}>${MB.CHROME.handoff.restart.en} · ${MB.CHROME.handoff.restart.hi}<//><//>
  <//><//>`;
}

/* ---------- phase: scan (doc picker + upload lane) ---------- */

function Scan(props) {
  var state = props.state, dispatch = props.dispatch;
  var C = MB.CHROME.scan;
  var U = MB.CHROME.upload;
  var fileRef = React.useRef(null);
  var camRef = React.useRef(null);
  var dragDepth = React.useRef(0);
  var ds = React.useState(false);
  var dragging = ds[0], setDragging = ds[1];

  function addFiles(fileList) {
    var items = [], skipped = 0, checks = [];
    var base = state.uploadSeq;
    Array.prototype.forEach.call(fileList || [], function (f) {
      var isImg = (f.type || "").indexOf("image/") === 0;
      var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
      if (!isImg && !isPdf) { skipped++; return; }
      var seq = base + items.length;
      items.push({
        maskedName: MB.maskSensitiveText(f.name || "page"),
        size: f.size || 0,
        mime: isPdf ? "application/pdf" : (f.type || "image/*"),
        thumbUrl: isImg ? URL.createObjectURL(f) : null
      });
      if (isImg) checks.push({ file: f, uid: "u" + (seq + 1) });
    });
    dispatch({ type: "ADD_UPLOADS", items: items, skipped: skipped });
    checks.forEach(function (ch) { checkImage(ch.file, ch.uid); });
  }

  function checkImage(file, uid) {
    if (typeof window === "undefined" || !window.createImageBitmap) return;
    window.createImageBitmap(file).then(function (bmp) {
      try {
        var w = 32, h = 32;
        var cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        var ctx = cv.getContext("2d");
        ctx.drawImage(bmp, 0, 0, w, h);
        var d = ctx.getImageData(0, 0, w, h).data;
        var s = 0, n = 0, k;
        for (k = 0; k < d.length; k += 4) { s += d[k] + d[k + 1] + d[k + 2]; n += 3; }
        if (s / Math.max(1, n) < 30) dispatch({ type: "MARK_DARK", uid: uid, dark: true });
      } catch (e) { dispatch({ type: "MARK_BROKEN", uid: uid }); }
      if (bmp.close) bmp.close();
    }).catch(function () { dispatch({ type: "MARK_BROKEN", uid: uid }); });
  }

  var nSel = Object.keys(state.selected).length;
  var nUp = state.uploads.length;
  var total = nSel + nUp;

  return html`<div className="welcome">
    <${Card}>
      <div className="stepTag">STEP 2 · ${C.title.en} · ${C.title.hi}<//>
      <h2 style=${{ marginTop: 12 }}>${bi(state, C.title).primary}<//>
      ${bi(state, C.title).secondary ? html`<div className="promptSub">${bi(state, C.title).secondary}<//>` : null}
      <div className="wLabel">${bi(state, C.demoPapers).primary} · ${bi(state, C.demoPapers).secondary}<//>
      <div style=${{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12, marginTop: 10 }}>
        ${MB.DEMO_DOCS.map(function (d) {
          var on = !!state.selected[d.id];
          var kind = bi(state, C.docTypes[d.kind]).primary;
          var mode = d.handwritten ? bi(state, C.handwritten).primary : bi(state, C.printed).primary;
          return html`<button key=${d.id}
            className=${"btn " + (on ? "" : "ghost")}
            style=${{ textAlign: "left", display: "block", padding: "14px 16px" }}
            onClick=${function () { dispatch({ type: "TOGGLE_DOC", id: d.id }); }}>
            <div style=${{ fontWeight: 700 }}>${on ? "☑" : "☐"} ${d.label.en}<//>
            <div className="promptSub">${d.label.hi}<//>
            <div style=${{ marginTop: 6 }}>
              <${Pill}>${kind}<//> <${Pill} tone=${d.handwritten ? "pri" : "ok"}>${mode}<//>
            <//>
          <//>`;
        })}
      <//>
      <div className="wLabel">${bi(state, U.title).primary} · ${bi(state, U.title).secondary}<//>
      <div
        onDragOver=${function (ev) { ev.preventDefault(); }}
        onDragEnter=${function (ev) { ev.preventDefault(); dragDepth.current++; setDragging(true); }}
        onDragLeave=${function (ev) { ev.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); }}
        onDrop=${function (ev) { ev.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles(ev.dataTransfer.files); }}
        style=${{
          border: "2px dashed " + (dragging ? "var(--teal)" : "var(--line)"),
          background: dragging ? "var(--teal-bg)" : "transparent",
          borderRadius: 14, padding: "20px 16px", textAlign: "center", marginTop: 10,
          transition: "background 120ms, border-color 120ms"
        }}>
        <div style=${{ fontWeight: 700 }}>${bi(state, U.drop).primary}<//>
        <div className="promptSub" style=${{ marginTop: 2 }}>${bi(state, U.drop).secondary}<//>
        <div className="btnRow" style=${{ justifyContent: "center", marginTop: 12 }}>
          <button className="btn big" onClick=${function () { fileRef.current.click(); }}>
            ${bi(state, U.choose).primary} · ${bi(state, U.choose).secondary}
          <//>
          <button className="btn ghost" onClick=${function () { camRef.current.click(); }}>
            ${bi(state, U.camera).primary} · ${bi(state, U.camera).secondary}
          <//>
        <//>
        <input ref=${fileRef} type="file" accept="image/*,.pdf,application/pdf" multiple
          style=${{ display: "none" }}
          onChange=${function (ev) { addFiles(ev.target.files); ev.target.value = ""; }} />
        <input ref=${camRef} type="file" accept="image/*" capture="environment"
          style=${{ display: "none" }}
          onChange=${function (ev) { addFiles(ev.target.files); ev.target.value = ""; }} />
      <//>
      ${state.uploads.length ? html`<div style=${{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 10, marginTop: 10 }}>
        ${state.uploads.map(function (u) {
          return html`<div key=${u.uid} data-upload=${u.uid}
            style=${{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", background: "var(--surface)" }}>
            ${u.thumbUrl && !u.broken
              ? html`<img src=${u.thumbUrl} alt="" onError=${function () { dispatch({ type: "MARK_BROKEN", uid: u.uid }); }} style=${{ width: 46, height: 46, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", flexShrink: 0 }} />`
              : html`<div style=${{ width: 46, height: 46, borderRadius: 8, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "var(--muted)", flexShrink: 0, fontSize: u.thumbUrl ? 9 : 12, textAlign: "center", padding: "0 2px" }}>${u.thumbUrl ? bi(state, U.noPreview).primary : "PDF"}<//>`}
            <div style=${{ flex: 1, minWidth: 0 }}>
              <div style=${{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${u.name}<//>
              <div className="promptSub" style=${{ marginTop: 2 }}>${Math.max(1, Math.round(u.size / 1024))} KB · ${u.mime}<//>
              <div style=${{ marginTop: 6 }} data-mode=${u.uid}>
                <${Pill}>${bi(state, C.docTypes[u.kind]).primary}<//>
                ${u.broken
                  ? html` <${Pill} tone="pri">${bi(state, U.broken).primary}<//>`
                  : html` <${Pill} tone=${u.handwritten ? "pri" : "ok"}>${u.handwritten ? bi(state, C.handwritten).primary : bi(state, C.printed).primary}<//>`}
                ${u.dark && !u.broken ? html` <${Pill} tone="pri">${bi(state, U.darkWarn).primary}<//>` : null}
              <//>
            <//>
            <div style=${{ display: "flex", gap: 6, flexShrink: 0 }}>
              ${u.broken ? null : html`<button data-modebtn=${u.uid + ":printed"} className=${"btn" + (u.handwritten ? " ghost" : "")}
                style=${{ padding: "6px 10px", fontSize: 13 }}
                onClick=${function () { dispatch({ type: "TOGGLE_UPLOAD_MODE", uid: u.uid, handwritten: false }); }}>
                ${bi(state, C.printed).primary}
              <//>
              <button data-modebtn=${u.uid + ":handwritten"} className=${"btn" + (u.handwritten ? "" : " ghost")}
                style=${{ padding: "6px 10px", fontSize: 13 }}
                onClick=${function () { dispatch({ type: "TOGGLE_UPLOAD_MODE", uid: u.uid, handwritten: true }); }}>
                ${bi(state, C.handwritten).primary}
              <//>`}
              <button data-remove=${u.uid} className="btn ghost" style=${{ padding: "6px 10px", fontSize: 13 }}
                onClick=${function () { dispatch({ type: "REMOVE_UPLOAD", uid: u.uid }); }}>✕<//>
            <//>
          <//>`;
        })}
      <//>` : null}
      <div className="btnRow" style=${{ marginTop: 16 }}>
        <button className="btn big" disabled=${total === 0} onClick=${function () { dispatch({ type: "SCAN" }); }}>
          ${bi(state, C.start).primary} (${total})<br/>${bi(state, C.start).secondary}
        <//>
      <//>
      ${total === 0 ? html`<div className="wNote" style=${{ marginTop: 10 }}>${bi(state, C.pickOne).primary} · ${bi(state, C.pickOne).secondary}<//>` : null}
      ${state.skippedNote ? html`<div className="wNote" style=${{ marginTop: 10 }}>${bi(state, U.onlyImages).primary} · ${bi(state, U.onlyImages).secondary}<//>` : null}
      <div className="wNote" style=${{ marginTop: 12 }}>
        OCR engine simulated in this demo with confidences measured from the reference
        implementation run (2026-09-11). The router, engine fallback ladder, cross-engine
        voting, confidence gate, structuring and FHIR emission below are the real pipeline
        logic (module-b/medib ported to JS).
        <br/>Uploaded pages: file thumbnails, names and pipeline routing are real; the OCR
        text for uploaded pages is simulated (the product runs PP-OCRv5 on the kiosk CPU).
        <br/>A sensitive-word filter ignores lines containing offensive words, and masks
        file names that contain them (demo display policy).
      <//>
    <//>
  <//>`;
}

/* ---------- phase: processing ---------- */

function Processing(props) {
  var state = props.state, dispatch = props.dispatch;
  React.useEffect(function () {
    var t = setTimeout(function () { dispatch({ type: "TO_REVIEW" }); }, 2600);
    return function () { clearTimeout(t); };
  }, []);
  var C = MB.CHROME.engine;
  var U = MB.CHROME.upload;
  var thumbs = {};
  state.uploads.forEach(function (u) { thumbs[u.uid] = u.thumbUrl; });
  var pt = React.useState({});
  var badProc = pt[0], setBadProc = pt[1];
  function markBadProc(uid) {
    setBadProc(function (prev) { var o = Object.assign({}, prev); o[uid] = true; return o; });
  }
  return html`<div className="welcome"><${Card}>
    <div className="stepTag">STEP 3 · ${C.reading.en} · ${C.reading.hi}<//>
    <h2 style=${{ marginTop: 12 }}>${bi(state, C.reading).primary}<//>
    ${bi(state, C.reading).secondary ? html`<div className="promptSub">${bi(state, C.reading).secondary}<//>` : null}
    <div style=${{ marginTop: 18 }}>
      ${state.session.results.map(function (r) {
        var up = !!r.doc.uploaded;
        return html`<div key=${r.doc.id} className="hoSec">
          <h4 style=${{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            ${up && thumbs[r.doc.uid] && !badProc[r.doc.uid] ? html`<img src=${thumbs[r.doc.uid]} alt="" onError=${function () { markBadProc(r.doc.uid); }} style=${{ width: 26, height: 26, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />` : null}
            ${r.doc.label.en} · ${r.doc.label.hi}
          <//>
          <div style=${{ marginTop: 6 }}>
            <${Pill}>route: ${r.route.pageType}<//>
            <${Pill}>engine: rapidocr ✓ (PP-OCRv5 mobile · CPU)<//>
            ${up ? html`<${Pill} tone="pri">${U.simulated.en}<//>` : null}
            ${r.doc.handwritten ? html`<${Pill} tone="pri">watchdog: tesseract cross-check<//>` : html`<${Pill} tone="ok">tesseract vote: agree<//>`}
          <//>
          <div className="hoBody" style=${{ marginTop: 8 }}>
            ${r.lineFields.map(function (f) {
              return html`<div key=${f.key} className="hoRow">
                <span className="hK">${f.text}<//>
                <span className="hV">${f.agree ? "✓ " + C.agree : "✗ " + C.disagree}<//>
                <span className="hSrc">conf ${f.conf.toFixed(2)}<//>
              <//>`;
            })}
          <//>
          ${r.ignoredLines ? html`<div className="wNote" style=${{ marginTop: 6 }}>${U.ignored.en} · ${U.ignored.hi} — ${r.ignoredLines}<//>` : null}
        <//>`;
      })}
    <//>
    <div className="wNote">${C.primary} → ${C.fallback} → ${C.manual} · ${C.simulated}<//>
  <//><//>`;
}

/* ---------- phase: review (patient) ---------- */

function fieldText(v) {
  if (typeof v === "string") return v;
  if (!v) return "—";
  if (v.name != null && v.text == null) {
    var t = v.name || "";
    if (v.dose) t += " " + v.dose;
    if (v.frequency) t += " " + v.frequency;
    if (v.duration) t += " × " + v.duration;
    if (v.value != null && v.value !== "") t += " : " + v.value + (v.unit ? " " + v.unit : "");
    else if (v.unit) t += " " + v.unit;
    if (v.note) t += " · " + v.note;
    return t || "—";
  }
  return v.text || JSON.stringify(v);
}

function kindOfField(f) {
  if (f.field.indexOf("medication") === 0) return "medication";
  if (f.field.indexOf("lab") === 0) return "lab";
  return "diagnose";
}

function FieldEditor(props) {
  var f = props.f, kind = props.kind, U = props.U;
  var v = f.value || {};
  var initA = kind === "diagnose" ? (v.text || "") : (v.name || "");
  var initB = kind === "medication"
    ? [v.dose, v.frequency, v.duration].filter(Boolean).join(" ")
    : (v.value || "");
  var initC = v.unit || "";
  var sA = React.useState(initA); var a = sA[0], setA = sA[1];
  var sB = React.useState(initB); var b = sB[0], setB = sB[1];
  var sC = React.useState(initC); var c = sC[0], setC = sC[1];
  var inputStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 16, width: "100%", boxSizing: "border-box" };
  return html`<div style=${{ margin: "2px 0 10px 0", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface)" }}>
    ${kind === "diagnose"
      ? html`<label style=${{ display: "block", fontSize: 13, fontWeight: 700 }}>${U.textL.en} · ${U.textL.hi}
          <input data-edit-a value=${a} onChange=${function (ev) { setA(ev.target.value); }} style=${inputStyle} /><//>`
      : kind === "medication"
      ? html`<div>
          <label style=${{ display: "block", fontSize: 13, fontWeight: 700 }}>${U.nameL.en} · ${U.nameL.hi}
            <input data-edit-a value=${a} onChange=${function (ev) { setA(ev.target.value); }} style=${inputStyle} /><//>
          <label style=${{ display: "block", fontSize: 13, fontWeight: 700, marginTop: 8 }}>${U.instrL.en} · ${U.instrL.hi}
            <input data-edit-b value=${b} onChange=${function (ev) { setB(ev.target.value); }} style=${inputStyle} /><//>
        <//>`
      : html`<div style=${{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style=${{ flex: "2 1 140px", fontSize: 13, fontWeight: 700 }}>${U.nameL.en} · ${U.nameL.hi}
            <input data-edit-a value=${a} onChange=${function (ev) { setA(ev.target.value); }} style=${inputStyle} /><//>
          <label style=${{ flex: "1 1 80px", fontSize: 13, fontWeight: 700 }}>${U.valueL.en} · ${U.valueL.hi}
            <input data-edit-b value=${b} onChange=${function (ev) { setB(ev.target.value); }} style=${inputStyle} /><//>
          <label style=${{ flex: "1 1 80px", fontSize: 13, fontWeight: 700 }}>${U.unitL.en} · ${U.unitL.hi}
            <input data-edit-c value=${c} onChange=${function (ev) { setC(ev.target.value); }} style=${inputStyle} /><//>
        <//>`}
    <div style=${{ display: "flex", gap: 8, marginTop: 10 }}>
      <button data-save className="btn" style=${{ padding: "8px 16px", fontSize: 14 }}
        disabled=${String(a).trim() === ""}
        onClick=${function () { props.onSave(a, b, c); }}>${U.save.en} · ${U.save.hi}<//>
      <button data-cancel className="btn ghost" style=${{ padding: "8px 16px", fontSize: 14 }}
        onClick=${props.onCancel}>${U.cancel.en}<//>
    <//>
  <//>`;
}

function Review(props) {
  var state = props.state, dispatch = props.dispatch;
  var C = MB.CHROME.review;
  var U = MB.CHROME.upload;
  var sess = state.session;
  var ed = React.useState(null);
  var editing = ed[0], setEditing = ed[1];
  var rt = React.useState({});
  var badRev = rt[0], setBadRev = rt[1];
  function markBadRev(uid) {
    setBadRev(function (prev) { var o = Object.assign({}, prev); o[uid] = true; return o; });
  }
  function liveFields(list) {
    return (list || []).filter(function (f) { return f.status !== "patient_denied"; });
  }
  function fieldRow(f) {
    var v = f.value;
    var corrected = f.status === "patient_corrected";
    var kind = kindOfField(f);
    return [html`<div key=${f.key} className="hoRow">
      <span className="hK">${fieldText(v)}<//>
      <span className="hV">${f.verify
        ? html`<span className="hoPill pri">⚠ ${C.verify.en} · ${C.verify.hi}<//>`
        : html`<span className="hoPill ok">${C.ok.en} · ${C.ok.hi}<//>`}
        ${corrected ? html` <span className="hoPill">✎ ${U.corrected.en}<//>` : null}
        <span style=${{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
          <button data-correct=${f.key} className="btn ghost" style=${{ padding: "3px 10px", fontSize: 12 }}
            onClick=${function () { setEditing({ key: f.key, kind: kind }); }}>${U.correct.en}<//>
          <button data-deny=${f.key} className="btn ghost" style=${{ padding: "3px 10px", fontSize: 12 }}
            onClick=${function () { dispatch({ type: "DENY_FIELD", key: f.key, denied: true }); }}>✕<//>
        <//>
      <//>
      <span className="hSrc">${corrected ? U.corrected.en : ("conf " + (v && v._srcConf != null ? v._srcConf.toFixed(2) : "—"))}<//>
    <//>`,
    (editing && editing.key === f.key)
      ? html`<div key=${f.key + ":ed"}><${FieldEditor} f=${f} kind=${editing.kind} U=${U}
          onSave=${function (a, b, c) { dispatch({ type: "CORRECT_FIELD", key: f.key, kind: editing.kind, a: a, b: b, c: c }); setEditing(null); }}
          onCancel=${function () { setEditing(null); }} /><//>`
      : null];
  }
  function section(title, rows) {
    var live = liveFields(rows);
    return html`<div className="hoSec">
      <h4>${title} (${live.length})<//>
      <div className="hoBody">${live.length
        ? live.flatMap(fieldRow)
        : html`<div className="hoRow"><span className="hV">${bi(state, C.none).primary}<//><span className="hSrc">—<//><//>`}<//>
    <//>`;
  }
  var denied = sess.results.flatMap(function (r) {
    return r.structFields.filter(function (f) { return f.status === "patient_denied"; });
  });
  return html`<div className="welcome"><${Card}>
    <div className="stepTag">STEP 4 · ${C.title.en} · ${C.title.hi}<//>
    <h2 style=${{ marginTop: 12 }}>${bi(state, C.title).primary}<//>
    ${bi(state, C.title).secondary ? html`<div className="promptSub">${bi(state, C.title).secondary}<//>` : null}
    <div className="wNote" style=${{ marginTop: 8 }}>${bi(state, U.fixHint).primary} · ${bi(state, U.fixHint).secondary}<//>
    ${state.uploads.filter(function (u) { return !u.broken; }).length ? html`<div className="hoSec" style=${{ marginTop: 6 }}>
      <h4>${bi(state, U.pages).primary} · ${bi(state, U.pages).secondary}<//>
      <div style=${{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        ${state.uploads.filter(function (u) { return !u.broken; }).map(function (u) {
          return (u.thumbUrl && !badRev[u.uid])
            ? html`<img key=${u.uid} src=${u.thumbUrl} alt=${u.name} onError=${function () { markBadRev(u.uid); }} style=${{ width: 120, height: 120, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)" }} />`
            : html`<div key=${u.uid} style=${{ width: 120, height: 120, borderRadius: 10, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "var(--muted)", fontSize: 11, textAlign: "center", padding: 4 }}>${u.thumbUrl ? U.noPreview.en : "PDF · " + u.name}<//>`;
        })}
      <//>
    <//>` : null}
    ${section(bi(state, C.meds).primary, sess.results.flatMap(function (r) { return r.structFields.filter(function (f) { return f.field.indexOf("medication") === 0; }); }))}
    ${section(bi(state, C.labs).primary, sess.results.flatMap(function (r) { return r.structFields.filter(function (f) { return f.field.indexOf("lab") === 0; }); }))}
    ${section(bi(state, C.dx).primary, sess.results.flatMap(function (r) { return r.structFields.filter(function (f) { return f.field.indexOf("diagnose") === 0; }); }))}
    ${denied.length ? html`<div className="hoSec">
      <h4>✕ ${U.deniedNote.en} (${denied.length})<//>
      <div className="promptSub">${U.deniedNote.hi}<//>
      <div className="hoBody">${denied.map(function (f) {
        return html`<div key=${f.key} className="hoRow">
          <span className="hK">${fieldText(f.value)}<//>
          <span className="hV"><button data-undo=${f.key} className="btn ghost" style=${{ padding: "3px 10px", fontSize: 12 }}
            onClick=${function () { dispatch({ type: "DENY_FIELD", key: f.key, denied: false }); }}>${U.undo.en} · ${U.undo.hi}<//><//>
          <span className="hSrc">—<//>
        <//>`;
      })}<//>
    <//>` : null}
    <div className="btnRow">
      <button className="btn big" onClick=${function () { dispatch({ type: "ATTEST" }); }}>
        ${bi(state, C.continue).primary}<br/>${bi(state, C.continue).secondary}
      <//>
    <//>
    ${sess.ignoredTotal ? html`<div className="wNote" style=${{ marginTop: 10 }}>${MB.CHROME.upload.ignored.en} · ${MB.CHROME.upload.ignored.hi} — ${sess.ignoredTotal}<//>` : null}
    <div className="wNote" style=${{ marginTop: 12 }}>
      “${C.verify.en}” fields go to the physician verify screen — nothing is silently guessed
      (MIRAGE: zero-shot models score 2–7.6% F1 on Indian handwriting; verify-default is
      evidence-mandated, doc/13 §2.1).
    <//>
  <//><//>`;
}

/* ---------- phase: handoff (physician attest + FHIR) ---------- */

function Handoff(props) {
  var state = props.state, dispatch = props.dispatch;
  var sess = state.session, bundle = state.bundle;
  var C = MB.CHROME.attest;
  var U = MB.CHROME.upload;
  var denied = MB.deniedSrcTexts(sess);
  var nCorr = 0, nDeny = 0;
  sess.results.forEach(function (r) {
    (r.structFields || []).forEach(function (f) {
      if (f.status === "patient_corrected") nCorr++;
      if (f.status === "patient_denied") nDeny++;
    });
  });
  var flagged = sess.results.flatMap(function (r) {
    return r.structFields.filter(function (f) { return f.verify && f.status !== "patient_denied"; })
      .concat(MB.visibleLineFields(r, denied).filter(function (f) { return f.verify; })
        .map(function (f) { return { field: f.key, value: f.text, reason: f.reason, bbox: f.bbox, conf: f.conf, status: "as_read" }; }));
  });
  var corrected = sess.results.flatMap(function (r) {
    return (r.structFields || []).filter(function (f) { return f.status === "patient_corrected"; });
  });
  var removed = sess.results.flatMap(function (r) {
    return (r.structFields || []).filter(function (f) { return f.status === "patient_denied"; });
  });
  var comp = bundle.entry[0].resource;
  var counts = {};
  bundle.entry.forEach(function (en) {
    var rt = en.resource.resourceType;
    counts[rt] = (counts[rt] || 0) + 1;
  });
  return html`<div className="hoWrap">
    <div className="hoSheet">
      <div className="hoHead">
        <div className="hoT">${C.title}<//>
        <div className="hoMeta">
          <span className="hoPill">session ${state.token} (Module D, simulated)<//>
          <span className="hoPill">language: ${state.lang === "en" ? "English" : "हिन्दी"}<//>
          ${sess.uploadCount ? html`<span className="hoPill">uploaded pages: ${sess.uploadCount} (OCR simulated)<//>` : null}
          ${nCorr ? html`<span className="hoPill">patient corrections: ${nCorr}<//>` : null}
          ${nDeny ? html`<span className="hoPill">removed by patient: ${nDeny}<//>` : null}
          ${sess.ignoredTotal ? html`<span className="hoPill">sensitive-word filter: ${sess.ignoredTotal} line(s) ignored<//>` : null}
          <span className="hoPill ok">${MB.CHROME.handoff.queue.en}<//>
          <span className="hoPill">captured on-device · offline<//>
        <//>
      <//>
      ${flagged.length ? html`<div className="hoBanner">${C.flagBanner.en}<//>` : html`<div className="hoBanner" style=${{ background: "var(--ok-bg)", borderColor: "#BCE3C9", color: "var(--ok)" }}>
        All fields read with high confidence — no flags. (Select the handwritten prescription to see the verify flow.)
      <//>`}
      <div className="hoBody">
        ${flagged.length ? html`<div className="hoSec">
          <h4>⚠ Flagged fields (${flagged.length}) — resolved by physician attestation<//>
          ${flagged.map(function (f, i) {
            var text = fieldText(f.value);
            return html`<div key={i} className="hoRow">
              <span className="hK">${text}<//>
              <span className="hV">${f.reason}<//>
              <span className="hSrc">bbox [${(f.bbox || []).join(", ")}] · ${f.status === "patient_corrected" ? U.corrected.en : "conf " + (f.conf !== undefined ? f.conf.toFixed(2) : (f.value && f.value._srcConf != null ? f.value._srcConf.toFixed(2) : "—"))}<//>
            <//>`;
          })}
        <//>` : null}
        ${(corrected.length || removed.length) ? html`<div className="hoSec">
          <h4>✎ Patient corrections (${corrected.length}) · removed by patient (${removed.length}) — confirm against the paper<//>
          ${corrected.map(function (f) {
            return html`<div key=${f.key} className="hoRow">
              <span className="hK">${fieldText(f.value)}<//>
              <span className="hV">${f.reason}<//>
              <span className="hSrc">bbox [${(f.bbox || []).join(", ")}]<//>
            <//>`;
          })}
          ${removed.map(function (f) {
            return html`<div key=${f.key} className="hoRow">
              <span className="hK">${fieldText(f.value)}<//>
              <span className="hV">${U.deniedNote.en}<//>
              <span className="hSrc">not in bundle<//>
            <//>`;
          })}
        <//>` : null}
        <div className="hoSec">
          <h4>${MB.CHROME.handoff.bundleTitle}<//>
          <div className="hoBody">
            ${Object.keys(counts).map(function (rt) {
              return html`<div key=${rt} className="hoRow"><span className="hK">${rt}<//><span className="hV">${counts[rt]} ${MB.CHROME.handoff.entries}<//><span className="hSrc">FHIR R4<//><//>`;
            })}
            <div className="hoRow"><span className="hK">Composition.status<//><span className="hV">${comp.status}<//><span className="hSrc">preliminary → final after attest<//><//>
            <div className="hoRow"><span className="hK">Composition.attester<//><span className="hV">${comp.attester.length ? comp.attester[0].mode + " ✓" : "—"}<//><span className="hSrc">NRCeS attester slot (doc/13 §1)<//><//>
            <div className="hoRow"><span className="hK">sections<//><span className="hV">${comp.section.map(function (s) { return s.title; }).join(" · ") || "—"}<//><span className="hSrc">LOINC-coded<//><//>
            <div className="hoRow"><span className="hK">raw scan<//><span className="hV">${sess.persistRaw ? MB.CHROME.handoff.rawKept.en : MB.CHROME.handoff.rawTransient.en}<//><span className="hSrc">DPDP transient default<//><//>
          <//>
          <div className="wNote" style=${{ marginTop: 8 }}>${C.done}<//>
        <//>
      <//>
      <div className="btnRow">
        <button className="btn ghost" onClick=${function () { dispatch({ type: "RESTART" }); }}>${MB.CHROME.handoff.restart.en} · ${MB.CHROME.handoff.restart.hi}<//>
      <//>
    <//>
  <//>`;
}

/* ---------- app ---------- */

function App() {
  var _React$useReducer = React.useReducer(reducer, undefined, initialState);
  var state = _React$useReducer[0], rawDispatch = _React$useReducer[1];
  var stateRef = React.useRef(state);
  stateRef.current = state;
  function dispatch(action) {
    if (action.type === "RESTART") {
      (stateRef.current.uploads || []).forEach(function (u) {
        if (u.thumbUrl) { try { URL.revokeObjectURL(u.thumbUrl); } catch (err) {} }
      });
    }
    if (action.type === "REMOVE_UPLOAD") {
      var victim = (stateRef.current.uploads || []).find(function (x) { return x.uid === action.uid; });
      if (victim && victim.thumbUrl) { try { URL.revokeObjectURL(victim.thumbUrl); } catch (err) {} }
    }
    rawDispatch(action);
  }
  var body = null;
  if (state.phase === "welcome") body = html`<${Welcome} state=${state} dispatch=${dispatch} />`;
  else if (state.phase === "declined") body = html`<${Declined} state=${state} dispatch=${dispatch} />`;
  else if (state.phase === "scan") body = html`<${Scan} state=${state} dispatch=${dispatch} />`;
  else if (state.phase === "processing") body = html`<${Processing} state=${state} dispatch=${dispatch} />`;
  else if (state.phase === "review") body = html`<${Review} state=${state} dispatch=${dispatch} />`;
  else if (state.phase === "handoff") body = html`<${Handoff} state=${state} dispatch=${dispatch} />`;
  return html`<div>
    <${DemoBar} state=${state} dispatch=${dispatch} />
    <${Header} state=${state} />
    ${body}
    <div className="stageFoot">
      MediKiosk SIH 26047 demo · Module B: OCR + structuring + FHIR (ABDM) · CPU-only engine lane
      (PP-OCRv5 mobile primary · Tesseract fallback) · verify-default on handwriting · this page runs offline
    <//>
  <//>`;
}

var rootEl = document.getElementById("root");
ReactDOM.createRoot(rootEl).render(e(App));
})();
