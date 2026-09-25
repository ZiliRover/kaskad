/* Seedance Studio - node canvas + graph execution. */
"use strict";

// ---------------------------------------------------------------- backend bridge

let BACKEND = null;   // pywebview api or mock
let MOCK = false;

const backendReady = new Promise((resolve) => {
  if (window.pywebview?.api) { BACKEND = window.pywebview.api; resolve(); return; }
  window.addEventListener("pywebviewready", () => {
    BACKEND = window.pywebview.api;
    resolve();
  });
  setTimeout(() => {
    if (!BACKEND) {
      MOCK = true;
      BACKEND = makeMock();
      resolve();
    }
  }, 1800);
});

function makeMock() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let total = 0;
  return {
    get_settings: async () => ({ has_key: true, key_preview: "sk-or-v1-mock...demo", spend_total: total }),
    save_key: async () => ({ has_key: true, key_preview: "sk-or-v1-mock...demo", spend_total: total }),
    add_spend: async (a) => { total += a; return { spend_total: total }; },
    get_credits: async () => ({ balance: 12.34 }),
    video_models: async () => [],
    generate_video: async () => { await sleep(2500); return { file: "", abs_path: "", cost: 0.31, mock: true }; },
    chat: async (p) => {
      await sleep(1800);
      if ((p.modalities || []).includes("image")) {
        return { text: "", images: ["https://picsum.photos/seed/seedance-demo/960/540"], cost: 0.04 };
      }
      return { text: "Демо-ответ модели (браузерный предпросмотр без бэкенда).", images: [], cost: 0.001 };
    },
    export_file: async () => ({ saved: "demo" }),
    win_minimize: async () => {}, win_toggle_max: async () => {}, win_close: async () => {},
  };
}

// ---------------------------------------------------------------- state

let VIDEO_MODELS = FALLBACK_VIDEO_MODELS.slice();

const state = {
  nodes: [],            // {id, type, x, y, data}
  edges: [],            // {id, from:{node,port}, to:{node,port}, dtype}
  pan: { x: 60, y: 40 },
  zoom: 1,
  counter: 1,
  sel: null,            // {kind:'node'|'edge', id}
  session: 0,
};

const running = new Set();

const el = {
  canvas: document.getElementById("canvas"),
  world: document.getElementById("world"),
  edges: document.getElementById("edges"),
  nodes: document.getElementById("nodes"),
  zoomLabel: document.getElementById("zoom-label"),
};

const byId = (id) => state.nodes.find((n) => n.id === id);
const isModelType = (t) => t === "video" || t === "imagegen" || t === "llm";

// ---------------------------------------------------------------- persistence

const STORE_KEY = "seedance-graph-v1";
let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

function persist() {
  try {
    const nodes = state.nodes.map((n) => ({ ...n, data: { ...n.data } }));
    localStorage.setItem(STORE_KEY, JSON.stringify({
      nodes, edges: state.edges, pan: state.pan, zoom: state.zoom, counter: state.counter,
    }));
  } catch (_) { /* storage full: skip */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.nodes) || !s.nodes.length) return false;
    state.nodes = s.nodes;
    state.edges = s.edges || [];
    state.pan = s.pan || state.pan;
    state.zoom = s.zoom || 1;
    state.counter = s.counter || state.nodes.length + 1;
    return true;
  } catch (_) { return false; }
}

// ---------------------------------------------------------------- toasts

function toast(msg, isError) {
  const wrap = document.getElementById("toast-wrap");
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " error" : "");
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3200);
}

// ---------------------------------------------------------------- money

const fmt$ = (v) => "$" + (v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2));

function setChip(id, val) {
  document.querySelector(`#${id} b`).textContent = val;
}

async function refreshBalance() {
  const r = await BACKEND.get_credits();
  setChip("chip-balance", r.balance != null ? fmt$(r.balance) : "—");
}

async function registerCost(cost) {
  if (!cost) return;
  state.session += cost;
  setChip("chip-session", fmt$(state.session));
  const r = await BACKEND.add_spend(cost);
  if (r.spend_total != null) setChip("chip-total", fmt$(r.spend_total));
  refreshBalance();
}

// ---------------------------------------------------------------- view transform

function applyView() {
  el.world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  el.canvas.style.backgroundPosition = `${state.pan.x}px ${state.pan.y}px`;
  el.canvas.style.backgroundSize = `${24 * state.zoom}px ${24 * state.zoom}px`;
  el.zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
}

function toWorld(clientX, clientY) {
  const r = el.canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left - state.pan.x) / state.zoom,
    y: (clientY - r.top - state.pan.y) / state.zoom,
  };
}

function zoomAt(clientX, clientY, factor) {
  const next = Math.min(2, Math.max(0.3, state.zoom * factor));
  const p = toWorld(clientX, clientY);
  state.zoom = next;
  const r = el.canvas.getBoundingClientRect();
  state.pan.x = clientX - r.left - p.x * next;
  state.pan.y = clientY - r.top - p.y * next;
  applyView();
  scheduleSave();
}

// ---------------------------------------------------------------- edges

function portEl(nodeId, dir, port) {
  return el.nodes.querySelector(`.port[data-node="${nodeId}"][data-dir="${dir}"][data-port="${port}"]`);
}

function portWorldPos(nodeId, dir, port) {
  const n = byId(nodeId);
  const p = portEl(nodeId, dir, port);
  if (!n || !p) return null;
  return { x: n.x + p.offsetLeft + 7, y: n.y + p.offsetTop + 7 };
}

function edgePath(a, b) {
  const dx = Math.max(50, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function drawEdges() {
  const parts = [];
  for (const e of state.edges) {
    const a = portWorldPos(e.from.node, "out", e.from.port);
    const b = portWorldPos(e.to.node, "in", e.to.port);
    if (!a || !b) continue;
    const sel = state.sel?.kind === "edge" && state.sel.id === e.id ? " selected" : "";
    parts.push(`<path class="edge-path${sel}" data-edge="${e.id}" d="${edgePath(a, b)}"/>`);
  }
  if (tempEdge) parts.push(`<path class="edge-temp" d="${edgePath(tempEdge.a, tempEdge.b)}"/>`);
  el.edges.innerHTML = parts.join("");
  updatePortDots();
}

function updatePortDots() {
  el.nodes.querySelectorAll(".port").forEach((p) => {
    const id = p.dataset.node, dir = p.dataset.dir, key = p.dataset.port;
    const connected = state.edges.some((e) =>
      dir === "out" ? (e.from.node === id && e.from.port === key)
                    : (e.to.node === id && e.to.port === key));
    p.classList.toggle("connected", connected);
  });
  state.nodes.forEach(syncLinkedHints);
}

function edgeInto(nodeId, port) {
  return state.edges.find((e) => e.to.node === nodeId && e.to.port === port);
}

function addEdge(from, to, dtype) {
  state.edges = state.edges.filter((e) => !(e.to.node === to.node && e.to.port === to.port));
  state.edges.push({ id: "e" + state.counter++, from, to, dtype });
  drawEdges();
  scheduleSave();
}

// ---------------------------------------------------------------- node creation

function addNode(type, x, y) {
  const id = "n" + state.counter++;
  const data = {};
  if (type === "prompt") data.text = "";
  if (type === "image") { data.dataUrl = ""; data.name = ""; }
  if (type === "video") {
    const m = VIDEO_MODELS[0];
    Object.assign(data, {
      model: m.id, resolution: m.resolutions.includes("720p") ? "720p" : m.resolutions[0],
      aspect: "16:9", duration: 5, audio: true, seed: "", prompt: "",
      result: null, cost: null,
    });
  }
  if (type === "imagegen") Object.assign(data, { model: IMAGE_MODELS[0].id, prompt: "", result: null, cost: null });
  if (type === "llm") Object.assign(data, { model: LLM_MODELS[0].id, system: "", prompt: "", result: null, cost: null });
  const node = { id, type, x: Math.round(x), y: Math.round(y) };
  node.data = data;
  state.nodes.push(node);
  renderNode(node);
  drawEdges();
  scheduleSave();
  return node;
}

function removeNode(id) {
  const nd = el.nodes.querySelector(`.node[data-id="${id}"]`);
  if (nd) nd.remove();
  state.nodes = state.nodes.filter((n) => n.id !== id);
  state.edges = state.edges.filter((e) => e.from.node !== id && e.to.node !== id);
  if (state.sel?.id === id) state.sel = null;
  drawEdges();
  scheduleSave();
}

// ---------------------------------------------------------------- node rendering

function optionList(items, current) {
  return items.map((it) => {
    const v = it.id ?? it, label = it.name ?? it;
    return `<option value="${v}" ${v === current ? "selected" : ""}>${label}</option>`;
  }).join("");
}

function renderNode(node) {
  const t = NODE_TYPES[node.type];
  const div = document.createElement("div");
  div.className = "node";
  div.dataset.id = node.id;
  div.style.left = node.x + "px";
  div.style.top = node.y + "px";

  let body = "";
  if (node.type === "prompt") {
    body = `<textarea data-bind="text" rows="4" placeholder="Опиши сцену...">${esc(node.data.text)}</textarea>`;
  } else if (node.type === "image") {
    body = `<div class="img-drop" data-role="drop">${node.data.dataUrl
      ? `<img src="${node.data.dataUrl}" alt="${esc(node.data.name)}">`
      : "Кликни или перетащи картинку"}</div>
      <input type="file" accept="image/*" hidden data-role="file">`;
  } else if (node.type === "video") {
    body = `
      <div class="param"><span class="param-label">МОДЕЛЬ</span>
        <div class="select-wrap"><select data-bind="model">${optionList(VIDEO_MODELS, node.data.model)}</select></div>
      </div>
      <div class="input-linked" data-role="prompt-linked" hidden>Промт придёт из подключённой ноды</div>
      <textarea data-bind="prompt" rows="3" placeholder="Промт для видео (или подключи ноду Промт)">${esc(node.data.prompt)}</textarea>
      <div class="param-grid" data-role="video-params"></div>
      <label class="check-row"><input type="checkbox" data-bind="audio" ${node.data.audio ? "checked" : ""}> Генерировать аудио</label>
      <div class="result-area" data-role="result"></div>`;
  } else if (node.type === "imagegen") {
    body = `
      <div class="param"><span class="param-label">МОДЕЛЬ</span>
        <div class="select-wrap"><select data-bind="model">${optionList(IMAGE_MODELS, node.data.model)}</select></div>
      </div>
      <div class="input-linked" data-role="prompt-linked" hidden>Промт придёт из подключённой ноды</div>
      <textarea data-bind="prompt" rows="3" placeholder="Что нарисовать (или подключи ноду Промт)">${esc(node.data.prompt)}</textarea>
      <div class="result-area" data-role="result"></div>`;
  } else if (node.type === "llm") {
    body = `
      <div class="param"><span class="param-label">МОДЕЛЬ</span>
        <div class="select-wrap"><select data-bind="model">${optionList(LLM_MODELS, node.data.model)}</select></div>
      </div>
      <input type="text" data-bind="system" placeholder="Системный промт (необязательно)" value="${esc(node.data.system)}">
      <div class="input-linked" data-role="prompt-linked" hidden>Промт придёт из подключённой ноды</div>
      <textarea data-bind="prompt" rows="3" placeholder="Вопрос модели (или подключи ноду Промт)">${esc(node.data.prompt)}</textarea>
      <div class="result-area" data-role="result"></div>`;
  }

  const foot = isModelType(node.type)
    ? `<div class="node-foot">
         <button class="btn primary small" data-role="run">Запустить</button>
         <span class="node-status" data-role="status"></span>
         <span class="node-cost" data-role="cost"></span>
       </div>`
    : "";

  div.innerHTML = `
    <div class="node-head">
      <span class="nh-dot dot-${t.dot}"></span>
      <span class="nh-title">${t.title}</span>
      <button class="nh-close" title="Удалить">&times;</button>
    </div>
    <div class="node-body">${body}</div>
    ${foot}
    ${t.inputs.map((p) => `<div class="port in" data-node="${node.id}" data-dir="in" data-port="${p.key}" data-dtype="${p.dtype}" title="${p.label}"><span class="port-label in">${p.label}</span></div>`).join("")}
    ${t.outputs.map((p) => `<div class="port out" data-node="${node.id}" data-dir="out" data-port="${p.key}" data-dtype="${p.dtype}" title="${p.label}"><span class="port-label out">${p.label}</span></div>`).join("")}
  `;
  el.nodes.appendChild(div);
  layoutPorts(div, t);
  bindNode(div, node);
  if (node.type === "video") rebuildVideoParams(div, node);
  renderResult(node);
  syncLinkedHints(node);
}

function layoutPorts(div, t) {
  const spread = (ports, cls) => {
    const els = [...div.querySelectorAll(`.port.${cls}`)];
    const h = div.offsetHeight;
    els.forEach((p, i) => {
      p.style.top = Math.round(h * (i + 1) / (ports.length + 1) - 7) + "px";
      const lbl = p.querySelector(".port-label");
      if (lbl) lbl.style.top = "0px";
    });
  };
  spread(t.inputs, "in");
  spread(t.outputs, "out");
}

function relayoutPorts(node) {
  const div = el.nodes.querySelector(`.node[data-id="${node.id}"]`);
  if (div) { layoutPorts(div, NODE_TYPES[node.type]); drawEdges(); }
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function rebuildVideoParams(div, node) {
  const meta = VIDEO_MODELS.find((m) => m.id === node.data.model) || VIDEO_MODELS[0];
  if (!meta.resolutions.includes(node.data.resolution)) node.data.resolution = meta.resolutions[0];
  if (!meta.aspect_ratios.includes(node.data.aspect)) node.data.aspect = meta.aspect_ratios[0];
  if (!meta.durations.includes(Number(node.data.duration))) node.data.duration = meta.durations[0];
  const grid = div.querySelector('[data-role="video-params"]');
  grid.innerHTML = `
    <div class="param"><span class="param-label">РАЗРЕШЕНИЕ</span>
      <div class="select-wrap"><select data-bind="resolution">${optionList(meta.resolutions, node.data.resolution)}</select></div></div>
    <div class="param"><span class="param-label">ФОРМАТ</span>
      <div class="select-wrap"><select data-bind="aspect">${optionList(meta.aspect_ratios, node.data.aspect)}</select></div></div>
    <div class="param"><span class="param-label">ДЛИТЕЛЬНОСТЬ, СЕК</span>
      <div class="select-wrap"><select data-bind="duration">${optionList(meta.durations.map(String), String(node.data.duration))}</select></div></div>
    <div class="param"><span class="param-label">SEED</span>
      <input type="text" data-bind="seed" placeholder="случайный" value="${esc(node.data.seed)}"></div>`;
  grid.querySelectorAll("[data-bind]").forEach((inp) => bindField(inp, node));
}

function bindField(inp, node) {
  const key = inp.dataset.bind;
  const ev = inp.tagName === "SELECT" || inp.type === "checkbox" ? "change" : "input";
  inp.addEventListener(ev, () => {
    node.data[key] = inp.type === "checkbox" ? inp.checked : inp.value;
    if (key === "model" && node.type === "video") {
      const div = el.nodes.querySelector(`.node[data-id="${node.id}"]`);
      rebuildVideoParams(div, node);
    }
    scheduleSave();
  });
  inp.addEventListener("mousedown", (e) => e.stopPropagation());
}

function bindNode(div, node) {
  // node height changes (params rebuild, results, textarea resize) move the ports
  const ro = new ResizeObserver(() => {
    layoutPorts(div, NODE_TYPES[node.type]);
    drawEdges();
  });
  ro.observe(div);
  div.querySelectorAll("[data-bind]").forEach((inp) => bindField(inp, node));
  div.querySelector(".nh-close").addEventListener("click", (e) => {
    e.stopPropagation();
    removeNode(node.id);
  });
  div.addEventListener("mousedown", () => selectNode(node.id));

  // dragging by header
  const head = div.querySelector(".node-head");
  head.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest(".nh-close")) return;
    e.preventDefault();
    e.stopPropagation();
    selectNode(node.id);
    const start = { mx: e.clientX, my: e.clientY, x: node.x, y: node.y };
    const move = (ev) => {
      node.x = start.x + (ev.clientX - start.mx) / state.zoom;
      node.y = start.y + (ev.clientY - start.my) / state.zoom;
      div.style.left = node.x + "px";
      div.style.top = node.y + "px";
      drawEdges();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      scheduleSave();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });

  // image node upload
  if (node.type === "image") {
    const drop = div.querySelector('[data-role="drop"]');
    const file = div.querySelector('[data-role="file"]');
    drop.addEventListener("click", () => file.click());
    drop.addEventListener("mousedown", (e) => e.stopPropagation());
    file.addEventListener("change", () => loadImageFile(file.files[0], node));
    drop.addEventListener("dragover", (e) => e.preventDefault());
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      loadImageFile(e.dataTransfer.files[0], node);
    });
  }

  const runBtn = div.querySelector('[data-role="run"]');
  if (runBtn) {
    runBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    runBtn.addEventListener("click", () => runNode(node.id).catch((err) => toast(String(err), true)));
  }

  // port interactions
  div.querySelectorAll(".port").forEach((p) => {
    p.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startPortDrag(p, e);
    });
  });
}

function loadImageFile(f, node) {
  if (!f || !f.type.startsWith("image/")) return;
  const rd = new FileReader();
  rd.onload = () => {
    node.data.dataUrl = rd.result;
    node.data.name = f.name;
    const div = el.nodes.querySelector(`.node[data-id="${node.id}"]`);
    const drop = div.querySelector('[data-role="drop"]');
    drop.classList.add("has-img");
    drop.innerHTML = `<img src="${node.data.dataUrl}" alt="${esc(f.name)}">`;
    relayoutPorts(node);
    scheduleSave();
  };
  rd.readAsDataURL(f);
}

function selectNode(id) {
  state.sel = { kind: "node", id };
  el.nodes.querySelectorAll(".node").forEach((d) =>
    d.classList.toggle("selected", d.dataset.id === id));
  drawEdges();
}

function clearSelection() {
  state.sel = null;
  el.nodes.querySelectorAll(".node.selected").forEach((d) => d.classList.remove("selected"));
  drawEdges();
}

function syncLinkedHints(node) {
  if (!isModelType(node.type)) return;
  const div = el.nodes.querySelector(`.node[data-id="${node.id}"]`);
  if (!div) return;
  const linked = !!edgeInto(node.id, "prompt");
  const hint = div.querySelector('[data-role="prompt-linked"]');
  const ta = div.querySelector('textarea[data-bind="prompt"]');
  if (hint) hint.hidden = !linked;
  if (ta) ta.style.display = linked ? "none" : "";
}

// ---------------------------------------------------------------- port dragging

let tempEdge = null;

function startPortDrag(portElem, e) {
  const from = {
    node: portElem.dataset.node,
    port: portElem.dataset.port,
    dir: portElem.dataset.dir,
    dtype: portElem.dataset.dtype,
  };
  // dragging from an input that already has an edge: detach it
  if (from.dir === "in") {
    const existing = edgeInto(from.node, from.port);
    if (existing) {
      state.edges = state.edges.filter((x) => x.id !== existing.id);
      from.node = existing.from.node;
      from.port = existing.from.port;
      from.dir = "out";
    } else {
      return; // start connections from outputs
    }
  }
  const a = portWorldPos(from.node, "out", from.port);
  tempEdge = { a, b: toWorld(e.clientX, e.clientY) };
  drawEdges();
  highlightCandidates(from.dtype, true);

  const move = (ev) => {
    tempEdge.b = toWorld(ev.clientX, ev.clientY);
    drawEdges();
  };
  const up = (ev) => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    highlightCandidates(from.dtype, false);
    tempEdge = null;
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".port");
    if (target && target.dataset.dir === "in"
        && target.dataset.dtype === from.dtype
        && target.dataset.node !== from.node) {
      addEdge({ node: from.node, port: from.port },
              { node: target.dataset.node, port: target.dataset.port }, from.dtype);
    } else {
      drawEdges();
      scheduleSave();
    }
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function highlightCandidates(dtype, on) {
  el.nodes.querySelectorAll(`.port.in[data-dtype="${dtype}"]`).forEach((p) =>
    p.classList.toggle("candidate", on));
}

// ---------------------------------------------------------------- execution

function sourceValue(edge) {
  const src = byId(edge.from.node);
  if (!src) return null;
  switch (src.type) {
    case "prompt": return src.data.text?.trim() || null;
    case "image": return src.data.dataUrl || null;
    case "llm": return src.data.result?.text || null;
    case "imagegen": return src.data.result?.dataUrl || null;
    case "video": return src.data.result?.file || null;
    default: return null;
  }
}

async function resolveInput(nodeId, port, visited) {
  const e = edgeInto(nodeId, port);
  if (!e) return null;
  const src = byId(e.from.node);
  if (src && isModelType(src.type) && !sourceValue(e)) {
    await runNode(src.id, visited); // auto-run stale upstream model nodes
  }
  return sourceValue(e);
}

function setNodeStatus(node, text, isError) {
  const div = el.nodes.querySelector(`.node[data-id="${node.id}"]`);
  if (!div) return;
  const st = div.querySelector('[data-role="status"]');
  if (st) { st.textContent = text || ""; st.classList.toggle("error", !!isError); }
}

function setNodeCost(node) {
  const div = el.nodes.querySelector(`.node[data-id="${node.id}"]`);
  const c = div?.querySelector('[data-role="cost"]');
  if (c) c.textContent = node.data.cost != null ? fmt$(node.data.cost) : "";
}

function setRunningUI(node, on) {
  const div = el.nodes.querySelector(`.node[data-id="${node.id}"]`);
  if (!div) return;
  div.classList.toggle("running", on);
  const btn = div.querySelector('[data-role="run"]');
  if (btn) btn.disabled = on;
  if (on) {
    const res = div.querySelector('[data-role="result"]');
    if (res) res.innerHTML = `<div class="skeleton"></div>`;
    relayoutPorts(node);
  }
}

function renderResult(node) {
  const div = el.nodes.querySelector(`.node[data-id="${node.id}"]`);
  const res = div?.querySelector('[data-role="result"]');
  if (!res) return;
  const r = node.data.result;
  if (!r) { res.innerHTML = ""; relayoutPorts(node); setNodeCost(node); return; }
  if (node.type === "video") {
    res.innerHTML = r.file
      ? `<video src="${r.file}" controls loop></video>
         <div><button class="btn small" data-role="export">Экспорт MP4</button></div>`
      : `<div class="result-text">Демо-режим: видео сгенерировалось бы здесь.</div>`;
  } else if (node.type === "imagegen") {
    res.innerHTML = `<img src="${r.dataUrl}" alt="Результат генерации" data-role="zoom">
      <div><button class="btn small" data-role="export">Экспорт PNG</button></div>`;
  } else if (node.type === "llm") {
    res.innerHTML = `<div class="result-text">${esc(r.text)}</div>
      <div><button class="btn small" data-role="export">Копировать</button></div>`;
  }
  const exp = res.querySelector('[data-role="export"]');
  if (exp) {
    exp.addEventListener("mousedown", (e) => e.stopPropagation());
    exp.addEventListener("click", () => exportResult(node));
  }
  const zoom = res.querySelector('[data-role="zoom"]');
  if (zoom) zoom.addEventListener("click", () => openLightbox(zoom.src));
  relayoutPorts(node);
  setNodeCost(node);
}

async function exportResult(node) {
  const r = node.data.result;
  if (!r) return;
  if (node.type === "llm") {
    try { await navigator.clipboard.writeText(r.text); toast("Скопировано в буфер"); }
    catch (_) { toast("Не удалось скопировать", true); }
    return;
  }
  const args = node.type === "video"
    ? { path: r.abs, suggested: "seedance.mp4" }
    : { data_url: r.dataUrl, suggested: "image.png" };
  const out = await BACKEND.export_file(args);
  if (out.saved) toast("Сохранено: " + out.saved);
  else if (out.error) toast(out.error, true);
}

async function runNode(id, visited) {
  visited = visited || new Set();
  if (visited.has(id) || running.has(id)) return;
  visited.add(id);
  const node = byId(id);
  if (!node || !isModelType(node.type)) return;

  running.add(id);
  setRunningUI(node, true);
  setNodeStatus(node, "");
  try {
    if (node.type === "video") await runVideo(node, visited);
    else if (node.type === "imagegen") await runImageGen(node, visited);
    else await runLlm(node, visited);
  } catch (err) {
    setNodeStatus(node, String(err?.message || err), true);
    node.data.result = null;
    renderResult(node);
  } finally {
    running.delete(id);
    setRunningUI(node, false);
    scheduleSave();
  }
}

async function runVideo(node, visited) {
  const linked = await resolveInput(node.id, "prompt", visited);
  const prompt = linked || node.data.prompt?.trim();
  if (!prompt) throw new Error("Нет промта: заполни поле или подключи ноду Промт.");
  const first = await resolveInput(node.id, "first_frame", visited);
  const last = await resolveInput(node.id, "last_frame", visited);
  setNodeStatus(node, "Генерация... обычно 1-5 минут");
  const r = await BACKEND.generate_video({
    model: node.data.model,
    prompt,
    resolution: node.data.resolution,
    aspect_ratio: node.data.aspect,
    duration: Number(node.data.duration),
    generate_audio: !!node.data.audio,
    seed: node.data.seed,
    first_frame: first || null,
    last_frame: last || null,
  });
  if (r.error) throw new Error(r.error);
  node.data.result = { file: r.file, abs: r.abs_path };
  node.data.cost = r.cost || 0;
  renderResult(node);
  setNodeStatus(node, "Готово");
  registerCost(r.cost);
}

async function runImageGen(node, visited) {
  const linked = await resolveInput(node.id, "prompt", visited);
  const prompt = linked || node.data.prompt?.trim();
  if (!prompt) throw new Error("Нет промта: заполни поле или подключи ноду Промт.");
  const ref = await resolveInput(node.id, "reference", visited);
  const content = [{ type: "text", text: prompt }];
  if (ref) content.push({ type: "image_url", image_url: { url: ref } });
  setNodeStatus(node, "Генерация...");
  const r = await BACKEND.chat({
    model: node.data.model,
    messages: [{ role: "user", content }],
    modalities: ["image", "text"],
  });
  if (r.error) throw new Error(r.error);
  if (!r.images?.length) throw new Error("Модель не вернула изображение." + (r.text ? " Ответ: " + r.text.slice(0, 120) : ""));
  node.data.result = { dataUrl: r.images[0] };
  node.data.cost = r.cost || 0;
  renderResult(node);
  setNodeStatus(node, "Готово");
  registerCost(r.cost);
}

async function runLlm(node, visited) {
  const linked = await resolveInput(node.id, "prompt", visited);
  const prompt = linked || node.data.prompt?.trim();
  if (!prompt) throw new Error("Нет промта: заполни поле или подключи ноду Промт.");
  const messages = [];
  if (node.data.system?.trim()) messages.push({ role: "system", content: node.data.system.trim() });
  messages.push({ role: "user", content: prompt });
  setNodeStatus(node, "Думает...");
  const r = await BACKEND.chat({ model: node.data.model, messages });
  if (r.error) throw new Error(r.error);
  node.data.result = { text: r.text || "" };
  node.data.cost = r.cost || 0;
  renderResult(node);
  setNodeStatus(node, "Готово");
  registerCost(r.cost);
}

function topoOrder() {
  const models = state.nodes.filter((n) => isModelType(n.type)).map((n) => n.id);
  const deps = (id) => state.edges
    .filter((e) => e.to.node === id && models.includes(e.from.node))
    .map((e) => e.from.node);
  const order = [], seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    deps(id).forEach(visit);
    order.push(id);
  };
  models.forEach(visit);
  return order;
}

async function runAll() {
  const order = topoOrder();
  if (!order.length) { toast("На холсте нет нод-моделей"); return; }
  const btn = document.getElementById("btn-run-all");
  btn.disabled = true;
  try {
    for (const id of order) {
      await runNode(id, new Set());
    }
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- canvas interactions

el.canvas.addEventListener("mousedown", (e) => {
  if (e.target.closest(".node") || e.target.closest(".zoom-chip")) return;
  const hitEdge = e.target.closest?.(".edge-path");
  if (hitEdge) {
    state.sel = { kind: "edge", id: hitEdge.dataset.edge };
    el.nodes.querySelectorAll(".node.selected").forEach((d) => d.classList.remove("selected"));
    drawEdges();
    return;
  }
  clearSelection();
  if (e.button !== 0 && e.button !== 1) return;
  e.preventDefault();
  el.canvas.classList.add("panning");
  const start = { mx: e.clientX, my: e.clientY, x: state.pan.x, y: state.pan.y };
  const move = (ev) => {
    state.pan.x = start.x + ev.clientX - start.mx;
    state.pan.y = start.y + ev.clientY - start.my;
    applyView();
  };
  const up = () => {
    el.canvas.classList.remove("panning");
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    scheduleSave();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
});

el.canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 0.9);
}, { passive: false });

document.getElementById("zoom-in").addEventListener("click", () => {
  const r = el.canvas.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.15);
});
document.getElementById("zoom-out").addEventListener("click", () => {
  const r = el.canvas.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.15);
});
document.getElementById("zoom-fit").addEventListener("click", () => {
  state.zoom = 1;
  state.pan = { x: 60, y: 40 };
  applyView();
  scheduleSave();
});

window.addEventListener("keydown", (e) => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  const tag = document.activeElement?.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
  if (!state.sel) return;
  if (state.sel.kind === "node") removeNode(state.sel.id);
  else {
    state.edges = state.edges.filter((x) => x.id !== state.sel.id);
    state.sel = null;
    drawEdges();
    scheduleSave();
  }
});

// ---------------------------------------------------------------- sidebar

function buildSidebar() {
  const list = document.getElementById("node-list");
  list.innerHTML = SIDEBAR_ORDER.map((type) => {
    const t = NODE_TYPES[type];
    return `<div class="node-card" draggable="true" data-type="${type}">
      <span class="nc-dot dot-${t.dot}"></span>
      <span class="nc-text"><span class="nc-name">${t.title}</span><span class="nc-desc">${t.desc}</span></span>
    </div>`;
  }).join("");
  list.querySelectorAll(".node-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/node-type", card.dataset.type);
    });
    card.addEventListener("click", () => {
      const r = el.canvas.getBoundingClientRect();
      const p = toWorld(r.left + r.width / 2 - 160, r.top + r.height / 3);
      addNode(card.dataset.type, p.x + (Math.random() * 60 - 30), p.y + (Math.random() * 60 - 30));
    });
  });
  el.canvas.addEventListener("dragover", (e) => e.preventDefault());
  el.canvas.addEventListener("drop", (e) => {
    const type = e.dataTransfer.getData("text/node-type");
    if (!type || !NODE_TYPES[type]) return;
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    addNode(type, p.x - 160, p.y - 20);
  });
}

// ---------------------------------------------------------------- settings modal

const modal = document.getElementById("settings-modal");

function openSettings() {
  modal.hidden = false;
  document.getElementById("input-key").focus();
}

async function refreshKeyStatus() {
  const s = await BACKEND.get_settings();
  document.getElementById("key-status").textContent =
    s.has_key ? "Текущий ключ: " + s.key_preview : "Ключ не задан";
  setChip("chip-total", fmt$(s.spend_total || 0));
  return s;
}

document.getElementById("btn-settings").addEventListener("click", openSettings);
document.getElementById("btn-close-settings").addEventListener("click", () => { modal.hidden = true; });
modal.addEventListener("mousedown", (e) => { if (e.target === modal) modal.hidden = true; });

document.getElementById("btn-save-key").addEventListener("click", async () => {
  const v = document.getElementById("input-key").value.trim();
  if (!v) { toast("Введи ключ", true); return; }
  await BACKEND.save_key(v);
  document.getElementById("input-key").value = "";
  await refreshKeyStatus();
  refreshBalance();
  toast("Ключ сохранён");
  modal.hidden = true;
});

// lightbox
const lightbox = document.getElementById("lightbox");
function openLightbox(src) {
  document.getElementById("lightbox-img").src = src;
  lightbox.hidden = false;
}
lightbox.addEventListener("click", () => { lightbox.hidden = true; });

// window controls
document.getElementById("win-min").addEventListener("click", () => BACKEND.win_minimize());
document.getElementById("win-max").addEventListener("click", () => BACKEND.win_toggle_max());
document.getElementById("win-close").addEventListener("click", () => BACKEND.win_close());
document.getElementById("btn-run-all").addEventListener("click", () => runAll());

// ---------------------------------------------------------------- boot

function defaultGraph() {
  const p = addNode("prompt", 80, 140);
  p.data.text = "Кинематографичный пролёт камеры над ночным городом под дождём, неон отражается в мокром асфальте";
  const pDiv = el.nodes.querySelector(`.node[data-id="${p.id}"] textarea`);
  if (pDiv) pDiv.value = p.data.text;
  const img = addNode("image", 80, 420);
  const vid = addNode("video", 520, 160);
  addEdge({ node: p.id, port: "text" }, { node: vid.id, port: "prompt" }, "text");
  addEdge({ node: img.id, port: "image" }, { node: vid.id, port: "first_frame" }, "image");
  addNode("imagegen", 520, 640);
}

async function boot() {
  buildSidebar();
  applyView();
  await backendReady;
  if (MOCK) toast("Браузерный предпросмотр: бэкенд не подключён, генерации демо");

  // live-модели Seedance
  try {
    const live = await BACKEND.video_models();
    if (Array.isArray(live) && live.length) VIDEO_MODELS = live;
  } catch (_) {}

  if (restore()) {
    state.nodes.forEach(renderNode);
    drawEdges();
    applyView();
  } else {
    defaultGraph();
  }

  const s = await refreshKeyStatus();
  refreshBalance();
  if (!s.has_key) {
    toast("Добавь ключ OpenRouter в настройках", true);
    openSettings();
  }
}

boot();
