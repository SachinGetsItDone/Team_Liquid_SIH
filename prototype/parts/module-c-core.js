/*  MediKiosk Module C — DOM-free demo core (testable in Node).
    Ports the reference implementation (module-c/medic: contracts, merger,
    renderer, OPConsultRecord emitter) to JS. The two input streams are demo
    fixtures shaped exactly like the real contracts (HistoryBundle v1 +
    medib run_summary) — the merge/render/emit logic below is the real
    pipeline ported from Python; only the inputs are simulated, which is
    labeled honestly in the UI. The renderer is DETERMINISTIC by design —
    no LLM generates any part of this summary (2026-09-11 /last30days
    validation + doc/15 §2: LLM-note hallucination measurement is contested;
    r/healthIT: scribe notes "generic, wrong terminology, rewritten half"). */
/*MC-CORE-BEGIN*/
"use strict";

function pickLangText(map, lang) {
  if (!map) return "";
  return map[lang] || map.en || "";
}

/* ---------- v1 HistoryBundle contract (port of medic.contracts) ---------- */

var SLOT_STATES = ["captured", "needs_review", "not_answered", "not_elicited"];
var SOCRATES_FIELDS = ["site", "onset", "character", "radiation", "associations",
                       "timing", "exacerbating", "severity"];

function slotFrom(raw, key) {
  raw = raw || {};
  var state = raw.state || "not_elicited";
  if (SLOT_STATES.indexOf(state) === -1)
    throw new Error("slot " + key + ": unknown state " + state);
  var value = String(raw.value == null ? "" : raw.value);
  if (state === "captured" && !value)
    throw new Error("slot " + key + ": captured but empty");
  return {
    key: key, state: state, value: value,
    by: raw.by || "patient", voice: !!raw.voice,
    conf: raw.conf == null ? null : raw.conf,
    rendered: (state === "captured" || state === "needs_review") && !!value
  };
}

function loadHistory(raw) {
  if (raw.schema !== "medikiosk-history-bundle/1")
    throw new Error("unsupported history schema: " + raw.schema);
  ["session_id", "consent_ref", "patient_ref"].forEach(function (k) {
    if (!raw[k]) throw new Error("missing required field " + k);
  });
  var socrates = {};
  SOCRATES_FIELDS.forEach(function (k) {
    if (!raw.socrates || !raw.socrates[k]) throw new Error("socrates missing slot " + k);
    socrates[k] = slotFrom(raw.socrates[k], k);
  });
  var ice = {};
  ["ideas", "concerns", "expectations"].forEach(function (k) {
    ice[k] = slotFrom((raw.ice || {})[k], "ice." + k);
  });
  return {
    schema: raw.schema, sessionId: raw.session_id, consentRef: raw.consent_ref,
    patientRef: raw.patient_ref, language: raw.language || "en",
    respondent: raw.respondent || { role: "patient" },
    visit: raw.visit || { type: "new" },
    complaint: raw.complaint || {},
    socrates: socrates, pmh: raw.pmh || [], medications: raw.medications || [],
    allergies: raw.allergies || [], family: raw.family || [],
    social: raw.social || [], ros: raw.ros || [], ice: ice,
    redFlags: raw.red_flags || [],
    capturedSlots: function () {
      var out = SOCRATES_FIELDS.map(function (k) { return socrates[k]; })
        .concat([ice.ideas, ice.concerns, ice.expectations]);
      return out.filter(function (s) { return s.rendered; });
    }
  };
}

function loadDocuments(raw) {
  var side = { sessionId: (raw && raw.session_id) || "", meds: [], labs: [],
               dx: [], hasRawScan: false, persistRaw: !!(raw && raw.persist_raw) };
  (raw && raw.pages ? raw.pages : []).forEach(function (page) {
    var st = page.structured || {};
    (st.medications || []).forEach(function (m) {
      side.meds.push({ name: m.name || "", dose: m.dose || "",
                       frequency: m.frequency || "", duration: m.duration || "",
                       verify: !!m._verify, conf: m._src_conf == null ? null : m._src_conf,
                       sourceDoc: page.image || "doc" });
    });
    (st.labs || []).forEach(function (l) {
      side.labs.push({ name: l.name || "", value: String(l.value == null ? "" : l.value),
                       unit: l.unit || "", verify: !!l._verify,
                       conf: l._src_conf == null ? null : l._src_conf,
                       sourceDoc: page.image || "doc" });
    });
    (st.diagnoses || []).forEach(function (d) {
      side.dx.push({ text: d.text || "", verify: !!d._verify,
                     conf: d._src_conf == null ? null : d._src_conf,
                     sourceDoc: page.image || "doc" });
    });
  });
  side.hasRawScan = side.meds.length + side.labs.length + side.dx.length > 0;
  return side;
}

/* ---------- merger (port of medic.merger) ---------- */

var REFERENCE_RANGES = {           /* placeholder demo table — same as medic.config */
  "hemoglobin": [12.0, 16.0, "g/dL"],
  "fasting glucose": [70.0, 100.0, "mg/dL"],
  "hba1c": [4.0, 5.6, "%"],
  "tsh": [0.4, 4.0, "mIU/L"]
};

function normName(n) {
  return String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dosesEquivalent(a, b) {
  function nu(s) {
    var m = String(s || "").match(/^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)/);
    return m ? [parseFloat(m[1]), m[2].toLowerCase()] : null;
  }
  var na = nu(a), nb = nu(b);
  if (na && nb) {
    if (na[0] !== nb[0]) return false;
    if (na[1] && nb[1]) return na[1] === nb[1];
    return true;
  }
  return normName(a) === normName(b);
}

function abnormality(name, value, unit) {
  var v = parseFloat(String(value).trim());
  if (isNaN(v)) return { abnormal: "", note: "" };
  var rng = REFERENCE_RANGES[String(name || "").trim().toLowerCase()];
  if (!rng) return { abnormal: "", note: "" };
  if (rng[2] && unit && rng[2].toLowerCase() !== unit.toLowerCase())
    return { abnormal: "", note: "" };
  var note = "ref " + rng[0] + "-" + rng[1] + " " + rng[2];
  if (v < rng[0]) return { abnormal: "low", note: note };
  if (v > rng[1]) return { abnormal: "high", note: note };
  return { abnormal: "", note: note };
}

function merge(history, documents) {
  var meds = [];
  var stated = {};
  (history.medications || []).forEach(function (m) { stated[normName(m.name)] = m; });

  /* pass 0: dedupe document meds across pages */
  var docMeds = [], seen = {};
  documents.meds.forEach(function (dm) {
    var key = normName(dm.name);
    if (!key) return;
    if (seen[key]) {
      var ex = docMeds.find(function (m) { return normName(m.name) === key; });
      if ((dm.conf || 0) > (ex.conf || 0)) {
        ex.name = dm.name; ex.dose = dm.dose; ex.frequency = dm.frequency;
      }
      ex.verify = ex.verify || dm.verify;
      return;
    }
    seen[key] = true; docMeds.push(dm);
  });

  /* pass 1: document meds drive the merged list */
  docMeds.forEach(function (dm, i) {
    var key = normName(dm.name);
    var matchKey = Object.keys(stated).find(function (k) { return k === key; });
    var sources = ["document"], verify = dm.verify, reason = "", dose = dm.dose;
    if (matchKey) {
      sources.unshift("patient");
      var statedDose = String(stated[matchKey].dose || "").trim();
      if (statedDose && dm.dose && !dosesEquivalent(statedDose, dm.dose)) {
        verify = true;
        reason = "dose differs: patient said " + statedDose + ", document says " + dm.dose;
      } else if (statedDose && !dm.dose) {
        dose = statedDose;
      }
    }
    meds.push({ name: dm.name, dose: dose, frequency: dm.frequency,
                duration: dm.duration, sources: sources, verify: verify,
                reason: reason, conf: dm.conf, fid: "B:med:" + i });
  });

  /* pass 2: patient-stated meds not on any document */
  var docKeys = docMeds.map(function (dm) { return normName(dm.name); });
  var j = 0;
  Object.keys(stated).forEach(function (k) {
    if (docKeys.indexOf(k) !== -1) return;
    var sm = stated[k];
    meds.push({ name: sm.name, dose: sm.dose || "", frequency: sm.frequency || "",
                sources: ["patient"], verify: false, reason: "", conf: null,
                fid: "A:med:" + (j++) });
  });

  /* labs + abnormality */
  var labs = documents.labs.map(function (l, i) {
    var ab = abnormality(l.name, l.value, l.unit);
    return { name: l.name, value: l.value, unit: l.unit,
             abnormal: ab.abnormal, rangeNote: ab.note, verify: l.verify,
             conf: l.conf, fid: "B:lab:" + i,
             label: function () {
               return this.name + ": " + this.value + (this.unit ? " " + this.unit : "");
             } };
  });

  var dx = documents.dx.map(function (d, i) {
    return { text: d.text, verify: d.verify, conf: d.conf,
             sourceDoc: d.sourceDoc, fid: "B:dx:" + i };
  });

  /* timeline (honest: dates only when on the paper — none in demo fixtures) */
  var timeline = dx.map(function (d) {
    return { kind: "diagnosis", text: d.text, date: null,
             dateNote: "date not on document", fid: d.fid };
  }).concat(labs.map(function (l) {
    return { kind: "lab", text: l.label() + (l.abnormal ? " (" + l.abnormal + ")" : ""),
             date: null, dateNote: "date not on document", fid: l.fid };
  }));

  /* severity-ordered alerts: red flags → verify → abnormal */
  var alerts = [];
  history.redFlags.forEach(function (rf) {
    alerts.push({ severity: "red-flag",
                  text: rf.rule + ": " + (rf.title || "red-flag rule matched"),
                  detail: rf.matched ? "matched: " + rf.matched.join(", ") : "",
                  fid: "A:redflag:" + rf.rule });
  });
  meds.forEach(function (m) {
    if (m.verify) alerts.push({ severity: "verify", text: "medication: " + medLabel(m),
                                detail: m.reason || "from document — physician verifies",
                                fid: m.fid });
  });
  dx.forEach(function (d) {
    if (d.verify) alerts.push({ severity: "verify",
                                text: "diagnosis (from paper): " + d.text,
                                detail: "document-derived — physician verifies", fid: d.fid });
  });
  labs.forEach(function (l) {
    if (l.abnormal) alerts.push({ severity: l.verify ? "verify" : "abnormal",
                                  text: l.label() + " — " + l.abnormal.toUpperCase(),
                                  detail: l.rangeNote, fid: l.fid });
    else if (l.verify) alerts.push({ severity: "verify", text: "lab: " + l.label(),
                                     detail: "low-confidence read — physician verifies",
                                     fid: l.fid });
  });
  var order = { "red-flag": 0, "verify": 1, "abnormal": 2 };
  function sevRank(s) { return order.hasOwnProperty(s) ? order[s] : 3; }
  alerts.sort(function (a, b) { return sevRank(a.severity) - sevRank(b.severity); });

  return { history: history, documents: documents, meds: meds, labs: labs,
           dx: dx, alerts: alerts, timeline: timeline };
}

function medLabel(m) {
  var parts = [m.name].concat([m.dose, m.frequency, m.duration].filter(Boolean));
  return parts.join(" ");
}

/* ---------- renderer (port of medic.renderer) ---------- */

var SOCRATES_LABELS = {
  site: { en: "Site", hi: "जगह" },
  onset: { en: "Onset", hi: "शुरुआत" },
  character: { en: "Character", hi: "प्रकार" },
  radiation: { en: "Radiation", hi: "फैलना" },
  associations: { en: "Associations", hi: "साथ में" },
  timing: { en: "Timing", hi: "समय" },
  exacerbating: { en: "Exacerbating/relieving", hi: "बढ़ता/घटता" },
  severity: { en: "Severity", hi: "तीव्रता" }
};
var ICE_LABELS = {
  "ice.ideas": { en: "Patient ideas", hi: "मरीज़ का ख्याल" },
  "ice.concerns": { en: "Patient concerns", hi: "मरीज़ की चिंता" },
  "ice.expectations": { en: "Patient expectations", hi: "मरीज़ की अपेक्षा" }
};
var PROXY_TAG = { en: "stated by attendant", hi: "परिचारक ने बताया" };
var VOICE_TAG = { en: "voice — original words kept", hi: "आवाज़ — मूल शब्द रखे गए" };
var DOCTOR_ONLY = {
  en: "Assessment & Plan — physician only. Not generated by the kiosk.",
  hi: "मूल्यांकन और योजना — केवल चिकित्सक। कियोस्क इसे नहीं बनाता।"
};

function slotTag(s, lang) {
  var tag = "";
  if (s.by === "proxy") tag += " [" + PROXY_TAG[lang] + "]";
  if (s.voice) tag += " [" + VOICE_TAG[lang] + "]";
  if (s.state === "needs_review") tag += " [needs review]";
  return tag;
}

function renderSoap(cs) {
  var h = cs.history, S = [], O = [];
  var cc = h.complaint.free_text || h.complaint.term || "(not stated)";
  S.push({ text: "Chief complaint (patient's words): " + cc, src: ["A:complaint"] });
  h.capturedSlots().forEach(function (s) {
    if (!SOCRATES_LABELS[s.key]) return;
    var label = SOCRATES_LABELS[s.key].en;
    S.push({ text: label + ": " + s.value + slotTag(s, "en"), src: ["A:" + s.key] });
  });
  if (h.pmh.length) S.push({ text: "Past history: " + h.pmh.map(function (p) { return p.text; }).join("; "), src: ["A:pmh"] });
  if (h.allergies.length) S.push({ text: "Allergies: " + h.allergies.map(function (a) { return a.text; }).join("; "), src: ["A:allergies"] });
  if (cs.meds.length) S.push({ text: "Medications: " + cs.meds.map(function (m) {
    return medLabel(m) + " [" + m.sources.join("+") + "]" + (m.reason ? " (" + m.reason + ")" : "");
  }).join("; "), src: cs.meds.map(function (m) { return m.fid; }) });
  if (h.family.length) S.push({ text: "Family history: " + h.family.map(function (f) { return f.text; }).join("; "), src: ["A:family"] });
  if (h.social.length) S.push({ text: "Social history: " + h.social.map(function (s) { return s.text; }).join("; "), src: ["A:social"] });
  var pos = h.ros.filter(function (r) { return r.positive; });
  var neg = h.ros.filter(function (r) { return !r.positive && r.state === "captured"; });
  if (pos.length) S.push({ text: "ROS pertinent positives: " + pos.map(function (r) { return r.symptom; }).join("; "), src: ["A:ros"] });
  if (neg.length) S.push({ text: "ROS pertinent negatives: " + neg.map(function (r) { return r.symptom; }).join("; "), src: ["A:ros"] });
  ["ideas", "concerns", "expectations"].forEach(function (k) {
    var s = h.ice[k];
    if (s.rendered) S.push({ text: "ICE " + k + ": " + s.value + slotTag(s, "en"), src: ["A:ice." + k] });
  });

  if (cs.labs.length) {
    O.push({ text: "Prior results (from patient's papers):", src: [] });
    cs.labs.forEach(function (l) {
      var flag = l.abnormal ? " [" + l.abnormal.toUpperCase() + " (" + l.rangeNote + ")]" : "";
      var verify = l.verify ? " [verify]" : "";
      O.push({ text: "  " + l.label() + flag + verify, src: [l.fid] });
    });
  }
  if (cs.dx.length) O.push({ text: "Documented conditions (from papers): " +
    cs.dx.map(function (d) { return d.text; }).join("; "), src: cs.dx.map(function (d) { return d.fid; }) });
  O.push({ text: "Vitals / examination: to be recorded at consultation", src: [] });

  var gaps = [];
  SOCRATES_FIELDS.concat(["ice.ideas", "ice.concerns", "ice.expectations"]).forEach(function (key) {
    var s = key.indexOf(".") !== -1 ? h.ice[key.split(".")[1]] : h.socrates[key];
    if (s.state === "not_answered" || s.state === "not_elicited") {
      var label = (SOCRATES_LABELS[key] || ICE_LABELS[key] || { en: key }).en;
      gaps.push({ text: label + ": " + (s.state === "not_answered"
        ? "not answered (patient will tell doctor)" : "not asked (session ended early)"),
        src: ["A:" + key] });
    }
  });

  return { view: "soap", S: S, O: O,
           A: [{ text: DOCTOR_ONLY.en, src: [] }],
           P: [{ text: "Plan — physician only. Draft slots left blank by design.", src: [] }],
           gaps: gaps };
}

function renderReadback(cs, lang) {
  var h = cs.history, lines = [];
  var cc = h.complaint.free_text || h.complaint.term || "";
  if (cc) {
    var ccLbl = { en: "Your problem", hi: "आपकी समस्या" }[lang];
    lines.push({ text: ccLbl + ": " + cc, src: ["A:complaint"] });
  }
  h.capturedSlots().forEach(function (s) {
    var label = s.key.indexOf("ice.") === 0
      ? ICE_LABELS[s.key][lang]
      : (SOCRATES_LABELS[s.key] || { en: s.key })[lang];
    lines.push({ text: label + ": " + s.value + slotTag(s, lang), src: ["A:" + s.key] });
  });
  if (h.allergies.length) {
    var al = { en: "Allergies", hi: "एलर्जी" }[lang];
    lines.push({ text: al + ": " + h.allergies.map(function (a) { return a.text; }).join("; "), src: ["A:allergies"] });
  }
  if (cs.meds.length) {
    var ml = { en: "Medicines you take", hi: "आपकी दवाएँ" }[lang];
    lines.push({ text: ml + ": " + cs.meds.map(medLabel).join("; "),
                 src: cs.meds.map(function (m) { return m.fid; }) });
  }
  if (h.social.length) {
    var sl = { en: "Habits", hi: "आदतें" }[lang];
    lines.push({ text: sl + ": " + h.social.map(function (s) { return s.text; }).join("; "), src: ["A:social"] });
  }
  if (cs.meds.length + cs.labs.length + cs.dx.length > 0) {
    lines.push({ text: { en: "The doctor will check the papers that were scanned.",
                         hi: "डॉक्टर स्कैन किए काग़ज़ों की जाँच करेंगे।" }[lang],
                 src: ["B:session"] });
  }
  return { view: "readback-" + lang, lang: lang, lines: lines };
}

/* ---------- OPConsultRecord emitter (port of medic.fhir_emitter) ---------- */

var NRCES_PROFILE = "https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord";
var SNOMED = "http://snomed.info/sct", LOINC = "http://loinc.org";
var SECTION_CODES = {
  chief_complaints: ["422843007", "Chief complaint", SNOMED],
  allergies: ["722446000", "Allergy record", SNOMED],
  medications: ["10160-0", "History of Medication use Narrative", LOINC],
  labs: ["30954-2", "Relevant diagnostic tests/laboratory data Narrative", LOINC],
  medical_history: ["11347-0", "History of Past illness Narrative", LOINC],
  family_history: ["10157-6", "History of Family member diseases Narrative", LOINC],
  document_reference: ["42348-3", "Encounter documents", LOINC]
};

function nowIso() { return new Date().toISOString().replace(/\.\d+Z$/, "+00:00"); }

function codeFor(section) {
  var c = SECTION_CODES[section];
  return { coding: [{ system: c[2], code: c[0], display: c[1] }] };
}

var SOCRATES_TEXT = {
  site: "Symptom site", onset: "Symptom onset", character: "Symptom character",
  radiation: "Symptom radiation", associations: "Associated symptoms",
  timing: "Symptom timing", exacerbating: "Exacerbating/relieving factors",
  severity: "Symptom severity"
};

function buildOpconsultrecord(cs) {
  var h = cs.history, entries = [], sections = [];
  var composition = {
    resourceType: "Composition", id: "opconsult-composition",
    meta: { profile: [NRCES_PROFILE], source: "#medikiosk-module-c-demo" },
    status: "preliminary",
    type: { coding: [{ system: SNOMED, code: "371530004",
                       display: "Clinical consultation report" }],
            text: "Pre-consultation history summary (patient-elicited)" },
    subject: { reference: h.patientRef },
    encounter: { reference: "Encounter/" + h.sessionId },
    date: nowIso(),
    author: [{ reference: "Organization/HOSP-DEMO" }],
    title: "MediKiosk pre-consultation history summary",
    attester: [], section: sections
  };
  entries.push({ fullUrl: "urn:uuid:composition", resource: composition });

  var cc = h.complaint.term || h.complaint.free_text;
  if (cc) {
    entries.push({ fullUrl: "urn:uuid:cc-0", resource: {
      resourceType: "Condition", id: "cc-0",
      clinicalStatus: { text: "patient-reported" },
      verificationStatus: { text: "unconfirmed" },
      code: { text: cc }, subject: { reference: h.patientRef } } });
    sections.push({ title: "Chief Complaints", code: codeFor("chief_complaints"),
                    entry: [{ reference: "urn:uuid:cc-0" }] });
  }

  var obsEntries = [];
  h.capturedSlots().forEach(function (s) {
    var oid = "obs-" + s.key.replace(/\./g, "-");
    entries.push({ fullUrl: "urn:uuid:" + oid, resource: {
      resourceType: "Observation", id: oid, status: "preliminary",
      code: { text: SOCRATES_TEXT[s.key] || ICE_LABELS[s.key].en },
      subject: { reference: h.patientRef }, valueString: s.value } });
    obsEntries.push({ reference: "urn:uuid:" + oid });
  });
  h.ros.forEach(function (r, i) {
    var oid = "ros-" + i;
    entries.push({ fullUrl: "urn:uuid:" + oid, resource: {
      resourceType: "Observation", id: oid, status: "preliminary",
      code: { text: "ROS " + (r.system || "") + ": " + (r.symptom || "") },
      subject: { reference: h.patientRef },
      valueString: r.positive ? "present" : "denied" } });
    obsEntries.push({ reference: "urn:uuid:" + oid });
  });
  if (obsEntries.length) {
    /* maps to the profile's OtherObservations slice; code intentionally not
       invented (not in the verified set) — flagged for M3 HAPI validation */
    sections.push({ title: "History of present illness (structured elicitation)",
                    entry: obsEntries });
  }

  if (h.allergies.length) {
    var aEntries = [];
    h.allergies.forEach(function (a, i) {
      var aid = "allergy-" + i;
      entries.push({ fullUrl: "urn:uuid:" + aid, resource: {
        resourceType: "AllergyIntolerance", id: aid,
        clinicalStatus: { text: "patient-reported" },
        code: { text: a.text }, patient: { reference: h.patientRef } } });
      aEntries.push({ reference: "urn:uuid:" + aid });
    });
    sections.push({ title: "Allergies", code: codeFor("allergies"), entry: aEntries });
  }

  if (cs.meds.length) {
    var mEntries = [];
    cs.meds.forEach(function (m, i) {
      var dosage = [m.dose, m.frequency, m.duration].filter(Boolean).join(" ");
      entries.push({ fullUrl: "urn:uuid:med-" + i, resource: {
        resourceType: "MedicationRequest", id: "med-" + i,
        status: "draft", intent: "proposal",
        medicationCodeableConcept: { text: m.name },
        subject: { reference: h.patientRef }, authoredOn: nowIso(),
        dosageInstruction: dosage ? [{ text: dosage }] : [],
        note: [{ text: "source: " + m.sources.join(", ") +
                       (m.reason ? "; " + m.reason : "") +
                       (m.verify ? "; needs physician verification" : "") }] } });
      mEntries.push({ reference: "urn:uuid:med-" + i });
    });
    sections.push({ title: "Medications (patient-stated + documents; verify)",
                    code: codeFor("medications"), entry: mEntries });
  }

  if (h.pmh.length + cs.dx.length) {
    var pEntries = [];
    h.pmh.forEach(function (p, i) {
      var pid = "pmh-" + i;
      entries.push({ fullUrl: "urn:uuid:" + pid, resource: {
        resourceType: "Condition", id: pid,
        clinicalStatus: { text: "patient-reported" },
        verificationStatus: { text: "unconfirmed" },
        code: { text: p.text }, subject: { reference: h.patientRef } } });
      pEntries.push({ reference: "urn:uuid:" + pid });
    });
    cs.dx.forEach(function (d) {
      var pid = d.fid.replace(/:/g, "-");
      entries.push({ fullUrl: "urn:uuid:" + pid, resource: {
        resourceType: "Condition", id: pid,
        clinicalStatus: { text: "documented (from patient papers)" },
        verificationStatus: { text: "unconfirmed" },
        code: { text: d.text }, subject: { reference: h.patientRef } } });
      pEntries.push({ reference: "urn:uuid:" + pid });
    });
    sections.push({ title: "Medical history (patient-stated + papers)",
                    code: codeFor("medical_history"), entry: pEntries });
  }

  if (cs.labs.length) {
    var lEntries = [];
    cs.labs.forEach(function (l, i) {
      var oid = "doclab-" + i;
      var res = { resourceType: "Observation", id: oid, status: "preliminary",
                  code: { text: l.name }, subject: { reference: h.patientRef } };
      var v = parseFloat(l.value);
      if (!isNaN(v)) {
        res.valueQuantity = { value: v };
        if (l.unit) res.valueQuantity.unit = l.unit;
      } else res.valueString = l.value;
      if (l.abnormal) res.interpretation = [{ text: l.abnormal }];
      entries.push({ fullUrl: "urn:uuid:" + oid, resource: res });
      lEntries.push({ reference: "urn:uuid:" + oid });
    });
    sections.push({ title: "Prior lab results (from patient papers)",
                    code: codeFor("labs"), entry: lEntries });
  }

  return { resourceType: "Bundle", id: "medikiosk-c-" + h.sessionId,
           type: "document", timestamp: nowIso(), entry: entries };
}

function physicianAttest(bundle, practitionerRef) {
  (bundle.entry || []).forEach(function (en) {
    var r = en.resource || {};
    if (r.resourceType === "Composition") {
      r.attester = r.attester || [];
      r.attester.push({ mode: "professional",
                        party: { reference: practitionerRef || "Practitioner/DEMO" },
                        time: nowIso() });
      if (r.status === "preliminary") r.status = "final";
    }
  });
  return bundle;
}

/* ---------- demo fixtures (the shared SIH demo case) ---------- */

var DEMO_CASES = [
  {
    id: "ramesh",
    label: { en: "Ramesh, 54 — chest pain (red-flag path)",
             hi: "रमेश, 54 — सीने में दर्द (रेड-फ्लैग पथ)" },
    queue: "PRIORITY TRIAGE",
    history: {
      schema: "medikiosk-history-bundle/1",
      session_id: "A2309111433", consent_ref: "opaque-token-module-d",
      patient_ref: "Patient/ABHA-DEMO", language: "rom",
      respondent: { role: "patient" }, visit: { type: "new" },
      complaint: { term: "chest pain",
                   free_text: "seedi seene mein dard hai (clinical excerpt kept)",
                   by: "patient", voice: true, conf: 0.91 },
      socrates: {
        site: { state: "captured", value: "middle of the chest", by: "patient", voice: true, conf: 0.93 },
        onset: { state: "captured", value: "2 days ago, sudden", by: "patient", voice: true, conf: 0.9 },
        character: { state: "captured", value: "heavy pressure", by: "patient", voice: true, conf: 0.89 },
        radiation: { state: "captured", value: "left arm", by: "patient", voice: true, conf: 0.88 },
        associations: { state: "captured", value: "breathlessness, sweating", by: "patient", voice: true, conf: 0.92 },
        timing: { state: "captured", value: "comes and goes, 10-20 minutes", by: "patient", voice: true, conf: 0.85 },
        exacerbating: { state: "captured", value: "walking uphill", by: "patient" },
        severity: { state: "captured", value: "8/10", by: "patient" }
      },
      pmh: [{ text: "high BP for 5 years", by: "patient" },
            { text: "kidney stone (2019)", by: "patient" }],
      medications: [
        { name: "Amlodipine", dose: "5 mg", frequency: "OD", by: "patient" },
        { name: "Atorvastatin", dose: "10 mg", frequency: "", by: "patient" }
      ],
      allergies: [{ text: "no allergies", by: "patient" }],
      family: [{ text: "father — heart attack at 58", by: "patient" }],
      social: [{ text: "smokes 10 bidis/day", by: "patient" }],
      ros: [
        { system: "cardio", symptom: "breathlessness", state: "captured", positive: true },
        { system: "resp", symptom: "cough", state: "captured", positive: true },
        { system: "gi", symptom: "vomiting", state: "captured", positive: false },
        { system: "neuro", symptom: "fainting", state: "captured", positive: false }
      ],
      ice: {
        ideas: { state: "captured", value: "thinks it is gas", by: "patient", voice: true },
        concerns: { state: "captured", value: "worried like his father", by: "patient", voice: true },
        expectations: { state: "needs_review", value: "wants ECG today", by: "patient" }
      },
      red_flags: [{ rule: "RF-2", title: "chest pain + breathlessness",
                    matched: ["chest pain", "breathlessness"] }]
    },
    documents: {
      session_id: "B2309111502", persist_raw: false,
      pages: [
        { image: "print_en_rx.png", structured: {
            medications: [
              { name: "Amoxicillin", dose: "500mg", frequency: "BD", duration: "5 days", _src_conf: 0.99 },
              { name: "Paracetamol", dose: "650mg", frequency: "TDS", duration: "3 days", _src_conf: 0.99 },
              { name: "Ascoril", dose: "5ml", frequency: "TDS", duration: "7 days", _src_conf: 0.97 }],
            labs: [], diagnoses: [{ text: "Acute bronchitis", _src_conf: 1.0 }] },
          verify: { verify_all: false, fields: [] } },
        { image: "print_hi_rx.png", structured: {
            medications: [{ name: "Paracetamol", dose: "650", frequency: "TDS", _src_conf: 0.96 }],
            labs: [], diagnoses: [{ text: "fever and cough", _src_conf: 0.95 }] },
          verify: { verify_all: false, fields: [] } },
        { image: "print_en_lab.png", structured: {
            medications: [],
            labs: [
              { name: "Hemoglobin", value: "10.2", unit: "g/dL", _src_conf: 0.99 },
              { name: "TSH", value: "4.1", unit: "mIU/L", _src_conf: 0.96 },
              { name: "Fasting Glucose", value: "112", unit: "mg/dL", _src_conf: 0.99 },
              { name: "HbA1c", value: "6.8", unit: "%", _src_conf: 0.91 }],
            diagnoses: [] },
          verify: { verify_all: false, fields: [] } },
        { image: "handwritten_rx.png", structured: {
            medications: [
              { name: "Atorvastatin", dose: "10", frequency: "", _src_conf: 0.61, _verify: true },
              { name: "Metformin", dose: "500", frequency: "BD", _src_conf: 0.52, _verify: true }],
            labs: [], diagnoses: [{ text: "NIDDM", _src_conf: 0.38, _verify: true }] },
          verify: { verify_all: true, fields: [] } }
      ]
    }
  },
  {
    id: "sunita",
    label: { en: "Sunita, 42 — knee pain (routine path, no papers)",
             hi: "सुनीता, 42 — घुटने का दर्द (सामान्य पथ, कोई काग़ज़ नहीं)" },
    queue: "ROUTINE OPD",
    history: {
      schema: "medikiosk-history-bundle/1",
      session_id: "A2309111611", consent_ref: "opaque-token-module-d",
      patient_ref: "Patient/ABHA-DEMO2", language: "hi",
      respondent: { role: "patient" }, visit: { type: "new" },
      complaint: { term: "knee pain", free_text: "ghutne mein dard",
                   by: "patient", voice: true, conf: 0.9 },
      socrates: {
        site: { state: "captured", value: "right knee", by: "patient", voice: true },
        onset: { state: "captured", value: "3 months, gradual", by: "patient", voice: true },
        character: { state: "captured", value: "aching", by: "patient" },
        radiation: { state: "not_answered" },
        associations: { state: "captured", value: "stiffness in morning", by: "patient" },
        timing: { state: "captured", value: "worse by evening", by: "patient" },
        exacerbating: { state: "captured", value: "stairs", by: "patient" },
        severity: { state: "captured", value: "5/10", by: "patient" }
      },
      pmh: [], medications: [],
      allergies: [{ text: "no allergies", by: "patient" }],
      family: [], social: [],
      ros: [{ system: "msk", symptom: "joint swelling", state: "captured", positive: false }],
      ice: { ideas: { state: "not_elicited" },
             concerns: { state: "captured", value: "will it need surgery?", by: "patient", voice: true },
             expectations: { state: "captured", value: "pain relief", by: "patient" } },
      red_flags: []
    },
    documents: { session_id: "", pages: [] }
  }
];

/* ---------- session orchestration ---------- */

function runCase(caseId) {
  var c = DEMO_CASES.find(function (x) { return x.id === caseId; });
  if (!c) throw new Error("unknown case " + caseId);
  var history = loadHistory(c.history);
  var documents = loadDocuments(c.documents);
  var cs = merge(history, documents);
  return {
    caseId: c.id, label: c.label, queue: c.queue,
    history: history, documents: documents,
    meds: cs.meds, labs: cs.labs, dx: cs.dx,
    alerts: cs.alerts, timeline: cs.timeline,
    soap: renderSoap(cs),
    readbackEn: renderReadback(cs, "en"),
    readbackHi: renderReadback(cs, "hi"),
    bundle: buildOpconsultrecord(cs)
  };
}

var MC = {
  SLOT_STATES: SLOT_STATES, SOCRATES_FIELDS: SOCRATES_FIELDS,
  REFERENCE_RANGES: REFERENCE_RANGES, DEMO_CASES: DEMO_CASES,
  pickLangText: pickLangText,
  slotFrom: slotFrom, loadHistory: loadHistory, loadDocuments: loadDocuments,
  normName: normName, dosesEquivalent: dosesEquivalent, abnormality: abnormality,
  merge: merge, medLabel: medLabel,
  renderSoap: renderSoap, renderReadback: renderReadback, slotTag: slotTag,
  buildOpconsultrecord: buildOpconsultrecord, physicianAttest: physicianAttest,
  runCase: runCase
};
if (typeof globalThis !== "undefined") globalThis.MC = MC;
/*MC-CORE-END*/
