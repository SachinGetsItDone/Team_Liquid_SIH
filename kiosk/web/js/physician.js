// Physician consult-screen application.
//
// Loads the red-flag-prioritised worklist, renders the real Module C summary
// (SOAP, OLD CARTS, alerts, labs, FHIR validation, eval), and performs the
// application-enforced attestation gate and the correction round-trip.
// All data comes from the API; nothing is mocked or hardcoded.

import { api, el, clear, t, toast, createStore, fmtTime } from "./core.js";

const S = createStore({
  config: null,
  queue: [],
  current: null,        // session id
  summary: null,
  practitioner: "Practitioner/PHYS-1",
  loading: false,
});

function main() { return document.getElementById("physician-main"); }
function aside() { return document.getElementById("physician-aside"); }

async function boot() {
  try {
    const config = await api.get("/api/config");
    S.set({ config });
    await refreshQueue();
    const deep = new URLSearchParams(location.search).get("session");
    if (deep) await openSession(deep);
  } catch (e) {
    main().append(el("div", { class: "banner err", text: "Cannot reach the service: " + e.message }));
  }
}

async function refreshQueue() {
  const queue = await api.get("/api/sessions");
  S.set({ queue });
  renderAside();
}

function renderAside() {
  const s = S.get();
  clear(aside());
  aside().append(
    el("a", { class: "btn btn-sm", href: "/", text: "← Kiosk" }),
    el("h2", { style: "margin-top:14px", text: "Worklist" }),
    el("div", { class: "field", style: "margin-bottom:10px" }, [
      el("label", { class: "small muted", text: "Attesting practitioner" }),
      el("input", {
        class: "textinput", type: "text", value: s.practitioner,
        onChange: (e) => S.set({ practitioner: e.target.value }),
      }),
    ]),
    el("button", { class: "btn btn-sm", type: "button", text: "Refresh", onClick: refreshQueue }),
    el("div", { class: "worklist", style: "margin-top:12px" },
      s.queue.length === 0
        ? el("p", { class: "small muted", text: "No sessions captured yet." })
        : s.queue.map(worklistItem)),
  );
}

function worklistItem(row) {
  return el("button", {
    class: "item", type: "button",
    "aria-current": String(S.get().current === row.session_id),
    onClick: () => openSession(row.session_id),
  }, [
    el("div", { class: "row" }, [
      el("strong", { class: "mono", text: row.session_id }),
      row.red_flag ? el("span", { class: "pill pill-red", text: "RED" }) : null,
    ]),
    el("div", { class: "small muted", text: `${fmtTime(row.created_at)}  ·  ${row.language}  ·  ${row.alerts} alerts` }),
    el("div", { class: "small", text: statusText(row) }),
  ]);
}

function statusText(row) {
  if (row.attested) return "attested";
  if (row.has_summary) return "summary ready";
  return row.status || "in progress";
}

async function openSession(id) {
  S.set({ current: id, loading: true, summary: null });
  renderAside();
  main().replaceChildren(el("div", { class: "muted", text: "Loading summary…" }));
  try {
    const summary = await api.get(`/api/sessions/${id}/summary`);
    S.set({ summary, loading: false });
    renderSummary();
  } catch (e) {
    S.set({ loading: false });
    main().replaceChildren(el("div", { class: "banner err", text: e.message }));
  }
}

// ------------------------------------------------------------------- render

function renderSummary() {
  const s = S.get();
  const sum = s.summary;
  const m = main();
  clear(m);
  const fresh = el("button", { class: "btn btn-sm", type: "button", text: "Re-generate", onClick: () => regenerate() });
  const meta = el("div", { class: "small muted" },
    `IG ${sum.meta.ig_pin} · range set ${sum.meta.range_set}${sum.meta.range_set_signed ? "" : " (unsigned — no lab flagging)"} · schema ${sum.meta.history_schema} · generated ${fmtTime(sum.generated_at)}`);
  m.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:12px" }, [
      el("div", {}, [
        el("h1", { text: "Pre-consultation summary" }),
        el("div", { class: "mono", text: sum.session }),
        meta,
      ]),
      fresh,
    ]),
    renderBanners(sum),
    renderAlerts(sum),
    el("div", { class: "summary-grid" }, [
      renderSOAP(sum),
      el("div", {}, [renderOldcarts(sum), renderFhir(sum), renderEval(sum)]),
    ]),
    renderAttest(sum),
  );
}

function renderBanners(sum) {
  const b = [];
  const att = sum.attestation;
  if (att && att.status === "final") b.push(el("div", { class: "banner ok", text: `Attested to final by ${att.practitioner_ref} at ${fmtTime(att.attested_at)}.` }));
  else if (att && att.status === "amended") b.push(el("div", { class: "banner warn", text: "Amended after attestation — re-attestation required." }));
  else b.push(el("div", { class: "banner info", text: "Preliminary — machine-generated from patient-elicited history. Not final until you attest." }));
  b.push(el("div", { class: "banner info", text: "Assessment and Plan are physician-only and are deliberately not generated by the kiosk." }));
  if (sum.fhir_validation_errors && sum.fhir_validation_errors.length) {
    b.push(el("div", { class: "banner err", text: `${sum.fhir_validation_errors.length} structural FHIR validation issue(s): ${sum.fhir_validation_errors[0]}` }));
  } else {
    b.push(el("div", { class: "banner ok", text: "FHIR bundle passes structural validation (profile validation is an M3 step)." }));
  }
  return el("div", {}, b);
}

function renderAlerts(sum) {
  const card = el("section", { class: "card" }, [el("h3", { text: "Alert list (red flags → verify → abnormal)" })]);
  if (!sum.alerts || sum.alerts.length === 0) {
    card.append(el("p", { class: "muted", text: "No alerts." }));
    return card;
  }
  sum.alerts.forEach((a) => {
    const row = el("div", { class: `alert ${a.severity}` }, [
      el("div", { style: "display:flex;justify-content:space-between;gap:10px" }, [
        el("strong", { text: a.text }),
        a.fid ? el("span", { class: "prov", text: a.fid }) : null,
      ]),
      a.detail ? el("div", { class: "detail", text: a.detail }) : null,
    ]);
    card.append(row);
  });
  return card;
}

function soapBlock(title, lines, opts = {}) {
  const block = el("div", { class: `soap-block ${opts.ap ? "ap" : ""}` }, [el("h4", { text: title })]);
  if (!lines || lines.length === 0) block.append(el("p", { class: "muted small", text: "—" }));
  (lines || []).forEach((ln) => block.append(renderLine(ln)));
  return block;
}

function renderLine(ln) {
  const row = el("div", { class: "line" }, [
    el("div", {}, [el("span", { text: ln.text })]),
    el("div", { style: "display:flex;gap:8px;align-items:center" }, [
      ln.src && ln.src.length ? el("span", { class: "prov", text: ln.src.join(" ") }) : null,
      isEditable(ln) ? el("button", {
        class: "btn btn-sm", type: "button", text: "Correct",
        onClick: () => beginEdit(row, ln),
      }) : null,
    ]),
  ]);
  return row;
}

function isEditable(ln) {
  return (ln.src || []).some((fid) => fid.startsWith("B:med:") || fid.startsWith("B:lab:"));
}

function beginEdit(row, ln) {
  const fid = (ln.src || []).find((f) => f.startsWith("B:med:") || f.startsWith("B:lab:"));
  clear(row);
  const input = el("input", { class: "textinput", type: "text", value: ln.text });
  row.append(input, el("div", { style: "display:flex;gap:8px;margin-top:8px" }, [
    el("button", {
      class: "btn btn-sm btn-primary", type: "button", text: "Save correction",
      onClick: async () => {
        try {
          const summary = await api.post(`/api/sessions/${S.get().current}/edit`, {
            fid, value: input.value, actor: S.get().practitioner,
          });
          S.set({ summary });
          renderSummary();
          refreshQueue();
          toast("Correction recorded and summary re-rendered.");
        } catch (e) { toast(e.message, "err"); }
      },
    }),
    el("button", { class: "btn btn-sm", type: "button", text: "Cancel", onClick: renderSummary }),
  ]));
  input.focus();
}

function renderSOAP(sum) {
  const v = sum.views.soap;
  return el("section", { class: "card" }, [
    el("h3", { text: "SOAP" }),
    soapBlock("Subjective", v.S),
    soapBlock("Objective", v.O),
    soapBlock("Assessment", v.A, { ap: true }),
    soapBlock("Plan", v.P, { ap: true }),
    v.gaps && v.gaps.length ? el("div", {}, [
      el("h4", { text: "Explicit gaps (never silently blank)" }),
      ...v.gaps.map(renderLine),
    ]) : null,
  ]);
}

function renderOldcarts(sum) {
  const v = sum.views.oldcarts;
  const card = el("section", { class: "card" }, [el("h3", { text: "OLD CARTS" })]);
  Object.entries(v.sections || {}).forEach(([heading, lines]) => {
    card.append(el("h4", { class: "small muted", text: heading }));
    lines.forEach((ln) => card.append(renderLine(ln)));
  });
  return card;
}

function renderFhir(sum) {
  const card = el("section", { class: "card" }, [el("h3", { text: "FHIR / ABDM" })]);
  card.append(el("p", { class: "small muted", text: "NRCeS OPConsultRecord document bundle (preliminary until attestation)." }));
  const comp = (sum.fhir.entry || []).find((e) => e.resource && e.resource.resourceType === "Composition");
  if (comp) {
    const c = comp.resource;
    card.append(el("table", { class: "data" }, el("tbody", {}, [
      row("status", c.status),
      row("type", `${(c.type?.coding?.[0]?.code) || ""} ${(c.type?.coding?.[0]?.display) || ""}`),
      row("author", (c.author || []).map((a) => a.reference).join(", ")),
      row("attester", (c.attester || []).map((a) => `${a.mode}:${a.party?.reference || ""}`).join(", ") || "—"),
      row("sections", String((c.section || []).length)),
    ])));
  }
  card.append(el("details", {}, [
    el("summary", { class: "small", text: "Raw bundle JSON" }),
    el("pre", { class: "small mono", style: "white-space:pre-wrap;max-height:280px;overflow:auto", text: JSON.stringify(sum.fhir, null, 2) }),
  ]));
  return card;
}

function row(k, v) {
  return el("tr", {}, [el("th", { text: k }), el("td", { text: String(v) })]);
}

function renderEval(sum) {
  const e = sum.eval || {};
  const card = el("section", { class: "card" }, [el("h3", { text: "Fidelity (deterministic)" })]);
  const items = Object.entries(e).filter(([, v]) => typeof v !== "object");
  if (items.length === 0) { card.append(el("p", { class: "muted small", text: JSON.stringify(e) })); return card; }
  card.append(el("table", { class: "data" }, el("tbody", {}, items.map(([k, v]) => row(k, v)))));
  return card;
}

// --------------------------------------------------------------- attestation

function renderAttest(sum) {
  const card = el("section", { class: "card" });
  const att = sum.attestation;
  const unresolved = sum.unresolved_verify_fids || [];
  if (att && att.status === "final") {
    card.append(el("div", { class: "attest-bar" }, [
      el("div", { class: "pill pill-ok", text: "Attested — final" }),
      el("span", { class: "small muted", text: `by ${att.practitioner_ref}` }),
    ]));
    return card;
  }
  card.append(el("h3", { text: "Attestation" }));
  card.append(el("p", { class: "small muted", text: "Every verify item must be explicitly dispositioned before finalisation. Patient confirmation does not clear a machine verify-flag." }));

  if (unresolved.length === 0) {
    card.append(el("div", { class: "banner ok", text: "No unresolved verify items." }));
  } else {
    card.append(el("div", { class: "tick-list" }, unresolved.map((fid) =>
      el("label", { class: "tick" }, [
        el("input", { type: "checkbox", class: "attest-tick", value: fid }),
        el("span", { text: `Reviewed and accepted: ${fid}` }),
      ]))));
  }

  card.append(el("div", { class: "attest-bar" }, [
    el("span", { class: "small muted", text: `Attesting as ${S.get().practitioner}` }),
    el("button", {
      class: "btn btn-primary", type: "button", text: "Attest & finalise",
      onClick: () => doAttest(sum),
    }),
  ]));
  return card;
}

async function doAttest(sum) {
  const ticks = Array.from(document.querySelectorAll(".attest-tick"));
  const resolved = ticks.filter((c) => c.checked).map((c) => c.value);
  try {
    const updated = await api.post(`/api/sessions/${S.get().current}/attest`, {
      practitioner_ref: S.get().practitioner,
      actor: S.get().practitioner,
      resolved_fids: resolved,
    });
    S.set({ summary: updated });
    renderSummary();
    refreshQueue();
    toast("Attested — the record is now final.", "info");
  } catch (e) {
    const d = e.body && e.body.detail && e.body.detail.unresolved_fids;
    toast(d ? `Unresolved: ${d.join(", ")}` : e.message, "err");
  }
}

async function regenerate() {
  try {
    const summary = await api.post(`/api/sessions/${S.get().current}/summary`, {});
    S.set({ summary });
    renderSummary();
  } catch (e) { toast(e.message, "err"); }
}

document.addEventListener("DOMContentLoaded", boot);
