import { readFileSync } from "fs";

const html = readFileSync(new URL("./module-c-kiosk-demo.html", import.meta.url), "utf8");

const m = html.match(/\/\*MC-CORE-BEGIN\*\/([\s\S]*?)\/\*MC-CORE-END\*\//);
if (!m) throw new Error("MC-CORE block not found in HTML");
(0, eval)(m[1]);
const MC = globalThis.MC;
if (!MC) throw new Error("MC did not attach to globalThis");

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name); }
}
function section(name) { console.log("\n== " + name + " =="); }

section("1 · HistoryBundle v1 contract (port of medic.contracts)");
{
  const h = MC.loadHistory(MC.DEMO_CASES[0].history);
  ok(h.sessionId === "A2309111433", "loads the shared demo case");
  ok(h.socrates.severity.value === "8/10" && h.socrates.severity.rendered, "severity slot captured + rendered");
  ok(h.ice.expectations.state === "needs_review" && h.ice.expectations.rendered, "needs_review slot still renders (honesty)");
  ok(h.capturedSlots().length === 11, "11 captured slots (8 SOCRATES + 3 ICE)");
  let threw = false;
  try { MC.loadHistory({ schema: "wrong" }); } catch (e) { threw = true; }
  ok(threw, "wrong schema rejected");
  threw = false;
  try { MC.slotFrom({ state: "captured", value: "" }, "x"); } catch (e) { threw = true; }
  ok(threw, "captured-but-empty slot rejected");
  threw = false;
  try { MC.slotFrom({ state: "bogus" }, "x"); } catch (e) { threw = true; }
  ok(threw, "unknown slot state rejected");
  const s = MC.loadHistory(MC.DEMO_CASES[1].history);
  ok(s.socrates.radiation.state === "not_answered" && !s.socrates.radiation.rendered,
    "routine case: not_answered slot not rendered but tracked");
}

section("2 · Merger — medication reconciliation (port of medic.merger)");
{
  const s = MC.runCase("ramesh");
  const byName = {};
  s.meds.forEach((m) => { byName[m.name.toLowerCase()] = m; });
  ok(s.meds.length === 6, "6 canon meds (7 doc reads + 2 stated, deduped + merged)");
  ok(byName.atorvastatin.sources.join("+") === "patient+document",
    "Atorvastatin: patient + document provenance merged");
  ok(byName.atorvastatin.verify === true, "Atorvastatin verify (handwriting doc)");
  ok(MC.dosesEquivalent("10 mg", "10") === true, "dose equivalence unit-tolerant (10 mg vs 10)");
  ok(MC.dosesEquivalent("10 mg", "20 mg") === false && MC.dosesEquivalent("10 mg", "10 mcg") === false,
    "real dose differences NOT equivalent");
  const para = s.meds.filter((m) => m.name.toLowerCase() === "paracetamol");
  ok(para.length === 1, "Paracetamol on two documents deduped to one entry");
  ok(byName.amlodipine.sources[0] === "patient" && byName.amlodipine.fid.startsWith("A:med:"),
    "Amlodipine: patient-only med kept");
  ok(byName.metformin.sources[0] === "document" && byName.metformin.verify === true,
    "Metformin: document-only med with verify state");
}

section("3 · Merger — abnormal labs + alerts");
{
  const s = MC.runCase("ramesh");
  const labs = {};
  s.labs.forEach((l) => { labs[l.name.toLowerCase()] = l; });
  ok(labs.hemoglobin.abnormal === "low", "Hemoglobin 10.2 → LOW");
  ok(labs["fasting glucose"].abnormal === "high", "Fasting glucose 112 → HIGH");
  ok(labs.hba1c.abnormal === "high", "HbA1c 6.8 → HIGH");
  ok(labs.tsh.abnormal === "high", "TSH 4.1 → HIGH (borderline above range)");
  ok(MC.abnormality("Unknown Test", "99", "").abnormal === "", "unknown test never marked");
  ok(MC.abnormality("Hemoglobin", "10.2", "mmol/L").abnormal === "", "unit mismatch never marked");
  const sev = s.alerts.map((a) => a.severity);
  ok(sev[0] === "red-flag", "alerts severity-ordered: red flag first");
  ok(sev.every((v, i) =>
    ({ "red-flag": 0, verify: 1, abnormal: 2 }[v] ?? 3) <=
    ({ "red-flag": 0, verify: 1, abnormal: 2 }[sev[Math.min(i + 1, sev.length - 1)]] ?? 3)),
    "severity ordering is monotonic");
  ok(s.alerts[0].text.startsWith("RF-2") && s.alerts[0].detail.includes("breathlessness"),
    "RF-2 red flag carried with matched-word evidence");
  ok(s.timeline.every((e) => e.date === null && e.dateNote === "date not on document"),
    "timeline honest: no invented dates");
}

section("4 · Renderer — SOAP + read-back (store once, render many)");
{
  const s = MC.runCase("ramesh");
  const soap = s.soap;
  const sText = soap.S.map((l) => l.text).join(" ");
  const oText = soap.O.map((l) => l.text).join(" ");
  ok(sText.includes("Chief complaint") && sText.includes("8/10"), "S: CC + SOCRATES severity");
  ok(sText.includes("voice — original words kept"), "S: voice provenance tags rendered");
  ok(sText.includes("patient+document"), "S: merged med provenance visible");
  ok(oText.includes("Hemoglobin") && oText.includes("LOW"), "O: document labs with abnormal flags");
  ok(soap.A[0].text.includes("physician only") && soap.P[0].text.includes("physician only"),
    "A/P locked — never generated");
  ok(soap.gaps.length === 0, "ramesh case: no gap lines (all slots captured)");
  const soapSunita = MC.runCase("sunita").soap;
  ok(soapSunita.gaps.some((g) => g.text.startsWith("Radiation")),
    "sunita case: not_answered slot appears in the honesty block");
  const en = s.readbackEn, hi = s.readbackHi;
  ok(en.lines.some((l) => l.text.includes("Severity")) && hi.lines.some((l) => l.text.includes("तीव्रता")),
    "read-back bilingual labels (en + hi)");
  ok(en.lines.some((l) => l.text.includes("no allergies")), "leading 'no' preserved (meaning-flip guard)");
  ok(hi.lines.some((l) => l.text.includes("आवाज़")), "voice tag in Hindi read-back");
  const enIds = new Set(en.lines.flatMap((l) => l.src));
  const hiIds = new Set(hi.lines.flatMap((l) => l.src));
  ok([...enIds].length === [...hiIds].length && [...enIds].every((id) => hiIds.has(id)),
    "same canon field ids in both languages (store once, render many)");
}

section("5 · OPConsultRecord emitter (port of medic.fhir_emitter)");
{
  const s = MC.runCase("ramesh");
  const b = s.bundle;
  const comp = b.entry[0].resource;
  ok(b.type === "document", "Bundle.type = document");
  ok(comp.type.coding[0].code === "371530004", "Composition.type SNOMED 371530004");
  ok(comp.meta.profile[0] === "https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord",
    "NRCeS OPConsultRecord profile asserted");
  ok(comp.status === "preliminary" && comp.attester.length === 0, "preliminary + empty attester before physician");
  const titles = comp.section.map((x) => x.title);
  ok(titles.some((t) => t.includes("Chief Complaints")), "ChiefComplaints section present");
  ok(titles.some((t) => t.includes("Medications")), "Medications section present");
  ok(titles.some((t) => t.includes("Allergies")), "Allergies section present");
  ok(!titles.some((t) => /InvestigationAdvice|Procedure|Follow|Referral|Physical/.test(t)),
    "physician-at-consult sections NOT pre-generated");
  const rts = new Set(b.entry.map((e) => e.resource.resourceType));
  ok(["Composition", "Condition", "MedicationRequest", "AllergyIntolerance", "Observation"]
    .every((rt) => rts.has(rt)), "NRCeS slice target resource types present");
  const attested = MC.physicianAttest(JSON.parse(JSON.stringify(b)), "Practitioner/DR-1");
  const comp2 = attested.entry[0].resource;
  ok(comp2.attester[0].mode === "professional" && comp2.status === "final",
    "attestation: professional mode + status final");
}

section("6 · Cross-case behaviour");
{
  const sunita = MC.runCase("sunita");
  ok(sunita.meds.length === 0 && sunita.labs.length === 0,
    "no papers brought → canon built from interview alone");
  ok(sunita.alerts.length === 0, "routine case: zero alerts");
  ok(sunita.queue === "ROUTINE OPD" && MC.runCase("ramesh").queue === "PRIORITY TRIAGE",
    "queue states differ by red-flag status");
  ok(sunita.soap.O.some((l) => l.text.includes("Vitals")), "O section still notes vitals-at-consult");
}

section("7 · Determinism (no LLM — same input, same output)");
{
  const a = MC.runCase("ramesh");
  const b = MC.runCase("ramesh");
  ok(JSON.stringify(a.soap) === JSON.stringify(b.soap), "SOAP render is deterministic");
  ok(JSON.stringify(a.readbackHi.lines) === JSON.stringify(b.readbackHi.lines),
    "read-back render is deterministic");
}

console.log(`\n${passed}/${passed + failed} checks pass`);
process.exit(failed ? 1 : 0);
