/* Metro board, legacy version.
 * Plain ES5 for old browsers (Kindle Fire 1st gen, Android 2.3 WebKit):
 * no let/const, no arrow functions, no fetch, no classList, no template strings.
 * Talks to the same Worker API as the main board:
 *   GET /api/stations
 *   GET /api/predictions?codes=A01,C01
 */
(function () {
  "use strict";

  var ROWS = 8;
  var DEST_LEN = 18;
  var TITLE_LEN = 24;
  var REFRESH_MS = 20000;
  var DEFAULT_STATION = "A01";
  var CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/.'";

  function $(id) { return document.getElementById(id); }

  // ---------- small helpers ----------
  function query(name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(location.search);
    if (!m) return null;
    try { return decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (e) { return m[1]; }
  }
  function storeGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  // Keep only characters the board can show; anything else becomes a blank.
  function clean(s) {
    s = String(s == null ? "" : s).toUpperCase();
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      out += CHARS.indexOf(c) >= 0 ? c : " ";
    }
    return out;
  }
  // Cut or pad text to exactly len characters.
  function fit(s, len, right) {
    s = clean(s).substring(0, len);
    while (s.length < len) s = right ? " " + s : s + " ";
    return s;
  }
  function centerDigit(c) { return " " + c + " "; }

  // ---------- flap style: static tiles ----------
  function makeCell() {
    var el = document.createElement("div");
    el.className = "cell";
    var span = document.createElement("span");
    span.appendChild(document.createTextNode(" "));
    var shade = document.createElement("b");
    var hinge = document.createElement("i");
    el.appendChild(span);
    el.appendChild(shade);
    el.appendChild(hinge);
    return { el: el, span: span, ch: " " };
  }

  function makeGroup(len, right) {
    var el = document.createElement("div");
    el.className = "group";
    var cells = [];
    for (var i = 0; i < len; i++) {
      var c = makeCell();
      cells.push(c);
      el.appendChild(c.el);
    }
    return {
      el: el,
      set: function (text) {
        var t = fit(text, len, right);
        for (var i = 0; i < len; i++) {
          var ch = t.charAt(i);
          if (cells[i].ch !== ch) {
            cells[i].ch = ch;
            cells[i].span.firstChild.nodeValue = ch;
          }
        }
      }
    };
  }

  var flapBoard = $("flapBoard");
  var ledBoard = $("ledBoard");

  var titleGroup = makeGroup(TITLE_LEN, false);
  $("flapTitle").appendChild(titleGroup.el);

  var flapRows = [];
  (function () {
    var holder = $("flapRows");
    for (var i = 0; i < ROWS; i++) {
      var row = document.createElement("div");
      row.className = "row";
      var r = { ln: makeGroup(2, false), car: makeGroup(1, true), dest: makeGroup(DEST_LEN, false), min: makeGroup(3, true) };
      row.appendChild(r.ln.el);
      row.appendChild(r.car.el);
      row.appendChild(r.dest.el);
      row.appendChild(r.min.el);
      holder.appendChild(row);
      flapRows.push(r);
    }
  })();

  // ---------- LED style: coloured monospace text ----------
  // One text line is: LN(2) space CAR(3) space DEST(18) space MIN(3)
  function span(cls, text) {
    var s = document.createElement("span");
    s.className = cls;
    s.appendChild(document.createTextNode(text));
    return s;
  }
  function setSpan(s, cls, text) {
    s.className = cls;
    s.firstChild.nodeValue = text;
  }

  var ledTitle = document.createElement("div");
  ledTitle.appendChild(span("am", ""));
  ledBoard.appendChild(ledTitle);

  var ledHead = document.createElement("div");
  ledHead.appendChild(span("hd", "LN " + "CAR " + fit("DEST", DEST_LEN) + " " + "MIN"));
  ledBoard.appendChild(ledHead);

  var gapEl = document.createElement("div");
  gapEl.className = "gap";
  ledBoard.appendChild(gapEl);

  var ledRows = [];
  (function () {
    for (var i = 0; i < ROWS; i++) {
      var d = document.createElement("div");
      var r = { ln: span("am", ""), car: span("cy", ""), dest: span("am", ""), min: span("am", "") };
      d.appendChild(r.ln);
      d.appendChild(r.car);
      d.appendChild(r.dest);
      d.appendChild(r.min);
      ledBoard.appendChild(d);
      ledRows.push(r);
    }
  })();

  // ---------- state ----------
  var els = { select: $("station"), style: $("style"), status: $("status") };
  var state = {
    stations: [], station: null, updatedAt: 0, loaded: false,
    token: 0, timer: null, retryTimer: null, note: "", noteClass: ""
  };
  var view = { title: "", trains: [], message: "", mode: "flap" };

  function render() {
    titleGroup.set(view.title);
    setSpan(ledTitle.firstChild, "am", clean(view.title));

    for (var i = 0; i < ROWS; i++) {
      var t = view.trains[i];
      var f = flapRows[i], l = ledRows[i];
      if (t) {
        var known = /^[A-Z]{2}$/.test(t.line) && t.line !== "--";
        var car = /^\d$/.test(t.cars) ? t.cars : "-";
        f.ln.el.className = "group" + (known ? " ln-" + t.line : "");
        f.ln.set(known ? t.line : "");
        f.car.set(car);
        f.dest.set(t.dest);
        f.min.set(t.min);

        setSpan(l.ln, known ? "l-" + t.line : "am", fit(known ? t.line : "", 2) + " ");
        setSpan(l.car, car === "8" ? "cg" : "cy", centerDigit(car) + " ");
        setSpan(l.dest, "am", fit(t.dest, DEST_LEN) + " ");
        setSpan(l.min, "am", fit(t.min, 3, true));
      } else {
        var msg = (i === 0 && view.trains.length === 0) ? (view.message || "NO TRAINS") : "";
        f.ln.el.className = "group";
        f.ln.set("");
        f.car.set("");
        f.dest.set(msg);
        f.min.set("");

        setSpan(l.ln, "am", "   ");
        setSpan(l.car, "cy", "    ");
        setSpan(l.dest, "am", fit(msg, DEST_LEN) + " ");
        setSpan(l.min, "am", "   ");
      }
    }
  }

  function setTitle(text) { view.title = text; render(); }
  function showTrains(trains) { view.trains = trains; view.message = ""; render(); }
  function showMessage(text) { view.trains = []; view.message = text; render(); }

  function setStatus() {
    if (window.legacyFatal) {
      els.status.className = "status err";
      els.status.textContent = window.legacyFatal;
      return;
    }
    var text = "";
    var cls = "";
    var secs = state.updatedAt ? Math.max(0, Math.round((new Date().getTime() - state.updatedAt) / 1000)) : 0;
    if (state.note) { text = state.note; cls = state.noteClass; }
    else if (state.updatedAt) { text = "Updated " + secs + "s ago - Data: WMATA"; }
    if (state.note && state.updatedAt) text += " - showing data from " + secs + "s ago";
    els.status.textContent = text;
    els.status.className = "status " + cls;
  }

  // ---------- data ----------
  function getJSON(url, ms, cb) {
    var done = false;
    var xhr = new XMLHttpRequest();
    var to = setTimeout(function () {
      if (done) return;
      done = true;
      try { xhr.abort(); } catch (e) {}
      cb(new Error("timed out"));
    }, ms);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || done) return;
      done = true;
      clearTimeout(to);
      var body = null;
      try { body = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300 && body) cb(null, body);
      else cb(new Error((body && body.error) || (xhr.status ? "HTTP " + xhr.status : "no connection")));
    };
    xhr.open("GET", url, true);
    xhr.send(null);
  }

  function refresh() {
    var st = state.station;
    if (!st) return;
    var token = ++state.token;
    getJSON("/api/predictions?codes=" + st.codes.join(",") + "&_=" + new Date().getTime(), 10000, function (err, data) {
      if (token !== state.token) return; // user switched station meanwhile
      if (err) {
        state.noteClass = "err";
        if (state.loaded) {
          state.note = "Connection problem";
        } else {
          state.note = "Could not load trains: " + err.message + " - retrying...";
          showMessage("CONNECTING");
          clearTimeout(state.retryTimer);
          state.retryTimer = setTimeout(refresh, 4000);
        }
      } else {
        if (data.closed) {
          showMessage("METRO IS CLOSED");
          state.loaded = true;
          state.updatedAt = 0;
          state.note = "Metro is closed - reopens " + data.reopens;
          state.noteClass = "";
        } else {
          showTrains(data.trains || []);
          state.loaded = true;
          state.updatedAt = data.updatedAt;
          state.note = data.stale ? "WMATA is not responding" : "";
          state.noteClass = data.stale ? "warn" : "";
        }
      }
      setStatus();
    });
  }

  function findByCode(code) {
    code = String(code || "").toUpperCase();
    for (var i = 0; i < state.stations.length; i++) {
      var s = state.stations[i];
      for (var j = 0; j < s.codes.length; j++) {
        if (s.codes[j] === code) return s;
      }
    }
    return null;
  }

  function isKiosk() { return document.body.className.indexOf("kiosk") >= 0; }

  function replaceUrl(station, style) {
    try {
      if (window.history && window.history.replaceState) {
        var extra = isKiosk() ? "&kiosk=1" : "";
        window.history.replaceState(null, "", "?station=" + encodeURIComponent(station) + "&style=" + style + extra);
      }
    } catch (e) {}
  }

  function selectStation(st) {
    state.station = st;
    state.loaded = false;
    state.updatedAt = 0;
    for (var i = 0; i < els.select.options.length; i++) {
      if (els.select.options[i].value === st.id) { els.select.selectedIndex = i; break; }
    }
    setTitle(st.name);
    storeSet("metro-legacy-station", st.id);
    replaceUrl(st.id, view.mode);
    document.title = st.name + " - Metro Board";
    state.note = "Loading...";
    state.noteClass = "";
    setStatus();
    clearTimeout(state.retryTimer);
    clearInterval(state.timer);
    refresh();
    state.timer = setInterval(refresh, REFRESH_MS);
  }

  function populateSelect() {
    els.select.innerHTML = "";
    for (var i = 0; i < state.stations.length; i++) {
      var s = state.stations[i];
      var o = document.createElement("option");
      o.value = s.id;
      o.appendChild(document.createTextNode(s.name + "  (" + s.lines.join(" ") + ")"));
      els.select.appendChild(o);
    }
  }

  // Measure the board at a known size, then scale the text so the board
  // fills the available width or height, whichever runs out first.
  function fitBoard(el, availW, availH, fallback) {
    el.style.fontSize = "100px";
    var w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) { el.style.fontSize = fallback + "px"; return; } // hidden: cannot measure
    var size = Math.floor(100 * Math.min(availW / w, availH / h) * 0.98);
    el.style.fontSize = Math.max(6, size) + "px";
  }

  // ---------- style switch and sizing ----------
  function layout() {
    var w = window.innerWidth || document.documentElement.clientWidth || 600;
    var h = window.innerHeight || document.documentElement.clientHeight || 400;
    var kiosk = document.body.className.indexOf("kiosk") >= 0;
    var availW = Math.max(200, w - 16);
    var availH = Math.max(150, h - (kiosk ? 20 : 96));
    // Rough sizes (used only if a board is hidden and cannot be measured).
    var cw = Math.max(6, Math.floor(Math.min(availW / 30, availH / 18)));
    var fs = Math.max(8, Math.floor(Math.min(availW / 19.2, availH / 12)));
    fitBoard(flapBoard, availW, availH, cw);
    fitBoard(ledBoard, availW, availH, fs);
  }

  function applyStyle(mode) {
    view.mode = mode === "led" ? "led" : "flap";
    flapBoard.style.display = view.mode === "led" ? "none" : "inline-block";
    ledBoard.style.display = view.mode === "led" ? "inline-block" : "none";
    for (var i = 0; i < els.style.options.length; i++) {
      if (els.style.options[i].value === view.mode) { els.style.selectedIndex = i; break; }
    }
    storeSet("metro-legacy-style", view.mode);
    if (state.station) replaceUrl(state.station.id, view.mode);
    layout();
  }

  els.select.onchange = function () {
    var st = findByCode(els.select.value);
    if (st) selectStation(st);
  };
  els.style.onchange = function () { applyStyle(els.style.value); };

  // ---------- kiosk mode ----------
  // Kiosk hides the controls. Tapping the screen shows an "Exit kiosk" button for a few seconds.
  var KIOSK_MENU_MS = 6000;
  var exitBtn = $("exitKiosk");
  var kioskTimer = 0;

  function hideExit() { exitBtn.className = ""; }
  function showExit() {
    exitBtn.className = "show";
    clearTimeout(kioskTimer);
    kioskTimer = setTimeout(hideExit, KIOSK_MENU_MS);
  }
  function setKiosk(on) {
    document.body.className = on ? "kiosk" : "";
    clearTimeout(kioskTimer);
    hideExit();
    if (state.station) replaceUrl(state.station.id, view.mode);
    layout(); // use the room the controls took up
  }
  function stopBubble(e) {
    e = e || window.event;
    if (e.stopPropagation) e.stopPropagation(); else e.cancelBubble = true;
  }
  $("kiosk").onclick = function (e) { stopBubble(e); setKiosk(true); };
  exitBtn.onclick = function (e) { stopBubble(e); setKiosk(false); };
  function onTap() { if (isKiosk()) showExit(); }
  document.onclick = onTap;
  document.ontouchstart = onTap;

  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 150);
  }
  window.onresize = onResize;
  window.onorientationchange = onResize;

  // ---------- go ----------
  if (query("kiosk") === "1") document.body.className = "kiosk";
  applyStyle(query("style") || storeGet("metro-legacy-style") || "flap");
  render();

  setInterval(setStatus, 1000);

  // The first request after a deploy can be slow, so wait longer and keep retrying.
  function start(attempt) {
    getJSON("/api/stations", 25000, function (err, data) {
      if (err) {
        var wait = Math.min(3 + attempt * 2, 15);
        state.note = "Could not load stations: " + err.message + " - retrying in " + wait + "s";
        state.noteClass = "err";
        setStatus();
        if (attempt === 0) showMessage("CONNECTING");
        setTimeout(function () { start(attempt + 1); }, wait * 1000);
        return;
      }
      state.stations = data.stations || [];
      populateSelect();
      var code = query("station") || storeGet("metro-legacy-station");
      selectStation(findByCode(code) || findByCode(DEFAULT_STATION) || state.stations[0]);
    });
  }
  start(0);
})();
