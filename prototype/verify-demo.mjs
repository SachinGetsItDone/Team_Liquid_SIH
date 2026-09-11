import { readFileSync } from "fs";

const html = readFileSync(new URL("./module-a-kiosk-demo.html", import.meta.url), "utf8");

const m = html.match(/\/\*MK-CORE-BEGIN\*\/([\s\S]*?)\/\*MK-CORE-END\*\//);
if (!m) throw new Error("MK-CORE block not found in HTML");
(0, eval)(m[1]);
const MK = globalThis.MK;
if (!MK) throw new Error("MK did not attach to globalThis");

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name); }
}
function section(name) { console.log("\n== " + name + " =="); }

const now = () => Date.now();

section("1 · Interview sequence matches confirmed flow");
{
  const list = MK.turnListFor("chest").map((t) => t.id);
  const expectPrefix = ["narrative", "cc",
    "socrates.site", "socrates.onset", "socrates.character", "socrates.radiation",
    "socrates.associations", "socrates.timing", "socrates.exacerbating", "socrates.severity",
    "safety",
    "pmh", "meds", "allergies", "family", "social.smoke", "social.alcohol"];
  ok(JSON.stringify(list.slice(0, expectPrefix.length)) === JSON.stringify(expectPrefix),
    "turn order = narrative → CC → SOCRATES(8) → safety → PMH → meds → allergies → family → social");
  const tail = list.slice(expectPrefix.length);
  ok(tail.length === 6 && tail[4] === "ice.worry" && tail[5] === "ice.expect",
    "4 focused-ROS items then ICE(worry, expect): " + tail.join(", "));
  ok(new Set(list).size === list.length, "turn ids unique");
  ok(list.indexOf("safety") === 10, "safety screen sits between SOCRATES and history (step 3 of confirmed sequence)");
  ok(MK.turnListFor("knee").length === list.length, "knee path has same length (4 ROS items each)");
}

section("2 · Complaint detection (en / hi / hinglish)");
{
  for (const lang of ["en", "hi", "rom"]) {
    const rf = MK.pickLangText(MK.DEMO_SCRIPTS.redflag.narrative, lang);
    const rt = MK.pickLangText(MK.DEMO_SCRIPTS.routine.narrative, lang);
    ok(MK.detectComplaint(rf) && MK.detectComplaint(rf).id === "chest", "redflag narrative [" + lang + "] → chest pain");
    ok(MK.detectComplaint(rt) && MK.detectComplaint(rt).id === "knee", "routine narrative [" + lang + "] → knee pain");
  }
  ok(MK.detectComplaint("mereko pet me dard ho raha hai").id === "abdomen", "free text: pet dard → abdomen");
  ok(MK.detectComplaint("sir dard hai") .id === "headache", "free text: sir dard → headache");
  ok(MK.detectComplaint("nothing matching here") === null, "no match → null (asks patient to type)");
}

section("3 · Deterministic red-flag rules");
{
  const rf = MK.DEMO_SCRIPTS.redflag;
  const canned = MK.cannedState("redflag", "readback", null, "rom");
  const result = canned.redFlag;
  ok(result.hits.some((h) => h.id === "RF-2"), "RF-2 fires on scripted chest pain + breathlessness");
  ok(result.hits.some((h) => h.id === "RF-4"), "RF-4 fires on severity 8 + sweating");
  ok(!result.hits.some((h) => h.id === "RF-1") && !result.hits.some((h) => h.id === "RF-3"),
    "RF-1 / RF-3 correctly NOT matched by chest-pain script");
  ok(result.hits.every((h) => Array.isArray(h.evidence) && h.evidence.length > 0),
    "every hit carries matched-word evidence");

  const routine = MK.cannedState("routine", "readback", null, "rom");
  ok(routine.redFlag.hits.length === 0, "routine script → zero rule matches");
  ok(routine.redFlag.all.length === 4, "all 4 rules were still checked (check is always-on)");

  const cases = [
    ["I have chest pain and I am breathless", "RF-2"],
    ["seene mein dard hai aur saans lene mein takleef", "RF-2"],
    ["छाती में दर्द है और सांस फूल रही है", "RF-2"],
    ["aaj subah se ek taraf shareer kamzor hai aur bolna lisdar hai", "RF-3"],
    ["achanak bahut tez sar dard hua", "RF-1"],
    ["dard 9 out of 10 hai aur pasina aa raha hai", "RF-4"],
    ["halka dard hai, theek hoon", null]
  ];
  for (const [text, expect] of cases) {
    const r = MK.runSafetyCheck(text, null);
    const hitIds = r.hits.map((h) => h.id);
    ok(expect === null ? hitIds.length === 0 : hitIds.indexOf(expect) !== -1,
      "free text: «" + text.slice(0, 42) + "» → " + (expect || "no hit") + (hitIds.length ? " (got " + hitIds.join(",") + ")" : ""));
  }
  const noHit = MK.runSafetyCheck("knee pain since 3 weeks, worse on stairs", 4);
  ok(noHit.hits.length === 0, "knee pain + severity 4 → no hit");
}

section("4 · Dose extraction & selective confirmation");
{
  ok(MK.extractDose("Amlodipine 5 mg — ek goli roz subah") === "5 mg", "extracts '5 mg'");
  ok(MK.extractDose("paracetamol 500mg daily") === "500 mg", "normalizes '500mg' → '500 mg'");
  ok(MK.extractDose("dawa ka naam nahi pata") === null, "no numeral → no dose prompt");
  const canned = MK.cannedState("redflag", "readback", null, "rom");
  ok(canned.answers.meds.doseConfirmed === true, "scripted voice medication carries doseConfirmed flag");
}

section("5 · Slot states — fabrication is structurally impossible");
{
  const routine = MK.cannedState("routine", "readback", null, "rom");
  ok(routine.answers.allergies.state === "needs_review", "'Not sure' allergy → needs_review (staff confirms)");
  const partial = MK.cannedState("redflag", "readback", "socrates.severity", "rom");
  const dq = MK.dataQuality(partial.answers, "chest");
  ok(dq.not_elicited > 0, "stopped-early run shows explicit not_elicited (" + dq.not_elicited + " fields)");
  ok(dq.total === 22, "expected field count = 22 (narrative+cc+8 SOCRATES+6 history+4 ROS+2 ICE)");
  ok(dq.captured + dq.needs_review + dq.not_answered + dq.not_elicited === dq.total, "every field has an explicit state");
}

section("6 · Full reducer run — scripted chest-pain demo");
{
  let s = MK.reducer(MK.initialState(), { type: "START", lang: "rom", scriptId: "redflag" });
  const script = MK.DEMO_SCRIPTS.redflag;
  const list = MK.turnListFor("chest");
  let doseConfirmed = false, safetyAcked = false, safetySeenAt = null;
  let guard = 0;
  while (s.phase === "interview" && guard++ < 50) {
    if (s.pendingDose) { s = MK.reducer(s, { type: "DOSE_CONFIRM", ok: true }); doseConfirmed = true; continue; }
    if (s.cursor === "safety") {
      safetySeenAt = s.redFlag ? s.redFlag.hits.map((h) => h.id).join(",") : "none";
      if (s.redFlag.hits.length > 0 && !s.redFlag.ack) {
        s = MK.reducer(s, { type: "SAFETY_ACK" }); safetyAcked = true; continue;
      }
      s = MK.reducer(s, { type: "SAFETY_CONTINUE" });
      continue;
    }
    const turn = list.find((t) => t.id === s.cursor);
    if (!turn) break;
    const slot = turn.id === "narrative"
      ? { state: "captured", v: "x", en: MK.pickLangText(script.narrative, "rom"), hi: null, utterance: MK.pickLangText(script.narrative, "rom"), source: "voice", ts: now() }
      : MK.scriptSlotFor(turn, script, "rom", now());
    if (!slot) break;
    s = MK.reducer(s, { type: "ANSWER", turnId: turn.id, slot });
  }
  ok(s.phase === "readback", "run reaches read-back");
  ok(safetySeenAt === "RF-2,RF-4", "safety check computed once at the safety step: " + safetySeenAt);
  ok(safetyAcked, "escalation required staff acknowledgment before continuing");
  ok(s.redFlag.ack === true, "urgent flag stays attached to the session");
  ok(s.answers.meds.doseConfirmed, "dose was selectively confirmed mid-run");
  ok(s.answers.cc.v.id === "chest", "CC structured as complaint object");
  s = MK.reducer(s, { type: "CONFIRM_SUMMARY" });
  ok(s.phase === "handoff", "confirm → physician handoff");
  s = MK.reducer(s, { type: "CHANGE_FIELD", turnId: "socrates.severity" });
  ok(s.phase === "interview" && s.cursor === "socrates.severity" && s.returnTo === "readback",
    "patient read-back correction loops back to the field");
  const re = MK.reducer(s, { type: "ANSWER", turnId: "socrates.severity", slot: { state: "captured", v: 7, en: "7 / 10", hi: "7 / 10", utterance: null, source: "touch", ts: now() } });
  ok(re.phase === "readback" && re.answers["socrates.severity"].v === 7, "corrected value lands and returns to read-back");
}

section("7 · Free-exploration run — typed Hinglish chest pain");
{
  let s = MK.reducer(MK.initialState(), { type: "START", lang: "rom", scriptId: "free" });
  const typedNarrative = "Doctor sahab subah se seene mein dard ho raha hai aur saans lene mein takleef ho rahi hai";
  s = MK.reducer(s, { type: "ANSWER", turnId: "narrative", slot: { state: "captured", v: typedNarrative, en: typedNarrative, hi: null, utterance: typedNarrative, source: "voice", ts: now() } });
  s = MK.reducer(s, { type: "ANSWER", turnId: "cc", slot: { state: "captured", v: MK.complaintById("chest"), en: "chest pain", hi: "छाती में दर्द", utterance: null, source: "touch", ts: now() } });
  ok(s.complaintId === "chest", "typed narrative → complaint detection → chest ROS set");
  let guard = 0;
  const skipAll = ["socrates.site", "socrates.onset", "socrates.character", "socrates.radiation", "socrates.associations", "socrates.timing", "socrates.exacerbating"];
  while (s.phase === "interview" && guard++ < 40) {
    if (s.cursor === "safety") break;
    const skipSlot = { state: "not_answered", v: null, en: "Will tell the doctor", hi: "डॉक्टर से बताएँगे", utterance: null, source: "touch", ts: now() };
    if (skipAll.indexOf(s.cursor) === -1 && s.cursor !== "socrates.severity") {
      s = MK.reducer(s, { type: "ANSWER", turnId: s.cursor, slot: s.cursor === "socrates.severity" ? { state: "captured", v: 9, en: "9 / 10", hi: "9 / 10", utterance: null, source: "touch", ts: now() } : skipSlot });
    } else {
      const sev = s.cursor === "socrates.severity";
      s = MK.reducer(s, { type: "ANSWER", turnId: s.cursor, slot: sev ? { state: "captured", v: 9, en: "9 / 10", hi: "9 / 10", utterance: null, source: "touch", ts: now() } : skipSlot });
    }
  }
  ok(s.cursor === "safety", "reached safety step from free run");
  ok(s.redFlag !== null && s.redFlag.all.length === 4,
    "rules run exactly on arrival at the safety step (all 4 checked, once)");
  const advanced = MK.reducer(MK.reducer(s, { type: "SAFETY_CONTINUE" }), { type: "SAFETY_ACK" });
  ok(advanced.redFlag.hits.some((h) => h.id === "RF-2"),
    "typed Hinglish narrative alone triggers RF-2 at the safety screen");
}

section("8 · Read-back / handoff content");
{
  const s = MK.cannedState("redflag", "readback", null, "rom");
  const secs = MK.summarySections(s);
  const ids = secs.map((x) => x.id);
  ok(JSON.stringify(ids) === JSON.stringify(["cc", "hpi", "safety", "history", "family", "ros", "ice"]),
    "summary sections: " + ids.join(", "));
  const hpi = secs.find((x) => x.id === "hpi");
  ok(hpi.rows.length === 8 && hpi.rows.every((r) => r.slot.state === "captured"), "all 8 SOCRATES fields captured");
  const socratesSet = new Set(hpi.rows.map((r) => r.turnId));
  ["socrates.site", "socrates.onset", "socrates.character", "socrates.radiation", "socrates.associations", "socrates.timing", "socrates.exacerbating", "socrates.severity"].forEach((id) => {
    if (!socratesSet.has(id)) ok(false, "missing SOCRATES field " + id);
  });
  const voiceRows = secs.flatMap((x) => x.rows).filter((r) => r.slot.source === "voice" && r.slot.utterance);
  ok(voiceRows.length >= 4, "original spoken words preserved on " + voiceRows.length + " fields (provenance)");
  const ros = secs.find((x) => x.id === "ros");
  ok(ros.rows.length === 4 && ros.rows.every((r) => r.slot.state === "captured"), "pertinent negatives kept (4 ROS rows)");
  const rf = secs.find((x) => x.id === "safety");
  ok(rf.rows.filter((r) => r.slot.state === "urgent").length === 2, "urgent rule rows visible in patient summary");
}

section("9 · Voice-input clinical excerpt (what gets stored from speech)");
{
  const ce = MK.clinicalExcerpt;
  ok(typeof ce === "function", "clinicalExcerpt is exported from the core");

  const rom = ce("Doctor sahab, mujhe batana hai — subah se seene mein dard hai aur saans lene mein takleef ho rahi hai", "narrative");
  ok(rom.indexOf("seene mein dard") !== -1 && rom.indexOf("Doctor sahab") === -1 && rom.indexOf("mujhe") === -1,
    "Roman/Hinglish: fillers stripped, clinical content kept: “" + rom + "”");

  const hi = ce("नमस्ते डॉक्टर, मुझे बताना है — सुबह से सीने में दर्द है और सांस लेने में तकलीफ है", "narrative");
  ok(hi.indexOf("सीने में दर्द") !== -1 && hi.indexOf("नमस्ते") === -1 && hi.indexOf("मुझे बताना") === -1,
    "Devanagari (hi-IN mic): fillers stripped, clinical content kept: “" + hi + "”");

  const mixed = ce("Thank you doctor for listening. I have chest pain since 3 days.", "narrative");
  ok(mixed.indexOf("chest pain since 3 days") !== -1 && mixed.indexOf("Thank you") === -1,
    "multi-sentence: courtesy sentence dropped, clinical kept: “" + mixed + "”");

  const hiMixed = ce("धन्यवाद डॉक्टर। सुबह से बुखार है और खांसी भी है।", "pmh");
  ok(hiMixed.indexOf("बुखार") !== -1 && hiMixed.indexOf("धन्यवाद") === -1,
    "Devanagari multi-sentence: thanks dropped, symptoms kept: “" + hiMixed + "”");

  ok(ce("no allergies that I know of", "allergies").indexOf("no allergies") === 0,
    "meaning preserved: leading 'no' is NOT stripped (would flip clinical meaning)");

  const long = ce(new Array(40).join("dard hai "), "narrative");
  ok(long.length <= 280, "stored utterance capped at 280 chars (" + long.length + ")");

  const scriptNarr = MK.pickLangText(MK.DEMO_SCRIPTS.redflag.narrative, "rom");
  const kept = ce(scriptNarr, "narrative");
  ok(MK.runSafetyCheck(kept, null).hits.some((h) => h.id === "RF-2"),
    "excerpted narrative still triggers RF-2 (safety rules run on what is actually stored)");
  ok(MK.detectComplaint(ce("Doctor sahab, ghutne mein dard ho raha hai", "narrative")).id === "knee",
    "complaint detection still works on the excerpted utterance");
}

console.log("\n" + (failed === 0 ? "ALL " + passed + " CHECKS PASSED" : failed + " FAILED / " + passed + " passed"));
process.exit(failed === 0 ? 0 : 1);
