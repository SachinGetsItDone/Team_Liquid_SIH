/*  MediKiosk Module B — DOM-free demo core (testable in Node).
    Ports the reference implementation (module-b/medib: router, voting,
    confidence gate, rules structurer, FHIR bundle builder) to JS.
    OCR engine OUTPUTS are simulated from measured demo fixtures
    (confidences reflect the 2026-09-11 reference run: EN 0.97-1.0,
    HI 0.94-0.96, handwriting low) — the engine itself is not in the
    browser; that is labeled honestly in the UI. */
/*MB-CORE-BEGIN*/
"use strict";

function pickLangText(map, lang) {
  if (!map) return "";
  return map[lang] || map.en || "";
}

var CHROME = {
  consent: {
    title: { en: "Before we scan your papers", hi: "काग़ज़ स्कैन करने से पहले" },
    purpose: { en: "Purpose: digitize your paper records for THIS consultation only", hi: "उद्देश्य: आपके काग़ज़ी रिकॉर्ड सिर्फ़ इसी परामर्श के लिए डिजिटल करना" },
    collected: { en: "What we read from them:", hi: "हम उनमें से क्या पढ़ते हैं:" },
    collectedItems: [
      { en: "Photo/scan of documents you bring", hi: "आपके लाए दस्तावेज़ों की तस्वीर/स्कैन" },
      { en: "Medicines, doses, lab values, diagnoses written on them", hi: "उन पर लिखी दवाएँ, खुराक, लैब वैल्यू, बीमारियाँ" }
    ],
    notCollected: { en: "What we do NOT take:", hi: "हम यह नहीं लेते:" },
    notCollectedItems: [
      { en: "Any other data from your phone or card", hi: "आपके फ़ोन या कार्ड से कोई और जानकारी नहीं" },
      { en: "The scan stays on this kiosk (offline)", hi: "स्कैन इसी कियोस्क पर रहता है (ऑफ़लाइन)" }
    ],
    rights: { en: "You may say no, or stop at any time. Ask the help desk to delete.", hi: "आप मना कर सकते हैं, या कभी भी रोक सकते हैं। मिटाने के लिए हेल्प डेस्क से कहें।" },
    retention: { en: "The scan is deleted at the end of this session unless the doctor verifies it into your record (DPDP 2023).", hi: "सत्र के अंत में स्कैन मिट जाएगा, जब तक डॉक्टर उसे आपके रिकॉर्ड में पुष्ट करके न रख दे (DPDP 2023)।" },
    agree: { en: "Yes, scan my papers", hi: "हाँ, मेरे काग़ज़ स्कैन करें" },
    decline: { en: "No — I will show them to the doctor", hi: "नहीं — मैं डॉक्टर को दिखाऊँगा" }
  },
  scan: {
    title: { en: "Place your papers on the scanner", hi: "अपने काग़ज़ स्कैनर पर रखें" },
    sub: { en: "Tap each paper you have brought. The kiosk reads Hindi and English.", hi: "अपने लाए हर काग़ज़ पर टैप करें। कियोस्क हिंदी और अंग्रेज़ी दोनों पढ़ता है।" },
    docTypes: {
      rx: { en: "Prescription", hi: "पर्चा" },
      lab: { en: "Lab report", hi: "लैब रिपोर्ट" },
      note: { en: "Discharge / advice note", hi: "डिस्चार्ज / सलाह पर्ची" }
    },
    printed: { en: "printed", hi: "छपा हुआ" },
    handwritten: { en: "handwritten", hi: "हाथ से लिखा" },
    start: { en: "Scan selected papers", hi: "चुने काग़ज़ स्कैन करें" },
    pickOne: { en: "Select at least one paper or upload your own", hi: "कम से कम एक काग़ज़ चुनें या अपना काग़ज़ अपलोड करें" },
    demoPapers: { en: "Demo papers (scanner stand-ins)", hi: "डेमो काग़ज़ (स्कैनर के विकल्प)" }
  },
  upload: {
    title: { en: "Or upload your own papers", hi: "या अपने काग़ज़ अपलोड करें" },
    drop: { en: "Drag & drop photos or PDFs here", hi: "तस्वीरें या PDF यहाँ खींचकर छोड़ें" },
    choose: { en: "Choose files", hi: "फ़ाइलें चुनें" },
    camera: { en: "Use camera", hi: "कैमरा इस्तेमाल करें" },
    onlyImages: { en: "Only photos and PDFs can be added", hi: "सिर्फ़ तस्वीरें और PDF जोड़े जा सकते हैं" },
    simulated: { en: "OCR simulated (uploaded page)", hi: "OCR सिम्युलेटेड (अपलोड पन्ना)" },
    ignored: { en: "sensitive-word filter: line(s) not shown", hi: "संवेदनशील-शब्द फ़िल्टर: पंक्ति(याँ) नहीं दिखाई गईं" },
    pages: { en: "Your pages (as uploaded)", hi: "आपके पन्ने (जैसे अपलोड किए)" },
    noPreview: { en: "preview unavailable", hi: "प्रीव्यू उपलब्ध नहीं" },
    broken: { en: "unreadable file — excluded from scan", hi: "फ़ाइल पढ़ी नहीं गई — स्कैन से बाहर" },
    darkWarn: { en: "photo looks dark — consider retaking", hi: "तस्वीर गहरी लग रही — दोबारा लें" },
    fixHint: { en: "Wrongly read? Correct it or remove it — the doctor sees the fix.", hi: "ग़लत पढ़ा? सुधारें या हटाएँ — डॉक्टर को सुधार दिखेगा।" },
    correct: { en: "Correct", hi: "सुधारें" },
    remove: { en: "Remove", hi: "हटाएँ" },
    save: { en: "Save fix", hi: "सुधार सहेजें" },
    cancel: { en: "Cancel", hi: "रद्द करें" },
    undo: { en: "Undo", hi: "वापस लें" },
    corrected: { en: "patient-corrected", hi: "मरीज़ ने सुधारा" },
    deniedNote: { en: "removed by patient — not sent to the doctor", hi: "मरीज़ ने हटाया — डॉक्टर को नहीं भेजा" },
    nameL: { en: "Name", hi: "नाम" },
    instrL: { en: "Dose / how often / how long", hi: "खुराक / कितनी बार / कितने दिन" },
    valueL: { en: "Value", hi: "मान" },
    unitL: { en: "Unit", hi: "इकाई" },
    textL: { en: "Text", hi: "पाठ" }
  },
  engine: {
    primary: "PRIMARY — PP-OCRv5 mobile (Devanagari) via RapidOCR / ONNX Runtime CPU",
    fallback: "FALLBACK — Tesseract 5 (hin+eng)",
    manual: "manual entry desk",
    simulated: "(engine simulated in this demo — logics below are the real pipeline)",
    reading: { en: "Reading your papers…", hi: "आपके काग़ज़ पढ़े जा रहे हैं…" },
    agree: "engines agree",
    disagree: "engines differ — doctor will check",
    lowconf: "low confidence — doctor will check"
  },
  review: {
    title: { en: "What we read from your papers", hi: "आपके काग़ज़ों से हमने यह पढ़ा" },
    sub: { en: "Please check before the doctor sees it. Items marked “doctor will check” are not certain.", hi: "डॉक्टर को दिखाने से पहले जाँच लें। “डॉक्टर जाँचेंगे” वाली बातें पक्की नहीं हैं।" },
    meds: { en: "Medicines", hi: "दवाएँ" },
    labs: { en: "Lab results", hi: "लैब रिपोर्ट" },
    dx: { en: "Conditions / diagnoses", hi: "बीमारियाँ / निदान" },
    none: { en: "none found", hi: "कुछ नहीं मिला" },
    verify: { en: "doctor will check", hi: "डॉक्टर जाँचेंगे" },
    ok: { en: "read clearly", hi: "साफ़ पढ़ा" },
    continue: { en: "Looks right — continue", hi: "ठीक है — आगे बढ़ें" }
  },
  attest: {
    title: "Physician review — document extract (demo view)",
    flagBanner: { en: "FLAGGED FIELDS — verify before attesting. Low-confidence and handwriting fields default to “verify”, never guessed (MIRAGE ceiling: best published handwriting accuracy is not deployable).", hi: "" },
    field: "field", value: "value", source: "source line", conf: "conf",
    reason: "why flagged",
    edit: "edit",
    confirm: { en: "Confirm value", hi: "मान पुष्ट करें" },
    attestBtn: "Attest & attach to record (Composition.attester — professional)",
    done: "Attested by Dr. (demo) — fields joined the FHIR bundle; flagged values were resolved or corrected by the physician."
  },
  handoff: {
    title: "Digitized record handoff (demo view)",
    bundleTitle: "FHIR DocumentBundle — NRCeS ABDM profiles",
    sections: "sections", entries: "entries",
    attested: "attester: professional (demo)",
    rawKept: { en: "raw scan attached (you consented)", hi: "कच्चा स्कैन जोड़ा गया (आपने सहमति दी)" },
    rawTransient: { en: "raw scan NOT kept (transient per DPDP default)", hi: "कच्चा स्कैन नहीं रखा गया (DPDP डिफ़ॉल्ट)" },
    queue: { en: "QUEUED: ROUTINE OPD", hi: "" },
    token: "session",
    restart: { en: "Restart demo", hi: "डेमो फिर से शुरू करें" },
    backReview: "← Back to patient view"
  }
};

/* ---------- demo document fixtures (simulated engine outputs) ----------
   conf values mirror the measured reference run (research log 2026-09-11):
   printed EN 0.97-1.0, printed HI 0.94-0.96, handwriting low & noisy. */

function L(text, x1, y1, x2, y2, conf) {
  return { text: text, bbox: [x1, y1, x2, y2], conf: conf };
}

var DEMO_DOCS = [
  {
    id: "rx-en", kind: "rx", handwritten: false, file: "print_en_rx.png",
    label: { en: "Prescription (printed, English)", hi: "पर्चा (छपा हुआ, अंग्रेज़ी)" },
    primary: [
      L("Rx", 58, 50, 92, 90, 1.0),
      L("Tab. Amoxicillin 500mg BD x 5 days", 58, 114, 620, 154, 0.99),
      L("Tab. Paracetamol 650mg TDS x 3 days", 58, 178, 640, 218, 0.99),
      L("Diagnosis: Acute bronchitis", 58, 242, 480, 282, 1.0),
      L("Syrup Ascoril 5ml TDS x 7 days", 58, 306, 540, 346, 0.97)
    ],
    fallback: [
      L("Rx", 60, 52, 90, 88, 0.99),
      L("Tab. Amoxicillin 500mg BD x 5 days", 60, 116, 618, 152, 0.98),
      L("Tab. Paracetamol 650mg TDS x 3 days", 60, 180, 638, 216, 0.97),
      L("Diagnosis: Acute bronchitis", 60, 244, 478, 280, 0.99),
      L("Syrup Ascoril 5ml TDS x 7 days", 60, 308, 538, 344, 0.95)
    ]
  },
  {
    id: "rx-hi", kind: "rx", handwritten: false, file: "print_hi_rx.png",
    label: { en: "Prescription (printed, Hindi)", hi: "पर्चा (छपा हुआ, हिंदी)" },
    primary: [
      L("निदान: बुखार और खांसी", 58, 50, 420, 90, 0.95),
      L("टैबलेट पैरासिटामोल 650 एमजी दिन में तीन बार", 58, 114, 760, 154, 0.96),
      L("मरीज़: 40 वर्ष पुरुष", 58, 178, 340, 218, 0.94),
      L("सलाह: एक सप्ताह बाद दोबारा आएं", 58, 242, 560, 282, 0.95)
    ],
    fallback: [
      L("निदान: बुखार और खांसी", 60, 52, 418, 88, 0.93),
      L("टैबलेट पैरासिटामोल 650 एमजी दिन में तीन बार", 60, 116, 758, 152, 0.94),
      L("मरीज़: 40 वर्ष पुरुष", 60, 180, 338, 216, 0.92),
      L("सलाह: एक सप्ताह बाद दोबारा आएं", 60, 244, 558, 280, 0.93)
    ]
  },
  {
    id: "lab-en", kind: "lab", handwritten: false, file: "print_en_lab.png",
    label: { en: "Lab report (printed)", hi: "लैब रिपोर्ट (छपी हुई)" },
    primary: [
      L("Test Report", 58, 50, 300, 90, 1.0),
      L("Hemoglobin : 10.2 g/dL", 58, 114, 420, 154, 0.99),
      L("TSH : 4.1 mIU/L", 58, 178, 340, 218, 0.96),
      L("Fasting Glucose : 112 mg/dL", 58, 242, 520, 282, 0.99),
      L("HbA1c : 6.8 %", 58, 306, 300, 346, 0.91)
    ],
    fallback: [
      L("Test Report", 60, 52, 298, 88, 0.99),
      L("Hemoglobin : 10.2 g/dL", 60, 116, 418, 152, 0.98),
      L("TSH : 4.1 mIU/L", 60, 180, 338, 216, 0.95),
      L("Fasting Glucose : 112 mg/dL", 60, 244, 518, 280, 0.98),
      L("HbA1c : 6.8 %", 60, 308, 298, 344, 0.89)
    ]
  },
  {
    id: "rx-hand", kind: "rx", handwritten: true, file: "handwritten_rx.png",
    label: { en: "Prescription (handwritten)", hi: "पर्चा (हाथ से लिखा)" },
    primary: [
      L("Rx", 56, 48, 90, 92, 0.44),
      L("Tab Atorvastatin 10", 56, 112, 420, 160, 0.61),
      L("Tab Metfomin 500 BD", 56, 176, 460, 226, 0.52),
      L("dx ? NIDDM", 56, 240, 280, 288, 0.38)
    ],
    fallback: [
      L("Rx", 58, 50, 88, 90, 0.42),
      L("Tab Atorvastotin 1O", 58, 114, 418, 158, 0.55),
      L("Tab Metformin 500 BD", 58, 178, 458, 224, 0.58),
      L("dx ? NIDDM", 58, 242, 278, 286, 0.35)
    ]
  }
];

/* ---------- sensitive-word filter (demo display policy) ----------
   Lines containing these words are ignored entirely: not voted, not
   structured, never displayed; file names are masked. Demo-scale list
   (English + romanized Hindi), chosen to avoid false positives on
   medical/report vocabulary ("Sex : Male", "Assessment" etc.); the
   product keeps an extensible, reviewable list. */
var SENSITIVE_WORDS = [
  "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "whore", "slut",
  "nigger", "faggot", "retard", "prick", "wanker", "dickhead", "motherfucker",
  "madarchod", "behenchod", "bhenchod", "betichod", "chutiya", "chutiyapa",
  "gandu", "gaand", "harami", "randi", "bhosdi", "bhonsdi", "lauda", "lund"
];
var SENSITIVE_RE = new RegExp("\\b(?:" + SENSITIVE_WORDS.join("|") + ")(?:s|es|ing|ed|er)?\\b", "i");

function hasSensitiveWord(t) {
  return SENSITIVE_RE.test(String(t == null ? "" : t));
}

function maskSensitiveText(t) {
  var re = new RegExp(SENSITIVE_RE.source, "gi");
  return String(t == null ? "" : t).replace(re, function (m) { return m.charAt(0) + "•••"; });
}

/* ---------- simulated engine reads for uploaded pages ----------
   The browser demo cannot run the real OCR engine; each uploaded page runs
   the same deterministic pipeline on one of these fixture reads (labelled
   honestly in the UI). Variants rotate so a mixed upload shows meds, labs
   and advice notes; the handwritten toggle switches to a low-confidence
   read that exercises the verify-default path. */
var UPLOAD_VARIANTS = [
  {
    kind: "rx",
    printed: {
      primary: [
        L("Rx", 58, 50, 92, 90, 0.96),
        L("Tab. Azithromycin 500mg OD x 3 days", 58, 114, 620, 154, 0.95),
        L("Tab. Pantoprazole 40mg OD x 5 days", 58, 178, 600, 218, 0.94),
        L("Advice: steam inhalation and warm fluids", 58, 242, 560, 282, 0.92),
        L("Review after 3 days", 58, 306, 380, 346, 0.93)
      ],
      fallback: [
        L("Rx", 60, 52, 90, 88, 0.95),
        L("Tab. Azithromycin 500mg OD x 3 days", 60, 116, 618, 152, 0.94),
        L("Tab. Pantoprazole 40mg OD x 5 days", 60, 180, 598, 216, 0.93),
        L("Advice: steam inhalation and warm fluids", 60, 244, 558, 280, 0.91),
        L("Review after 3 days", 60, 308, 378, 344, 0.92)
      ]
    },
    handwritten: {
      primary: [
        L("Rx", 56, 48, 90, 92, 0.44),
        L("Tab Telmisartan 40", 56, 112, 400, 158, 0.58),
        L("Tab Metformin 500 BD", 56, 176, 440, 226, 0.49),
        L("dx : HTN", 56, 240, 260, 288, 0.37)
      ],
      fallback: [
        L("Rx", 58, 50, 88, 90, 0.42),
        L("Tab Telmisartan 4O", 58, 114, 398, 156, 0.54),
        L("Tab Metformin 500 BD", 58, 178, 438, 224, 0.51),
        L("dx : HTN", 58, 242, 258, 286, 0.34)
      ]
    }
  },
  {
    kind: "lab",
    printed: {
      primary: [
        L("Test Report", 58, 50, 300, 90, 0.97),
        L("Hemoglobin : 11.4 g/dL", 58, 114, 420, 154, 0.95),
        L("TSH : 6.2 mIU/L", 58, 178, 340, 218, 0.93),
        L("Fasting Glucose : 132 mg/dL", 58, 242, 520, 282, 0.94),
        L("Vitamin D : 18 ng/mL", 58, 306, 380, 346, 0.91)
      ],
      fallback: [
        L("Test Report", 60, 52, 298, 88, 0.96),
        L("Hemoglobin : 11.4 g/dL", 60, 116, 418, 152, 0.94),
        L("TSH : 6.2 mIU/L", 60, 180, 338, 216, 0.92),
        L("Fasting Glucose : 132 mg/dL", 60, 244, 518, 280, 0.93),
        L("Vitamin D : 18 ng/m L", 60, 308, 378, 344, 0.89)
      ]
    },
    handwritten: {
      primary: [
        L("Hb : 9.8 g/dL", 56, 60, 300, 110, 0.52),
        L("sugar : 180 mg/dL", 56, 130, 340, 180, 0.44),
        L("review 1 week", 56, 200, 300, 250, 0.40)
      ],
      fallback: [
        L("Hb : 9.8 g/dL", 58, 62, 298, 108, 0.50),
        L("sugar : 1BO mg/dL", 58, 132, 338, 178, 0.41),
        L("review 1 week", 58, 202, 298, 248, 0.38)
      ]
    }
  },
  {
    kind: "note",
    printed: {
      primary: [
        L("Discharge Advice", 58, 50, 340, 90, 0.95),
        L("Tab. Cetirizine 10mg HS x 5 days", 58, 114, 560, 154, 0.92),
        L("Soft diet, plenty of fluids", 58, 178, 440, 218, 0.90),
        L("Review after 1 week", 58, 242, 380, 282, 0.91)
      ],
      fallback: [
        L("Discharge Advice", 60, 52, 338, 88, 0.94),
        L("Tab. Cetirizine 10mg HS x 5 days", 60, 116, 558, 152, 0.91),
        L("Soft diet, plenty of fluids", 60, 180, 438, 216, 0.89),
        L("Review after 1 week", 60, 244, 378, 280, 0.90)
      ]
    },
    handwritten: {
      primary: [
        L("tabs continue", 56, 60, 280, 110, 0.46),
        L("soft diet", 56, 130, 220, 180, 0.43),
        L("come after 1 week", 56, 200, 360, 250, 0.50)
      ],
      fallback: [
        L("tabs continue", 58, 62, 278, 108, 0.44),
        L("soft diet", 58, 132, 218, 178, 0.41),
        L("come after 1 week", 58, 202, 358, 248, 0.48)
      ]
    }
  }
];

function makeUploadedDoc(meta) {
  meta = meta || {};
  var variant = UPLOAD_VARIANTS[(meta.variant || 0) % UPLOAD_VARIANTS.length];
  var hw = !!meta.handwritten;
  var set = hw ? variant.handwritten : variant.printed;
  var name = maskSensitiveText(meta.name || "uploaded-page");
  function cp(l) { return { text: l.text, bbox: l.bbox.slice(), conf: l.conf }; }
  return {
    id: meta.uid || ("up-" + (meta.variant || 0) + (hw ? "-hw" : "")),
    uid: meta.uid || null,
    uploaded: true,
    kind: variant.kind,
    handwritten: hw,
    file: name,
    label: { en: "Uploaded: " + name, hi: "अपलोड किया: " + name },
    primary: set.primary.map(cp),
    fallback: set.fallback.map(cp)
  };
}

/* ---------- router (port of medib.router) ---------- */

var HANDWRITING_MARKERS = ["rx", "prescription", "dr.", "doctor"];
var TABLE_MARKERS = ["test", "result", "value", "reference", "range", "parameter"];

function bucketX1(values, tol) {
  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (!out.length || values[i] - out[out.length - 1] > tol) out.push(values[i]);
  }
  return out;
}

function classifyPage(lines, cfg) {
  cfg = cfg || DEFAULT_CFG;
  if (!lines || !lines.length) return { pageType: "empty", signals: {} };
  var confs = lines.map(function (l) { return l.conf; });
  var avg = confs.reduce(function (a, b) { return a + b; }, 0) / confs.length;
  var lowRatio = confs.filter(function (c) { return c < 0.60; }).length / confs.length;
  var text = lines.map(function (l) { return l.text.toLowerCase(); }).join("\n");
  var hw = HANDWRITING_MARKERS.filter(function (m) { return text.indexOf(m) !== -1; }).length;
  var tb = TABLE_MARKERS.filter(function (m) { return text.indexOf(m) !== -1; }).length;
  var x1s = lines.map(function (l) { return l.bbox[0]; }).sort(function (a, b) { return a - b; });
  var colAlign = bucketX1(x1s, 25).length / x1s.length;
  var signals = {
    avgLineConf: Math.round(avg * 1000) / 1000,
    lowConfRatio: Math.round(lowRatio * 1000) / 1000,
    handwritingMarkers: hw,
    tableMarkers: tb,
    colAlignment: Math.round(colAlign * 1000) / 1000,
    nLines: lines.length
  };
  var pageType;
  if (tb >= 2 && colAlign < (1.0 - cfg.tableIfColAlignmentAbove)) pageType = "lab_table";
  else if (avg < cfg.handwritingIfAvgConfBelow || (hw >= 1 && lowRatio > 0.5)) pageType = "handwritten";
  else pageType = "printed";
  return { pageType: pageType, signals: signals };
}

/* ---------- cross-engine voting (port of medib.voting) ---------- */

function normText(t) { return String(t).toLowerCase().split(/\s+/).filter(Boolean).join(" "); }

function iou(a, b) {
  var ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  var iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  var inter = ix * iy;
  var union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

function fieldVote(primaryLines, fallbackLines) {
  var votes = [];
  var fl = fallbackLines || [];
  for (var i = 0; i < primaryLines.length; i++) {
    var p = primaryLines[i];
    var agree = false, engines = ["rapidocr"], best = null, bestIou = 0;
    for (var j = 0; j < fl.length; j++) {
      var v = iou(p.bbox, fl[j].bbox);
      if (v > bestIou) { bestIou = v; best = fl[j]; }
    }
    if (best && bestIou >= 0.30) {
      engines.push("tesseract");
      agree = normText(p.text) === normText(best.text);
    }
    votes.push({ text: p.text, bbox: p.bbox, conf: Math.round(p.conf * 10000) / 10000,
                 agree: agree, engines: engines });
  }
  return votes;
}

/* ---------- confidence gate (port of medib.confidence) ---------- */

var DEFAULT_CFG = {
  handwritingIfAvgConfBelow: 0.55,
  tableIfColAlignmentAbove: 0.60,
  fieldConfThreshold: 0.80,
  voteBonusAgree: 0.15,
  votePenaltyDisagree: 0.25
};

function votedConf(v) {
  var c = v.conf + (v.agree ? DEFAULT_CFG.voteBonusAgree : -DEFAULT_CFG.votePenaltyDisagree);
  return Math.round(Math.min(1, Math.max(0, c)) * 10000) / 10000;
}

function gateVotes(votes, cfg, pageIsHandwritten) {
  cfg = cfg || DEFAULT_CFG;
  return votes.map(function (v, i) {
    var c = votedConf(v);
    var need = false, reason = "";
    if (pageIsHandwritten) { need = true; reason = "handwriting: verify-default (MIRAGE ceiling)"; }
    else if (c < cfg.fieldConfThreshold) { need = true; reason = "confidence " + c.toFixed(2) + " < " + cfg.fieldConfThreshold; }
    else if (!v.agree) { need = true; reason = "engines disagree"; }
    return { key: "line:" + i, text: v.text, bbox: v.bbox, conf: c,
             verify: need, reason: reason, agree: v.agree, engines: v.engines };
  });
}

/* ---------- rules structurer (port of medib.structurer) ---------- */

var MED_TOKEN = /([A-Za-z][A-Za-z-]{2,}(?:\s+[A-Za-z][A-Za-z-]{2,})?)\s*(\d+(?:\.\d+)?\s*(?:mg|mcg|ml|gm|g))?(?:\s*\b(OD|BD|TDS|QID|HS|SOS|once|twice|thrice)\b)?(?:\s*(?:x|for)\s*(\d+\s*(?:days?|weeks?|months?)))?/i;
var LAB_VALUE = /([A-Za-z][A-Za-z0-9 /%]{0,15}?)\s*[:\-]\s*(\d+(?:\.\d+)?)\s*(mg\/dL|g\/dL|mmol\/L|mIU\/L|IU\/L|U\/L|ng\/mL|pg\/mL|mg%|%)?/;
var DIAG_HINT = /(?:diagnosis|impression|dx|c\/o|history of|known case of)\s*[:\-]?\s*([^\n]+)/i;

var DOSAGE_FORMS = ["tab", "tab.", "tablet", "cap", "cap.", "capsule", "syrup", "syp",
                    "inj", "injection", "drops", "cream", "ointment"];
var STOP = { the: 1, and: 1, for: 1, with: 1, patient: 1, history: 1, tablet: 1, tab: 1,
             cap: 1, syrup: 1, injection: 1, known: 1, case: 1, advice: 1, follow: 1,
             visit: 1, review: 1, complaint: 1, fever: 1, days: 1, better: 1, since: 1,
             morning: 1, night: 1 };

function stripDosageForm(name) {
  while (true) {
    var parts = name.split(" ");
    var first = parts[0].toLowerCase().replace(/\.$/, "");
    if (DOSAGE_FORMS.indexOf(first) !== -1 && parts.length > 1) {
      name = parts.slice(1).join(" ");
    } else if (DOSAGE_FORMS.indexOf(first) !== -1) {
      return "";
    } else return name;
  }
}

function structureLines(lines) {
  var meds = [], labs = [], dxs = [];
  (lines || []).forEach(function (b) {
    var m = b.text.match(DIAG_HINT);
    if (m) dxs.push({ text: m[1].trim(), _srcConf: b.conf, _srcBbox: b.bbox, _srcText: b.text });
    var low = b.text.toLowerCase();
    var hasForm = DOSAGE_FORMS.some(function (f) {
      return low.indexOf(f + " ") === 0 || low.indexOf(" " + f + " ") !== -1;
    });
    var lineMeds = 0;
    var re = new RegExp(MED_TOKEN.source, "gi"), mm;
    while ((mm = re.exec(b.text)) !== null) {
      var name = stripDosageForm((mm[1] || "").trim());
      var dose = mm[2] || null, freq = mm[3] || null, dur = mm[4] || null;
      if (!name || STOP[name.toLowerCase()]) continue;
      if (!(dose || freq || dur || hasForm)) continue;
      meds.push({ name: name, dose: dose, frequency: freq, duration: dur,
                  _srcConf: b.conf, _srcBbox: b.bbox, _srcText: b.text });
      lineMeds++;
    }
    if (lineMeds) return;
    var lm = b.text.match(LAB_VALUE);
    if (lm) labs.push({ name: lm[1].replace(/[\s:-]+$/, "").trim(), value: lm[2],
                        unit: lm[3] || null, _srcConf: b.conf, _srcBbox: b.bbox, _srcText: b.text });
  });
  return { medications: meds, labs: labs, diagnoses: dxs };
}

/* ---------- FHIR bundle (port of medib.fhir_emitter, browser-safe) ---------- */

var SECTION_CODES = {
  document_reference: ["42348-3", "Encounter documents"],
  medications: ["10160-0", "History of Medication use Narrative"],
  labs: ["30954-2", "Relevant diagnostic tests/laboratory data Narrative"],
  diagnoses: ["11450-4", "Problem list - Reported"]
};

function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
}

function sectionCode(kind) {
  var c = SECTION_CODES[kind];
  return { coding: [{ system: "http://loinc.org", code: c[0], display: c[1] }] };
}

function buildBundle(session) {
  /* session: { sessionId, docs: [per-doc {doc, route, fields}], persistRaw} */
  var structured = session.structured;
  var anyVerify = session.anyVerify;
  var entries = [];
  var composition = {
    resourceType: "Composition",
    id: "hc-record-composition",
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/HealthDocumentRecord"],
            source: "#medikiosk-module-b-demo" },
    status: anyVerify ? "preliminary" : "final",
    type: { coding: [{ system: "http://loinc.org", code: "34117-2",
                       display: "History and physical note" }],
            text: "Pre-consultation health document record" },
    subject: { reference: "Patient/ABHA-DEMO" },
    date: nowIso(),
    author: [{ reference: "Organization/HOSP-DEMO" }],
    title: "MediKiosk pre-consultation record (Module B demo)",
    attester: [],
    section: []
  };
  entries.push({ fullUrl: "urn:uuid:composition", resource: composition });

  if (session.persistRaw) {
    var docref = {
      resourceType: "DocumentReference", id: "raw-scan", status: "current",
      docStatus: anyVerify ? "preliminary" : "final",
      type: { text: "Patient-carried scanned document" },
      subject: { reference: "Patient/ABHA-DEMO" },
      content: [{ attachment: { contentType: "image/png",
                                title: (session.docFiles || ["scans.png"]).join(", "),
                                data: "…base64 omitted in demo view…" } }]
    };
    entries.push({ fullUrl: "urn:uuid:docref", resource: docref });
    composition.section.push({ title: "Scanned document", code: sectionCode("document_reference"),
                               entry: [{ reference: "urn:uuid:docref" }] });
  }

  (structured.medications || []).forEach(function (med, i) {
    var dosage = [med.dose, med.frequency, med.duration, med.note].filter(Boolean).join(" ");
    entries.push({ fullUrl: "urn:uuid:med-" + i, resource: {
      resourceType: "MedicationRequest", id: "med-" + i, status: "draft", intent: "proposal",
      medicationCodeableConcept: { text: med.name || "" },
      subject: { reference: "Patient/ABHA-DEMO" }, authoredOn: nowIso(),
      dosageInstruction: dosage ? [{ text: dosage }] : []
    }});
  });
  if (structured.medications && structured.medications.length) {
    composition.section.push({ title: "Medications (from patient documents — verify)",
      code: sectionCode("medications"),
      entry: structured.medications.map(function (_, i) { return { reference: "urn:uuid:med-" + i }; }) });
  }

  (structured.labs || []).forEach(function (lab, i) {
    var num = parseFloat(lab.value);
    var labRes = {
      resourceType: "Observation", id: "lab-" + i, status: "preliminary",
      code: { text: lab.name || "" }, subject: { reference: "Patient/ABHA-DEMO" }
    };
    if (isNaN(num)) labRes.valueString = String(lab.value == null ? "" : lab.value);
    else {
      labRes.valueQuantity = { value: num };
      if (lab.unit) labRes.valueQuantity.unit = lab.unit;
    }
    entries.push({ fullUrl: "urn:uuid:lab-" + i, resource: labRes });
  });
  if (structured.labs && structured.labs.length) {
    composition.section.push({ title: "Lab results (from patient documents — verify)",
      code: sectionCode("labs"),
      entry: structured.labs.map(function (_, i) { return { reference: "urn:uuid:lab-" + i }; }) });
  }

  (structured.diagnoses || []).forEach(function (dx, i) {
    entries.push({ fullUrl: "urn:uuid:dx-" + i, resource: {
      resourceType: "Condition", id: "dx-" + i,
      clinicalStatus: { text: "patient-reported" },
      verificationStatus: { text: "unconfirmed" },
      code: { text: dx.text || "" }, subject: { reference: "Patient/ABHA-DEMO" }
    }});
  });
  if (structured.diagnoses && structured.diagnoses.length) {
    composition.section.push({ title: "Reported conditions", code: sectionCode("diagnoses"),
      entry: structured.diagnoses.map(function (_, i) { return { reference: "urn:uuid:dx-" + i }; }) });
  }

  return { resourceType: "Bundle", id: "medikiosk-" + (session.sessionId || "demo"),
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

/* ---------- session orchestration (mirrors medib.pipeline.run) ---------- */

function runDocument(doc, cfg) {
  cfg = cfg || DEFAULT_CFG;
  var allPrimary = doc.primary || [];
  var allFallback = doc.fallback || [];
  var primary = allPrimary.filter(function (l) { return !hasSensitiveWord(l.text); });
  var fallback = allFallback.filter(function (l) { return !hasSensitiveWord(l.text); });
  var ignoredLines = (allPrimary.length - primary.length) + (allFallback.length - fallback.length);
  var route = classifyPage(primary, cfg);
  var isHand = route.pageType === "handwritten" || doc.handwritten;
  var votes = fieldVote(primary, fallback);
  var lineFields = gateVotes(votes, cfg, isHand);
  var structured = structureLines(primary);
  var structFields = [];
  ["medications", "labs", "diagnoses"].forEach(function (sec) {
    (structured[sec] || []).forEach(function (item, i) {
      var src = item._srcConf || 0;
      var fname = sec.slice(0, -1) + ":" + i;
      structFields.push({
        key: doc.id + "|" + fname, docId: doc.id, field: fname, value: item,
        verify: isHand || src < cfg.fieldConfThreshold,
        reason: isHand ? "handwriting: verify-default" : "source confidence " + src.toFixed(2),
        bbox: item._srcBbox || null, srcText: item._srcText || "", status: "as_read"
      });
    });
  });
  return { doc: doc, route: route, isHandwritten: isHand, votes: votes,
           lineFields: lineFields, structured: structured, structFields: structFields,
           ignoredLines: ignoredLines };
}

function runSession(docRefs, opts) {
  opts = opts || {};
  var docs = (docRefs || []).map(function (ref) {
    if (typeof ref === "string") {
      for (var i = 0; i < DEMO_DOCS.length; i++) if (DEMO_DOCS[i].id === ref) return DEMO_DOCS[i];
      return null;
    }
    return ref;
  }).filter(Boolean);
  var results = docs.map(function (d) { return runDocument(d, opts.cfg); });
  var session = {
    sessionId: opts.sessionId || ("B" + String(Date.now()).slice(-6)),
    results: results, structured: { medications: [], labs: [], diagnoses: [] }, anyVerify: false,
    persistRaw: !!opts.persistRaw,
    uploadCount: docs.filter(function (d) { return !!d.uploaded; }).length,
    ignoredTotal: results.reduce(function (a, r) { return a + (r.ignoredLines || 0); }, 0),
    docFiles: docs.map(function (d) { return d.file; })
  };
  return rebuildSession(session);
}

/* ---------- patient correction loop (review screen) ----------
   The patient can deny ("not on my paper") or correct a structured field.
   Denied fields leave the structured lists and the FHIR bundle; corrected
   fields keep their verify flag (the doctor still attests) and carry
   patient-corrected provenance. Line-level flags whose source text was fully
   denied are hidden from the physician view. */

function findField(session, key) {
  var found = null;
  (session.results || []).forEach(function (r) {
    (r.structFields || []).forEach(function (f) { if (f.key === key) found = f; });
  });
  return found;
}

function sectionOf(fieldName) {
  if (fieldName.indexOf("medication") === 0) return "medications";
  if (fieldName.indexOf("lab") === 0) return "labs";
  return "diagnoses";
}

function parseCorrection(kind, a, b, c) {
  if (kind === "medication") {
    var name = String(a == null ? "" : a).trim();
    var instr = String(b == null ? "" : b).trim();
    var got = structureLines([{ text: (name + " " + instr).trim(), bbox: [0, 0, 1, 1], conf: 1 }]).medications[0];
    if (got && name) { got.name = name; return got; }
    return { name: name, dose: null, frequency: null, duration: null, note: instr || null };
  }
  if (kind === "lab") {
    return { name: String(a == null ? "" : a).trim(), value: String(b == null ? "" : b).trim(),
             unit: String(c == null ? "" : c).trim() || null };
  }
  return { text: String(a == null ? "" : a).trim() };
}

function correctField(session, key, kind, a, b, c) {
  var f = findField(session, key);
  if (!f) return session;
  var item = parseCorrection(kind, a, b, c);
  item._srcConf = null;
  item._srcBbox = f.value ? f.value._srcBbox : null;
  item._srcText = f.srcText;
  f.value = item;
  f.status = "patient_corrected";
  if (typeof f.reason === "string" && f.reason.indexOf("patient-corrected") === -1) {
    f.reason = (f.reason ? f.reason + " · " : "") + "patient-corrected";
  }
  return rebuildSession(session);
}

function denyField(session, key, denied) {
  var f = findField(session, key);
  if (!f) return session;
  f.status = denied === false ? "as_read" : "patient_denied";
  return rebuildSession(session);
}

function deniedSrcTexts(session) {
  var out = [];
  (session.results || []).forEach(function (r) {
    (r.structFields || []).forEach(function (f) {
      if (f.status === "patient_denied" && f.srcText) out.push(f.srcText);
    });
  });
  return out;
}

function visibleLineFields(result, deniedTexts) {
  deniedTexts = deniedTexts || [];
  return (result.lineFields || []).filter(function (f) {
    return deniedTexts.indexOf(f.text) === -1;
  });
}

function rebuildSession(session) {
  var denied = deniedSrcTexts(session);
  var structured = { medications: [], labs: [], diagnoses: [] };
  (session.results || []).forEach(function (r) {
    (r.structFields || []).forEach(function (f) {
      if (f.status === "patient_denied") return;
      structured[sectionOf(f.field)].push(f.value);
    });
  });
  session.structured = structured;
  session.anyVerify = (session.results || []).some(function (r) {
    if (r.isHandwritten) return true;
    return visibleLineFields(r, denied).some(function (fl) { return fl.verify; }) ||
      (r.structFields || []).some(function (f) { return f.status !== "patient_denied" && f.verify; });
  });
  session.bundle = buildBundle(session);
  return session;
}

var MB = {
  CHROME: CHROME, DEMO_DOCS: DEMO_DOCS, DEFAULT_CFG: DEFAULT_CFG,
  UPLOAD_VARIANTS: UPLOAD_VARIANTS, SENSITIVE_WORDS: SENSITIVE_WORDS,
  pickLangText: pickLangText,
  hasSensitiveWord: hasSensitiveWord, maskSensitiveText: maskSensitiveText,
  makeUploadedDoc: makeUploadedDoc,
  classifyPage: classifyPage, fieldVote: fieldVote, votedConf: votedConf,
  gateVotes: gateVotes, structureLines: structureLines, stripDosageForm: stripDosageForm,
  buildBundle: buildBundle, physicianAttest: physicianAttest,
  runDocument: runDocument, runSession: runSession,
  findField: findField, sectionOf: sectionOf, parseCorrection: parseCorrection,
  correctField: correctField, denyField: denyField,
  deniedSrcTexts: deniedSrcTexts, visibleLineFields: visibleLineFields,
  rebuildSession: rebuildSession,
  iou: iou, normText: normText
};
if (typeof globalThis !== "undefined") globalThis.MB = MB;
/*MB-CORE-END*/
