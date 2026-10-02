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
