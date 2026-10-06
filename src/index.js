// Metro board Worker
// - GET /api/stations     -> list of stations (transfer stations merged into one entry)
// - GET /api/predictions?codes=A01,C01 -> upcoming trains for those station codes
// Everything else is served from ./public (the board page).
// The WMATA key lives in the WMATA_KEY secret and never reaches the browser.

const WMATA = "https://api.wmata.com";

const STATIONS_TTL_MS = 24 * 60 * 60 * 1000; // station list rarely changes
const PREDICTIONS_TTL_MS = 15 * 1000; // protects the WMATA daily quota

// Best-effort in-memory cache (per Worker instance).
const cache = new Map();

async function cached(key, ttlMs, fetcher) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return { data: hit.data, at: hit.at, stale: false };
  try {
    const data = await fetcher();
    cache.set(key, { data, at: now });
    return { data, at: now, stale: false };
  } catch (err) {
    // Serve the last good data if WMATA is having a bad moment.
    if (hit) return { data: hit.data, at: hit.at, stale: true };
    throw err;
  }
}

async function wmata(path, env) {
  if (!env.WMATA_KEY) throw new Error("WMATA_KEY secret is not set");
  const res = await fetch(WMATA + path, { headers: { api_key: env.WMATA_KEY } });
  if (!res.ok) throw new Error(`WMATA responded ${res.status}`);
  return res.json();
}

export function groupStations(list) {
  const byCode = new Map(list.map((s) => [s.Code, s]));
  const seen = new Set();
  const out = [];
  for (const s of list) {
    if (seen.has(s.Code)) continue;
    const codes = [s.Code];
    for (const t of [s.StationTogether1, s.StationTogether2]) {
      if (t && byCode.has(t) && !codes.includes(t)) codes.push(t);
    }
    codes.sort();
    codes.forEach((c) => seen.add(c));
    const lines = new Set();
    for (const c of codes) {
      const x = byCode.get(c);
      [x.LineCode1, x.LineCode2, x.LineCode3, x.LineCode4].forEach((l) => l && lines.add(l));
    }
    out.push({
      id: codes[0],
      name: s.Name,
      codes,
      lines: [...lines],
      lat: s.Lat,
      lon: s.Lon,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function cleanTrains(trains) {
  const rank = (m) => {
    if (m === "BRD") return -1;
    if (m === "ARR") return 0;
    const n = parseInt(m, 10);
    return Number.isNaN(n) ? 9999 : n;
  };
  return (trains || [])
    .filter((t) => t.DestinationName && t.DestinationName !== "No Passenger")
    .map((t) => ({
      line: t.Line || "--",
      cars: t.Car || "",
      dest: t.DestinationName,
      min: String(t.Min ?? "").trim() || "---",
    }))
    .sort((a, b) => rank(a.min) - rank(b.min));
}

// ---------- closing hours (Washington time) ----------
// While the Metro is closed we do not call WMATA at all. Times are minutes after midnight:
// closed from the start time up to, but not including, the end time.
const TIMEZONE = "America/New_York";
const CLOSED_HOURS = {
  Mon: [1 * 60, 4 * 60 + 30],
  Tue: [1 * 60, 4 * 60 + 30],
  Wed: [1 * 60, 4 * 60 + 30],
  Thu: [1 * 60, 4 * 60 + 30],
  Fri: [3 * 60, 4 * 60 + 40],
  Sat: [3 * 60, 5 * 60 + 30],
  Sun: [1 * 60, 5 * 60 + 30],
};

export function closedNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  const [start, end] = CLOSED_HOURS[get("weekday")];
  const now = Number(get("hour")) * 60 + Number(get("minute"));
  if (now < start || now >= end) return null;
  const h = Math.floor(end / 60), m = end % 60;
  return { reopens: `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/stations") {
        // Cached for 24 hours, so WMATA is asked at most about once a day.
        const r = await cached("stations", STATIONS_TTL_MS, async () => {
          const raw = await wmata("/Rail.svc/json/jStations", env);
          return groupStations(raw.Stations || []);
        });
        return json({ stations: r.data }, 200, { "cache-control": "public, max-age=3600" });
      }

      if (url.pathname === "/api/predictions") {
        const codes = (url.searchParams.get("codes") || "").toUpperCase().split(",").filter(Boolean);
        if (codes.length === 0 || codes.length > 4 || !codes.every((c) => /^[A-Z]\d{2}$/.test(c))) {
          return json({ error: "Provide 1-4 station codes, e.g. ?codes=A01,C01" }, 400);
        }
        // Closed: answer right away without touching the cache or WMATA.
        // For testing: `wrangler dev --var FORCE_CLOSED:1` pretends the Metro is closed.
        const closed = env.FORCE_CLOSED ? { reopens: "4:30 AM" } : closedNow();
        if (closed) {
          return json({ closed: true, reopens: closed.reopens, trains: [], updatedAt: Date.now(), stale: false }, 200, { "cache-control": "no-store" });
        }
        codes.sort();
        const key = "pred:" + codes.join(",");
        const r = await cached(key, PREDICTIONS_TTL_MS, async () => {
          const raw = await wmata(`/StationPrediction.svc/json/GetPrediction/${codes.join(",")}`, env);
          return cleanTrains(raw.Trains);
        });
        return json({ trains: r.data, updatedAt: r.at, stale: r.stale }, 200, { "cache-control": "no-store" });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: String(err.message || err) }, 502, { "cache-control": "no-store" });
    }
  },
};
