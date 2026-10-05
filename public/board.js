(() => {
  "use strict";

  // ---------- configuration ----------
  const CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/.'";
  // ms per flap flip. The single source of truth is --dur in style.css; we read it here.
  const cssDur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur"));
  const DUR = cssDur > 0 ? cssDur : 35; // fallback if the CSS value is missing or unreadable
  const ROWS = 8;            // trains shown
  const DEST_LEN = 18;
  const TITLE_LEN = 24;
  const REFRESH_MS = 20000;  // how often to ask for fresh predictions
  const DEFAULT_STATION = "A01"; // Metro Center, used the very first time
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const params = new URLSearchParams(location.search);
  if (params.get("kiosk") === "1") document.body.classList.add("kiosk");

  // ---------- split-flap cell ----------
  function makeCell() {
    const el = document.createElement("div");
    el.className = "cell";
    el.innerHTML =
      '<div class="top"><span> </span></div><div class="bottom"><span> </span></div>' +
      '<div class="ft"><span> </span></div><div class="fb"><span> </span></div>';
    const q = (s) => el.querySelector(s + " span");
    return {
      el, top: q(".top"), bottom: q(".bottom"), ft: q(".ft"), fb: q(".fb"),
      cur: " ", target: " ", busy: false,
    };
  }

  function showStatic(cell, ch) {
    cell.cur = ch;
    cell.top.textContent = ch;
    cell.bottom.textContent = ch;
  }

  function step(cell) {
    if (cell.cur === cell.target) { cell.busy = false; return; }
    const from = cell.cur;
    const to = CHARS[(CHARS.indexOf(from) + 1) % CHARS.length];
    cell.top.textContent = to;      // new top half, revealed as the flap falls
    cell.bottom.textContent = from; // old bottom half, covered as the flap lands
    cell.ft.textContent = from;
    cell.fb.textContent = to;
    cell.el.classList.remove("flipping");
    void cell.el.offsetWidth;       // restart the CSS animation
    cell.el.classList.add("flipping");
    setTimeout(() => {
      cell.bottom.textContent = to;
      cell.cur = to;
      cell.el.classList.remove("flipping");
      step(cell);
    }, DUR);
  }

  function setCell(cell, ch, delay) {
    if (!CHARS.includes(ch)) ch = " ";
    cell.target = ch;
    if (cell.busy || cell.cur === ch) return;
    if (reduced) { showStatic(cell, ch); return; }
    cell.busy = true;
    setTimeout(() => step(cell), delay || 0);
  }

  // ---------- groups of cells ----------
  function makeGroup(len, align) {
    const el = document.createElement("div");
    el.className = "group";
    const cells = Array.from({ length: len }, makeCell);
    cells.forEach((c) => el.appendChild(c.el));
    return {
      el, cells,
      set(text, stagger) {
        let t = String(text || "").toUpperCase().slice(0, len);
        t = align === "right" ? t.padStart(len, " ") : t.padEnd(len, " ");
        cells.forEach((c, i) => setCell(c, t[i], i * (stagger || 18)));
      },
    };
  }

  const titleGroup = makeGroup(TITLE_LEN, "left");
  document.getElementById("title").appendChild(titleGroup.el);

  const rowsEl = document.getElementById("rows");
  const rows = Array.from({ length: ROWS }, () => {
    const row = document.createElement("div");
    row.className = "row";
    const ln = makeGroup(2, "left");
    const car = makeGroup(1, "right");
    const dest = makeGroup(DEST_LEN, "left");
    const min = makeGroup(3, "right");
    [ln, car, dest, min].forEach((g) => row.appendChild(g.el));
    rowsEl.appendChild(row);
    return { ln, car, dest, min };
  });

  // ---------- display style: flaps (default) or LED dots ----------
  const root = document.documentElement;
  const led = window.LedBoard.create(document.getElementById("led"), { rows: ROWS });
  const view = {
    mode: root.classList.contains("style-led") ? "led" : "flap",
    title: "", trains: [], message: "",
    ready: false, // true once there is something real to show
  };

  // Everything that changes the board goes through these three functions,
  // so both styles always show the same data.
  function setTitle(text) {
    view.title = text;
    if (view.mode === "led") led.set({ title: text });
    else titleGroup.set(text, 14);
  }

  function showTrains(trains) {
    view.trains = trains;
    view.message = "";
    view.ready = true;
    if (view.mode === "led") led.set({ trains, message: "" });
    else renderTrains(trains);
  }

  function showMessage(text) {
    view.trains = [];
    view.message = text;
    view.ready = true;
    if (view.mode === "led") led.set({ trains: [], message: text });
    else showMessageRow(text);
  }

  // ---------- state ----------
  const els = {
    select: document.getElementById("station"),
    style: document.getElementById("style"),
    status: document.getElementById("status"),
    controls: document.getElementById("controls"),
  };
  els.style.value = view.mode;
  const state = { stations: [], station: null, updatedAt: 0, loaded: false, token: 0, timer: null, note: "", noteClass: "" };

  function renderTrains(trains) {
    rows.forEach((r, i) => {
      const t = trains[i];
      if (t) {
        const lineKnown = /^[A-Z]{2}$/.test(t.line) && t.line !== "--";
        r.ln.el.className = "group" + (lineKnown ? " ln-" + t.line : "");
        r.ln.set(lineKnown ? t.line : "", 10);
        r.car.set(/^\d$/.test(t.cars) ? t.cars : "-", 10);
        r.dest.set(t.dest, 14);
        r.min.set(t.min, 14);
      } else {
        r.ln.el.className = "group";
        r.ln.set("", 6);
        r.car.set("", 6);
        r.dest.set(i === 0 && trains.length === 0 ? "NO TRAINS" : "", 10);
        r.min.set("", 6);
      }
    });
  }

  function showMessageRow(text) {
    renderTrains([]);
    rows[0].dest.set(text, 14);
  }

  function setStatus() {
    let text = "";
    let cls = "";
    if (state.note) { text = state.note; cls = state.noteClass; }
    else if (state.updatedAt) {
      const s = Math.max(0, Math.round((Date.now() - state.updatedAt) / 1000));
      text = `Updated ${s}s ago · Data: WMATA`;
    }
    if (state.note && state.updatedAt) {
      const s = Math.max(0, Math.round((Date.now() - state.updatedAt) / 1000));
      text += ` · showing data from ${s}s ago`;
    }
    els.status.textContent = text;
    els.status.className = "status " + cls;
  }

  // ---------- data ----------
  async function getJSON(url, ms = 10000) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return body;
    } finally { clearTimeout(to); }
  }

  async function refresh() {
    const st = state.station;
    if (!st) return;
    const token = ++state.token;
    try {
      const data = await getJSON("/api/predictions?codes=" + st.codes.join(","));
      if (token !== state.token) return; // user switched station meanwhile
      showTrains(data.trains);
      state.loaded = true;
      state.updatedAt = data.updatedAt;
      state.note = data.stale ? "WMATA is not responding" : "";
      state.noteClass = data.stale ? "warn" : "";
    } catch (err) {
      if (token !== state.token) return;
      state.noteClass = "err";
      if (state.loaded) {
        state.note = "Connection problem";
      } else {
        // Nothing has loaded yet: retry soon instead of waiting for the next 20s refresh.
        state.note = "Could not load trains: " + err.message + " · retrying…";
        showMessage("CONNECTING");
        clearTimeout(state.retryTimer);
        state.retryTimer = setTimeout(refresh, 4000);
      }
    }
    setStatus();
  }

  function selectStation(st, { push = true } = {}) {
    state.station = st;
    state.loaded = false;
    state.updatedAt = 0;
    state.note = "";
    els.select.value = st.id;
    setTitle(st.name.replace(/[^A-Za-z0-9\-/.' ]/g, " "));
    if (push) {
      const p = new URLSearchParams(location.search);
      p.set("station", st.id);
      history.replaceState(null, "", "?" + p.toString());
      try { localStorage.setItem("metro-board-station", st.id); } catch (_) {}
    }
    document.title = st.name + " · Metro Board";
    state.note = "Loading…";
    state.noteClass = "";
    setStatus();
    clearTimeout(state.retryTimer);
    clearInterval(state.timer);
    refresh();
    state.timer = setInterval(refresh, REFRESH_MS);
  }

  function findByCode(code) {
    code = String(code || "").toUpperCase();
    return state.stations.find((s) => s.codes.includes(code));
  }

  function initialStation() {
    let code = params.get("station");
    if (!code) { try { code = localStorage.getItem("metro-board-station"); } catch (_) {} }
    return findByCode(code) || findByCode(DEFAULT_STATION) || state.stations[0];
  }

  // ---------- controls ----------
  function populateSelect() {
    els.select.innerHTML = "";
    for (const s of state.stations) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name + "  (" + s.lines.join(" ") + ")";
      els.select.appendChild(o);
    }
  }

  els.select.addEventListener("change", () => {
    const st = findByCode(els.select.value);
    if (st) selectStation(st);
  });

  function applyStyle(mode) {
    view.mode = mode === "led" ? "led" : "flap";
    root.classList.toggle("style-led", view.mode === "led");
    root.classList.toggle("style-flap", view.mode !== "led");
    els.style.value = view.mode;
    // Bring the newly shown style up to date with what is currently known.
    if (view.mode === "led") {
      led.resize();
      led.set({ title: view.title, trains: view.trains, message: view.message });
    } else {
      titleGroup.set(view.title, 14);
      if (view.ready) {
        if (view.message) showMessageRow(view.message);
        else renderTrains(view.trains);
      }
    }
    // Remember the choice in the URL and in this browser.
    const p = new URLSearchParams(location.search);
    p.set("style", view.mode);
    history.replaceState(null, "", "?" + p.toString());
    try { localStorage.setItem("metro-board-style", view.mode); } catch (_) {}
  }

  els.style.addEventListener("change", () => applyStyle(els.style.value));

  document.getElementById("fullscreen").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  });

  document.getElementById("nearest").addEventListener("click", () => {
    if (!navigator.geolocation) { alert("Location is not available in this browser."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: la, longitude: lo } = pos.coords;
        const rad = (d) => (d * Math.PI) / 180;
        const dist = (s) => {
          const dLat = rad(s.lat - la), dLon = rad(s.lon - lo);
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(la)) * Math.cos(rad(s.lat)) * Math.sin(dLon / 2) ** 2;
          return 2 * Math.asin(Math.sqrt(a));
        };
        const best = state.stations.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
        selectStation(best);
      },
      () => alert("Could not get your location."),
      { timeout: 8000 }
    );
  });

  // hide the controls when idle (handy for a wall display)
  let idleTimer;
  function wake() {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add("idle"), 6000);
  }
  ["mousemove", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, wake, { passive: true }));
  wake();

  setInterval(setStatus, 1000);
  // refresh right away when the tab/screen wakes up
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

  // ---------- go ----------
  // The first request after a deploy can be slow (the Worker has to fetch the
  // station list from WMATA), so wait longer and keep retrying until it works.
  async function start(attempt) {
    try {
      const data = await getJSON("/api/stations", 25000);
      state.stations = data.stations;
      populateSelect();
      selectStation(initialStation());
    } catch (err) {
      const wait = Math.min(3 + attempt * 2, 15); // 3s, 5s, 7s ... capped at 15s
      state.note = `Could not load stations: ${err.message} · retrying in ${wait}s`;
      state.noteClass = "err";
      setStatus();
      if (attempt === 0) showMessage("CONNECTING");
      setTimeout(() => start(attempt + 1), wait * 1000);
    }
  }
  start(0);
})();
