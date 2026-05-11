const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SESSION_DAYS = 14;
const MAX_JSON_BYTES = 20 * 1024 * 1024;
const firebase = initFirebase();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function loadEnvFile() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }
    await routeStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong." });
  }
});

start();

async function start() {
  ensureDb();
  await hydrateDbFromFirestore();
  server.listen(PORT, HOST, () => {
    console.log(`SignalBoard is running at http://${HOST}:${PORT}`);
  });
}

async function routeApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/auth/register") return register(req, res);
  if (req.method === "POST" && url.pathname === "/api/auth/login") return login(req, res);
  if (req.method === "POST" && url.pathname === "/api/auth/firebase-session") return firebaseSession(req, res);
  if (req.method === "POST" && url.pathname === "/api/auth/logout") return logout(req, res);
  if (req.method === "GET" && url.pathname === "/api/firebase-config") return firebaseConfig(req, res);
  if (req.method === "GET" && url.pathname === "/api/me") return me(req, res);

  if (req.method === "GET" && url.pathname === "/api/groups") return listGroups(req, res);
  if (req.method === "POST" && url.pathname === "/api/groups") return createGroup(req, res);

  const groupMatch = url.pathname.match(/^\/api\/groups\/([^/]+)$/);
  if (groupMatch && req.method === "GET") return getGroup(req, res, groupMatch[1]);
  if (groupMatch && req.method === "PUT") return updateGroup(req, res, groupMatch[1]);
  if (groupMatch && req.method === "DELETE") return deleteGroup(req, res, groupMatch[1]);

  const playerMatch = url.pathname.match(/^\/api\/player\/([A-Z0-9]{6})$/);
  if (playerMatch && req.method === "GET") return playerConfig(req, res, playerMatch[1]);

  const controlMatch = url.pathname.match(/^\/api\/control\/([A-Z0-9]{6})$/);
  if (controlMatch && req.method === "GET") return controlConfig(req, res, controlMatch[1]);
  if (controlMatch && req.method === "POST") return controlGroup(req, res, controlMatch[1]);

  const triggerMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/trigger$/);
  if (triggerMatch && req.method === "POST") return triggerGroup(req, res, triggerMatch[1]);

  const eventMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/events$/);
  if (eventMatch && req.method === "GET") return calendarEvents(req, res, eventMatch[1]);

  const weatherMatch = url.pathname.match(/^\/api\/weather$/);
  if (weatherMatch && req.method === "GET") return weather(req, res, url);

  sendJson(res, 404, { error: "Not found." });
}

async function routeStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  const pathname = decodeURIComponent(url.pathname);
  let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

async function register(req, res) {
  const body = await readJson(req);
  const name = String(body.name || "").trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!name || !email || password.length < 8) {
    return sendJson(res, 400, { error: "Name, valid email, and an 8+ character password are required." });
  }

  const db = readDb();
  if (db.users.some((user) => user.email === email)) {
    return sendJson(res, 409, { error: "An account already exists for that email." });
  }

  const user = {
    id: id("usr"),
    name,
    email,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  const session = createSession(db, user.id);
  writeDb(db);
  setSessionCookie(res, session.token);
  sendJson(res, 201, { user: publicUser(user) });
}

async function login(req, res) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const db = readDb();
  const user = db.users.find((entry) => entry.email === email);
  if (!user || user.passwordHash !== hashPassword(password)) {
    return sendJson(res, 401, { error: "Email or password is incorrect." });
  }
  const session = createSession(db, user.id);
  writeDb(db);
  setSessionCookie(res, session.token);
  sendJson(res, 200, { user: publicUser(user) });
}

async function firebaseSession(req, res) {
  if (!firebase.admin) return sendJson(res, 503, { error: "Firebase Admin is not configured on the server." });
  const body = await readJson(req);
  const idToken = String(body.idToken || "");
  if (!idToken) return sendJson(res, 400, { error: "Firebase ID token is required." });
  const decoded = await firebase.admin.auth().verifyIdToken(idToken);
  const db = readDb();
  let user = db.users.find((entry) => entry.firebaseUid === decoded.uid || entry.id === decoded.uid);
  if (!user) {
    user = {
      id: decoded.uid,
      firebaseUid: decoded.uid,
      name: String(decoded.name || body.name || decoded.email || "Firebase User").trim(),
      email: normalizeEmail(decoded.email || body.email || ""),
      provider: decoded.firebase?.sign_in_provider || "firebase",
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
  } else {
    user.name = String(decoded.name || body.name || user.name || "").trim() || user.name;
    user.email = normalizeEmail(decoded.email || user.email || "");
    user.provider = decoded.firebase?.sign_in_provider || user.provider || "firebase";
    user.firebaseUid = decoded.uid;
  }
  const session = createSession(db, user.id);
  writeDb(db);
  setSessionCookie(res, session.token);
  sendJson(res, 200, { user: publicUser(user) });
}

function firebaseConfig(req, res) {
  const config = publicFirebaseConfig();
  sendJson(res, 200, { enabled: Boolean(firebase.admin && config.apiKey && config.authDomain && config.projectId && config.appId), config });
}

async function logout(req, res) {
  const token = getSessionToken(req);
  const db = readDb();
  db.sessions = db.sessions.filter((session) => session.token !== token);
  writeDb(db);
  res.setHeader("Set-Cookie", "sb_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  sendJson(res, 200, { ok: true });
}

async function me(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  sendJson(res, 200, { user: publicUser(auth.user) });
}

async function listGroups(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const groups = auth.db.groups
    .filter((group) => group.ownerId === auth.user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summaryGroup);
  sendJson(res, 200, { groups });
}

async function createGroup(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const body = await readJson(req);
  const now = new Date().toISOString();
  const group = defaultGroup({
    id: id("grp"),
    ownerId: auth.user.id,
    name: String(body.name || "New Signage Group").trim().slice(0, 80),
    code: uniqueCode(auth.db),
    createdAt: now,
    updatedAt: now
  });
  auth.db.groups.push(group);
  writeDb(auth.db);
  sendJson(res, 201, { group });
}

async function getGroup(req, res, groupId) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const group = ownedGroup(auth, groupId);
  if (!group) return sendJson(res, 404, { error: "Group not found." });
  sendJson(res, 200, { group });
}

async function updateGroup(req, res, groupId) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const group = ownedGroup(auth, groupId);
  if (!group) return sendJson(res, 404, { error: "Group not found." });
  const body = await readJson(req);
  const incoming = sanitizeGroup(body.group || {});
  Object.assign(group, incoming, {
    id: group.id,
    ownerId: group.ownerId,
    code: group.code,
    createdAt: group.createdAt,
    updatedAt: new Date().toISOString()
  });
  writeDb(auth.db);
  sendJson(res, 200, { group });
}

async function deleteGroup(req, res, groupId) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const index = auth.db.groups.findIndex((group) => group.id === groupId && group.ownerId === auth.user.id);
  if (index === -1) return sendJson(res, 404, { error: "Group not found." });
  auth.db.groups.splice(index, 1);
  writeDb(auth.db);
  sendJson(res, 200, { ok: true });
}

async function playerConfig(req, res, code) {
  const db = readDb();
  const group = db.groups.find((entry) => entry.code === code);
  if (!group) return sendJson(res, 404, { error: "No signage group is paired with that code." });
  sendJson(res, 200, { group: publicGroup(group) });
}

async function controlConfig(req, res, code) {
  const db = readDb();
  const group = db.groups.find((entry) => entry.code === code);
  if (!group) return sendJson(res, 404, { error: "No signage group is paired with that code." });
  sendJson(res, 200, { group: controlGroupView(group) });
}

async function controlGroup(req, res, code) {
  const db = readDb();
  const group = db.groups.find((entry) => entry.code === code);
  if (!group) return sendJson(res, 404, { error: "No signage group is paired with that code." });
  const body = await readJson(req);
  if (body.layout && ["command", "media", "calendar", "weather", "workshop"].includes(body.layout)) group.layout = body.layout;
  if (body.theme && ["aurora", "ember", "mono", "field", "gallery", "paper", "sky", "home", "frost", "graphite", "midnight", "contrast"].includes(body.theme)) group.theme = body.theme;
  if (typeof body.fillScreen === "boolean") group.settings.fillScreen = body.fillScreen;
  if (typeof body.showMediaBanner === "boolean") group.settings.showMediaBanner = body.showMediaBanner;
  if (typeof body.showSeconds === "boolean") group.settings.showSeconds = body.showSeconds;
  if (Number.isFinite(Number(body.overlayOpacity))) group.settings.overlayOpacity = clamp(Number(body.overlayOpacity), 0, 90);
  if (body.trigger && typeof body.trigger === "object") {
    applyTrigger(group, body.trigger);
  }
  group.updatedAt = new Date().toISOString();
  writeDb(db);
  sendJson(res, 200, { group: controlGroupView(group) });
}

async function triggerGroup(req, res, groupId) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const group = ownedGroup(auth, groupId);
  if (!group) return sendJson(res, 404, { error: "Group not found." });
  const body = await readJson(req);
  applyTrigger(group, body);
  group.updatedAt = new Date().toISOString();
  writeDb(auth.db);
  sendJson(res, 200, { group });
}

function applyTrigger(group, body) {
  const now = new Date().toISOString();
  const duration = Math.max(0, Math.min(24 * 60 * 60, Number(body.durationSeconds || 0)));
  group.liveTrigger = {
    type: ["study", "timer", "message", "clear"].includes(body.type) ? body.type : "timer",
    label: String(body.label || "").trim().slice(0, 80),
    message: String(body.message || "").trim().slice(0, 240),
    durationSeconds: duration,
    startedAt: now,
    endsAt: duration ? new Date(Date.now() + duration * 1000).toISOString() : null
  };
  if (group.liveTrigger.type === "clear") group.liveTrigger = null;
}

async function calendarEvents(req, res, groupId) {
  const auth = optionalAuth(req);
  const db = auth?.db || readDb();
  const group = db.groups.find((entry) => entry.id === groupId || entry.code === groupId);
  if (!group) return sendJson(res, 404, { error: "Group not found." });
  if (auth && group.ownerId !== auth.user.id && group.id === groupId) return sendJson(res, 403, { error: "Forbidden." });

  const feeds = (group.calendarFeeds || []).filter((feed) => feed.enabled && feed.url);
  const results = await Promise.allSettled(feeds.map((feed, index) => fetchCalendarFeed(feed, index)));
  const events = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 30);
  sendJson(res, 200, { events });
}

async function weather(req, res, url) {
  const location = String(url.searchParams.get("location") || "").trim();
  if (!location) return sendJson(res, 400, { error: "Location is required." });
  const place = await resolveWeatherPlace(location);
  if (!place) return sendJson(res, 404, { error: "Location not found." });
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
  const forecast = await fetchJson(forecastUrl);
  sendJson(res, 200, {
    location: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    current: forecast.current,
    units: forecast.current_units,
    summary: weatherSummary(forecast.current?.weather_code)
  });
}

async function resolveWeatherPlace(location) {
  if (/^\d{5}$/.test(location)) {
    const zip = await fetchJson(`https://api.zippopotam.us/us/${encodeURIComponent(location)}`);
    const place = zip.places?.[0];
    if (!place) return null;
    return {
      latitude: Number(place.latitude),
      longitude: Number(place.longitude),
      name: place["place name"],
      admin1: place.state,
      country: zip.country
    };
  }
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const geo = await fetchJson(geoUrl);
  return geo.results?.[0] || null;
}

function requireAuth(req, res) {
  const auth = optionalAuth(req);
  if (!auth) sendJson(res, 401, { error: "Please sign in." });
  return auth;
}

function optionalAuth(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const db = readDb();
  const now = Date.now();
  db.sessions = db.sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
  const session = db.sessions.find((entry) => entry.token === token);
  if (!session) {
    writeDb(db);
    return null;
  }
  const user = db.users.find((entry) => entry.id === session.userId);
  if (!user) return null;
  return { db, user, session };
}

function ownedGroup(auth, groupId) {
  return auth.db.groups.find((group) => group.id === groupId && group.ownerId === auth.user.id);
}

function defaultGroup(base) {
  return {
    ...base,
    theme: "aurora",
    layout: "command",
    settings: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      weatherLocation: "New York",
      weatherZip: "",
      headline: "Workshop Display",
      subheadline: "Focus blocks, schedules, and live room status",
      fillScreen: false,
      showMediaBanner: true,
      showSeconds: false,
      overlayOpacity: 58
    },
    modules: {
      clock: true,
      date: true,
      weather: true,
      calendar: true,
      media: true,
      countdowns: true,
      events: true
    },
    calendarFeeds: [],
    media: [],
    countdowns: [],
    blackoutTimes: [],
    liveTrigger: null
  };
}

function sanitizeGroup(raw) {
  const safe = defaultGroup({
    id: "",
    ownerId: "",
    name: String(raw.name || "Untitled Group").trim().slice(0, 80),
    code: "",
    createdAt: "",
    updatedAt: ""
  });
  safe.theme = ["aurora", "ember", "mono", "field", "gallery", "paper", "sky", "home", "frost", "graphite", "midnight", "contrast"].includes(raw.theme) ? raw.theme : "aurora";
  safe.layout = ["command", "media", "calendar", "weather", "workshop"].includes(raw.layout) ? raw.layout : "command";
  safe.settings = {
    timezone: String(raw.settings?.timezone || "America/New_York").trim().slice(0, 80),
    weatherLocation: String(raw.settings?.weatherLocation || "").trim().slice(0, 120),
    weatherZip: String(raw.settings?.weatherZip || "").replace(/[^\d]/g, "").slice(0, 5),
    headline: String(raw.settings?.headline || "").trim().slice(0, 100),
    subheadline: String(raw.settings?.subheadline || "").trim().slice(0, 180),
    fillScreen: Boolean(raw.settings?.fillScreen),
    showMediaBanner: raw.settings?.showMediaBanner !== false,
    showSeconds: Boolean(raw.settings?.showSeconds),
    overlayOpacity: clamp(Number(raw.settings?.overlayOpacity ?? 58), 0, 90)
  };
  safe.modules = {
    clock: Boolean(raw.modules?.clock),
    date: Boolean(raw.modules?.date),
    weather: Boolean(raw.modules?.weather),
    calendar: Boolean(raw.modules?.calendar),
    media: Boolean(raw.modules?.media),
    countdowns: Boolean(raw.modules?.countdowns),
    events: Boolean(raw.modules?.events)
  };
  safe.calendarFeeds = array(raw.calendarFeeds).slice(0, 8).map((feed, index) => ({
    id: String(feed.id || id("cal")).slice(0, 40),
    name: String(feed.name || "Calendar").trim().slice(0, 80),
    url: String(feed.url || "").trim().slice(0, 1000),
    color: calendarColor(feed.color, index),
    enabled: feed.enabled !== false
  }));
  safe.media = array(raw.media).slice(0, 20).map((item) => ({
    id: String(item.id || id("img")).slice(0, 40),
    name: String(item.name || "Image").trim().slice(0, 100),
    dataUrl: String(item.dataUrl || "").startsWith("data:image/") ? String(item.dataUrl).slice(0, 2_500_000) : "",
    durationSeconds: clamp(Number(item.durationSeconds || 12), 3, 120)
  })).filter((item) => item.dataUrl);
  safe.countdowns = array(raw.countdowns).slice(0, 12).map((timer) => ({
    id: String(timer.id || id("cnt")).slice(0, 40),
    name: String(timer.name || "Countdown").trim().slice(0, 80),
    mode: timer.mode === "countup" ? "countup" : "countdown",
    target: validIso(timer.target) ? timer.target : new Date(Date.now() + 3600_000).toISOString(),
    enabled: timer.enabled !== false
  }));
  safe.blackoutTimes = array(raw.blackoutTimes).slice(0, 12).map((entry) => ({
    id: String(entry.id || id("blk")).slice(0, 40),
    name: String(entry.name || "Blackout").trim().slice(0, 80),
    start: clockTime(entry.start) || "22:00",
    end: clockTime(entry.end) || "06:00",
    days: array(entry.days).map(Number).filter((day) => day >= 0 && day <= 6),
    enabled: entry.enabled !== false
  }));
  safe.liveTrigger = raw.liveTrigger && typeof raw.liveTrigger === "object" ? {
    type: ["study", "timer", "message"].includes(raw.liveTrigger.type) ? raw.liveTrigger.type : "timer",
    label: String(raw.liveTrigger.label || "").trim().slice(0, 80),
    message: String(raw.liveTrigger.message || "").trim().slice(0, 240),
    durationSeconds: clamp(Number(raw.liveTrigger.durationSeconds || 0), 0, 24 * 60 * 60),
    startedAt: validIso(raw.liveTrigger.startedAt) ? raw.liveTrigger.startedAt : new Date().toISOString(),
    endsAt: validIso(raw.liveTrigger.endsAt) ? raw.liveTrigger.endsAt : null
  } : null;
  return safe;
}

function publicGroup(group) {
  const { ownerId, ...rest } = group;
  return rest;
}

function controlGroupView(group) {
  return {
    code: group.code,
    name: group.name,
    layout: group.layout,
    theme: group.theme,
    settings: {
      fillScreen: Boolean(group.settings?.fillScreen),
      showMediaBanner: group.settings?.showMediaBanner !== false,
      showSeconds: Boolean(group.settings?.showSeconds),
      overlayOpacity: Number(group.settings?.overlayOpacity ?? 58)
    },
    liveTrigger: group.liveTrigger
  };
}

function summaryGroup(group) {
  return {
    id: group.id,
    name: group.name,
    code: group.code,
    theme: group.theme,
    layout: group.layout,
    updatedAt: group.updatedAt
  };
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

async function fetchCalendarFeed(feed, index) {
  const text = await fetchText(feed.url);
  return parseIcs(text, feed);
}

function parseIcs(text, feed) {
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of unfolded) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT" && current) {
      const start = parseIcsDate(current.DTSTART);
      const end = parseIcsDate(current.DTEND);
      if (start && start.getTime() > Date.now() - 12 * 3600_000) {
        events.push({
          id: crypto.createHash("sha1").update(`${feed.name}${current.SUMMARY}${start.toISOString()}`).digest("hex").slice(0, 12),
          feedId: feed.id,
          feedName: feed.name,
          feedColor: feed.color || "#41d6b3",
          title: cleanIcs(current.SUMMARY || "Untitled event"),
          location: cleanIcs(current.LOCATION || ""),
          start: start.toISOString(),
          end: end ? end.toISOString() : new Date(start.getTime() + 3600_000).toISOString()
        });
      }
      current = null;
    } else if (current) {
      const index = line.indexOf(":");
      if (index > -1) {
        const key = line.slice(0, index).split(";")[0];
        current[key] = line.slice(index + 1);
      }
    }
  }
  return events;
}

function parseIcsDate(value) {
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`);
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${value.endsWith("Z") ? "Z" : ""}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanIcs(value) {
  return String(value).replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\/g, "").trim();
}

function calendarColor(value, index = 0) {
  const palette = ["#41d6b3", "#f2b84b", "#7da8ff", "#ff7a90", "#9be564", "#c084fc", "#5ee7ff", "#ff9f68"];
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : palette[index % palette.length];
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "SignalBoard/1.0" } });
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "SignalBoard/1.0" } });
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  return response.text();
}

function weatherSummary(code) {
  const map = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    95: "Thunderstorm"
  };
  return map[code] || "Current conditions";
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    writeDb({ users: [], sessions: [], groups: [] });
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  syncDbToFirestore(db).catch((error) => {
    console.error("Firestore sync failed:", error.message);
  });
}

function initFirebase() {
  try {
    const admin = require("firebase-admin");
    if (admin.apps.length) return { admin, firestore: admin.firestore() };
    const credential = firebaseCredential(admin);
    if (!credential) return { admin: null, firestore: null };
    admin.initializeApp({ credential });
    return { admin, firestore: admin.firestore() };
  } catch (error) {
    console.warn("Firebase Admin disabled:", error.message);
    return { admin: null, firestore: null };
  }
}

function firebaseCredential(admin) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return admin.credential.cert(JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")));
  }
  return null;
}

function publicFirebaseConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || ""
  };
}

async function hydrateDbFromFirestore() {
  if (!firebase.firestore) return;
  const db = readDb();
  const [usersSnap, groupsSnap] = await Promise.all([
    firebase.firestore.collection("users").get(),
    firebase.firestore.collection("groups").get()
  ]);
  db.users = usersSnap.docs.map((doc) => doc.data());
  db.groups = groupsSnap.docs.map((doc) => doc.data());
  db.sessions = [];
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

async function syncDbToFirestore(db) {
  if (!firebase.firestore) return;
  const batch = firebase.firestore.batch();
  for (const user of db.users || []) {
    batch.set(firebase.firestore.collection("users").doc(user.id), user, { merge: true });
  }
  for (const group of db.groups || []) {
    batch.set(firebase.firestore.collection("groups").doc(group.id), group, { merge: true });
    batch.set(firebase.firestore.collection("codes").doc(group.code), { groupId: group.id, code: group.code }, { merge: true });
  }
  await batch.commit();
}

function createSession(db, userId) {
  const session = {
    token: crypto.randomBytes(32).toString("hex"),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
  };
  db.sessions.push(session);
  return session;
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `sb_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

function getSessionToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)sb_session=([^;]+)/);
  return match ? match[1] : "";
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(`signalboard:${password}`).digest("hex");
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function uniqueCode(db) {
  let code = "";
  do {
    code = crypto.randomBytes(4).toString("hex").toUpperCase().replace(/[IO]/g, "7").slice(0, 6);
  } while (db.groups.some((group) => group.code === code));
  return code;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function validIso(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function clockTime(value) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : null;
}
