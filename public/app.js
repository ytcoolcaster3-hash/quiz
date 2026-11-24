/* =========================================================
   Quiz-Ecke – App im Browser
   Mitspieler · Präsentationsmodus (Host) · Admin
   ========================================================= */
"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const LETTERS = ["A", "B", "C", "D"];
const MAX_OPTIONS = 4;
const RING = 2 * Math.PI * 26; // Umfang des Timer-Rings

// Antwort-Symbole: fette Buchstaben in farbigen Feldern
const SHAPES = LETTERS;

/* ---------- Kleine Helfer ---------- */

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* privat */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* privat */ } },
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function setMessage(element, text, isError) {
  element.textContent = text;
  element.className = "message " + (text ? (isError ? "error" : "success") : "");
}

let toastTimer = null;
function toast(text) {
  const element = $("#toast");
  element.textContent = text;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2800);
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function animateNumber(element, from, to, duration = 900) {
  if (!element) return;
  if (reducedMotion() || from === to) { element.textContent = to.toLocaleString("de-DE"); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    element.textContent = Math.round(from + (to - from) * eased).toLocaleString("de-DE");
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const fmt = (number) => Number(number || 0).toLocaleString("de-DE");

function newDeviceId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) + "-a" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
}

let deviceId = store.get("quiz-device-id");
if (!deviceId || !/^[a-f0-9-]{36}$/i.test(deviceId)) {
  deviceId = newDeviceId();
  store.set("quiz-device-id", deviceId);
}

async function api(url, data) {
  let response;
  try {
    response = await fetch(url, {
      method: data ? "POST" : "GET",
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch {
    throw new Error("Keine Verbindung zum Quiz. Bitte versuche es gleich nochmal.");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Der Quiz-Server hat gerade keine lesbare Antwort gesendet. Bitte versuche es erneut.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "Da ist etwas schiefgelaufen.");
    error.status = response.status;
    throw error;
  }
  return result;
}

/* ---------- Sound (wird im Browser erzeugt, keine Dateien nötig) ---------- */

const Sound = (() => {
  let context = null;
  let muted = store.get("quiz-muted") === "1";

  function ensure() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!context) context = new AudioCtx();
    if (context.state === "suspended") context.resume();
    return context;
  }

  function tone(freq, at, duration, type = "sine", volume = 0.12, slideTo = 0) {
    const ctx = context;
    const start = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  const effects = {
    click: () => tone(720, 0, 0.07, "triangle", 0.07),
    pop: () => { tone(500, 0, 0.09, "sine", 0.1, 900); },
    join: () => { tone(660, 0, 0.1, "sine", 0.1); tone(990, 0.08, 0.14, "sine", 0.1); },
    count: () => tone(540, 0, 0.16, "triangle", 0.13),
    go: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.06, 0.2, "triangle", 0.11)),
    tick: () => tone(1250, 0, 0.035, "square", 0.025),
    lock: () => { tone(880, 0, 0.08, "triangle", 0.1); tone(1320, 0.06, 0.12, "triangle", 0.08); },
    correct: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.07, 0.3, "sine", 0.12)),
    wrong: () => { tone(300, 0, 0.3, "sawtooth", 0.06, 180); tone(200, 0.2, 0.4, "sawtooth", 0.06, 120); },
    reveal: () => { tone(392, 0, 0.18, "triangle", 0.1); tone(523, 0.12, 0.18, "triangle", 0.1); tone(784, 0.24, 0.35, "triangle", 0.12); },
    whoosh: () => tone(200, 0, 0.35, "sine", 0.06, 900),
    drumroll: () => { for (let i = 0; i < 26; i += 1) tone(110 + (i % 2) * 8, i * 0.1, 0.07, "square", 0.03 + i * 0.002); },
    fanfare: () => {
      const notes = [[523, 0, 0.18], [523, 0.2, 0.18], [523, 0.4, 0.18], [659, 0.6, 0.5], [587, 1.15, 0.2], [659, 1.4, 0.2], [784, 1.65, 0.8]];
      notes.forEach(([f, at, d]) => { tone(f, at, d, "triangle", 0.12); tone(f / 2, at, d, "sine", 0.06); });
    },
  };

  function play(name) {
    if (muted || !effects[name]) return;
    if (!ensure()) return;
    try { effects[name](); } catch { /* egal */ }
  }

  function setMuted(value) {
    muted = value;
    store.set("quiz-muted", value ? "1" : "0");
    $("#sound-toggle").textContent = muted ? "🔇" : "🔊";
  }

  // Browser erlauben Ton erst nach einer Berührung.
  window.addEventListener("pointerdown", () => { if (!muted) ensure(); }, { once: true });

  return { play, setMuted, isMuted: () => muted };
})();

/* ---------- Effekte ---------- */

function launchConfetti(amount = 140) {
  if (reducedMotion()) return;
  const colors = ["#c6f432", "#ff5a1f", "#2b4eff", "#111111", "#ffc531", "#ffffff"];
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  for (let i = 0; i < amount; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    const size = 6 + Math.random() * 8;
    piece.style.left = Math.random() * 100 + "%";
    piece.style.width = size + "px";
    piece.style.height = (Math.random() < 0.3 ? size : size * 1.7) + "px";
    if (Math.random() < 0.25) piece.style.borderRadius = "50%";
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty("--dur", 2.6 + Math.random() * 2.8 + "s");
    piece.style.setProperty("--delay", Math.random() * 1.4 + "s");
    piece.style.setProperty("--drift", Math.random() * 240 - 120 + "px");
    piece.style.setProperty("--spin", 360 + Math.random() * 900 + "deg");
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 7000);
}

function burst(emojis, x = window.innerWidth / 2, y = window.innerHeight / 2.6, count = 14) {
  if (reducedMotion()) return;
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    piece.className = "burst";
    piece.textContent = emojis[i % emojis.length];
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const distance = 110 + Math.random() * 140;
    piece.style.left = x + "px";
    piece.style.top = y + "px";
    piece.style.setProperty("--bx", Math.cos(angle) * distance + "px");
    piece.style.setProperty("--by", Math.sin(angle) * distance + "px");
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 1100);
  }
}


/* ---------- Bausteine für Antworten, Ringe, Ranglisten ---------- */

function shape(index) {
  return "<span class='shape'>" + SHAPES[index] + "</span>";
}

function timerRing(id, large) {
  return "<div class='timer-ring" + (large ? " large" : "") + "' id='" + id + "'>"
    + "<svg viewBox='0 0 64 64'><circle class='ring-bg' cx='32' cy='32' r='26'/>"
    + "<circle class='ring-fg' cx='32' cy='32' r='26' stroke-dasharray='" + RING.toFixed(2) + "' stroke-dashoffset='0'/></svg>"
    + "<span class='ring-num'></span></div>";
}

function setRing(ring, remainingMs, durationMs) {
  if (!ring) return;
  const fraction = durationMs ? Math.max(0, Math.min(1, remainingMs / durationMs)) : 0;
  ring.querySelector(".ring-fg").style.strokeDashoffset = (RING * (1 - fraction)).toFixed(2);
  ring.querySelector(".ring-num").textContent = Math.ceil(remainingMs / 1000);
}

function pointsTag(points) {
  if (points === "double") return "<span class='points-tag double'>⚡ Doppelte Punkte</span>";
  if (points === "none") return "<span class='points-tag none'>Ohne Punkte</span>";
  return "";
}

function leaderboardRows(players, options = {}) {
  const { limit = players.length, meName = "", showExtra = false, animate = true, offset = 0 } = options;
  const medals = ["🥇", "🥈", "🥉"];
  const rows = [];
  const lower = meName.toLowerCase();
  const meIndex = lower ? players.findIndex((p) => p.name.toLowerCase() === lower) : -1;
  players.slice(0, limit).forEach((player, index) => {
    rows.push(row(player, index));
  });
  if (meIndex >= limit) {
    rows.push("<div class='lb-sep'>• • •</div>");
    rows.push(row(players[meIndex], meIndex));
  }
  function row(player, index) {
    const isMe = index === meIndex;
    return "<div class='lb-row" + (isMe ? " me" : "") + "'" + (animate ? " style='animation-delay:" + Math.min(index, 8) * 0.07 + "s'" : "") + ">"
      + "<span class='lb-rank'>" + (medals[index + offset] || index + offset + 1) + "</span>"
      + "<span class='lb-avatar'>" + escapeHtml(player.avatar || "🙂") + "</span>"
      + "<span class='lb-name'>" + escapeHtml(player.name) + (isMe ? " (du)" : "") + "</span>"
      + (showExtra ? "<span class='lb-extra'>" + (player.correct || 0) + " richtig</span>" : "")
      + (player.streak >= 2 && !showExtra ? "<span class='lb-extra'>🔥" + player.streak + "</span>" : "")
      + "<span class='lb-score' data-score='" + player.score + "'>" + fmt(player.score) + "</span></div>";
  }
  return rows.join("") || "<p class='empty-hint'>Noch keine Punkte.</p>";
}

// Spieler-Chips: Nur neue Namen bekommen die Einflug-Animation.
function renderChips(container, players, known, options = {}) {
  const signature = JSON.stringify(players.map((p) => [p.name, p.avatar])) + "|" + (options.meName || "");
  if (container.dataset.sig === signature) return false;
  container.dataset.sig = signature;
  const lowerMe = (options.meName || "").toLowerCase();
  let added = false;
  container.innerHTML = players.length
    ? players.map((player) => {
        const isNew = !known.has(player.name);
        if (isNew) { known.add(player.name); added = true; }
        return "<span class='player-chip" + (isNew ? " new" : "") + (player.name.toLowerCase() === lowerMe ? " me" : "")
          + "' data-name='" + escapeHtml(player.name) + "'" + (options.kickable ? " title='Entfernen'" : "") + ">"
          + "<span class='chip-avatar'>" + escapeHtml(player.avatar || "🙂") + "</span>"
          + "<span class='chip-name'>" + escapeHtml(player.name) + "</span></span>";
      }).join("")
    : "<p class='empty-hint'>" + (options.empty || "Noch niemand da.") + "</p>";
  return added;
}

function podiumHTML(podium) {
  const slots = [
    { place: 2, index: 1, className: "podium-second" },
    { place: 1, index: 0, className: "podium-first" },
    { place: 3, index: 2, className: "podium-third" },
  ];
  return slots.map((slot) => {
    const player = podium[slot.index];
    return "<div class='podium-item " + slot.className + (player ? "" : " podium-empty") + "'>"
      + "<div class='podium-avatar'>" + (player ? escapeHtml(player.avatar || "🙂") : "–") + "</div>"
      + "<strong class='podium-name'>" + (player ? escapeHtml(player.name) : "Noch niemand") + "</strong>"
      + "<div class='podium-score'>" + (player ? fmt(player.score) + " Punkte" : "—") + "</div>"
      + "<div class='podium-stand'>" + slot.place + "</div></div>";
  }).join("");
}

function revealRows(state, myAnswers = []) {
  const { reveal, question } = state;
  const total = Math.max(1, reveal.counts.reduce((sum, value) => sum + value, 0));
  return question.options.map((option, index) => {
    const correct = reveal.correctIndices.includes(index);
    const mine = myAnswers.includes(index);
    const count = reveal.counts[index] || 0;
    return "<div class='reveal-row " + (correct ? "correct" : "wrong") + "' style='--c:var(--a" + index + ")'>"
      + "<span class='bar' data-width='" + Math.round((count / total) * 100) + "'></span>"
      + shape(index)
      + "<span class='rr-text'>" + escapeHtml(option) + (mine ? " <span class='mine-tag'>deine Wahl</span>" : "") + "</span>"
      + "<span class='rr-count'>" + count + "</span>"
      + "<span class='rr-mark'>" + (correct ? "✓" : "") + "</span></div>";
  }).join("");
}

function growBars(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$(".bar[data-width]", root).forEach((bar) => { bar.style.width = bar.dataset.width + "%"; });
  }));
}

/* ---------- Konfiguration (Sponsor usw.) ---------- */

let config = {
  sponsorName: "ITB Projekt",
  sponsorUrl: "",
  eventBadge: "",
  avatars: ["🦊", "🐼", "🐸", "🦁", "🐯", "🐨", "🐵", "🦄", "🐙", "🐳", "🦖", "🐝", "🦉", "🐧", "🐰", "🐱", "🐶", "🐻", "🐲", "👾", "🤖", "👻", "🚀", "🌈"],
  maxPlayers: 40,
};

function applyConfig() {
  $$(".sponsor-name").forEach((element) => { element.textContent = config.sponsorName; });
  $$(".sponsor-link").forEach((link) => {
    if (config.sponsorUrl) link.href = config.sponsorUrl;
    else link.removeAttribute("href");
  });
  const badge = $("#event-badge");
  badge.textContent = config.eventBadge || "";
  badge.classList.toggle("hidden", !config.eventBadge);
  buildAvatarGrid();
}

api("/api/config").then((result) => {
  config = { ...config, ...result };
  applyConfig();
}).catch(() => applyConfig());

/* =========================================================
   Zustand
   ========================================================= */

// Mitspieler
let playerCode = store.get("quiz-code") || "";
let chosenAvatar = store.get("quiz-avatar") || "";
let lastState = null;
let joinError = "";
let wasJoined = false;
let stageKey = "";
let builtNumber = 0;
let selected = new Set();
let answerError = "";
let playerClock = { key: "", endsAt: 0, duration: 0 };
let lastCountShown = 0;
let lastTickSecond = 0;
let finishedSignature = "";
let celebrated = false;
let preloadedImage = "";
const lobbyKnown = new Set();

// Präsentationsmodus
let hostOpen = false;
let hostQuiz = null;      // { id, code, name }
let hostState = null;
let hostKey = "";
let hostClock = { key: "", endsAt: 0, duration: 0 };
let hostCountShown = 0;
let hostTickSecond = 0;
let hostCelebrated = false;
const hostKnown = new Set();
let qrLoader = null;

// Admin
let adminOpen = false;
let adminAuth = null;     // { email, password } – nur im Speicher, nie auf der Platte
let adminQuiz = null;     // { id, name, code, settings }
let draft = [];
let dirty = false;
let listSignature = "";

/* ---------- Ansichten ---------- */

function showView(name) {
  for (const view of ["join", "lobby", "game", "finished", "admin", "host"]) {
    $("#view-" + view).classList.toggle("hidden", view !== name);
  }
}

function inGame(state) {
  return state && state.status === "playing" && state.me && state.me.inRound && state.question;
}

function updateView() {
  let view = "join";
  if (hostOpen) view = "host";
  else if (adminOpen) view = "admin";
  else if (playerCode) {
    view = "lobby";
    if (lastState) {
      if (inGame(lastState)) view = "game";
      else if (lastState.status === "finished") view = "finished";
    }
  }
  showView(view);
  document.body.classList.toggle("host-mode", hostOpen);
  $("#admin-toggle").textContent = adminOpen ? "← Zum Quiz" : "⚙️ Admin";
  $("#admin-login").classList.toggle("hidden", Boolean(adminAuth));
  $("#admin-panel").classList.toggle("hidden", !adminAuth);
  $("#admin-list-view").classList.toggle("hidden", Boolean(adminQuiz));
  $("#admin-quiz-view").classList.toggle("hidden", !adminQuiz);
  $("#admin-title").textContent = adminQuiz ? "Quiz bearbeiten" : "Admin";
}

/* =========================================================
   Startseite
   ========================================================= */

function resetPlayerState() {
  lastState = null;
  joinError = "";
  wasJoined = false;
  stageKey = "";
  builtNumber = 0;
  selected = new Set();
  finishedSignature = "";
  celebrated = false;
  lobbyKnown.clear();
  $("#queue").dataset.sig = "";
  $("#game-stage").innerHTML = "";
}

function leaveQuiz(message) {
  playerCode = "";
  resetPlayerState();
  store.remove("quiz-code");
  setMessage($("#code-message"), message || "", true);
  updateView();
}

async function enterCode(raw) {
  const code = String(raw || "").trim().toUpperCase();
  const input = $("#code-input");
  if (!code) return;
  try {
    const state = await api("/api/state", { deviceId, code });
    playerCode = state.code;
    store.set("quiz-code", playerCode);
    input.value = "";
    setMessage($("#code-message"), "", false);
    resetPlayerState();
    Sound.play("whoosh");
    render(state);
    setTimeout(() => { if (!$("#player-name").disabled) $("#player-name").focus({ preventScroll: true }); }, 300);
  } catch (error) {
    setMessage($("#code-message"), error.message, true);
    input.classList.remove("shake");
    void input.offsetWidth;
    input.classList.add("shake");
    Sound.play("wrong");
  }
}

$("#code-form").addEventListener("submit", (event) => {
  event.preventDefault();
  enterCode($("#code-input").value);
});
$("#code-input").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
$("#leave-quiz").addEventListener("click", async () => {
  if (lastState && lastState.deviceJoined) {
    try { await api("/api/leave", { code: playerCode, deviceId }); } catch { /* egal */ }
  }
  leaveQuiz("");
});

/* =========================================================
   Lobby
   ========================================================= */

function buildAvatarGrid() {
  if (!chosenAvatar || !config.avatars.includes(chosenAvatar)) {
    chosenAvatar = config.avatars[Math.floor(Math.random() * config.avatars.length)];
  }
  $("#avatar-grid").innerHTML = config.avatars.map((avatar) =>
    "<button type='button' class='avatar-option" + (avatar === chosenAvatar ? " active" : "") + "' data-avatar='" + avatar + "'>" + avatar + "</button>").join("");
  $("#avatar-preview").textContent = chosenAvatar;
}

function chooseAvatar(avatar) {
  chosenAvatar = avatar;
  store.set("quiz-avatar", avatar);
  $$(".avatar-option").forEach((button) => button.classList.toggle("active", button.dataset.avatar === avatar));
  const preview = $("#avatar-preview");
  preview.textContent = avatar;
  preview.classList.remove("bump");
  void preview.offsetWidth;
  preview.classList.add("bump");
  Sound.play("pop");
}

$("#avatar-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-avatar]");
  if (button) chooseAvatar(button.dataset.avatar);
});
$("#avatar-preview").addEventListener("click", () => {
  const others = config.avatars.filter((avatar) => avatar !== chosenAvatar);
  chooseAvatar(others[Math.floor(Math.random() * others.length)]);
});

function renderLobby(state) {
  $("#lobby-title").textContent = state.quizName;
  $("#lobby-code").textContent = state.code;
  const me = state.me;
  const joined = Boolean(me);

  if (wasJoined && !joined) toast("Du bist nicht mehr in der Lobby. Du kannst neu beitreten.");
  wasJoined = joined;

  $("#join-card").classList.toggle("hidden", joined);
  $("#me-card").classList.toggle("hidden", !joined);
  $("#lobby-kicker").textContent = state.status === "playing" ? "🎮 Runde läuft" : state.status === "finished" ? "🏁 Runde vorbei" : "⏳ Lobby";

  if (joined) {
    $("#me-avatar").textContent = me.avatar || "🙂";
    $("#me-name").textContent = me.name;
    $("#me-status").textContent = state.status === "finished" ? "Du bist für die nächste Runde dabei!" : "Du bist dabei!";
    $("#me-hint").textContent = state.status === "waiting" ? "Warte, bis der Host die Runde startet. Schau auf den Beamer!" : "Gleich geht's los …";
  } else {
    const message = $("#join-message");
    message.textContent = joinError;
    message.className = "message " + (joinError ? "error" : "");
    $("#join-button").textContent = state.status === "playing" ? "Jetzt noch einsteigen ⚡" : "Ab in die Lobby 🚀";
  }

  const list = state.status === "playing" ? state.players : state.queue;
  const status = $("#status-box");
  if (state.status === "playing") {
    status.innerHTML = "🎮 Eine Runde läuft gerade mit <strong>" + state.players.length + "</strong> Leuten. "
      + (joined ? "" : "Du kannst sofort noch einsteigen!");
  } else if (state.status === "finished") {
    status.innerHTML = "🏁 Die Runde ist vorbei. Für die nächste Runde eintragen!";
  } else {
    status.innerHTML = list.length
      ? "<strong>" + list.length + "</strong> " + (list.length === 1 ? "Person wartet" : "Leute warten") + " auf den Start."
      : "Noch ist die Lobby leer – sei die erste Person!";
  }
  $("#queue-count").textContent = list.length + " / " + state.maxPlayers;
  const added = renderChips($("#queue"), list, lobbyKnown, { meName: joined ? me.name : "", empty: "Noch niemand da – sei die erste Person!" });
  if (added && !document.hidden) Sound.play("join");
}

$("#join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#player-name").value.trim();
  const button = $("#join-button");
  button.disabled = true;
  try {
    await api("/api/join", { code: playerCode, name, deviceId, avatar: chosenAvatar });
    joinError = "";
    $("#player-name").value = "";
    store.set("quiz-name", name);
    Sound.play("go");
    burst([chosenAvatar, "✨", "🎉"], window.innerWidth / 2, window.innerHeight / 2.4, 12);
  } catch (error) {
    joinError = error.message;
    Sound.play("wrong");
  }
  button.disabled = false;
  refreshPlayer();
});

$("#player-name").value = store.get("quiz-name") || "";
$("#player-name").addEventListener("input", () => {
  if (joinError) {
    joinError = "";
    setMessage($("#join-message"), "", false);
  }
});

$("#leave-lobby").addEventListener("click", async () => {
  try {
    await api("/api/leave", { code: playerCode, deviceId });
    wasJoined = false;
  } catch (error) {
    toast(error.message);
  }
  refreshPlayer();
});

/* =========================================================
   Spiel (Mitspieler)
   ========================================================= */

function updateClock(clock, state, key) {
  if (state.phaseMs === null || state.phaseMs === undefined) {
    clock.key = key;
    clock.endsAt = 0;
    clock.duration = 0;
    return;
  }
  const estimate = Date.now() + state.phaseMs;
  // Kleine Schwankungen durch das Netz ignorieren, damit der Timer nicht springt.
  if (clock.key !== key || Math.abs(clock.endsAt - estimate) > 400) clock.endsAt = estimate;
  clock.key = key;
  clock.duration = state.phaseDurationMs;
}

const remainingOf = (clock) => (clock.endsAt ? Math.max(0, clock.endsAt - Date.now()) : 0);

const PRAISE = ["Richtig!", "Stark!", "Volltreffer!", "Genau so!", "Super!", "Klasse!"];

function renderGame(state) {
  const stage = $("#game-stage");
  const me = state.me;
  const question = state.question;
  const phase = state.phase;
  const key = phase + "|" + question.number + "|" + (me.answered ? 1 : 0);
  updateClock(playerClock, state, phase + "|" + question.number);

  if (question.number !== builtNumber) {
    selected = new Set();
    answerError = "";
    builtNumber = question.number;
  }

  if (key !== stageKey) {
    const previous = stageKey;
    stageKey = key;
    window.scrollTo({ top: 0, behavior: previous ? "smooth" : "auto" });
    if (phase === "countdown") {
      lastCountShown = 0;
      stage.innerHTML = "<div class='stage stage-countdown'>"
        + "<div class='q-counter'>Frage " + question.number + " von " + question.total + "</div><br>"
        + pointsTag(question.points)
        + "<h2 class='q-text' style='margin-top:14px'>" + escapeHtml(question.text) + "</h2>"
        + "<div class='count-big'><span id='count-num'>3</span></div>"
        + "<p class='get-ready'>Mach dich bereit!</p></div>";
    } else if (phase === "question" && !me.answered) {
      buildQuestionStage(stage, state);
      if (!previous.startsWith("question")) Sound.play("go");
    } else if (phase === "question") {
      stage.innerHTML = "<div class='stage stage-wait'>"
        + "<div class='wait-orb'>⚡</div>"
        + "<h2 class='wait-title'>Antwort eingeloggt!</h2>"
        + "<p class='muted' style='font-size:19px'>Mal sehen, ob du richtig liegst …</p>"
        + "<div class='chosen-list'>" + (me.answers || []).map((index) =>
            "<div class='tile' data-i='" + index + "'>" + shape(index) + "<span class='tile-text'>" + escapeHtml(question.options[index] || "") + "</span></div>").join("") + "</div>"
        + "<div class='timebar' style='max-width:520px;margin:18px auto 8px'><div class='timebar-fill' id='timebar-fill'></div></div>"
        + "<p class='answer-hint' id='answered-info'></p></div>";
    } else if (phase === "reveal") {
      buildResultStage(stage, state);
    } else if (phase === "scoreboard") {
      stage.innerHTML = "<div class='stage stage-scoreboard'>"
        + "<h2>📊 Zwischenstand</h2>"
        + "<p class='rank-line center'>Du bist auf Platz <strong>" + me.rank + "</strong> von " + state.players.length
        + " · <span class='lb-score'>" + fmt(me.score) + "</span> Punkte</p>"
        + "<div class='leaderboard'>" + leaderboardRows(state.players, { limit: 5, meName: me.name }) + "</div>"
        + "<p class='next-hint'>" + (state.autoAdvance ? "Die nächste Frage kommt gleich …" : "Gleich geht's weiter …") + "</p>"
        + (state.autoAdvance ? "<div class='auto-bar'><div id='auto-fill'></div></div>" : "")
        + "</div>";
      Sound.play("whoosh");
    }
  }

  const info = $("#answered-info");
  if (info) info.textContent = state.answeredCount + " von " + state.players.length + " haben geantwortet";
  const hint = $("#answer-hint");
  if (hint) {
    hint.textContent = answerError || (question.multiple ? "Wähle alle richtigen Antworten und schick sie ab." : "Tippe auf deine Antwort – schnell sein lohnt sich!");
    hint.classList.toggle("error", Boolean(answerError));
  }

  if (state.nextImage && state.nextImage !== preloadedImage) {
    preloadedImage = state.nextImage;
    new Image().src = state.nextImage;
  }
  tickPlayer();
}

function buildQuestionStage(stage, state) {
  const question = state.question;
  const multiple = question.multiple;
  stage.innerHTML = "<div class='stage stage-question' id='q-stage'>"
    + "<div class='game-top'><span class='count-chip'>Frage " + question.number + " / " + question.total + "</span>"
    + pointsTag(question.points)
    + timerRing("player-ring") + "</div>"
    + "<div class='timebar'><div class='timebar-fill' id='timebar-fill'></div></div>"
    + (question.image ? "<img class='q-image' id='q-image' src='" + escapeHtml(question.image) + "' alt=''>" : "")
    + "<h2 class='q-text'>" + escapeHtml(question.text) + "</h2>"
    + (multiple ? "<p class='multi-note'>☑ Mehrere Antworten können richtig sein</p>" : "")
    + "<div class='answers" + (question.options.length === 1 ? " one" : "") + "' id='answers'>"
    + question.options.map((option, index) =>
        "<button type='button' class='answer" + (selected.has(index) ? " selected" : "") + "' data-i='" + index + "' data-answer='" + index + "'>"
        + shape(index) + "<span class='answer-text'>" + escapeHtml(option) + "</span>"
        + "</button>").join("")
    + "</div>"
    + (multiple ? "<button type='button' class='btn dark big submit-answer' id='submit-answer'" + (selected.size ? "" : " disabled") + ">Antwort abschicken ✓</button>" : "")
    + "<p class='answer-hint' id='answer-hint'></p></div>";

  const image = $("#q-image");
  if (image) image.addEventListener("error", () => image.remove());

  $$("[data-answer]", stage).forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.answer);
      if (!multiple) return submitAnswer([index], question.number, false);
      if (selected.has(index)) selected.delete(index);
      else selected.add(index);
      button.classList.toggle("selected", selected.has(index));
      $("#submit-answer").disabled = selected.size === 0;
      Sound.play("click");
    });
  });
  const submit = $("#submit-answer");
  if (submit) submit.addEventListener("click", () => submitAnswer([...selected], question.number, true));
}

function buildResultStage(stage, state) {
  const me = state.me;
  const question = state.question;
  const result = me.lastResult;
  const noPoints = question.points === "none";
  let mood = "neutral";
  let icon = "•";
  let title = "Verpasst";
  if (result && result.answered) {
    if (noPoints) { mood = "neutral"; icon = "✓"; title = "Danke!"; }
    else if (result.correct) { mood = "good"; icon = "✓"; title = PRAISE[question.number % PRAISE.length]; }
    else { mood = "bad"; icon = "✕"; title = "Leider falsch"; }
  } else if (result) {
    mood = noPoints ? "neutral" : "bad"; icon = "⏰"; title = "Zeit ist um!";
  }

  let rankText = "Du bist auf Platz <strong>" + me.rank + "</strong>";
  if (me.rank === 1 && state.players.length > 1) rankText += " <span class='muted'>· Du führst! 👑</span>";
  else if (me.ahead) rankText += " <span class='muted'>· " + fmt(me.ahead.gap) + " Punkte hinter " + escapeHtml(me.ahead.name) + "</span>";

  stage.innerHTML = "<div class='stage stage-result'>"
    + "<div class='result-hero " + mood + "'>"
    + "<div class='result-icon'>" + icon + "</div>"
    + "<h2 class='result-title'>" + title + "</h2>"
    + (noPoints ? "" : "<div class='result-points'>+<span id='gain'>0</span></div>")
    + (result && result.streak >= 2 && result.correct && !noPoints
      ? "<div class='streak'><span class='fire'>🔥</span> " + result.streak + "er-Serie" + (result.bonus ? " · +" + fmt(result.bonus) + " Bonus" : "") + "</div>"
      : "")
    + "</div>"
    + "<p class='rank-line'>" + rankText + " · <span id='total'>" + fmt(me.score - (result ? result.points : 0)) + "</span> Punkte</p>"
    + "<div class='card' style='text-align:left'><h2 style='font-size:18px'>" + escapeHtml(question.text) + "</h2>"
    + "<div class='reveal-list'>" + revealRows(state, me.answers || []) + "</div></div>"
    + "</div>";

  growBars(stage);
  if (result) {
    animateNumber($("#gain"), 0, result.points, 900);
    animateNumber($("#total"), me.score - result.points, me.score, 1300);
  }
  if (mood === "good") {
    Sound.play("correct");
    burst(["⭐", "✨", "🎉", "💜"], window.innerWidth / 2, 180, 16);
    if (result.streak >= 3) launchConfetti(60);
  } else if (mood === "bad") {
    Sound.play("wrong");
  } else {
    Sound.play("reveal");
  }
}

async function submitAnswer(answers, questionNumber, multiple) {
  selected = new Set(answers);
  answerError = "";
  const list = $("#answers");
  if (list) list.classList.add("locked");
  $$("#game-stage [data-answer]").forEach((button) => {
    button.disabled = true;
    button.classList.toggle("selected", selected.has(Number(button.dataset.answer)));
  });
  const submit = $("#submit-answer");
  if (submit) submit.disabled = true;
  Sound.play("lock");
  try {
    await api("/api/answer", { code: playerCode, deviceId, answers, questionNumber });
  } catch (error) {
    if (!multiple) selected = new Set();
    answerError = error.message;
    stageKey = "";
  }
  refreshPlayer();
}

function tickPlayer() {
  if (!lastState || !inGame(lastState) || hostOpen || adminOpen) return;
  const remaining = remainingOf(playerClock);
  const phase = lastState.phase;

  if (phase === "countdown") {
    const number = Math.max(1, Math.ceil(remaining / 1000));
    const element = $("#count-num");
    if (element && number !== lastCountShown) {
      lastCountShown = number;
      element.textContent = number;
      element.style.animation = "none";
      void element.offsetWidth;
      element.style.animation = "";
      Sound.play("count");
    }
  }

  if (phase === "question") {
    const fill = $("#timebar-fill");
    if (fill && playerClock.duration) fill.style.width = Math.min(100, (remaining / playerClock.duration) * 100) + "%";
    setRing($("#player-ring"), remaining, playerClock.duration);
    const low = remaining <= 5000;
    const stageEl = $("#q-stage") || $(".stage-wait");
    if (stageEl) stageEl.classList.toggle("low", low);
    const second = Math.ceil(remaining / 1000);
    if (low && second !== lastTickSecond && second > 0 && !lastState.me.answered) {
      lastTickSecond = second;
      Sound.play("tick");
    }
  }

  if (phase === "scoreboard") {
    const fill = $("#auto-fill");
    if (fill && playerClock.duration) fill.style.width = (remaining / playerClock.duration) * 100 + "%";
  }
}

/* =========================================================
   Siegerpodest
   ========================================================= */

function renderFinished(state) {
  if (state.status !== "finished") {
    finishedSignature = "";
    celebrated = false;
    $("#end-access").classList.add("hidden");
    setMessage($("#end-message"), "", false);
    return;
  }
  const signature = JSON.stringify([state.podium, state.players]);
  if (signature === finishedSignature) return;
  const first = !finishedSignature;
  finishedSignature = signature;
  $("#podium").innerHTML = podiumHTML(state.podium);

  // In der Endansicht stehen die Ergebnisse der gerade beendeten Runde in "players".
  const me = state.players.find((player) => state.me && player.name === state.me.name);
  const rank = me ? state.players.indexOf(me) + 1 : 0;
  const myFinal = $("#my-final");
  myFinal.classList.toggle("hidden", !me);
  if (me) {
    const line = rank === 1 ? "Du hast gewonnen! 🏆" : rank <= 3 ? "Ab aufs Treppchen! 🎉" : "Gut gespielt! 💪";
    myFinal.innerHTML = "<div class='muted small'>Dein Ergebnis</div><div class='big-rank'>Platz " + rank + "</div>"
      + "<div>" + fmt(me.score) + " Punkte · " + (me.correct || 0) + " richtig</div><div>" + line + "</div>";
  }
  $("#final-scores").innerHTML = leaderboardRows(state.players, { meName: me ? me.name : "", showExtra: true });

  if (first && !celebrated && !adminOpen && !hostOpen) {
    celebrated = true;
    Sound.play("drumroll");
    setTimeout(() => { Sound.play("fanfare"); launchConfetti(); }, 3000);
  }
}

async function endRound(credentials, showAccessOnError) {
  try {
    await api("/api/reset", { ...credentials, code: playerCode });
    refreshPlayer();
  } catch (error) {
    if (showAccessOnError) $("#end-access").classList.remove("hidden");
    setMessage($("#end-message"), error.message, true);
  }
}

$("#end-game").addEventListener("click", () => {
  if (adminAuth) endRound(adminAuth, true);
  else $("#end-access").classList.toggle("hidden");
});
$("#confirm-end").addEventListener("click", () => {
  endRound({ email: $("#end-email").value.trim(), password: $("#end-password").value }, false);
});

/* =========================================================
   Präsentationsmodus (Host / Beamer)
   ========================================================= */

// QR-Code-Bibliothek liegt im Projekt (public/qrcode.js), damit es auch ohne Internet klappt.
function loadQrLibrary() {
  if (window.qrcode) return Promise.resolve();
  if (!qrLoader) {
    qrLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "qrcode.js?v=1";
      script.onload = resolve;
      script.onerror = () => { qrLoader = null; reject(new Error("QR")); };
      document.head.appendChild(script);
    });
  }
  return qrLoader;
}

function joinUrl(code) {
  return window.location.origin + "/?code=" + encodeURIComponent(code);
}

function drawQr(code) {
  const box = $("#qr-box");
  if (!box || box.dataset.code === code) return;
  box.dataset.code = code;
  loadQrLibrary().then(() => {
    if (!$("#qr-box") || box.dataset.code !== code) return;
    const qr = window.qrcode(0, "M");
    qr.addData(joinUrl(code));
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true, alt: "QR-Code zum Mitmachen" });
  }).catch(() => {
    box.innerHTML = "<div style='color:#111;padding:20px;font-weight:800'>" + escapeHtml(window.location.host) + "</div>";
  });
}

function openHost(quiz) {
  hostQuiz = { id: quiz.id, code: quiz.code, name: quiz.name };
  hostOpen = true;
  hostState = null;
  hostKey = "";
  hostCelebrated = false;
  hostKnown.clear();
  $("#host-stage").innerHTML = "<div class='host-wait-big'>Lade …</div>";
  $("#host-quiz-name").textContent = quiz.name;
  setMessage($("#host-message"), "", false);
  updateView();
  window.scrollTo({ top: 0 });
  refreshHost();
}

function closeHost() {
  hostOpen = false;
  hostQuiz = null;
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  updateView();
  refreshAdmin();
}

$("#host-exit").addEventListener("click", closeHost);
$("#host-fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
});

async function hostAction(path, extra = {}) {
  try {
    await api(path, { ...adminAuth, id: hostQuiz.id, ...extra });
    setMessage($("#host-message"), "", false);
  } catch (error) {
    setMessage($("#host-message"), error.message, true);
  }
  refreshHost();
}

function hostControls(buttons) {
  return "<div class='host-controls'>" + buttons.join("") + "</div>";
}

function renderHost(state) {
  hostState = state;
  hostQuiz.code = state.code;
  hostQuiz.name = state.quizName;
  $("#host-quiz-name").textContent = state.quizName;
  $("#host-mode-pill").textContent = state.autoAdvance ? "⏩ Automatisch" : "🖐 Manuell";
  const stage = $("#host-stage");
  const question = state.question;
  const phase = state.status === "playing" ? state.phase : state.status;
  const key = phase + "|" + (question ? question.number : 0);
  updateClock(hostClock, state, key);

  if (key !== hostKey) {
    const previous = hostKey;
    hostKey = key;
    if (phase === "waiting") {
      hostCelebrated = false;
      hostKnown.clear();
      stage.innerHTML = "<div class='host-lobby host-stage'>"
        + "<section class='card host-join'>"
        + "<div class='host-join-url'>Mitmachen auf <strong>" + escapeHtml(window.location.host) + "</strong></div>"
        + "<div class='muted small' style='margin-top:6px'>Quiz-Code</div>"
        + "<div class='host-code'>" + escapeHtml(state.code) + "</div>"
        + "<div class='qr-box' id='qr-box'></div>"
        + "<p class='muted small'>QR-Code scannen und direkt mitmachen</p></section>"
        + "<section class='card'>"
        + "<div class='host-players-head'><div class='player-count' id='host-count'>0 <span>Spieler</span></div>"
        + "<button type='button' class='btn lime huge pulse' id='host-start'>▶ Start</button></div>"
        + "<div class='player-cloud host-cloud' id='host-cloud'></div>"
        + "<p class='muted small'>Tipp: Auf einen Namen klicken, um die Person zu entfernen.</p></section></div>";
      $("#host-cloud").dataset.sig = "";
      $("#host-start").addEventListener("click", () => { Sound.play("go"); hostAction("/api/start"); });
      $("#host-cloud").addEventListener("click", (event) => {
        const chip = event.target.closest("[data-name]");
        if (chip && confirm("„" + chip.dataset.name + "“ aus der Lobby entfernen?")) hostAction("/api/admin/kick", { name: chip.dataset.name });
      });
      drawQr(state.code);
    } else if (phase === "countdown") {
      hostCountShown = 0;
      stage.innerHTML = "<div class='host-q host-stage'>"
        + "<div class='q-counter'>Frage " + question.number + " von " + question.total + "</div><br>"
        + pointsTag(question.points)
        + "<h1 class='host-q-text'>" + escapeHtml(question.text) + "</h1>"
        + "<div class='count-big'><span id='host-count-num'>3</span></div></div>";
      if (!previous.startsWith("countdown")) Sound.play("whoosh");
    } else if (phase === "question") {
      stage.innerHTML = "<div class='host-q host-stage' id='host-q'>"
        + "<h1 class='host-q-text'>" + escapeHtml(question.text) + "</h1>"
        + "<div class='host-q-mid'>"
        + "<div class='host-side-stat'>" + timerRing("host-ring", true) + "</div>"
        + "<div>" + (question.image ? "<img class='q-image' src='" + escapeHtml(question.image) + "' alt=''>" : "<img class='host-logo-spin' src='logo-round.png' alt=''>") + "</div>"
        + "<div class='host-side-stat'><div class='num' id='host-answers'>0</div><div class='lbl'>Antworten</div></div></div>"
        + (question.multiple ? "<p class='multi-note'>☑ Mehrere Antworten können richtig sein</p>" : "")
        + "<div class='tiles'>" + question.options.map((option, index) =>
            "<div class='tile' data-i='" + index + "'>" + shape(index) + "<span class='tile-text'>" + escapeHtml(option) + "</span></div>").join("") + "</div>"
        + hostControls(["<button type='button' class='btn light' id='host-skip'>⏭ Überspringen</button>"])
        + "</div>";
      $("#host-skip").addEventListener("click", () => hostAction("/api/next"));
      Sound.play("go");
    } else if (phase === "reveal") {
      const counts = state.reveal.counts;
      const max = Math.max(1, ...counts);
      stage.innerHTML = "<div class='host-q host-stage'>"
        + "<h1 class='host-q-text' style='font-size:clamp(26px,3.2vw,44px)'>" + escapeHtml(question.text) + "</h1>"
        + "<div class='chart'>" + question.options.map((_, index) => {
            const correct = state.reveal.correctIndices.includes(index);
            return "<div class='chart-col " + (correct ? "correct" : "wrong") + "' data-i='" + index + "'>"
              + "<div class='chart-num'>" + (correct ? "✓ " : "") + counts[index] + "</div>"
              + "<div class='chart-bar' style='height:" + Math.round(Math.max(44, (counts[index] / max) * 170)) + "px'>" + SHAPES[index] + "</div></div>";
          }).join("") + "</div>"
        + "<div class='tiles revealed'>" + question.options.map((option, index) => {
            const correct = state.reveal.correctIndices.includes(index);
            return "<div class='tile " + (correct ? "correct" : "wrong") + "' data-i='" + index + "'>" + shape(index)
              + "<span class='tile-text'>" + escapeHtml(option) + "</span>" + (correct ? "<span class='check'>✓</span>" : "") + "</div>";
          }).join("") + "</div>"
        + hostControls(["<button type='button' class='btn dark big' id='host-next'>Weiter ▶</button>"])
        + (state.autoAdvance ? "<div class='auto-bar' style='max-width:400px;margin:12px auto 0'><div id='host-auto'></div></div>" : "")
        + "</div>";
      $("#host-next").addEventListener("click", () => hostAction("/api/next"));
      Sound.play("reveal");
    } else if (phase === "scoreboard") {
      stage.innerHTML = "<div class='host-stage'>"
        + "<h1 class='host-title'>📊 Zwischenstand</h1>"
        + "<div class='leaderboard host-board'>" + leaderboardRows(state.players, { limit: 5 }) + "</div>"
        + hostControls(["<button type='button' class='btn dark big' id='host-next'>Nächste Frage ▶</button>"])
        + (state.autoAdvance ? "<div class='auto-bar' style='max-width:400px;margin:12px auto 0'><div id='host-auto'></div></div>" : "")
        + "</div>";
      $("#host-next").addEventListener("click", () => hostAction("/api/next"));
      Sound.play("whoosh");
    } else if (phase === "finished") {
      stage.innerHTML = "<div class='host-stage host-podium'>"
        + "<h1 class='host-title'>🏆 Siegerpodest</h1>"
        + "<div class='podium'>" + podiumHTML(state.podium) + "</div>"
        + "<div class='leaderboard host-board' style='margin-top:10px'>" + leaderboardRows(state.players.slice(3), { showExtra: true, offset: 3 }) + "</div>"
        + hostControls([
            "<button type='button' class='btn dark big' id='host-again'>🔁 Nochmal spielen</button>",
            "<button type='button' class='btn light' id='host-csv'>⬇ Ergebnisse (CSV)</button>",
            "<button type='button' class='btn light' id='host-reset'>⏹ Runde beenden</button>",
          ])
        + "</div>";
      if (state.players.length <= 3) $(".host-podium .host-board").remove();
      $("#host-again").addEventListener("click", () => hostAction("/api/reset", { keepPlayers: true }));
      $("#host-reset").addEventListener("click", () => {
        if (confirm("Runde beenden? Alle müssen dann neu beitreten.")) hostAction("/api/reset");
      });
      $("#host-csv").addEventListener("click", () => downloadResults(state));
      if (!hostCelebrated) {
        hostCelebrated = true;
        Sound.play("drumroll");
        setTimeout(() => { Sound.play("fanfare"); launchConfetti(180); }, 3000);
      }
    }
  }

  // Laufend aktualisieren
  if (phase === "waiting") {
    $("#host-count").innerHTML = state.queue.length + " <span>" + "Spieler · max. " + state.maxPlayers + "</span>";
    $("#host-start").disabled = !state.queue.length || !state.questionCount;
    const added = renderChips($("#host-cloud"), state.queue, hostKnown, { kickable: true, empty: "Warte auf Mitspieler … 👀" });
    if (added) Sound.play("join");
    drawQr(state.code);
  }
  const answersEl = $("#host-answers");
  if (answersEl && answersEl.textContent !== String(state.answeredCount)) {
    answersEl.textContent = state.answeredCount;
    answersEl.animate([{ transform: "scale(1.4)" }, { transform: "scale(1)" }], { duration: 300, easing: "ease-out" });
  }
  tickHost();
}

function tickHost() {
  if (!hostOpen || !hostState || hostState.status !== "playing") return;
  const remaining = remainingOf(hostClock);
  const phase = hostState.phase;
  if (phase === "countdown") {
    const number = Math.max(1, Math.ceil(remaining / 1000));
    const element = $("#host-count-num");
    if (element && number !== hostCountShown) {
      hostCountShown = number;
      element.textContent = number;
      element.style.animation = "none";
      void element.offsetWidth;
      element.style.animation = "";
      Sound.play("count");
    }
  } else if (phase === "question") {
    setRing($("#host-ring"), remaining, hostClock.duration);
    const low = remaining <= 5000;
    const stageEl = $("#host-q");
    if (stageEl) stageEl.classList.toggle("low", low);
    const second = Math.ceil(remaining / 1000);
    if (low && second > 0 && second !== hostTickSecond) {
      hostTickSecond = second;
      Sound.play("tick");
    }
  } else {
    const fill = $("#host-auto");
    if (fill && hostClock.duration) fill.style.width = (remaining / hostClock.duration) * 100 + "%";
  }
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function downloadResults(state) {
  const cell = (value) => '"' + String(value).replace(/"/g, '""') + '"';
  const lines = [["Platz", "Name", "Punkte", "Richtige"].map(cell).join(";")];
  state.players.forEach((player, index) => lines.push([index + 1, player.name, player.score, player.correct || 0].map(cell).join(";")));
  const safeName = state.quizName.replace(/[^\w\-äöüÄÖÜß ]+/g, "").trim() || "quiz";
  downloadFile(safeName + " – Ergebnisse.csv", "﻿" + lines.join("\n"), "text/csv;charset=utf-8");
}

/* =========================================================
   Admin
   ========================================================= */

$("#admin-toggle").addEventListener("click", () => {
  adminOpen = !adminOpen;
  updateView();
  window.scrollTo({ top: 0 });
  if (adminOpen) {
    refreshAdmin();
    setTimeout(() => { if (!adminAuth) $("#admin-email").focus({ preventScroll: true }); }, 200);
  } else {
    refreshPlayer();
  }
});

$("#sound-toggle").addEventListener("click", () => {
  Sound.setMuted(!Sound.isMuted());
  if (!Sound.isMuted()) Sound.play("pop");
});

$("#admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const credentials = { email: $("#admin-email").value.trim(), password: $("#admin-password").value };
  try {
    await api("/api/admin/quizzes", credentials);
    adminAuth = credentials;
    $("#admin-password").value = "";
    setMessage($("#admin-login-message"), "", false);
    listSignature = "";
    Sound.play("go");
    updateView();
    refreshAdmin();
  } catch (error) {
    setMessage($("#admin-login-message"), error.message, true);
    Sound.play("wrong");
  }
});

$("#admin-logout").addEventListener("click", () => {
  if (dirty && !confirm("Es gibt ungespeicherte Änderungen. Wirklich abmelden?")) return;
  adminAuth = null;
  adminQuiz = null;
  draft = [];
  dirty = false;
  adminOpen = false;
  updateView();
});

/* ---------- Liste der Quizze ---------- */

function statusText(quiz) {
  if (quiz.status === "playing") return "<span class='live-dot'></span>Live (" + quiz.playerCount + " dabei)";
  if (quiz.status === "finished") return "🏁 Beendet";
  return quiz.queueCount ? "⏳ " + quiz.queueCount + " in der Lobby" : "Bereit";
}

function renderQuizList(quizzes) {
  const signature = JSON.stringify(quizzes);
  if (signature === listSignature) return;
  listSignature = signature;
  const live = quizzes.filter((quiz) => quiz.status === "playing").length;
  const questions = quizzes.reduce((sum, quiz) => sum + quiz.questionCount, 0);
  $("#admin-stats").innerHTML = [
    [quizzes.length, quizzes.length === 1 ? "Quiz" : "Quizze"],
    [questions, "Fragen insgesamt"],
    [live, live === 1 ? "Runde live" : "Runden live"],
  ].map(([num, lbl]) => "<div class='stat'><div class='num'>" + num + "</div><div class='lbl'>" + lbl + "</div></div>").join("");

  const icons = ["🧠", "🎯", "📚", "🚀", "💡", "🌍", "🎨", "🔬"];
  $("#quiz-list").innerHTML = quizzes.length
    ? quizzes.map((quiz, index) => {
        const id = escapeHtml(quiz.id);
        return "<div class='quiz-item'><span class='quiz-icon'>" + icons[index % icons.length] + "</span>"
          + "<div class='quiz-info'><strong>" + escapeHtml(quiz.name) + "</strong>"
          + "<div class='muted small'>" + quiz.questionCount + (quiz.questionCount === 1 ? " Frage" : " Fragen") + " · " + statusText(quiz) + "</div></div>"
          + "<span class='code-chip'>" + escapeHtml(quiz.code) + "</span>"
          + "<div class='quiz-actions'>"
          + "<button type='button' class='btn dark small' data-quiz-action='present' data-id='" + id + "'>🖥️ Präsentieren</button>"
          + "<button type='button' class='btn light small' data-quiz-action='edit' data-id='" + id + "'>✏️ Bearbeiten</button>"
          + "<button type='button' class='icon-btn' data-quiz-action='duplicate' data-id='" + id + "' title='Duplizieren'>⧉</button>"
          + "<button type='button' class='icon-btn' data-quiz-action='delete' data-id='" + id + "' data-name='" + escapeHtml(quiz.name) + "' title='Löschen'>🗑</button>"
          + "</div></div>";
      }).join("")
    : "<p class='muted' style='margin-top:12px'>Es gibt noch kein Quiz. Erstelle das erste mit „Neues Quiz“.</p>";
}

$("#quiz-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-quiz-action]");
  if (!button) return;
  const message = $("#list-message");
  const id = button.dataset.id;
  try {
    const action = button.dataset.quizAction;
    if (action === "edit") {
      const result = await api("/api/admin/quiz", { ...adminAuth, id });
      openQuiz(result.quiz);
    } else if (action === "present") {
      const result = await api("/api/admin/quiz", { ...adminAuth, id });
      openHost(result.quiz);
    } else if (action === "duplicate") {
      await api("/api/admin/duplicate", { ...adminAuth, id });
      setMessage(message, "Quiz kopiert ✓", false);
      listSignature = "";
      refreshAdmin();
    } else if (action === "delete" && confirm("Das Quiz „" + button.dataset.name + "“ wirklich löschen?")) {
      await api("/api/admin/delete", { ...adminAuth, id });
      setMessage(message, "Quiz gelöscht.", false);
      listSignature = "";
      refreshAdmin();
    }
  } catch (error) {
    setMessage(message, error.message, true);
  }
});

$("#create-quiz").addEventListener("click", async () => {
  try {
    const result = await api("/api/admin/create", { ...adminAuth, name: "Neues Quiz" });
    setMessage($("#list-message"), "", false);
    openQuiz(result.quiz);
  } catch (error) {
    setMessage($("#list-message"), error.message, true);
  }
});

$("#import-quiz").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const message = $("#list-message");
  try {
    const data = JSON.parse(await file.text());
    const questions = Array.isArray(data) ? data : data.questions;
    if (!Array.isArray(questions)) throw new Error("In der Datei wurden keine Fragen gefunden.");
    const created = await api("/api/admin/create", { ...adminAuth, name: String(data.name || "Importiertes Quiz").slice(0, 60) });
    try {
      await api("/api/admin/save", { ...adminAuth, id: created.quiz.id, name: created.quiz.name, questions, settings: data.settings });
    } catch (error) {
      await api("/api/admin/delete", { ...adminAuth, id: created.quiz.id }).catch(() => {});
      throw error;
    }
    setMessage(message, "Quiz importiert ✓", false);
    listSignature = "";
    refreshAdmin();
  } catch (error) {
    setMessage(message, error instanceof SyntaxError ? "Die Datei ist keine gültige Quiz-Datei." : error.message, true);
  }
});

/* ---------- Ein Quiz bearbeiten ---------- */

function cloneQuestion(question) {
  return {
    text: question.text,
    options: [...question.options],
    correctIndices: [...question.correctIndices],
    duration: question.duration,
    image: question.image || "",
    points: question.points || "standard",
  };
}

function openQuiz(quiz) {
  adminQuiz = { id: quiz.id, name: quiz.name, code: quiz.code, settings: { ...quiz.settings } };
  draft = quiz.questions.map(cloneQuestion);
  dirty = false;
  $("#quiz-name").value = adminQuiz.name;
  $("#quiz-code").textContent = adminQuiz.code;
  $("#setting-auto").checked = adminQuiz.settings.autoAdvance !== false;
  $("#setting-shuffle").checked = adminQuiz.settings.shuffle === true;
  setMessage($("#save-message"), "", false);
  setMessage($("#admin-message"), "", false);
  $("#admin-status").textContent = "Lade …";
  renderEditor();
  updateView();
  window.scrollTo({ top: 0 });
  refreshAdmin();
}

$("#back-to-list").addEventListener("click", () => {
  if (dirty && !confirm("Es gibt ungespeicherte Änderungen. Wirklich zurück?")) return;
  adminQuiz = null;
  draft = [];
  dirty = false;
  listSignature = "";
  updateView();
  refreshAdmin();
});

$("#quiz-name").addEventListener("input", (event) => {
  if (!adminQuiz) return;
  adminQuiz.name = event.target.value;
  markDirty();
});
$("#setting-auto").addEventListener("change", (event) => {
  adminQuiz.settings.autoAdvance = event.target.checked;
  markDirty();
});
$("#setting-shuffle").addEventListener("change", (event) => {
  adminQuiz.settings.shuffle = event.target.checked;
  markDirty();
});

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(label + " kopiert ✓");
  } catch {
    toast(label + ": " + text);
  }
}
$("#copy-code").addEventListener("click", () => copyText(adminQuiz.code, "Code"));
$("#copy-link").addEventListener("click", () => copyText(joinUrl(adminQuiz.code), "Link"));

$("#new-code").addEventListener("click", async () => {
  if (!confirm("Einen neuen Code erstellen? Der alte Code funktioniert danach nicht mehr.")) return;
  try {
    const result = await api("/api/admin/newcode", { ...adminAuth, id: adminQuiz.id });
    adminQuiz.code = result.code;
    $("#quiz-code").textContent = result.code;
    toast("Neuer Code: " + result.code);
    refreshAdmin();
  } catch (error) {
    setMessage($("#save-message"), error.message, true);
  }
});

$("#open-host").addEventListener("click", () => {
  if (dirty) toast("Hinweis: Ungespeicherte Änderungen sind im Spiel noch nicht drin.");
  openHost(adminQuiz);
});

$("#export-quiz").addEventListener("click", () => {
  const data = { name: adminQuiz.name, settings: adminQuiz.settings, questions: draft };
  const safeName = adminQuiz.name.replace(/[^\w\-äöüÄÖÜß ]+/g, "").trim() || "quiz";
  downloadFile(safeName + ".json", JSON.stringify(data, null, 2), "application/json");
});

const PHASE_NAMES = { countdown: "Countdown", question: "Frage läuft", reveal: "Auflösung", scoreboard: "Zwischenstand" };

function renderAdminStatus(state) {
  let text;
  if (state.status === "playing") {
    text = "<span class='live-dot'></span> Live: Frage <strong>" + state.question.number + " / " + state.question.total
      + "</strong> (" + (PHASE_NAMES[state.phase] || "") + ") mit <strong>" + state.players.length + "</strong> Leuten.";
  } else if (state.status === "finished") {
    text = "🏁 Die Runde ist vorbei. Beende sie, um eine neue zu starten.";
  } else if (!state.queue.length) {
    text = "Noch ist niemand in der Lobby. Mitspieler geben den Code <strong>" + escapeHtml(state.code) + "</strong> ein.";
  } else {
    text = "<strong>" + state.queue.length + "</strong> " + (state.queue.length === 1 ? "Person wartet" : "Leute warten") + " in der Lobby.";
  }
  $("#admin-status").innerHTML = text;

  const playing = state.status === "playing";
  $("#start-game").disabled = playing || !state.queue.length || !state.questionCount;
  $("#reset-game").disabled = state.status === "waiting" && !state.queue.length;
  $("#editor-notice").classList.toggle("hidden", !playing);
  $("#editor-fieldset").disabled = playing;
  $("#quiz-name").disabled = playing;
  $("#new-code").disabled = playing;
  $("#save-questions").disabled = playing;
}

function markDirty() {
  dirty = true;
  updateSaveBar();
}

function updateSaveBar() {
  $("#savebar").classList.toggle("dirty", dirty);
  $("#save-state").textContent = dirty ? "● Ungespeicherte Änderungen" : "✓ Alles gespeichert";
  $("#question-total").textContent = draft.length + (draft.length === 1 ? " Frage" : " Fragen");
}

function renderEditor() {
  $("#editor").innerHTML = draft.map((question, i) => {
    const canAddOption = question.options.length < MAX_OPTIONS;
    return "<article class='q-card' style='animation-delay:" + Math.min(i, 6) * 0.04 + "s'>"
      + "<div class='q-head'><span class='q-number'>" + (i + 1) + "</span><div class='q-tools'>"
      + "<button type='button' class='icon-btn' data-action='up' data-q='" + i + "' title='Nach oben'" + (i === 0 ? " disabled" : "") + ">↑</button>"
      + "<button type='button' class='icon-btn' data-action='down' data-q='" + i + "' title='Nach unten'" + (i === draft.length - 1 ? " disabled" : "") + ">↓</button>"
      + "<button type='button' class='icon-btn' data-action='copy' data-q='" + i + "' title='Frage kopieren'>⧉</button>"
      + "<button type='button' class='icon-btn' data-action='delete' data-q='" + i + "' title='Frage löschen'>🗑</button>"
      + "</div></div>"
      + "<div class='label'>Frage</div>"
      + "<textarea data-field='text' data-q='" + i + "' rows='2' maxlength='400' placeholder='Schreibe hier deine Frage …'>" + escapeHtml(question.text) + "</textarea>"
      + "<div class='q-settings'>"
      + "<div><div class='label'>Zeit</div><div class='time-row'><input type='number' min='5' max='300' step='5' data-field='duration' data-q='" + i + "' value='" + escapeHtml(question.duration) + "'><span>Sekunden</span></div></div>"
      + "<div><div class='label'>Punkte</div><select data-field='points' data-q='" + i + "'>"
      + [["standard", "Standard (bis 1000)"], ["double", "⚡ Doppelt (bis 2000)"], ["none", "Ohne Punkte"]]
          .map(([value, label]) => "<option value='" + value + "'" + (question.points === value ? " selected" : "") + ">" + label + "</option>").join("")
      + "</select></div></div>"
      + "<div class='label'>Bild (optional)</div>"
      + "<div class='image-box'>"
      + (question.image ? "<img src='" + escapeHtml(question.image) + "' alt='Vorschau'>" : "<div class='image-empty'>Kein Bild</div>")
      + "<div class='image-actions'><label class='btn light small'>📷 " + (question.image ? "Bild ändern" : "Bild hinzufügen")
      + "<input type='file' accept='image/*' data-field='image' data-q='" + i + "' hidden></label>"
      + (question.image ? "<button type='button' class='btn light small' data-action='remove-image' data-q='" + i + "'>Bild entfernen</button>" : "")
      + "</div></div>"
      + "<div class='label'>Antworten – hake alle richtigen an</div>"
      + "<div class='option-list'>"
      + question.options.map((option, j) => {
          const correct = question.correctIndices.includes(j);
          return "<div class='option-row" + (correct ? " is-correct" : "") + "'>"
            + "<input type='checkbox' data-field='correct' data-q='" + i + "' data-o='" + j + "'" + (correct ? " checked" : "") + " aria-label='Antwort " + LETTERS[j] + " ist richtig'>"
            + "<span class='shape opt-shape' data-i='" + j + "'>" + SHAPES[j] + "</span>"
            + "<input type='text' data-field='option' data-q='" + i + "' data-o='" + j + "' maxlength='200' value='" + escapeHtml(option) + "' placeholder='Antwort " + LETTERS[j] + "'>"
            + "<button type='button' class='icon-btn' data-action='delete-option' data-q='" + i + "' data-o='" + j + "' title='Antwort entfernen'"
            + (question.options.length <= 1 ? " disabled" : "") + ">✕</button></div>";
        }).join("")
      + "</div>"
      + (canAddOption ? "<button type='button' class='btn light small add-option' data-action='add-option' data-q='" + i + "'>＋ Antwort hinzufügen</button>" : "")
      + "</article>";
  }).join("") || "<p class='empty-hint' style='margin-top:14px'>Noch keine Fragen. Leg los mit „Neue Frage“!</p>";
  updateSaveBar();
}

$("#editor").addEventListener("input", (event) => {
  const target = event.target;
  const question = draft[Number(target.dataset.q)];
  if (!question) return;
  if (target.dataset.field === "text") question.text = target.value;
  else if (target.dataset.field === "option") question.options[Number(target.dataset.o)] = target.value;
  else if (target.dataset.field === "duration") question.duration = Number(target.value);
  else return;
  markDirty();
});

$("#editor").addEventListener("change", (event) => {
  const target = event.target;
  const question = draft[Number(target.dataset.q)];
  if (!question) return;
  if (target.dataset.field === "correct") {
    const index = Number(target.dataset.o);
    const correct = new Set(question.correctIndices);
    if (target.checked) correct.add(index);
    else correct.delete(index);
    // Es muss immer mindestens eine richtige Antwort geben.
    if (correct.size) {
      question.correctIndices = [...correct].sort((a, b) => a - b);
      markDirty();
    } else {
      toast("Mindestens eine Antwort muss richtig sein.");
    }
    renderEditor();
  } else if (target.dataset.field === "duration") {
    const seconds = Math.round(Number(target.value));
    question.duration = Number.isFinite(seconds) && seconds > 0 ? Math.min(300, Math.max(5, seconds)) : 30;
    target.value = question.duration;
    markDirty();
  } else if (target.dataset.field === "points") {
    question.points = target.value;
    markDirty();
  } else if (target.dataset.field === "image") {
    const file = target.files[0];
    target.value = "";
    if (file) uploadImage(question, file);
  }
});

$("#editor").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const index = Number(button.dataset.q);
  const question = draft[index];
  if (!question) return;
  const action = button.dataset.action;

  if (action === "up" && index > 0) {
    [draft[index - 1], draft[index]] = [draft[index], draft[index - 1]];
  } else if (action === "down" && index < draft.length - 1) {
    [draft[index + 1], draft[index]] = [draft[index], draft[index + 1]];
  } else if (action === "copy") {
    if (draft.length >= 50) return toast("Es sind maximal 50 Fragen möglich.");
    draft.splice(index + 1, 0, cloneQuestion(question));
  } else if (action === "delete") {
    if (!confirm("Frage " + (index + 1) + " wirklich löschen?")) return;
    draft.splice(index, 1);
  } else if (action === "remove-image") {
    question.image = "";
  } else if (action === "add-option") {
    if (question.options.length >= MAX_OPTIONS) return;
    question.options.push("");
  } else if (action === "delete-option") {
    const optionIndex = Number(button.dataset.o);
    if (question.options.length <= 1) return;
    question.options.splice(optionIndex, 1);
    question.correctIndices = question.correctIndices
      .filter((value) => value !== optionIndex)
      .map((value) => (value > optionIndex ? value - 1 : value));
    if (!question.correctIndices.length) question.correctIndices = [0];
  } else {
    return;
  }
  markDirty();
  renderEditor();
  if (action === "add-option") {
    const inputs = $$("#editor .q-card:nth-child(" + (index + 1) + ") input[data-field='option']");
    if (inputs.length) inputs[inputs.length - 1].focus();
  }
});

function addQuestion(question) {
  if (draft.length >= 50) return toast("Es sind maximal 50 Fragen möglich.");
  draft.push(question);
  markDirty();
  renderEditor();
  const cards = $$("#editor .q-card");
  const last = cards[cards.length - 1];
  if (last) {
    last.scrollIntoView({ behavior: "smooth", block: "center" });
    last.querySelector("textarea").focus({ preventScroll: true });
  }
}

$("#add-question").addEventListener("click", () => {
  addQuestion({ text: "", options: ["", ""], correctIndices: [0], duration: 30, image: "", points: "standard" });
});
$("#add-truefalse").addEventListener("click", () => {
  addQuestion({ text: "", options: ["Wahr", "Falsch"], correctIndices: [0], duration: 20, image: "", points: "standard" });
});

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Bitte wähle eine Bilddatei aus."));
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Dieses Bild konnte nicht gelesen werden."));
    };
    image.src = url;
  });
}

async function uploadImage(question, file) {
  const message = $("#save-message");
  setMessage(message, "Bild wird hochgeladen …", false);
  try {
    const dataUrl = await shrinkImage(file);
    const result = await api("/api/admin/upload", { ...adminAuth, dataUrl });
    question.image = result.url;
    markDirty();
    renderEditor();
    setMessage(message, "Bild hochgeladen. Vergiss das Speichern nicht.", false);
  } catch (error) {
    setMessage(message, error.message, true);
  }
}

$("#save-questions").addEventListener("click", async () => {
  const message = $("#save-message");
  setMessage(message, "Speichere …", false);
  try {
    const result = await api("/api/admin/save", { ...adminAuth, id: adminQuiz.id, name: adminQuiz.name, questions: draft, settings: adminQuiz.settings });
    adminQuiz = { id: result.quiz.id, name: result.quiz.name, code: result.quiz.code, settings: { ...result.quiz.settings } };
    draft = result.quiz.questions.map(cloneQuestion);
    dirty = false;
    $("#quiz-name").value = adminQuiz.name;
    renderEditor();
    setMessage(message, "", false);
    toast("Gespeichert ✓");
    Sound.play("correct");
    refreshAdmin();
  } catch (error) {
    setMessage(message, error.message, true);
    Sound.play("wrong");
  }
});

window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

$("#start-game").addEventListener("click", async () => {
  const message = $("#admin-message");
  try {
    await api("/api/start", { ...adminAuth, id: adminQuiz.id });
    setMessage(message, "Los geht's! 🎉 Die Runde läuft.", false);
    refreshAdmin();
    refreshPlayer();
  } catch (error) {
    setMessage(message, error.message, true);
  }
});

$("#reset-game").addEventListener("click", async () => {
  if (!confirm("Die Runde wirklich beenden? Die Punkte gehen verloren.")) return;
  const message = $("#admin-message");
  try {
    await api("/api/reset", { ...adminAuth, id: adminQuiz.id });
    setMessage(message, "Die Runde wurde beendet.", false);
    refreshAdmin();
    refreshPlayer();
  } catch (error) {
    setMessage(message, error.message, true);
  }
});

/* =========================================================
   Aktualisieren
   ========================================================= */

function render(state) {
  lastState = state;
  renderLobby(state);
  if (inGame(state)) renderGame(state);
  else if (stageKey) {
    stageKey = "";
    builtNumber = 0;
    $("#game-stage").innerHTML = "";
  }
  renderFinished(state);
  updateView();
}

let playerBusy = false;
async function refreshPlayer() {
  if (!playerCode || playerBusy) return;
  playerBusy = true;
  const code = playerCode;
  try {
    const state = await api("/api/state", { deviceId, code });
    if (code === playerCode) render(state);
  } catch (error) {
    if (error.status === 404 && code === playerCode) leaveQuiz(error.message);
    else if (code === playerCode) $("#status-box").textContent = "⚠️ " + error.message;
  } finally {
    playerBusy = false;
  }
}

let hostBusy = false;
async function refreshHost() {
  if (!hostOpen || !hostQuiz || hostBusy) return;
  hostBusy = true;
  try {
    const state = await api("/api/state", { deviceId, code: hostQuiz.code });
    if (hostOpen) renderHost(state);
  } catch (error) {
    setMessage($("#host-message"), error.message, true);
  } finally {
    hostBusy = false;
  }
}

async function refreshAdmin() {
  if (!adminOpen || !adminAuth || hostOpen) return;
  try {
    if (adminQuiz) {
      renderAdminStatus(await api("/api/state", { deviceId, code: adminQuiz.code }));
    } else {
      renderQuizList((await api("/api/admin/quizzes", adminAuth)).quizzes);
    }
  } catch {
    // Beim nächsten Durchlauf wird es erneut versucht.
  }
}

function loop(task, delay) {
  const run = async () => {
    await task();
    setTimeout(run, typeof delay === "function" ? delay() : delay);
  };
  run();
}

// Während einer Runde öfter nachfragen, damit sich alles live anfühlt.
loop(refreshPlayer, () => (lastState && lastState.status === "playing" ? 700 : 1500));
loop(refreshHost, () => (hostState && hostState.status === "playing" ? 600 : 1200));
loop(refreshAdmin, 2000);
setInterval(() => { tickPlayer(); tickHost(); }, 100);

Sound.setMuted(Sound.isMuted());
applyConfig();
updateView();

// Direkt beitreten über einen Link wie /?code=ABCDE (z. B. vom QR-Code)
(function joinFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return;
  window.history.replaceState(null, "", window.location.pathname);
  if (code.toUpperCase() !== playerCode) enterCode(code);
})();
