// Shared core: API client, i18n, DOM helpers, toast.
// No clinical content lives here — everything comes from the server config.

export const api = {
  async request(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) {
      const err = new Error((body && body.error) || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  },
  get(path) { return this.request(path, { method: "GET" }); },
  post(path, payload) {
    return this.request(path, { method: "POST", body: JSON.stringify(payload ?? {}) });
  },
  put(path, payload) {
    return this.request(path, { method: "PUT", body: JSON.stringify(payload ?? {}) });
  },
};

// Resolve a multilingual config object to the active language, falling back
// to English. Values that are plain strings pass through.
export function t(value, lang) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[lang] || value.en || value.rom || value.hi || "";
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "value") node.value = v;         // textarea needs the property
    else if (k === "checked") node.checked = Boolean(v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

let toastTimer = null;
export function toast(message, kind = "info") {
  let box = document.querySelector(".toast");
  if (!box) { box = el("div", { class: "toast", role: "status", "aria-live": "polite" }); document.body.append(box); }
  box.className = "toast " + (kind === "err" ? "err" : "");
  box.textContent = message;
  box.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.add("hidden"), kind === "err" ? 6000 : 3200);
}

// Tiny observable store.
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) { state = { ...state, ...patch }; subs.forEach((fn) => fn(state)); },
    subscribe(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); },
  };
}

export function fmtTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
