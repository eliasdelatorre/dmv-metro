/* LED dot-matrix board, drawn on a <canvas>.
 *
 * Exposes window.LedBoard.create(canvas, { rows }) which returns
 *   { set({ title, trains, message }), resize() }
 *
 * Every character is a grid of 10 x 14 dots. Change COLORS below to restyle the board.
 */
(() => {
  "use strict";

  // ---------- colours ----------
  const COLORS = {
    header:    "#ff2a1d", // column labels (red, like the real boards)
    title:     "#ffae00", // station name
    dest:      "#ffae00", // destination
    min:       "#ffae00", // minutes
    carYellow: "#ffe21a", // car count
    carGreen:  "#27ff4f", // car count when it is 8
    RD: "#ff2d2d", BL: "#2f6bff", OR: "#ff7a00", YL: "#ffd60a", GR: "#1fe060", SV: "#cfd6e2", // lines
    fallback:  "#ffae00", // unknown line
  };

  // ---------- glow ----------
  // How strongly the lit dots glow. Change GLOW_PRESET to one of the names below, or try a
  // preset without editing anything by adding ?glow=night (for example) to the page address.
  //   off       the original, light glow
  //   soft      a gentle halo
  //   balanced  a halo that keeps the dots clearly separate (default)
  //   strong    a wider halo
  //   night     the strongest, like a lit sign at night
  const GLOW_PRESET = "soft";

  // radius: size of each dot's own glow, in dot spacings. a0 / a1: how bright that glow is
  // near the dot / further out. hot: how white the centre of each dot is.
  // bloom: wide, soft halos around the letters (factor = how blurry, bigger is wider;
  // alpha = how strong, 0 to 1). behind: draw the halo behind the dots, which keeps each colour true.
  const GLOW_PRESETS = {
    off:      { radius: 2.8, a0: 0.34,   a1: 0.10,  hot: 0.5,    behind: false, bloom: [] },
    soft:     { radius: 3.0, a0: 0.40,   a1: 0.14,  hot: 0.5,    behind: true,
                bloom: [{ factor: 8, alpha: 0.9 }] },
    balanced: { radius: 3.1, a0: 0.4125, a1: 0.145, hot: 0.5125, behind: true,
                bloom: [{ factor: 7.5, alpha: 0.875 }, { factor: 18, alpha: 0.325 }] },
    strong:   { radius: 3.2, a0: 0.425,  a1: 0.15,  hot: 0.525,  behind: true,
                bloom: [{ factor: 7, alpha: 0.85 }, { factor: 18, alpha: 0.65 }] },
    night:    { radius: 3.4, a0: 0.45,   a1: 0.16,  hot: 0.55,   behind: true,
                bloom: [{ factor: 6, alpha: 0.8 }, { factor: 18, alpha: 1 }] },
  };
  const glowName = new URLSearchParams(location.search).get("glow") || GLOW_PRESET;
  const GL = GLOW_PRESETS[glowName] || GLOW_PRESETS.balanced;

  // ---------- font: 10 x 14 dots per character ----------
  // Each character is 14 numbers (one per row). In each number, the 10 low bits are the
  // dots of that row, with the leftmost dot in bit 9 (0x200) and the rightmost in bit 0.
  const CW = 10, CH = 14;
  const GLYPHS = {
    "A": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x186, 0x1fe, 0x1fe, 0x186, 0x186, 0x186, 0x186, 0x186, 0x000],
    "B": [0x000, 0x000, 0x1f8, 0x1fc, 0x186, 0x186, 0x1fc, 0x1fc, 0x186, 0x186, 0x186, 0x1fc, 0x1f8, 0x000],
    "C": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x180, 0x180, 0x180, 0x180, 0x180, 0x186, 0x0fc, 0x078, 0x000],
    "D": [0x000, 0x000, 0x1f0, 0x1f8, 0x18c, 0x186, 0x186, 0x186, 0x186, 0x186, 0x18c, 0x1f8, 0x1f0, 0x000],
    "E": [0x000, 0x000, 0x1fe, 0x1fe, 0x180, 0x180, 0x1f8, 0x1f8, 0x180, 0x180, 0x180, 0x1fe, 0x1fe, 0x000],
    "F": [0x000, 0x000, 0x1fe, 0x1fe, 0x180, 0x180, 0x1f8, 0x1f8, 0x180, 0x180, 0x180, 0x180, 0x180, 0x000],
    "G": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x180, 0x180, 0x19e, 0x19e, 0x186, 0x186, 0x0fc, 0x078, 0x000],
    "H": [0x000, 0x000, 0x186, 0x186, 0x186, 0x186, 0x1fe, 0x1fe, 0x186, 0x186, 0x186, 0x186, 0x186, 0x000],
    "I": [0x000, 0x000, 0x0fc, 0x0fc, 0x030, 0x030, 0x030, 0x030, 0x030, 0x030, 0x030, 0x0fc, 0x0fc, 0x000],
    "J": [0x000, 0x000, 0x01e, 0x01e, 0x00c, 0x00c, 0x00c, 0x00c, 0x00c, 0x18c, 0x18c, 0x0fc, 0x078, 0x000],
    "K": [0x000, 0x000, 0x186, 0x18c, 0x198, 0x1b0, 0x1e0, 0x1e0, 0x1b0, 0x198, 0x18c, 0x186, 0x186, 0x000],
    "L": [0x000, 0x000, 0x180, 0x180, 0x180, 0x180, 0x180, 0x180, 0x180, 0x180, 0x180, 0x1fe, 0x1fe, 0x000],
    "M": [0x000, 0x000, 0x186, 0x1ce, 0x1fe, 0x1b6, 0x1b6, 0x186, 0x186, 0x186, 0x186, 0x186, 0x186, 0x000],
    "N": [0x000, 0x000, 0x1c6, 0x1c6, 0x1e6, 0x1e6, 0x1b6, 0x1b6, 0x19e, 0x19e, 0x18e, 0x18e, 0x186, 0x000],
    "O": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x186, 0x186, 0x186, 0x186, 0x186, 0x186, 0x0fc, 0x078, 0x000],
    "P": [0x000, 0x000, 0x1f8, 0x1fc, 0x186, 0x186, 0x1fc, 0x1f8, 0x180, 0x180, 0x180, 0x180, 0x180, 0x000],
    "Q": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x186, 0x186, 0x186, 0x186, 0x196, 0x18e, 0x0fc, 0x07a, 0x000],
    "R": [0x000, 0x000, 0x1f8, 0x1fc, 0x186, 0x186, 0x1fc, 0x1f8, 0x1b0, 0x198, 0x18c, 0x186, 0x186, 0x000],
    "S": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x180, 0x0f8, 0x07c, 0x006, 0x006, 0x186, 0x0fc, 0x078, 0x000],
    "T": [0x000, 0x000, 0x1fe, 0x1fe, 0x030, 0x030, 0x030, 0x030, 0x030, 0x030, 0x030, 0x030, 0x030, 0x000],
    "U": [0x000, 0x000, 0x186, 0x186, 0x186, 0x186, 0x186, 0x186, 0x186, 0x186, 0x186, 0x0fc, 0x078, 0x000],
    "V": [0x000, 0x000, 0x186, 0x186, 0x186, 0x186, 0x186, 0x0cc, 0x0cc, 0x0cc, 0x078, 0x078, 0x030, 0x000],
    "W": [0x000, 0x000, 0x186, 0x186, 0x186, 0x186, 0x186, 0x1b6, 0x1b6, 0x1fe, 0x1fe, 0x0cc, 0x0cc, 0x000],
    "X": [0x000, 0x000, 0x186, 0x186, 0x0cc, 0x0cc, 0x078, 0x030, 0x078, 0x0cc, 0x0cc, 0x186, 0x186, 0x000],
    "Y": [0x000, 0x000, 0x186, 0x186, 0x0cc, 0x0cc, 0x078, 0x030, 0x030, 0x030, 0x030, 0x030, 0x030, 0x000],
    "Z": [0x000, 0x000, 0x1fe, 0x1fe, 0x00c, 0x018, 0x018, 0x030, 0x060, 0x060, 0x0c0, 0x1fe, 0x1fe, 0x000],
    "0": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x186, 0x186, 0x186, 0x186, 0x186, 0x186, 0x0fc, 0x078, 0x000],
    "1": [0x000, 0x000, 0x030, 0x070, 0x0f0, 0x030, 0x030, 0x030, 0x030, 0x030, 0x030, 0x0fc, 0x0fc, 0x000],
    "2": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x006, 0x00c, 0x018, 0x030, 0x060, 0x0c0, 0x1fe, 0x1fe, 0x000],
    "3": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x006, 0x03c, 0x03c, 0x006, 0x006, 0x186, 0x0fc, 0x078, 0x000],
    "4": [0x000, 0x000, 0x018, 0x038, 0x078, 0x0d8, 0x198, 0x1fe, 0x1fe, 0x018, 0x018, 0x018, 0x018, 0x000],
    "5": [0x000, 0x000, 0x1fe, 0x1fe, 0x180, 0x180, 0x1f8, 0x1fc, 0x006, 0x006, 0x186, 0x0fc, 0x078, 0x000],
    "6": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x180, 0x1f8, 0x1fc, 0x186, 0x186, 0x186, 0x0fc, 0x078, 0x000],
    "7": [0x000, 0x000, 0x1fe, 0x1fe, 0x006, 0x00c, 0x00c, 0x018, 0x018, 0x030, 0x030, 0x030, 0x030, 0x000],
    "8": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x186, 0x0fc, 0x0fc, 0x186, 0x186, 0x186, 0x0fc, 0x078, 0x000],
    "9": [0x000, 0x000, 0x078, 0x0fc, 0x186, 0x186, 0x186, 0x0fe, 0x07e, 0x006, 0x186, 0x0fc, 0x078, 0x000],
    "-": [0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x0fc, 0x0fc, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000],
    "/": [0x000, 0x000, 0x006, 0x006, 0x00c, 0x00c, 0x018, 0x030, 0x060, 0x060, 0x0c0, 0x180, 0x180, 0x000],
    ".": [0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x030, 0x030, 0x000],
    "'": [0x000, 0x000, 0x030, 0x030, 0x030, 0x060, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000],
  };

  // ---------- layout, measured in dots ----------
  const TITLE_CHARS = 24, DEST_CHARS = 18, GAP = 3, PAD = 6;
  const X_LN = 0;
  const X_CAR = X_LN + 2 * CW + GAP;            // car column is 3 characters wide, digit in the middle
  const X_DEST = X_CAR + 3 * CW + GAP;
  const X_MIN = X_DEST + DEST_CHARS * CW + GAP;
  const COLS = X_MIN + 3 * CW;
  const Y_TITLE = 0;
  const Y_HEAD = CH + 4;
  const Y_ROWS = Y_HEAD + CH + 2;

  const NAMES = Object.keys(COLORS);
  const colorIndex = (name) => NAMES.indexOf(COLORS[name] ? name : "fallback") + 1;

  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  function create(canvas, opts = {}) {
    const rowsN = opts.rows || 8;
    const W = COLS + 2 * PAD;
    const H = Y_ROWS + rowsN * CH + 2 * PAD;
    const ctx = canvas.getContext("2d");
    const grid = new Uint8Array(W * H);          // 0 = off, otherwise colour index + 1
    const model = { title: "", trains: [], message: "" };
    let pitch = 4, sprites = [], bg = null, raf = 0;

    // ----- drawing text into the dot grid -----
    function put(str, x, y, colorName, width, right) {
      let s = String(str == null ? "" : str).toUpperCase().slice(0, width);
      if (right) s = s.padStart(width, " ");
      const color = colorIndex(colorName);
      for (let i = 0; i < s.length; i++) {
        const glyph = GLYPHS[s[i]];
        if (!glyph) continue;                      // space or unsupported character stays blank
        const gx = PAD + x + i * CW;
        for (let r = 0; r < CH; r++) {
          const bits = glyph[r];
          if (!bits) continue;
          const row = (PAD + y + r) * W;
          for (let c = 0; c < CW; c++) {
            if ((bits >> (CW - 1 - c)) & 1) grid[row + gx + c] = color;
          }
        }
      }
    }

    function compose() {
      grid.fill(0);
      put(model.title, 0, Y_TITLE, "title", TITLE_CHARS);
      put("LN", X_LN, Y_HEAD, "header", 2);
      put("CAR", X_CAR, Y_HEAD, "header", 3);
      put("DEST", X_DEST, Y_HEAD, "header", DEST_CHARS);
      put("MIN", X_MIN, Y_HEAD, "header", 3);

      const trains = model.trains;
      for (let i = 0; i < rowsN; i++) {
        const y = Y_ROWS + i * CH;
        const t = trains[i];
        if (t) {
          const lineKnown = /^[A-Z]{2}$/.test(t.line) && t.line !== "--";
          if (lineKnown) put(t.line, X_LN, y, COLORS[t.line] ? t.line : "fallback", 2);
          const carOk = /^\d$/.test(t.cars);
          put(carOk ? t.cars : "-", X_CAR + CW, y, t.cars === "8" ? "carGreen" : "carYellow", 1);
          put(t.dest, X_DEST, y, "dest", DEST_CHARS);
          put(t.min, X_MIN, y, "min", 3, true);
        } else if (i === 0 && trains.length === 0) {
          put(model.message || "NO TRAINS", X_DEST, y, "dest", DEST_CHARS);
        }
      }
    }

    // ----- pre-rendered glowing dots -----
    function makeSprite(hex, p) {
      const [r, g, b] = rgb(hex);
      const S = Math.ceil(p * GL.radius);
      const c = document.createElement("canvas");
      c.width = c.height = S;
      const x = c.getContext("2d");
      const m = S / 2;
      let gr = x.createRadialGradient(m, m, 0, m, m, m);       // soft glow
      gr.addColorStop(0, `rgba(${r},${g},${b},${GL.a0})`);
      gr.addColorStop(0.45, `rgba(${r},${g},${b},${GL.a1})`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = gr;
      x.fillRect(0, 0, S, S);
      x.beginPath();                                            // the lit dot
      x.arc(m, m, p * 0.38, 0, Math.PI * 2);
      x.fillStyle = hex;
      x.fill();
      gr = x.createRadialGradient(m, m, 0, m, m, p * 0.38);     // hot centre
      gr.addColorStop(0, `rgba(255,255,255,${GL.hot})`);
      gr.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gr;
      x.beginPath();
      x.arc(m, m, p * 0.38, 0, Math.PI * 2);
      x.fill();
      return c;
    }

    function makeBackground() {
      const c = document.createElement("canvas");
      c.width = canvas.width;
      c.height = canvas.height;
      const x = c.getContext("2d");
      x.fillStyle = "#050505";
      x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = "#1b1815";                                  // unlit dots, barely visible
      const r = pitch * 0.3;
      x.beginPath();
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const cx = (i + 0.5) * pitch, cy = (j + 0.5) * pitch;
          x.moveTo(cx + r, cy);
          x.arc(cx, cy, r, 0, Math.PI * 2);
        }
      }
      x.fill();
      return c;
    }

    // ----- halo: a cheap blur made by shrinking and re-growing the lit dots (works in every browser) -----
    let lit = null; // the lit dots on their own transparent layer

    function makeLayer(w, h) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    }

    // Each halving averages neighbouring pixels, which blurs the image.
    function shrink(src, factor) {
      const tw = Math.max(1, Math.round(src.width / factor));
      const th = Math.max(1, Math.round(src.height / factor));
      let c = src;
      while (c.width > tw) {
        const n = makeLayer(Math.max(tw, Math.round(c.width / 2)), Math.max(th, Math.round(c.height / 2)));
        const x = n.getContext("2d");
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = "high";
        x.drawImage(c, 0, 0, n.width, n.height);
        c = n;
      }
      return c;
    }

    // Double back up with smoothing. It stops one step short; the last step happens when drawing.
    function grow(c, tw, th) {
      while (c.width * 2 < tw) {
        const n = makeLayer(Math.min(tw, c.width * 2), Math.min(th, c.height * 2));
        const x = n.getContext("2d");
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = "high";
        x.drawImage(c, 0, 0, n.width, n.height);
        c = n;
      }
      return c;
    }

    function draw() {
      if (!lit || lit.width !== canvas.width || lit.height !== canvas.height) {
        lit = makeLayer(canvas.width, canvas.height);
      }
      const lx = lit.getContext("2d");
      lx.clearRect(0, 0, lit.width, lit.height);
      lx.globalCompositeOperation = "lighter";
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const v = grid[j * W + i];
          if (!v) continue;
          const s = sprites[v - 1];
          lx.drawImage(s, (i + 0.5) * pitch - s.width / 2, (j + 0.5) * pitch - s.height / 2);
        }
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(bg, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      if (!GL.behind) ctx.drawImage(lit, 0, 0);
      for (const b of GL.bloom) {
        const halo = grow(shrink(lit, b.factor), canvas.width, canvas.height);
        ctx.globalAlpha = Math.min(1, b.alpha); // the canvas ignores values above 1
        ctx.drawImage(halo, 0, 0, canvas.width, canvas.height);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if (GL.behind) ctx.drawImage(lit, 0, 0); // dots on top of the halo, so their colours stay true
    }

    // ----- sizing: fit the screen, keep the dots crisp on high-density displays -----
    function layout() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const kiosk = document.body.classList.contains("kiosk");
      const visibleW = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
      const availW = Math.max(200, visibleW - 16);
      const availH = Math.max(120, window.innerHeight - (kiosk ? 24 : 120));
      const pitchCss = Math.max(0.8, Math.min(availW / W, availH / H));
      canvas.style.width = W * pitchCss + "px";
      canvas.style.height = H * pitchCss + "px";
      // Very large screens: limit the drawing size so the glow layers do not use too much memory.
      const MAX_PIXELS = 8e6;
      const wanted = W * pitchCss * dpr * H * pitchCss * dpr;
      const scale = wanted > MAX_PIXELS ? dpr * Math.sqrt(MAX_PIXELS / wanted) : dpr;
      canvas.width = Math.round(W * pitchCss * scale);
      canvas.height = Math.round(H * pitchCss * scale);
      pitch = canvas.width / W;
      sprites = NAMES.map((n) => makeSprite(COLORS[n], pitch));
      bg = makeBackground();
      compose();
      draw();
    }

    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; compose(); draw(); });
    }

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(layout, 120);
    });

    layout();

    // Screen readers cannot read dots, so keep a plain-text description on the canvas.
    function describe() {
      const rows = model.trains.slice(0, rowsN).map((t) => `${t.line} line to ${t.dest}, ${t.min}`);
      const body = rows.length ? rows : [model.message || "No trains"];
      canvas.setAttribute("aria-label", [model.title, ...body].filter(Boolean).join(". "));
    }

    return {
      set(patch) { Object.assign(model, patch); describe(); schedule(); },
      resize: layout,
    };
  }

  window.LedBoard = { create };
})();
