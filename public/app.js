const state = {
  user: null,
  groups: [],
  activeGroup: null,
  playerGroup: null,
  playerCode: "",
  events: [],
  weather: null,
  mediaIndex: 0,
  groupRevision: 0,
  toast: "",
  wakeLock: null,
  wakeLockWanted: false
};

const $app = document.querySelector("#app");
const routes = {
  "/": renderHome,
  "/dashboard": renderDashboard,
  "/display": renderDisplayPair,
  "/player": renderPlayer,
  "/control": renderControl
};

window.addEventListener("popstate", route);
window.addEventListener("submit", handleSubmit);
window.addEventListener("click", handleClick);
window.addEventListener("change", handleChange);
window.addEventListener("input", handleInput);
document.addEventListener("visibilitychange", maintainWakeLock);
window.addEventListener("pageshow", maintainWakeLock);
document.addEventListener("fullscreenchange", maintainWakeLock);

init();

async function init() {
  try {
    const response = await api("/api/me", { quiet: true });
    state.user = response.user;
  } catch {}
  await route();
  setInterval(tick, 1000);
}

async function route() {
  const path = location.pathname;
  if (path !== "/player") releaseWakeLock();
  const renderer = routes[path] || renderHome;
  await renderer();
}

function navigate(path) {
  history.pushState(null, "", path);
  route();
}

async function renderHome() {
  $app.className = "site-shell";
  $app.innerHTML = `
    <nav class="topbar">
      <button class="brand" data-nav="/">SignalBoard</button>
      <div class="topbar-actions">
        <button class="ghost" data-nav="/display">Pair Display</button>
        ${state.user ? `<button class="primary" data-nav="/dashboard">Dashboard</button>` : ""}
      </div>
    </nav>
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Digital signage command center</p>
        <h1>Run every lobby, classroom, studio, and workshop screen from one account.</h1>
        <p>Build signage groups, pair displays with a six-character code, mix calendars, media, weather, countdowns, live study timers, and blackout schedules.</p>
        <div class="hero-actions">
          <button class="primary large" data-nav="${state.user ? "/dashboard" : "#auth"}">Open Dashboard</button>
          <button class="secondary large" data-nav="/display">Pair a Screen</button>
        </div>
      </div>
      <div class="hero-screen" aria-hidden="true">
        <div class="screen-status"><span></span> LIVE WORKSHOP</div>
        <div class="screen-time">10:24</div>
        <div class="screen-grid">
          <div>Calendar<br><strong>Design Critique</strong></div>
          <div>Weather<br><strong>72 F</strong></div>
          <div>Focus Timer<br><strong>24:59</strong></div>
        </div>
      </div>
    </section>
    <section id="auth" class="auth-panel">
      <div>
        <h2>${state.user ? `Welcome, ${escapeHtml(state.user.name)}` : "Create your signage account"}</h2>
        <p>${state.user ? "Your dashboard is ready." : "Accounts are stored locally in this prototype and keep each signage group private."}</p>
      </div>
      ${state.user ? `
        <button class="primary" data-nav="/dashboard">Go to Dashboard</button>
      ` : `
        <div class="auth-options">
          <button class="google-button" data-action="google-login">Continue with Google</button>
          <p class="muted">Or use Firebase email and password.</p>
        </div>
        <form class="auth-form" data-action="register">
          <input name="name" placeholder="Name" autocomplete="name" required />
          <input name="email" inputmode="email" placeholder="Email" autocomplete="email" required />
          <input name="password" type="password" placeholder="Password" autocomplete="new-password" minlength="8" required />
          <button class="primary">Create Account</button>
        </form>
        <form class="auth-form compact" data-action="login">
          <input name="email" inputmode="email" placeholder="Email" autocomplete="email" required />
          <input name="password" type="password" placeholder="Password" autocomplete="current-password" required />
          <button class="secondary">Sign In</button>
        </form>
      `}
    </section>
    ${toast()}
  `;
}

async function renderDashboard() {
  if (!state.user) return renderHome();
  const data = await api("/api/groups");
  state.groups = data.groups;
  if (!state.activeGroup && state.groups[0]) {
    state.activeGroup = (await api(`/api/groups/${state.groups[0].id}`)).group;
  }
  if (state.activeGroup && !state.groups.some((group) => group.id === state.activeGroup.id)) {
    state.activeGroup = null;
  }
  $app.className = "dashboard-shell";
  $app.innerHTML = `
    <aside class="sidebar">
      <button class="brand" data-nav="/">SignalBoard</button>
      <button class="primary full" data-action="new-group">New Group</button>
      <div class="group-list">
        ${state.groups.map((group) => `
          <button class="group-pill ${state.activeGroup?.id === group.id ? "active" : ""}" data-group-id="${group.id}">
            <span>${escapeHtml(group.name)}</span>
            <code>${group.code}</code>
          </button>
        `).join("") || `<p class="muted">Create your first group to start pairing screens.</p>`}
      </div>
      <button class="ghost full" data-action="logout">Sign Out</button>
    </aside>
    <section class="workspace">
      ${state.activeGroup ? dashboardEditor(state.activeGroup) : emptyDashboard()}
    </section>
    ${toast()}
  `;
}

function emptyDashboard() {
  return `
    <div class="empty-state">
      <h1>No signage groups yet</h1>
      <p>Create a group, then use its code on any display at <strong>/display</strong>.</p>
      <button class="primary" data-action="new-group">Create Group</button>
    </div>
  `;
}

function dashboardEditor(group) {
  return `
    <header class="workspace-header">
      <div>
        <p class="eyebrow">Pairing code</p>
        <h1>${escapeHtml(group.name)} <code class="pair-code">${group.code}</code></h1>
      </div>
      <div class="header-actions">
        <button class="secondary" data-open-player="${group.code}">Preview</button>
        <button class="danger" data-action="delete-group">Delete</button>
      </div>
    </header>

    <div class="editor-grid">
      <form class="panel" data-action="save-group">
        <h2>Group Setup</h2>
        <label>Name<input name="name" value="${attr(group.name)}" /></label>
        <label>Headline<input name="headline" value="${attr(group.settings.headline)}" /></label>
        <label>Subheadline<input name="subheadline" value="${attr(group.settings.subheadline)}" /></label>
        <input type="hidden" name="theme" value="${attr(group.theme)}" />
        <label>Layout${select("layout", group.layout, [["command", "Command"], ["media", "Media Wall"], ["calendar", "Calendar Board"], ["weather", "Weather Board"], ["workshop", "Workshop"]])}</label>
        <section class="theme-picker">
          <div class="panel-head">
            <h3>Themes</h3>
            <span class="muted">Scroll previews</span>
          </div>
          <div class="theme-preview-strip">
            ${themeOptions().map((theme) => themePreviewCard(theme, group.theme, group.media?.[0])).join("")}
          </div>
        </section>
        <label>Calendar view${select("calendarRange", group.settings.calendarRange || "month", [["three-day", "3 Days"], ["week", "1 Week"], ["two-week", "2 Weeks"], ["month", "1 Month"]])}</label>
        <div class="split">
          <label>Weather City<input name="weatherLocation" value="${attr(group.settings.weatherLocation)}" placeholder="Chicago, IL" /></label>
          <label>Weather ZIP<input name="weatherZip" inputmode="numeric" maxlength="5" value="${attr(group.settings.weatherZip || "")}" placeholder="10001" /></label>
        </div>
        <div class="module-grid">
          <label class="toggle"><input type="checkbox" name="fillScreen" ${group.settings.fillScreen ? "checked" : ""} />Fill whole screen</label>
          <label class="toggle"><input type="checkbox" name="showMediaBanner" ${group.settings.showMediaBanner !== false ? "checked" : ""} />Bottom media banner</label>
          <label class="toggle"><input type="checkbox" name="showSeconds" ${group.settings.showSeconds ? "checked" : ""} />Show clock seconds</label>
        </div>
        <label>Image overlay opacity <input name="overlayOpacity" type="range" min="0" max="90" value="${attr(group.settings.overlayOpacity ?? 58)}" /></label>
        <div class="module-grid">
          ${Object.entries(group.modules).map(([key, enabled]) => `
            <label class="toggle"><input type="checkbox" name="module:${key}" ${enabled ? "checked" : ""} />${labelize(key)}</label>
          `).join("")}
        </div>
        <button class="primary">Save Setup</button>
      </form>

      <section class="panel">
        <h2>Live Workshop Triggers</h2>
        <div class="trigger-row">
          <button class="primary" data-trigger="study" data-duration="1500">Study 25</button>
          <button class="secondary" data-trigger="timer" data-duration="300">Timer 5</button>
          <button class="secondary" data-trigger="timer" data-duration="900">Timer 15</button>
          <button class="ghost" data-trigger="clear">Clear</button>
        </div>
        <form class="inline-form" data-action="custom-trigger">
          <input name="label" placeholder="Timer label" value="Focus block" />
          <input name="minutes" type="number" min="1" max="480" value="45" />
          <button class="secondary">Start</button>
        </form>
        <p class="muted">Triggers update paired displays on the next refresh cycle.</p>
      </section>

      <section class="panel wide">
        <div class="panel-head">
          <h2>Google / iCal Calendars</h2>
          <button class="secondary" data-action="add-calendar">Add Feed</button>
        </div>
        ${calendarPaletteRecommendation(group)}
        <div class="stack" data-list="calendarFeeds">
          ${group.calendarFeeds.map((feed, index) => calendarRow(feed, index)).join("") || `<p class="muted">Paste a public Google Calendar iCal URL to show current and upcoming events.</p>`}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Images</h2>
          <label class="file-button">Upload<input type="file" accept="image/*" multiple data-action="upload-images" /></label>
        </div>
        <form class="stack image-link-form" data-action="add-image-links">
          <label>Image links
            <textarea name="imageLinks" rows="3" placeholder="Paste one direct image URL per line"></textarea>
          </label>
          <button class="secondary" type="submit">Add Links</button>
        </form>
        <div class="media-list">
          ${group.media.map((item) => `
            <div class="media-item">
              <img src="${item.dataUrl}" alt="" />
              <span><b>${item.storagePath ? "Upload" : "Link"}</b>${escapeHtml(item.name)}</span>
              <button class="secondary compact" type="button" data-remove-media="${item.id}" aria-label="Remove ${attr(item.name)}">Remove</button>
            </div>
          `).join("") || `<p class="muted">Uploaded images or direct image links rotate on the display.</p>`}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Countdowns & Count Ups</h2>
          <button class="secondary" data-action="add-countdown">Add</button>
        </div>
        <div class="stack">
          ${group.countdowns.map(countdownRow).join("") || `<p class="muted">Track deadlines, openings, launches, or days since a milestone.</p>`}
        </div>
      </section>

      <section class="panel wide">
        <div class="panel-head">
          <h2>Blackout Times</h2>
          <button class="secondary" data-action="add-blackout">Add Blackout</button>
        </div>
        <div class="stack">
          ${group.blackoutTimes.map(blackoutRow).join("") || `<p class="muted">Dim displays to black during scheduled quiet hours.</p>`}
        </div>
      </section>
    </div>
  `;
}

function calendarRow(feed, index = 0) {
  return `
    <div class="edit-row calendar-edit-row" data-calendar-id="${feed.id}">
      <input data-field="cal:name" value="${attr(feed.name)}" placeholder="Calendar name" />
      <input data-field="cal:url" value="${attr(feed.url)}" placeholder="https://calendar.google.com/.../basic.ics" />
      <input class="color-input" data-field="cal:color" type="color" value="${attr(feed.color || calendarPalette(index))}" title="Calendar color" />
      <label class="toggle"><input type="checkbox" data-field="cal:enabled" ${feed.enabled ? "checked" : ""} />On</label>
      <button class="icon" data-remove-calendar="${feed.id}">x</button>
    </div>
  `;
}

function countdownRow(timer) {
  return `
    <div class="edit-row" data-countdown-id="${timer.id}">
      <input data-field="count:name" value="${attr(timer.name)}" />
      ${select("count:mode", timer.mode, [["countdown", "Countdown"], ["countup", "Count Up"]], "data-field")}
      <input data-field="count:target" type="datetime-local" value="${toLocalInput(timer.target)}" />
      <label class="toggle"><input type="checkbox" data-field="count:enabled" ${timer.enabled ? "checked" : ""} />On</label>
      <button class="icon" data-remove-countdown="${timer.id}">x</button>
    </div>
  `;
}

function blackoutRow(entry) {
  return `
    <div class="edit-row" data-blackout-id="${entry.id}">
      <input data-field="black:name" value="${attr(entry.name)}" />
      <input data-field="black:start" type="time" value="${entry.start}" />
      <input data-field="black:end" type="time" value="${entry.end}" />
      <label class="toggle"><input type="checkbox" data-field="black:enabled" ${entry.enabled ? "checked" : ""} />On</label>
      <button class="icon" data-remove-blackout="${entry.id}">x</button>
    </div>
  `;
}

function renderDisplayPair() {
  $app.className = "pair-shell";
  $app.innerHTML = `
    <section class="pair-card">
      <button class="brand" data-nav="/">SignalBoard</button>
      <h1>Pair this display</h1>
      <p>Enter the code shown in a signage group dashboard.</p>
      <form data-action="pair-display">
        <input name="code" class="code-input" maxlength="6" placeholder="ABC123" autocomplete="off" />
        <button class="primary large">Launch Display</button>
      </form>
    </section>
    ${toast()}
  `;
}

function renderControl() {
  const code = new URLSearchParams(location.search).get("code") || state.playerCode || "";
  $app.className = "control-shell";
  $app.innerHTML = `
    <section class="control-panel">
      <button class="brand" data-nav="/">SignalBoard</button>
      <div>
        <p class="eyebrow">Room controller</p>
        <h1>Control a paired display</h1>
      </div>
      <form class="control-code-form" data-action="control-load">
        <input name="code" class="code-input" maxlength="6" value="${attr(code.toUpperCase())}" placeholder="ABC123" autocomplete="off" />
        <button class="primary">Connect</button>
      </form>
      <div id="controlSurface">${code ? `<p class="muted">Connecting...</p>` : `<p class="muted">Enter the six-character code shown for the signage group.</p>`}</div>
    </section>
    ${toast()}
  `;
  if (code) loadControl(code.toUpperCase());
}

async function loadControl(code) {
  try {
    const { group } = await api(`/api/control/${code}`);
    state.playerCode = code;
    const surface = document.querySelector("#controlSurface");
    if (!surface) return;
    surface.innerHTML = controlSurface(group);
  } catch (error) {
    flash(error.message);
  }
}

function controlSurface(group) {
  return `
    <section class="control-surface">
      <div class="control-status">
        <strong>${escapeHtml(group.name)}</strong>
        <code>${group.code}</code>
      </div>
      <div class="control-grid">
        <div>
          <h2>Layout</h2>
          <div class="control-buttons">
            ${[["command", "Command"], ["media", "Media"], ["calendar", "Calendar"], ["weather", "Weather"], ["workshop", "Workshop"]].map(([key, label]) => `
              <button class="${group.layout === key ? "primary" : "secondary"}" data-control-layout="${key}">${label}</button>
            `).join("")}
          </div>
        </div>
        <div>
          <h2>Theme</h2>
          <div class="control-buttons">
            ${themeOptions().map((theme) => `
              <button class="${group.theme === theme.id ? "primary" : "secondary"}" data-control-theme="${theme.id}">${theme.label}</button>
            `).join("")}
          </div>
        </div>
      </div>
      <div class="module-grid">
        <label class="toggle"><input type="checkbox" data-control-toggle="fillScreen" ${group.settings.fillScreen ? "checked" : ""} />Fill screen</label>
        <label class="toggle"><input type="checkbox" data-control-toggle="showMediaBanner" ${group.settings.showMediaBanner ? "checked" : ""} />Media banner</label>
        <label class="toggle"><input type="checkbox" data-control-toggle="showSeconds" ${group.settings.showSeconds ? "checked" : ""} />Clock seconds</label>
      </div>
      <label>Image overlay <input type="range" min="0" max="90" value="${attr(group.settings.overlayOpacity)}" data-control-range="overlayOpacity" /></label>
      <div>
        <h2>Live Workshop Triggers</h2>
        <div class="control-buttons">
          <button class="primary" data-control-trigger="study" data-duration="1500">Study 25</button>
          <button class="secondary" data-control-trigger="timer" data-duration="300">Timer 5</button>
          <button class="secondary" data-control-trigger="timer" data-duration="900">Timer 15</button>
          <button class="ghost" data-control-trigger="clear">Clear</button>
        </div>
        <form class="inline-form" data-action="control-custom-trigger">
          <input name="label" placeholder="Timer label" value="Focus block" />
          <input name="minutes" type="number" min="1" max="480" value="45" />
          <button class="secondary">Start</button>
        </form>
      </div>
    </section>
  `;
}

async function renderPlayer() {
  const code = new URLSearchParams(location.search).get("code") || state.playerCode;
  if (!code) return renderDisplayPair();
  state.playerCode = code.toUpperCase();
  state.wakeLockWanted = true;
  maintainWakeLock();
  try {
    state.playerGroup = (await api(`/api/player/${state.playerCode}`)).group;
    state.events = [];
    state.weather = null;
    drawPlayer();
    maintainWakeLock();
    refreshPlayerData(true).then(drawPlayer).catch(() => drawPlayer());
  } catch (error) {
    flash(error.message);
    return renderDisplayPair();
  }
  setInterval(async () => {
    if (location.pathname === "/player") {
      try {
        state.playerGroup = (await api(`/api/player/${state.playerCode}`, { quiet: true })).group;
        await refreshPlayerData(true);
        drawPlayer();
      } catch {}
    }
  }, 15000);
}

async function maintainWakeLock() {
  if (!state.wakeLockWanted || location.pathname !== "/player" || document.visibilityState !== "visible") return;
  if (!("wakeLock" in navigator) || state.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
      if (state.wakeLockWanted && location.pathname === "/player" && document.visibilityState === "visible") {
        setTimeout(maintainWakeLock, 500);
      }
    });
  } catch {
    state.wakeLock = null;
  }
}

function releaseWakeLock() {
  state.wakeLockWanted = false;
  if (!state.wakeLock) return;
  const lock = state.wakeLock;
  state.wakeLock = null;
  lock.release().catch(() => {});
}

async function refreshPlayerData(quiet = false) {
  const group = state.playerGroup;
  if (!group) return;
  const jobs = [];
  if (group.modules.calendar || group.modules.events) {
    jobs.push(api(`/api/groups/${group.code}/events`, { quiet })
      .then((data) => {
        state.events = data.events;
        if (location.pathname === "/player") drawPlayer();
      })
      .catch(() => {
        state.events = [];
        if (location.pathname === "/player") drawPlayer();
      }));
  }
  if (group.modules.weather && (group.settings.weatherZip || group.settings.weatherLocation)) {
    const weatherQuery = group.settings.weatherZip || group.settings.weatherLocation;
    jobs.push(api(`/api/weather?location=${encodeURIComponent(weatherQuery)}`, { quiet })
      .then((data) => {
        state.weather = data;
        if (location.pathname === "/player") drawPlayer();
      })
      .catch(() => {
        state.weather = null;
        if (location.pathname === "/player") drawPlayer();
      }));
  }
  await Promise.allSettled(jobs);
}

function drawPlayer() {
  const group = state.playerGroup;
  const blackedOut = isBlackout(group);
  $app.className = `player-shell theme-${group.theme} layout-${group.layout} ${group.settings.fillScreen ? "display-fill" : ""} ${blackedOut ? "blackout" : ""}`;
  $app.style.setProperty("--overlay-alpha", String((group.settings.overlayOpacity ?? 58) / 100));
  if (blackedOut) {
    $app.innerHTML = `<div class="blackout-screen"></div>`;
    return;
  }
  const media = group.media || [];
  const image = media.length ? media[state.mediaIndex % media.length] : null;
  const trigger = activeTrigger(group.liveTrigger);
  $app.innerHTML = `
    <section class="player-main">
      ${mediaStage(group, media, image)}
      <div class="player-copy">
        <p class="eyebrow">${escapeHtml(group.name)} · ${group.code}</p>
        <h1>${escapeHtml(group.settings.headline || group.name)}</h1>
        <p>${escapeHtml(group.settings.subheadline || "")}</p>
      </div>
      ${group.layout === "calendar" ? calendarBoard() : ""}
      ${group.layout === "weather" ? weatherBoard() : ""}
      ${trigger ? triggerView(trigger) : ""}
    </section>
    <aside class="player-rail">
      ${group.modules.clock ? `<div class="rail-tile time-tile ${group.settings.showSeconds ? "with-seconds" : ""}"><span id="clock">${formatTime(group.settings.showSeconds)}</span><small>${group.modules.date ? formatDate() : ""}</small></div>` : ""}
      ${group.modules.calendar || group.modules.events ? eventsTile() : ""}
      ${group.modules.weather ? weatherTile() : ""}
      ${group.modules.countdowns ? countdownsTile(group.countdowns) : ""}
    </aside>
    <button class="fullscreen-button" data-action="fullscreen" title="Fullscreen">⛶</button>
  `;
}

function mediaStage(group, media, image) {
  if (!group.modules.media || !image) return `<div class="visual-block">${escapeHtml(group.layout)}</div>`;
  const items = media.length > 1 ? [...media, ...media] : media;
  if (group.layout === "media") {
    return `
      <div class="media-showcase">
        <img class="player-media hero-media" src="${mediaUrl(image)}" alt="" />
        ${group.settings.showMediaBanner === false ? "" : `<div class="media-scroll" style="--media-count: ${Math.max(1, media.length)}">
          ${items.map((item) => `<img src="${mediaUrl(item)}" alt="" />`).join("")}
        </div>`}
      </div>
    `;
  }
  return `
    <div class="command-media-card">
      <img class="player-media" src="${mediaUrl(image)}" alt="" />
    </div>
  `;
}

function mediaUrl(item) {
  return item?.dataUrl || item?.url || "";
}

function calendarBoard() {
  const today = new Date();
  const range = state.playerGroup?.settings?.calendarRange || "month";
  const cells = calendarCells(today, range);
  const weekdays = range === "month"
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : cells.filter(Boolean).slice(0, range === "three-day" ? 3 : 7).map((date) => formatWeekday(date));
  const title = range === "month"
    ? new Intl.DateTimeFormat([], { month: "long", year: "numeric" }).format(today)
    : calendarRangeTitle(cells.filter(Boolean), range);
  return `
    <section class="calendar-board range-${range}">
      <header>
        <span>${formatDate()}</span>
        <strong>${title}</strong>
      </header>
      <div class="calendar-weekdays">${weekdays.map((day) => `<b>${day}</b>`).join("")}</div>
      <div class="calendar-grid">
        ${cells.map((date) => calendarCell(date, today)).join("")}
      </div>
    </section>
  `;
}

function calendarCells(today, range) {
  if (range !== "month") {
    const total = range === "three-day" ? 3 : range === "week" ? 7 : 14;
    return Array.from({ length: total }, (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + index));
  }
  const year = today.getFullYear();
  const month = today.getMonth();
  const start = new Date(year, month, 1);
  const firstDay = start.getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i += 1) cells.push(null);
  for (let day = 1; day <= days; day += 1) cells.push(new Date(year, month, day));
  while (cells.length % 7) cells.push(null);
  return cells;
}

function calendarCell(date, today) {
  if (!date) return `<div class="calendar-cell empty"></div>`;
  const events = state.events.filter((event) => sameDay(new Date(event.start), date)).slice(0, 4);
  const isToday = sameDay(date, today);
  return `
    <div class="calendar-cell ${isToday ? "today" : ""}">
      <span>${formatCalendarCellDate(date)}</span>
      ${events.map((event) => `<p style="--event-color: ${attr(event.feedColor || "#41d6b3")}"><b></b>${escapeHtml(event.title)}</p>`).join("")}
    </div>
  `;
}

function weatherBoard() {
  if (!state.weather?.current) {
    return `<section class="weather-board"><span>Weather</span><strong>Loading</strong></section>`;
  }
  return `
    <section class="weather-board">
      <div class="weather-art">${weatherIcon(state.weather.current.weather_code, state.weather.current.is_day)}</div>
      <span>${escapeHtml(state.weather.location)}</span>
      <strong>${Math.round(state.weather.current.temperature_2m)}°F</strong>
      <p>${escapeHtml(state.weather.summary)} · Feels like ${Math.round(state.weather.current.apparent_temperature)}°F · ${Math.round(state.weather.current.wind_speed_10m)} mph wind</p>
    </section>
  `;
}

function triggerView(trigger) {
  const remaining = trigger.endsAt ? Math.max(0, new Date(trigger.endsAt).getTime() - Date.now()) : 0;
  return `
    <div class="trigger-display">
      <span>${escapeHtml(trigger.label || (trigger.type === "study" ? "Study Countdown" : "Live Timer"))}</span>
      <strong>${formatDuration(remaining)}</strong>
      <p>${escapeHtml(trigger.message || "In progress")}</p>
    </div>
  `;
}

function weatherTile() {
  if (!state.weather?.current) return `<div class="rail-tile"><small>Weather</small><strong>Loading</strong></div>`;
  return `
    <div class="rail-tile icon-tile weather-tile">
      <div class="tile-art">${weatherIcon(state.weather.current.weather_code, state.weather.current.is_day)}</div>
      <div>
        <small>${escapeHtml(state.weather.location)}</small>
        <strong>${Math.round(state.weather.current.temperature_2m)}°F</strong>
        <span>${escapeHtml(state.weather.summary)} · ${Math.round(state.weather.current.wind_speed_10m)} mph</span>
      </div>
    </div>
  `;
}

function eventsTile() {
  const now = Date.now();
  const live = state.events.find((event) => new Date(event.start).getTime() <= now && new Date(event.end).getTime() >= now);
  const upcoming = state.events.filter((event) => new Date(event.start).getTime() > now).slice(0, 6);
  return `
    <div class="rail-tile event-list primary-events">
      <small>${live ? "Happening now" : "Upcoming calendar"}</small>
      ${live ? eventCard(live, true) : ""}
      ${upcoming.map((event, index) => eventCard(event, index === 0 && !live)).join("") || (!live ? "<p>No upcoming events</p>" : "")}
    </div>
  `;
}

function eventCard(event, featured = false) {
  const color = event.feedColor || "#41d6b3";
  const now = Date.now();
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  const live = start <= now && end >= now;
  return `
    <article class="event-card ${featured ? "featured" : ""}" style="--event-color: ${attr(color)}">
      <span class="event-color"></span>
      <div class="event-date">
        <b>${formatEventMonth(event.start)}</b>
        <strong>${formatEventDay(event.start)}</strong>
      </div>
      <div class="event-body">
        <div class="event-meta">
          <span>${escapeHtml(event.feedName || "Calendar")}</span>
          <span>${formatShortTime(event.start)}${event.end ? `-${formatShortTime(event.end)}` : ""}</span>
        </div>
        <h3>${escapeHtml(event.title)}</h3>
        ${event.location ? `<p>${escapeHtml(event.location)}</p>` : ""}
        ${live ? `<em>${formatDuration(end - now)} left</em>` : ""}
      </div>
    </article>
  `;
}

function countdownsTile(countdowns) {
  const enabled = (countdowns || []).filter((timer) => timer.enabled).slice(0, 4);
  return `
    <div class="rail-tile icon-tile countdown-list">
      <div class="tile-art">${themeWidgetIcon(state.playerGroup?.theme)}</div>
      <div>
      <small>Countdowns</small>
      ${enabled.map((timer) => {
        const diff = Date.now() - new Date(timer.target).getTime();
        const ms = timer.mode === "countup" ? Math.max(0, diff) : Math.max(0, -diff);
        return `<p><b>${escapeHtml(timer.name)}</b><span>${formatSmartDuration(ms)}</span></p>`;
      }).join("") || "<p>No active timers</p>"}
      </div>
    </div>
  `;
}

async function handleSubmit(event) {
  const form = event.target.closest("form");
  if (!form) return;
  const action = form.dataset.action;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (action === "register" || action === "login") {
      const result = await authRequest(action, data);
      state.user = result.user;
      navigate("/dashboard");
    }
    if (action === "save-group") {
      collectBasicSettings(form);
      await saveActiveGroup();
      flash("Group saved.");
    }
    if (action === "custom-trigger") {
      await sendTrigger("timer", Number(data.minutes) * 60, data.label);
    }
    if (action === "pair-display") {
      const code = String(data.code || "").trim().toUpperCase();
      navigate(`/player?code=${encodeURIComponent(code)}`);
    }
    if (action === "control-load") {
      const code = String(data.code || "").trim().toUpperCase();
      history.replaceState(null, "", `/control?code=${encodeURIComponent(code)}`);
      await loadControl(code);
    }
    if (action === "control-custom-trigger") {
      await sendControl({ trigger: { type: "timer", durationSeconds: Number(data.minutes) * 60, label: data.label } });
    }
    if (action === "add-image-links") {
      if (!state.activeGroup) return;
      const urls = String(data.imageLinks || "")
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => /^https:\/\/\S+$/i.test(value))
        .slice(0, Math.max(0, 100 - state.activeGroup.media.length));
      if (!urls.length) throw new Error("Paste at least one direct https image URL.");
      const existing = new Set(state.activeGroup.media.map((item) => item.dataUrl));
      const additions = urls
        .filter((url) => !existing.has(url))
        .map((url, index) => ({
          id: uid("img"),
          name: imageLinkName(url, index),
          dataUrl: url,
          durationSeconds: 12
        }));
      if (!additions.length) throw new Error("Those image links are already in this group.");
      state.activeGroup.media.push(...additions);
      markGroupChanged();
      renderDashboard();
      await saveActiveGroup();
      flash(`${additions.length} image link${additions.length === 1 ? "" : "s"} saved.`);
    }
  } catch (error) {
    flash(error.message);
  }
}

async function handleClick(event) {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    const path = nav.dataset.nav;
    if (path.startsWith("#")) document.querySelector(path)?.scrollIntoView({ behavior: "smooth" });
    else navigate(path);
  }
  const groupButton = event.target.closest("[data-group-id]");
  if (groupButton) {
    state.activeGroup = (await api(`/api/groups/${groupButton.dataset.groupId}`)).group;
    renderDashboard();
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  const themeChoice = event.target.closest("[data-select-theme]");
  if (themeChoice && state.activeGroup) {
    state.activeGroup.theme = themeChoice.dataset.selectTheme;
    markGroupChanged();
    renderDashboard();
    await saveActiveGroup();
    flash("Theme selected. Recommended calendar colors are ready above the calendar list.");
  }
  if (action === "new-group") {
    const result = await api("/api/groups", { method: "POST", body: { name: "New Signage Group" } });
    state.activeGroup = result.group;
    await renderDashboard();
  }
  if (action === "logout") {
    if (window.signalFirebase?.enabled) await window.signalFirebase.logout();
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    state.activeGroup = null;
    navigate("/");
  }
  if (action === "google-login") {
    try {
      if (!window.signalFirebase?.enabled) throw new Error("Firebase Auth is not configured yet.");
      const result = await window.signalFirebase.google();
      state.user = result.user;
      navigate("/dashboard");
    } catch (error) {
      flash(error.message);
    }
  }
  if (action === "apply-theme-calendar-colors" && state.activeGroup) {
    const palette = themePalette(state.activeGroup.theme);
    state.activeGroup.calendarFeeds.forEach((feed, index) => {
      feed.color = palette[index % palette.length];
    });
    markGroupChanged();
    await saveActiveGroup();
    renderDashboard();
    flash("Recommended calendar colors applied.");
  }
  if (action === "delete-group" && state.activeGroup && confirm("Delete this signage group?")) {
    await api(`/api/groups/${state.activeGroup.id}`, { method: "DELETE" });
    state.activeGroup = null;
    await renderDashboard();
  }
  if (action === "fullscreen") {
    const target = document.documentElement;
    if (!document.fullscreenElement && target.requestFullscreen) await target.requestFullscreen();
  }
  const controlLayout = event.target.closest("[data-control-layout]");
  if (controlLayout) await sendControl({ layout: controlLayout.dataset.controlLayout });
  const controlTheme = event.target.closest("[data-control-theme]");
  if (controlTheme) await sendControl({ theme: controlTheme.dataset.controlTheme });
  const controlTrigger = event.target.closest("[data-control-trigger]");
  if (controlTrigger) await sendControl({ trigger: { type: controlTrigger.dataset.controlTrigger, durationSeconds: Number(controlTrigger.dataset.duration || 0) } });
  if (action === "add-calendar") await mutateGroup((group) => group.calendarFeeds.push({ id: uid("cal"), name: "Calendar", url: "", color: themePalette(group.theme)[group.calendarFeeds.length % themePalette(group.theme).length], enabled: true }));
  if (action === "add-countdown") await mutateGroup((group) => group.countdowns.push({ id: uid("cnt"), name: "Launch", mode: "countdown", target: new Date(Date.now() + 86400_000).toISOString(), enabled: true }));
  if (action === "add-blackout") await mutateGroup((group) => group.blackoutTimes.push({ id: uid("blk"), name: "Evening blackout", start: "22:00", end: "06:00", days: [0,1,2,3,4,5,6], enabled: true }));
  const trigger = event.target.closest("[data-trigger]");
  if (trigger) await sendTrigger(trigger.dataset.trigger, Number(trigger.dataset.duration || 0));
  const preview = event.target.closest("[data-open-player]");
  if (preview) window.open(`/player?code=${preview.dataset.openPlayer}`, "_blank");
  await removeByClick(event, "data-remove-calendar", "calendarFeeds");
  await removeByClick(event, "data-remove-countdown", "countdowns");
  await removeByClick(event, "data-remove-blackout", "blackoutTimes");
  await removeByClick(event, "data-remove-media", "media");
}

async function handleChange(event) {
  if (!state.activeGroup) return;
  if (event.target.matches("[data-action='upload-images']")) {
    const files = [...event.target.files].slice(0, 10);
    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      state.activeGroup.media.push({ id: uid("img"), name: file.name, dataUrl, durationSeconds: 12 });
    }
    markGroupChanged();
    renderDashboard();
    try {
      await saveActiveGroup();
      flash("Images saved.");
      renderDashboard();
    } catch (error) {
      flash(error.message);
    }
  }
  handleInput(event);
  if (event.target.dataset.field) await saveActiveGroup();
}

function handleInput(event) {
  const controlToggle = event.target.dataset.controlToggle;
  if (controlToggle) {
    sendControl({ [controlToggle]: event.target.checked });
    return;
  }
  const controlRange = event.target.dataset.controlRange;
  if (controlRange) {
    clearTimeout(handleInput.controlRangeTimer);
    handleInput.controlRangeTimer = setTimeout(() => sendControl({ [controlRange]: Number(event.target.value) }), 250);
    return;
  }
  const field = event.target.dataset.field;
  if (!field || !state.activeGroup) return;
  const [kind, prop] = field.split(":");
  const row = event.target.closest("[data-calendar-id],[data-countdown-id],[data-blackout-id]");
  if (!row) return;
  const collections = { cal: "calendarFeeds", count: "countdowns", black: "blackoutTimes" };
  const idAttr = { cal: "calendarId", count: "countdownId", black: "blackoutId" };
  const item = state.activeGroup[collections[kind]].find((entry) => entry.id === row.dataset[idAttr[kind]]);
  if (!item) return;
  item[prop] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  if (prop === "target") item[prop] = new Date(event.target.value).toISOString();
  markGroupChanged();
  debounceSave();
}

async function sendControl(payload) {
  if (!state.playerCode) return;
  const { group } = await api(`/api/control/${state.playerCode}`, { method: "POST", body: payload });
  const surface = document.querySelector("#controlSurface");
  if (surface) surface.innerHTML = controlSurface(group);
  flash("Display updated.");
}

async function authRequest(action, data) {
  await window.signalFirebase?.ready;
  if (window.signalFirebase?.enabled) {
    if (action === "register") return window.signalFirebase.register(data.email, data.password, data.name);
    return window.signalFirebase.login(data.email, data.password);
  }
  return api(`/api/auth/${action}`, { method: "POST", body: data });
}

function collectBasicSettings(form) {
  const fd = new FormData(form);
  const group = state.activeGroup;
  group.name = fd.get("name");
  group.theme = fd.get("theme");
  group.layout = fd.get("layout");
  group.settings.headline = fd.get("headline");
  group.settings.subheadline = fd.get("subheadline");
  group.settings.weatherLocation = fd.get("weatherLocation");
  group.settings.weatherZip = fd.get("weatherZip");
  group.settings.fillScreen = fd.get("fillScreen") === "on";
  group.settings.showMediaBanner = fd.get("showMediaBanner") === "on";
  group.settings.showSeconds = fd.get("showSeconds") === "on";
  group.settings.overlayOpacity = Number(fd.get("overlayOpacity") || 58);
  group.settings.calendarRange = fd.get("calendarRange") || "month";
  for (const key of Object.keys(group.modules)) group.modules[key] = fd.get(`module:${key}`) === "on";
  markGroupChanged();
}

async function sendTrigger(type, durationSeconds = 0, label = "") {
  await api(`/api/groups/${state.activeGroup.id}/trigger`, { method: "POST", body: { type, durationSeconds, label } });
  state.activeGroup = (await api(`/api/groups/${state.activeGroup.id}`)).group;
  flash(type === "clear" ? "Trigger cleared." : "Trigger sent.");
  renderDashboard();
}

async function mutateGroup(mutator) {
  mutator(state.activeGroup);
  markGroupChanged();
  await saveActiveGroup();
  renderDashboard();
}

async function removeByClick(event, attrName, collection) {
  const button = event.target.closest(`[${attrName}]`);
  if (!button || !state.activeGroup) return;
  const idValue = button.getAttribute(attrName);
  state.activeGroup[collection] = state.activeGroup[collection].filter((item) => item.id !== idValue);
  markGroupChanged();
  await saveActiveGroup();
  renderDashboard();
}

function markGroupChanged() {
  state.groupRevision += 1;
}

let saveTimer;
function debounceSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveActiveGroup, 500);
}

async function saveActiveGroup() {
  if (!state.activeGroup) return;
  const revision = state.groupRevision;
  const snapshot = JSON.parse(JSON.stringify(state.activeGroup));
  const result = await api(`/api/groups/${snapshot.id}`, { method: "PUT", body: { group: snapshot } });
  if (revision === state.groupRevision) {
    state.activeGroup = result.group;
  }
}

function tick() {
  if (location.pathname === "/player" && state.playerGroup) {
    const media = state.playerGroup.media || [];
    if (media.length) {
      const current = media[state.mediaIndex % media.length];
      const elapsed = Math.floor(Date.now() / 1000);
      if (elapsed % (current.durationSeconds || 12) === 0) state.mediaIndex += 1;
    }
    drawPlayer();
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || "Request failed.";
    if (!options.quiet) flash(message);
    throw new Error(message);
  }
  return data;
}

function select(name, value, options, attrName = "name") {
  return `<select ${attrName}="${name}">${options.map(([key, label]) => `<option value="${key}" ${key === value ? "selected" : ""}>${label}</option>`).join("")}</select>`;
}

function themeOptions() {
  return [
    { id: "sun-bleached", label: "Beach House Sun Bleached", tagline: "Airy, light, and minimal with sun-bleached neutrals.", palette: ["#ecdcc6", "#d9c3a7", "#b6cad5", "#7f9fb0"] },
    { id: "coastal-fog", label: "Coastal Fog", tagline: "Cool, misty, and relaxed with soft coastal blues.", palette: ["#cfdbe1", "#a8bbc6", "#6e8c9f", "#eef3f5"] },
    { id: "coastal-sand", label: "Coastal Sand", tagline: "Light and airy with soft neutrals and ocean accents.", palette: ["#8ad9e0", "#b6ddd2", "#ffd39a", "#cbc1d3"] },
    { id: "beach-house", label: "Beach House", tagline: "Airy, sun-bleached, and coastal with sandy neutrals and ocean blues.", palette: ["#69c6d8", "#63b9cd", "#3f8fb3", "#2964a1"] },
    { id: "sea-glass", label: "Sea Glass", tagline: "Cool, fresh, and tranquil with sea glass greens and soft aqua tones.", palette: ["#bde4db", "#89c7bb", "#559f9b", "#2f7b7c"] },
    { id: "coastal-navy", label: "Coastal Navy", tagline: "Nautical and timeless with deep navy, crisp white, and ocean accents.", palette: ["#f5f7fb", "#6ba7d4", "#3f82bd", "#16528c"] },
    { id: "coral-coast", label: "Coral Coast", tagline: "Warm, vibrant, and tropical with coral tones and sandy neutrals.", palette: ["#ffb39d", "#ff907f", "#f8756b", "#e85f58"] },
    { id: "dune-house", label: "Dune House", tagline: "Warm oat, clay beige, seafoam hints.", palette: ["#d8cbb8", "#b99b78", "#8e5c35", "#99b8b0"] },
    { id: "cape-cod-morning", label: "Cape Cod Morning", tagline: "Foggy blue-grays with driftwood neutrals.", palette: ["#dbe5ea", "#a7bac8", "#6f91a7", "#294f6b"] },
    { id: "graphite-sand", label: "Graphite & Sand", tagline: "Matte charcoal with warm coastal beige highlights.", palette: ["#2f3438", "#565f62", "#b89b67", "#d8c7a5"] },
    { id: "champagne-coast", label: "Champagne Coast", tagline: "Ivory, champagne gold, muted stone.", palette: ["#fbf6ed", "#e2d3bd", "#bd8a52", "#7b5a38"] },
    { id: "moonlit-marina", label: "Moonlit Marina", tagline: "Dark navy, calm cyan glow, muted blues.", palette: ["#0b2233", "#13364b", "#39b8cf", "#82d6e6"] },
    { id: "after-hours-beach-house", label: "After Hours Beach House", tagline: "Charcoal, warm amber lighting, deep coast.", palette: ["#262b2f", "#3a3a34", "#c58d36", "#e4b765"] },
    { id: "graphite", label: "Graphite Glass", tagline: "Dark glass with crisp contrast and cool neutral accents.", palette: ["#bfc9d2", "#8aa2b1", "#617886", "#3d4a54"] }
  ];
}

function selectedTheme(id) {
  return themeOptions().find((theme) => theme.id === id) || themeOptions()[0];
}

function themePalette(id) {
  return selectedTheme(id).palette;
}

function themePreviewCard(theme, current, media) {
  const image = mediaUrl(media);
  return `
    <button class="theme-card ${theme.id === current ? "selected" : ""}" type="button" data-select-theme="${theme.id}">
      <span class="theme-shot ${image ? "has-image" : ""}" style="--preview-a:${attr(theme.palette[0])};--preview-b:${attr(theme.palette[1])};${image ? `--preview-image:url('${attr(image)}')` : ""}">
        <i></i><b></b><em></em>
      </span>
      <strong>${escapeHtml(theme.label)}</strong>
      <small>${escapeHtml(theme.tagline)}</small>
      <span class="theme-swatches">${theme.palette.map((color) => `<i style="--swatch:${attr(color)}"></i>`).join("")}</span>
    </button>
  `;
}

function calendarPaletteRecommendation(group) {
  const theme = selectedTheme(group.theme);
  return `
    <div class="palette-recommendation">
      <div>
        <small>Recommended calendar colors for ${escapeHtml(theme.label)}</small>
        <span>${theme.palette.map((color) => `<i style="--swatch:${attr(color)}"></i>`).join("")}</span>
      </div>
      <button class="secondary" type="button" data-action="apply-theme-calendar-colors">Apply Colors</button>
    </div>
  `;
}

function weatherIcon(code, isDay = 1) {
  const value = Number(code);
  if ([95, 96, 99].includes(value)) return `<span class="weather-glyph storm">ϟ</span>`;
  if ([61, 63, 65, 80, 81, 82, 51, 53, 55].includes(value)) return `<span class="weather-glyph rain">☔</span>`;
  if ([71, 73, 75, 77, 85, 86].includes(value)) return `<span class="weather-glyph snow">❄</span>`;
  if ([2, 3, 45, 48].includes(value)) return `<span class="weather-glyph cloud">☁</span>`;
  return `<span class="weather-glyph ${isDay ? "sun" : "moon"}">${isDay ? "☼" : "☾"}</span>`;
}

function themeWidgetIcon(themeId) {
  const map = {
    "sun-bleached": "⌁",
    "coastal-fog": "≈",
    "coastal-sand": "◔",
    "beach-house": "⌇",
    "sea-glass": "✦",
    "coastal-navy": "⚓",
    "coral-coast": "✹",
    "dune-house": "▣",
    "cape-cod-morning": "≋",
    "graphite-sand": "◩",
    "champagne-coast": "⌘",
    "moonlit-marina": "☾",
    "after-hours-beach-house": "☼",
    graphite: "◆"
  };
  return `<span class="widget-glyph">${map[themeId] || "◆"}</span>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function activeTrigger(trigger) {
  if (!trigger) return null;
  if (trigger.endsAt && new Date(trigger.endsAt).getTime() < Date.now()) return null;
  return trigger;
}

function isBlackout(group) {
  const now = new Date();
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return (group.blackoutTimes || []).some((entry) => {
    if (!entry.enabled || (entry.days.length && !entry.days.includes(day))) return false;
    const start = timeMinutes(entry.start);
    const end = timeMinutes(entry.end);
    return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  });
}

function timeMinutes(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(showSeconds = false) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", second: showSeconds ? "2-digit" : undefined }).format(new Date());
}

function formatDate() {
  return new Intl.DateTimeFormat([], { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

function formatShortTime(value) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatEventMonth(value) {
  return new Intl.DateTimeFormat([], { month: "short" }).format(new Date(value));
}

function formatEventDay(value) {
  return new Intl.DateTimeFormat([], { day: "2-digit" }).format(new Date(value));
}

function formatWeekday(value) {
  return new Intl.DateTimeFormat([], { weekday: "short" }).format(value);
}

function formatCalendarCellDate(value) {
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(value);
}

function calendarRangeTitle(dates, range) {
  const first = dates[0] || new Date();
  const last = dates[dates.length - 1] || first;
  const prefix = range === "three-day" ? "3 Days" : range === "week" ? "1 Week" : "2 Weeks";
  return `${prefix} · ${new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(first)} - ${new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(last)}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSmartDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function toLocalInput(iso) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function flash(message) {
  state.toast = message;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    state.toast = "";
    document.querySelector(".toast")?.remove();
  }, 3500);
}

function toast() {
  return state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : "";
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function labelize(value) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function calendarPalette(index) {
  return ["#41d6b3", "#f2b84b", "#7da8ff", "#ff7a90", "#9be564", "#c084fc", "#5ee7ff", "#ff9f68"][index % 8];
}

function imageLinkName(url, index) {
  try {
    const parsed = new URL(url);
    const leaf = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    return (leaf || parsed.hostname || `Linked image ${index + 1}`).slice(0, 100);
  } catch {
    return `Linked image ${index + 1}`;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function attr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
