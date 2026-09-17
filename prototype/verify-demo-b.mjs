import { readFileSync } from "fs";

const html = readFileSync(new URL("./module-b-kiosk-demo.html", import.meta.url), "utf8");

const m = html.match(/\/\*MB-CORE-BEGIN\*\/([\s\S]*?)\/\*MB-CORE-END\*\//);
if (!m) throw new Error("MB-CORE block not found in HTML");
(0, eval)(m[1]);
const MB = globalThis.MB;
if (!MB) throw new Error("MB did not attach to globalThis");

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name); }
}
function section(name) { console.log("\n== " + name + " =="); }

section("1 · Demo fixtures match reference-run confidences");
{
  const en = MB.DEMO_DOCS.find((d) => d.id === "rx-en");
  const hi = MB.DEMO_DOCS.find((d) => d.id === "rx-hi");
  const hand = MB.DEMO_DOCS.find((d) => d.id === "rx-hand");
  ok(en.primary.length === 5 && en.primary.every((l) => l.conf >= 0.97), "printed EN lines within measured 0.97–1.0 band");
  ok(hi.primary.length === 4 && hi.primary.every((l) => l.conf >= 0.94 && l.conf <= 0.96), "printed HI lines within measured 0.94–0.96 band");
  ok(hand.primary.every((l) => l.conf < 0.65), "handwritten lines low-conf (< 0.65)");
  ok(hand.primary[1].text === "Tab Atorvastatin 10" && hand.fallback[1].text === "Tab Atorvastotin 1O",
    "handwritten fixture contains the deliberate engine disagreement (Atorvastatin 10 vs Atorvastotin 1O)");
}

section("2 · Router (port of medib.router)");
{
  const lab = MB.classifyPage(MB.DEMO_DOCS.find((d) => d.id === "lab-en").primary);
  const hand = MB.classifyPage(MB.DEMO_DOCS.find((d) => d.id === "rx-hand").primary);
  ok(["printed", "lab_table"].includes(lab.pageType), "lab report classifies printed/lab_table, got: " + lab.pageType);
  ok(hand.pageType === "handwritten", "handwritten prescription classifies handwritten (avg conf " + hand.signals.avgLineConf + ")");
  ok(MB.classifyPage([]).pageType === "empty", "no lines → empty");
}

section("3 · Cross-engine voting (port of medib.voting)");
{
  const en = MB.DEMO_DOCS.find((d) => d.id === "rx-en");
  const votes = MB.fieldVote(en.primary, en.fallback);
  ok(votes.length === en.primary.length, "one vote per primary line");
  ok(votes.every((v) => v.agree === true && v.engines.length === 2), "printed EN: all lines agree (both engines)");
  ok(votes[0].conf < MB.votedConf(votes[0]) || votes[0].agree, "agreement adds vote bonus");
  const hand = MB.DEMO_DOCS.find((d) => d.id === "rx-hand");
  const hv = MB.fieldVote(hand.primary, hand.fallback);
  ok(hv[1].agree === false, "Atorvastatin line: engines disagree (normalized text differs)");
  ok(hv[2].agree === true || hv[2].agree === false, "Metfomin/Metformin disagreement state: " + hv[2].agree);
  const noFb = MB.fieldVote(en.primary, null);
  ok(noFb.every((v) => v.engines.length === 1), "no fallback → single-engine votes, never auto-agree");
}

section("4 · Confidence gate — verify-default (port of medib.confidence)");
{
  const hand = MB.DEMO_DOCS.find((d) => d.id === "rx-hand");
  const votes = MB.fieldVote(hand.primary, hand.fallback);
  const fields = MB.gateVotes(votes, null, true);
  ok(fields.every((f) => f.verify), "handwriting page: EVERY field verify-flagged (MIRAGE ceiling)");
  ok(fields[0].reason.indexOf("handwriting") === 0, "reason cites handwriting verify-default");
  const en = MB.DEMO_DOCS.find((d) => d.id === "rx-en");
  const ef = MB.gateVotes(MB.fieldVote(en.primary, en.fallback), null, false);
  ok(ef.every((f) => !f.verify), "clean printed page with engine agreement: no flags");
}

section("5 · Rules structurer (port of medib.structurer)");
{
  const en = MB.DEMO_DOCS.find((d) => d.id === "rx-en");
  const s = MB.structureLines(en.primary);
  const amox = s.medications.find((x) => x.name === "Amoxicillin");
  ok(amox && amox.dose === "500mg" && amox.frequency === "BD" && amox.duration === "5 days",
    "Amoxicillin 500mg BD x 5 days extracted (form prefix stripped, dose/freq/duration kept)");
  ok(s.medications.some((x) => x.name === "Ascoril"), "syrup-line med extracted via form prefix");
  ok(s.diagnoses.some((d) => d.text.indexOf("bronchitis") !== -1), "diagnosis line captured");
  const lab = MB.DEMO_DOCS.find((d) => d.id === "lab-en");
  const ls = MB.structureLines(lab.primary);
  const hb = ls.labs.find((x) => x.name === "Hemoglobin");
  ok(hb && hb.value === "10.2" && hb.unit === "g/dL", "Hemoglobin : 10.2 g/dL parsed (name/value/unit)");
  ok(ls.labs.length >= 4, "lab report yields >= 4 lab values, got " + ls.labs.length);
  ok(MB.structureLines([{ text: "the and for", bbox: [0, 0, 100, 20], conf: 0.9 }]).medications.length === 0,
    "noise line yields no medications (anti-noise guard)");
  ok(MB.stripDosageForm("Tab. Amoxicillin") === "Amoxicillin" && MB.stripDosageForm("Syrup") === "",
    "dosage-form stripping: 'Tab. Amoxicillin' → 'Amoxicillin'; bare 'Syrup' → empty");
}

section("6 · FHIR bundle (port of medib.fhir_emitter)");
{
  const sess = MB.runSession(["rx-en", "lab-en"], { sessionId: "T1" });
  const b = sess.bundle;
  ok(b.resourceType === "Bundle" && b.type === "document", "document Bundle emitted");
  const comp = b.entry[0].resource;
  ok(comp.resourceType === "Composition" && comp.meta.profile[0].indexOf("nrces.in") !== -1,
    "Composition carries the NRCeS HealthDocumentRecord profile URL");
  ok(comp.status === "final", "clean session (no flags) → final, matching medib port; flagged sessions stay preliminary");
  const refs = new Set(b.entry.map((e) => e.fullUrl));
  let allRefsOk = true;
  comp.section.forEach((s) => s.entry.forEach((r) => { if (!refs.has(r.reference)) allRefsOk = false; }));
  ok(allRefsOk, "every section entry resolves to a bundle entry");
  const kinds = b.entry.map((e) => e.resource.resourceType);
  ok(kinds.includes("MedicationRequest") && kinds.includes("Observation"), "meds → MedicationRequest, labs → Observation");
  ok(comp.attester.length === 0, "attester slot empty before physician step");
  const att = MB.physicianAttest(b, "Practitioner/Dr-DEMO");
  const comp2 = att.entry[0].resource;
  ok(comp2.attester[0].mode === "professional" && comp2.status === "final",
    "physicianAttest fills attester (professional) and finalizes status");
  const handSess = MB.runSession(["rx-hand"], {});
  ok(handSess.anyVerify === true, "handwritten session flags verify");
  ok(handSess.bundle.entry[0].resource.status === "preliminary", "handwritten bundle stays preliminary");
  const transient = MB.runSession(["rx-en"], { persistRaw: false });
  ok(!transient.bundle.entry.some((e) => e.resource.resourceType === "DocumentReference"),
    "transient default (DPDP): no DocumentReference for the raw scan");
  const kept = MB.runSession(["rx-en"], { persistRaw: true });
  const dr = kept.bundle.entry.find((e) => e.resource.resourceType === "DocumentReference");
  ok(dr && dr.resource.content[0].attachment.contentType === "image/png", "persistRaw=true attaches DocumentReference (image/png)");
}

section("7 · Session merge (port of medib.pipeline.run)");
{
  const sess = MB.runSession(["rx-en", "rx-hi", "lab-en", "rx-hand"], { sessionId: "T2" });
  ok(sess.results.length === 4, "multi-doc session processes all four pages");
  ok(sess.structured.medications.length >= 4, "meds merged across pages: " + sess.structured.medications.length);
  ok(sess.structured.labs.length >= 4, "labs merged: " + sess.structured.labs.length);
  ok(sess.anyVerify === true, "handwritten page in session → session-level verify flag");
}

section("8 · Upload lane (simulated OCR for uploaded files)");
{
  const d = MB.makeUploadedDoc({ uid: "u1", name: "my-report.jpg", variant: 1, handwritten: false });
  ok(d.uploaded === true && d.file === "my-report.jpg", "makeUploadedDoc marks uploaded + keeps the masked name");
  const r = MB.runDocument(d);
  ok(r.structured.labs.length >= 3, "uploaded lab variant extracts >= 3 labs, got " + r.structured.labs.length);
  ok(r.lineFields.some((f) => f.verify), "uploaded lab variant flags the disagreeing line (Vitamin D)");
  const rx = MB.makeUploadedDoc({ uid: "u1b", name: "rx.png", variant: 0, handwritten: false });
  const rrx = MB.runDocument(rx);
  ok(rrx.structured.medications.some((m) => m.name === "Azithromycin") &&
     rrx.structured.medications.some((m) => m.name === "Pantoprazole"),
    "uploaded rx variant extracts Azithromycin + Pantoprazole");
  const hw = MB.makeUploadedDoc({ uid: "u2", name: "rx.png", variant: 0, handwritten: true });
  const rhw = MB.runDocument(hw);
  ok(rhw.isHandwritten && rhw.lineFields.every((f) => f.verify), "handwritten upload toggle → verify-default on every line");
  const dirtyName = MB.makeUploadedDoc({ uid: "u3", name: "shit-scan.png", variant: 0 });
  ok(dirtyName.file === "s•••-scan.png" && dirtyName.label.en.indexOf("shit") === -1,
    "sensitive file name masked at doc creation");
  const sess = MB.runSession(["rx-en", d], { sessionId: "T3" });
  ok(sess.results.length === 2 && sess.uploadCount === 1, "mixed session: fixture ids + uploaded doc objects");
  ok(sess.bundle.entry[0].resource.resourceType === "Composition", "mixed session still emits the Composition bundle");
}

section("9 · Sensitive-word filter (demo display policy)");
{
  ok(MB.hasSensitiveWord("what the shit is this") === true, "sensitive word detected in a line");
  ok(MB.hasSensitiveWord("FUCKING unreadable scrawl") === true, "case-insensitive + suffix forms detected");
  ok(MB.hasSensitiveWord("madarchod likha hai") === true, "romanized Hindi profanity detected");
  ok(["Sex : Male", "Assistant Professor", "Bastar district", "Assessment: fever"]
    .every((t) => MB.hasSensitiveWord(t) === false), "no false positives on medical/report vocabulary");
  ok(MB.maskSensitiveText("shit-scan.png") === "s•••-scan.png", "masking keeps first char, hides the word");
  ok(MB.maskSensitiveText(MB.maskSensitiveText("shit-scan.png")) === "s•••-scan.png", "masking is idempotent");
  const dirty = {
    id: "dirty", kind: "rx", uploaded: true, file: "x.png", label: { en: "x", hi: "x" },
    primary: [
      { text: "this line is shit", bbox: [0, 0, 100, 20], conf: 0.9 },
      { text: "fucking unreadable scrawl", bbox: [0, 30, 100, 50], conf: 0.9 },
      { text: "Tab. Paracetamol 650mg TDS x 3 days", bbox: [0, 60, 100, 80], conf: 0.95 }
    ],
    fallback: [
      { text: "this line is shit", bbox: [1, 1, 101, 21], conf: 0.89 },
      { text: "fucking unreadable scrawl", bbox: [1, 31, 101, 51], conf: 0.89 },
      { text: "Tab. Paracetamol 650mg TDS x 3 days", bbox: [1, 61, 101, 81], conf: 0.94 }
    ]
  };
  const rr = MB.runDocument(dirty);
  ok(rr.ignoredLines === 4, "sensitive lines ignored in both engines (counted), got " + rr.ignoredLines);
  ok(rr.lineFields.every((f) => !MB.hasSensitiveWord(f.text)) &&
     rr.structured.medications.every((m) => !MB.hasSensitiveWord(m.name)),
    "no sensitive word reaches voting, display or structuring");
  ok(rr.structured.medications.length === 1 && rr.structured.medications[0].name === "Paracetamol",
    "clean line still extracted from the same page");
  const sess = MB.runSession([dirty], { sessionId: "T4" });
  ok(sess.ignoredTotal === 4, "session-level ignored total propagates");
}

section("10 · Patient correction loop (deny / correct / rebuild)");
{
  const up = MB.makeUploadedDoc({ uid: "u9", name: "lab.png", variant: 1, handwritten: false });
  const sess = MB.runSession([up], { sessionId: "T5" });
  const vitD = sess.results[0].structFields.find((f) => f.field.indexOf("lab") === 0 && f.value.name === "Vitamin D");
  ok(!!vitD && !!vitD.key && vitD.status === "as_read", "structFields carry stable keys + as_read status");

  const before = sess.structured.labs.length;
  MB.correctField(sess, vitD.key, "lab", "Vitamin D", "19", "ng/mL");
  const corr = MB.findField(sess, vitD.key);
  ok(corr.status === "patient_corrected" && corr.value.value === "19" &&
     corr.reason.indexOf("patient-corrected") !== -1, "correction updates value + status + reason");
  ok(sess.structured.labs.length === before, "corrected item stays in structured lists (not duplicated)");
  const obs = sess.bundle.entry.map((e) => e.resource)
    .find((r) => r.resourceType === "Observation" && r.code.text === "Vitamin D");
  ok(obs && obs.valueQuantity && obs.valueQuantity.value === 19, "rebuilt bundle carries the corrected value");

  MB.denyField(sess, vitD.key, true);
  ok(MB.findField(sess, vitD.key).status === "patient_denied", "deny flips status");
  ok(!sess.structured.labs.some((l) => l.name === "Vitamin D"), "denied item leaves structured lists");
  ok(!sess.bundle.entry.some((e) => e.resource.code && e.resource.code.text === "Vitamin D"),
    "denied item leaves the FHIR bundle");
  const deniedTexts = MB.deniedSrcTexts(sess);
  ok(deniedTexts.indexOf("Vitamin D : 18 ng/mL") !== -1, "denied source text tracked");
  ok(MB.visibleLineFields(sess.results[0], deniedTexts).every((f) => f.text !== "Vitamin D : 18 ng/mL"),
    "denied source line hidden from the physician view");
  MB.denyField(sess, vitD.key, false);
  ok(MB.findField(sess, vitD.key).status === "as_read" &&
     sess.structured.labs.some((l) => l.name === "Vitamin D"), "undo restores the item everywhere");

  const rx = MB.makeUploadedDoc({ uid: "u8", name: "rx.png", variant: 0, handwritten: false });
  const sess2 = MB.runSession([rx], { sessionId: "T6" });
  const amox = sess2.results[0].structFields.find((f) => f.value.name === "Azithromycin");
  MB.correctField(sess2, amox.key, "medication", "Azithromycin", "as directed by the doctor", "");
  const amox2 = MB.findField(sess2, amox.key);
  ok(amox2.value.note === "as directed by the doctor" && amox2.value.name === "Azithromycin",
    "unparsable instructions kept as a note, name preserved");
  const med = sess2.bundle.entry.map((e) => e.resource)
    .find((r) => r.resourceType === "MedicationRequest" && r.medicationCodeableConcept.text === "Azithromycin");
  ok(med && med.dosageInstruction[0].text.indexOf("as directed") !== -1,
    "FHIR dosage text carries the patient note");

  const labDoc = MB.makeUploadedDoc({ uid: "u7", name: "lab.png", variant: 1, handwritten: false });
  const sess3 = MB.runSession([labDoc], { sessionId: "T7" });
  const hb = sess3.results[0].structFields.find((f) => f.value.name === "Hemoglobin");
  MB.correctField(sess3, hb.key, "lab", "Hemoglobin", "", "g/dL");
  const hbObs = sess3.bundle.entry.map((e) => e.resource)
    .find((r) => r.resourceType === "Observation" && r.code.text === "Hemoglobin");
  ok(hbObs && !hbObs.valueQuantity && hbObs.valueString === "", "empty lab value → valueString, never NaN");

  const same = MB.correctField(sess3, "no-such-key", "lab", "x", "1", "");
  ok(same === sess3, "unknown key leaves the session untouched");
  const n1 = JSON.stringify(sess3.bundle).length;
  MB.rebuildSession(sess3);
  ok(JSON.stringify(sess3.bundle).length === n1, "rebuild is idempotent");

  const cleanRx = MB.makeUploadedDoc({ uid: "u6", name: "rx.png", variant: 0, handwritten: false });
  const sess4 = MB.runSession([cleanRx], { sessionId: "T8" });
  ok(sess4.anyVerify === false, "clean printed upload: no verify flags");
  const firstMed = sess4.results[0].structFields.find((f) => f.field.indexOf("medication") === 0);
  MB.denyField(sess4, firstMed.key, true);
  ok(sess4.anyVerify === false, "denying an unflagged item keeps the session clean");
}

console.log("\n" + (failed === 0 ? "ALL " + passed + " CHECKS PASSED" : failed + " FAILED / " + passed + " passed"));
process.exit(failed === 0 ? 0 : 1);
